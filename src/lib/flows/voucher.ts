import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// ============================================================
// Voucher PDF — the customer-facing proof of booking sent after
// `create_reservation` succeeds. Deliberately plain (pdf-lib draws
// text directly, no HTML/headless-browser rendering pipeline): the
// agency's self-hosted box has no Chromium available, and a voucher
// is a receipt, not a marketing asset — legible beats fancy.
// ============================================================

export interface VoucherData {
  agenciaNome: string
  agenciaCnpj: string | null
  agenciaTelefone: string | null
  agenciaEndereco: string | null
  agenciaPixKey: string | null
  agenciaPoliticaCancelamento: string | null
  pacoteNome: string
  pacoteDescricao: string | null
  data: string // YYYY-MM-DD
  horaSaida: string | null // HH:MM:SS or null (no fixed slot)
  horaVolta: string | null
  quantidadePessoas: number
  precoTotal: number
  clienteNome: string | null
  reservaId: string
  /**
   * Raw image bytes for the agency's logo (PNG or JPEG), already
   * fetched by the caller — kept out of this function so it stays
   * pure/network-free and unit-testable. `null` when the agency
   * hasn't uploaded one; the header layout just shifts to fill the
   * space instead of leaving a gap.
   */
  logoBytes: Uint8Array | null
}

/** Shared with recibo.ts — same date/currency conventions across every generated document. */
export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function formatTime(t: string): string {
  return t.slice(0, 5)
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** First 8 chars of the reserva UUID, uppercased — short enough to read over the phone. */
export function voucherCode(reservaId: string): string {
  return reservaId.slice(0, 8).toUpperCase()
}

export function voucherFilename(reservaId: string): string {
  return `voucher-${voucherCode(reservaId)}.pdf`
}

/**
 * Greedy word-wrap at a rough character width — good enough for a
 * receipt's body text, not a real typesetting engine (no font-metric
 * measurement). Pure, so both the description and the cancellation
 * policy can share it and it's independently testable.
 */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const rows: string[] = []
  let row = ''
  for (const w of words) {
    const candidate = row ? `${row} ${w}` : w
    if (candidate.length > maxChars) {
      if (row) rows.push(row)
      row = w
    } else {
      row = candidate
    }
  }
  if (row) rows.push(row)
  return rows
}

const PAGE_WIDTH = 595.28 // A4 at 72dpi
const PAGE_HEIGHT = 841.89
const MARGIN = 56
const LOGO_MAX = 48

/**
 * Renders the voucher as a one-page A4 PDF. Network-free (the logo
 * arrives pre-fetched as bytes) so it's unit-testable on plain input
 * data — see voucher.test.ts.
 */
export async function renderVoucherPdf(data: VoucherData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  let y = 780
  const ink = rgb(0.1, 0.1, 0.12)
  const muted = rgb(0.45, 0.45, 0.48)
  const accent = rgb(0.42, 0.24, 0.9) // matches the app's primary purple, close enough in print

  const line = (
    text: string,
    opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ) => {
    const { size = 11, f = font, color = ink, gap = 18 } = opts
    page.drawText(text, { x: MARGIN, y, size, font: f, color })
    y -= gap
  }

  const wrapAndDraw = (text: string, maxChars: number, size: number, color: ReturnType<typeof rgb>) => {
    for (const row of wrapText(text, maxChars)) line(row, { size, color, gap: 15 })
  }

  // Logo, top-right — best-effort: an embed failure (corrupt bytes,
  // unsupported format that slipped past the bucket's MIME allow-list)
  // never breaks the voucher, it just renders without one.
  if (data.logoBytes) {
    try {
      const isPng = data.logoBytes[0] === 0x89 // PNG magic byte; JPEG starts 0xFF
      const image = isPng ? await doc.embedPng(data.logoBytes) : await doc.embedJpg(data.logoBytes)
      const scale = Math.min(LOGO_MAX / image.width, LOGO_MAX / image.height, 1)
      const w = image.width * scale
      const h = image.height * scale
      page.drawImage(image, { x: PAGE_WIDTH - MARGIN - w, y: PAGE_HEIGHT - 40 - h, width: w, height: h })
    } catch {
      // Swallow — see comment above.
    }
  }

  line(data.agenciaNome, { size: 13, f: bold, color: accent, gap: 16 })
  const agencyContactBits = [data.agenciaCnpj && `CNPJ ${data.agenciaCnpj}`, data.agenciaTelefone, data.agenciaEndereco]
    .filter(Boolean)
    .join(' · ')
  if (agencyContactBits) line(agencyContactBits, { size: 8.5, color: muted, gap: 20 })
  else y -= 4

  line('VOUCHER DE RESERVA', { size: 20, f: bold, gap: 8 })
  line(`Código: ${voucherCode(data.reservaId)}`, { size: 10, color: muted, gap: 30 })

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.87),
  })
  y -= 26

  line(data.pacoteNome, { size: 16, f: bold, gap: 22 })
  if (data.pacoteDescricao) {
    wrapAndDraw(data.pacoteDescricao, 90, 10.5, muted)
    y -= 10
  }

  const field = (label: string, value: string) => {
    page.drawText(label, { x: MARGIN, y, size: 9.5, font, color: muted })
    page.drawText(value, { x: MARGIN + 130, y, size: 11.5, font: bold, color: ink })
    y -= 24
  }

  field('Data', formatDateBR(data.data))
  field(
    'Horário',
    data.horaSaida
      ? `${formatTime(data.horaSaida)}${data.horaVolta ? ` – ${formatTime(data.horaVolta)}` : ''}`
      : 'A combinar',
  )
  field('Pessoas', String(data.quantidadePessoas))
  field('Valor', formatBRL(data.precoTotal))
  field('Cliente', data.clienteNome ?? '—')
  if (data.agenciaPixKey) field('Pix', data.agenciaPixKey)

  y -= 16
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.87),
  })
  y -= 26

  line('Apresente este voucher (impresso ou no celular) no embarque.', {
    size: 10,
    color: muted,
    gap: 15,
  })
  line('Chegue com 15 minutos de antecedência no ponto de encontro.', {
    size: 10,
    color: muted,
    gap: 15,
  })

  if (data.agenciaPoliticaCancelamento) {
    y -= 10
    line('Política de cancelamento', { size: 9.5, f: bold, color: muted, gap: 14 })
    wrapAndDraw(data.agenciaPoliticaCancelamento, 95, 9, muted)
  }

  return doc.save()
}
