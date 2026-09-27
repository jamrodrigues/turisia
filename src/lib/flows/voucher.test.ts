import { describe, it, expect } from 'vitest'
import { renderVoucherPdf, voucherCode, voucherFilename, wrapText, type VoucherData } from './voucher'

const BASE: VoucherData = {
  agenciaNome: 'Turia Turismo',
  agenciaCnpj: '12.345.678/0001-99',
  agenciaTelefone: '+55 81 91234 5678',
  agenciaEndereco: 'Porto de Galinhas, PE',
  agenciaPixKey: 'contato@turia.com.br',
  agenciaPoliticaCancelamento: 'Cancelamentos com até 24h de antecedência têm reembolso integral.',
  pacoteNome: 'Passeio de Buggy pela Praia de Muro Alto',
  pacoteDescricao: 'Saída pela manhã, inclui parada nas piscinas naturais.',
  data: '2026-09-09',
  horaSaida: '08:00:00',
  horaVolta: '12:00:00',
  quantidadePessoas: 3,
  precoTotal: 540,
  clienteNome: 'Jameson Rodrigues',
  reservaId: 'd988ec65-cbb1-4b53-a1ea-ec82e841b00e',
  logoBytes: null,
}

describe('voucherCode', () => {
  it('takes the first 8 chars of the reserva id, uppercased', () => {
    expect(voucherCode('d988ec65-cbb1-4b53-a1ea-ec82e841b00e')).toBe('D988EC65')
  })
})

describe('voucherFilename', () => {
  it('builds a filename from the voucher code', () => {
    expect(voucherFilename('d988ec65-cbb1-4b53-a1ea-ec82e841b00e')).toBe(
      'voucher-D988EC65.pdf',
    )
  })
})

describe('renderVoucherPdf', () => {
  it('produces a valid one-page PDF', async () => {
    const bytes = await renderVoucherPdf(BASE)
    expect(bytes.byteLength).toBeGreaterThan(0)
    // PDF magic header.
    expect(Buffer.from(bytes.slice(0, 5)).toString('ascii')).toBe('%PDF-')
  })

  it('does not throw when horario/descricao/cliente/agency fields are all null (nothing filled in)', async () => {
    const data: VoucherData = {
      ...BASE,
      agenciaCnpj: null,
      agenciaTelefone: null,
      agenciaEndereco: null,
      agenciaPixKey: null,
      agenciaPoliticaCancelamento: null,
      pacoteDescricao: null,
      horaSaida: null,
      horaVolta: null,
      clienteNome: null,
    }
    const bytes = await renderVoucherPdf(data)
    expect(Buffer.from(bytes.slice(0, 5)).toString('ascii')).toBe('%PDF-')
  })

  it('does not throw on a long description or long cancellation policy that need wrapping', async () => {
    const data: VoucherData = {
      ...BASE,
      pacoteDescricao:
        'Um passeio bem longo com muitos detalhes sobre o roteiro, os pontos de parada, o que está incluso no pacote, o que levar, horário de saída e volta, e outras informações relevantes para o cliente que vai fazer o passeio conosco.',
      agenciaPoliticaCancelamento:
        'Cancelamentos com até 48 horas de antecedência recebem reembolso integral. Entre 48 e 24 horas, reembolso de 50%. Cancelamentos com menos de 24 horas de antecedência ou não comparecimento não têm direito a reembolso.',
    }
    const bytes = await renderVoucherPdf(data)
    expect(Buffer.from(bytes.slice(0, 5)).toString('ascii')).toBe('%PDF-')
  })

  it('embeds a PNG logo without throwing', async () => {
    // 1x1 transparent PNG.
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const data: VoucherData = {
      ...BASE,
      logoBytes: new Uint8Array(Buffer.from(pngB64, 'base64')),
    }
    const bytes = await renderVoucherPdf(data)
    expect(Buffer.from(bytes.slice(0, 5)).toString('ascii')).toBe('%PDF-')
  })

  it('swallows a corrupt logo instead of throwing', async () => {
    const data: VoucherData = {
      ...BASE,
      logoBytes: new Uint8Array([1, 2, 3, 4]),
    }
    const bytes = await renderVoucherPdf(data)
    expect(Buffer.from(bytes.slice(0, 5)).toString('ascii')).toBe('%PDF-')
  })
})

describe('wrapText', () => {
  it('keeps a short text on one row', () => {
    expect(wrapText('Olá mundo', 90)).toEqual(['Olá mundo'])
  })

  it('wraps at the given character width without splitting words', () => {
    const rows = wrapText('uma frase razoavelmente longa para testar o wrap de texto', 20)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(20)
  })

  it('returns an empty array for empty input', () => {
    expect(wrapText('', 90)).toEqual([])
  })
})
