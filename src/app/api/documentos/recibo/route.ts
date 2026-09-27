import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { renderReciboPdf, reciboFilename } from '@/lib/flows/recibo'

interface ReservaForRecibo {
  id: string
  data: string
  quantidade_pessoas: number
  account_id: string
  pagamento_status: string | null
  pagamento_valor: number | null
  paid_at: string | null
  pacotes: { name: string; price: number } | null
  contacts: { name: string | null } | null
  accounts: {
    name: string
    cnpj: string | null
    telefone: string | null
    endereco: string | null
    logo_url: string | null
  } | null
}

async function fetchLogoBytes(logoUrl: string | null): Promise<Uint8Array | null> {
  if (!logoUrl) return null
  try {
    const res = await fetch(logoUrl)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * GET /api/documentos/recibo?reserva_id=...
 *
 * On-demand recibo (payment receipt) PDF for an already-paid reserva —
 * Fase 6.2 of the market-gap plan. Agent+ only (same floor as
 * confirming/canceling a reserva). Streams the PDF back directly; no
 * storage upload, since this is a manual download, not a WhatsApp send
 * like the voucher.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const url = new URL(request.url)
    const reservaId = url.searchParams.get('reserva_id')
    if (!reservaId) {
      return NextResponse.json({ error: 'reserva_id is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('reservas')
      .select(
        'id, data, quantidade_pessoas, account_id, pagamento_status, pagamento_valor, paid_at, pacotes(name, price), contacts(name), accounts(name, cnpj, telefone, endereco, logo_url)',
      )
      .eq('id', reservaId)
      .eq('account_id', accountId) // RLS already scopes this; explicit filter keeps intent obvious.
      .maybeSingle()

    if (error || !data) {
      return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 })
    }
    const reserva = data as unknown as ReservaForRecibo

    if (reserva.pagamento_status !== 'pago') {
      return NextResponse.json(
        { error: 'Recibo só pode ser emitido para reservas com pagamento confirmado' },
        { status: 400 },
      )
    }

    const logoBytes = await fetchLogoBytes(reserva.accounts?.logo_url ?? null)

    const pdfBytes = await renderReciboPdf({
      agenciaNome: reserva.accounts?.name ?? 'Agência',
      agenciaCnpj: reserva.accounts?.cnpj ?? null,
      agenciaTelefone: reserva.accounts?.telefone ?? null,
      agenciaEndereco: reserva.accounts?.endereco ?? null,
      pacoteNome: reserva.pacotes?.name ?? 'Passeio',
      data: reserva.data,
      quantidadePessoas: reserva.quantidade_pessoas,
      valor: reserva.pagamento_valor ?? reserva.pacotes?.price ?? 0,
      clienteNome: reserva.contacts?.name ?? null,
      reservaId: reserva.id,
      paidAt: reserva.paid_at,
      logoBytes,
    })

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${reciboFilename(reserva.id)}"`,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
