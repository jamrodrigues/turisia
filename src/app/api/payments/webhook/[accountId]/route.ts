import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { loadPaymentConfig } from '@/lib/payments/config'
import { verifyWebhookSignature, getOrder, getPayment } from '@/lib/payments/mercadopago'
import { resumeFlowRunAfterPayment } from '@/lib/flows/engine'

// ============================================================
// POST /api/payments/webhook/[accountId]
//
// Per-account Mercado Pago notification endpoint — the account admin
// configures this exact URL (with their own account id) as the
// notification URL in Mercado Pago's "Your integrations → Webhooks"
// panel. The account id in the path is not itself a secret; the
// x-signature HMAC check (using the account's own webhook_secret) is
// what actually authenticates the request — same posture as the
// account-scoped-but-not-secret path segments already used for
// storage paths (account-<uuid>/...) elsewhere in this codebase.
//
// ALWAYS re-fetches the order from Mercado Pago (`getOrder`) before
// treating a payment as confirmed — the webhook body itself is only a
// prompt to go check, never proof on its own (standard Mercado Pago
// integration guidance, and the same "never trust the caller" posture
// as every other inbound webhook in this app).
//
// Responds 200 quickly and unconditionally (Mercado Pago retries on
// non-2xx, every 15 min, per their docs) — an unmatched/duplicate/
// not-yet-approved notification is not an error, just a no-op.
// ============================================================

interface MpWebhookBody {
  type?: string
  action?: string
  data?: { id?: string }
}

export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params
  const db = supabaseAdmin()

  const body = (await request.json().catch(() => null)) as MpWebhookBody | null
  const dataId = body?.data?.id ?? new URL(request.url).searchParams.get('data.id')

  const paymentConfig = await loadPaymentConfig(db, accountId)
  if (!paymentConfig) {
    // No payments configured for this account (or config was removed
    // after the webhook URL was already saved on Mercado Pago's side)
    // — nothing we can or should do with this notification.
    return NextResponse.json({ ok: true, skipped: 'not_configured' })
  }

  const valid = verifyWebhookSignature({
    xSignature: request.headers.get('x-signature'),
    xRequestId: request.headers.get('x-request-id'),
    dataId: dataId ?? null,
    secret: paymentConfig.webhookSecret ?? '',
  })
  if (!valid) {
    console.error(`[payments webhook] invalid signature for account ${accountId}`)
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  if (!dataId) {
    return NextResponse.json({ ok: true, skipped: 'no_data_id' })
  }

  // Mark a reserva paid + resume its flow, idempotently. Shared by both
  // reconciliation paths below (Pix/Orders-API and Checkout Pro) so
  // "already paid" / concurrent-webhook handling lives in one place.
  async function markPaidAndResume(reservaId: string): Promise<boolean> {
    const { data: updated, error: updErr } = await db
      .from('reservas')
      .update({ pagamento_status: 'pago', paid_at: new Date().toISOString() })
      .eq('id', reservaId)
      .neq('pagamento_status', 'pago')
      .select('id')
      .maybeSingle()
    if (updErr) {
      console.error('[payments webhook] failed to mark reserva paid:', updErr.message)
      return false
    }
    if (updated) await resumeFlowRunAfterPayment(reservaId)
    return true
  }

  // data.id may be the order id or the payment id depending on
  // notification topic — match on either, then always re-fetch by our
  // own stored order id (see column comments, 062). This is the
  // Pix/Orders-API v2 path (createPixOrder) — the id was already known
  // and stored on the reserva at charge-creation time.
  const { data: reserva, error } = await db
    .from('reservas')
    .select('id, mp_order_id, pagamento_status')
    .or(`mp_order_id.eq.${dataId},mp_payment_id.eq.${dataId}`)
    .maybeSingle()

  if (reserva?.mp_order_id) {
    if (reserva.pagamento_status === 'pago') {
      return NextResponse.json({ ok: true, skipped: 'already_paid' })
    }
    try {
      const order = await getOrder(paymentConfig.accessToken, reserva.mp_order_id)
      if (!order.approved) {
        return NextResponse.json({ ok: true, status: order.status })
      }
      await markPaidAndResume(reserva.id)
      return NextResponse.json({ ok: true, status: 'approved' })
    } catch (err) {
      console.error('[payments webhook] getOrder failed:', err instanceof Error ? err.message : err)
      // Non-2xx would make Mercado Pago retry — appropriate here since
      // this is our own transient failure (network, MP API hiccup), not
      // "this notification is invalid".
      return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
  }
  if (error) {
    console.error('[payments webhook] reserva lookup failed:', error.message)
  }

  // No pre-stored id matched — this notification's `data.id` is a
  // Checkout Pro PAYMENT id (createCheckoutPreference/072), which
  // doesn't exist until the customer actually pays, so it was never
  // stored on the reserva. Re-fetch the payment itself and match by
  // `external_reference` (the reserva id we set when creating the
  // preference) instead.
  try {
    const payment = await getPayment(paymentConfig.accessToken, dataId)
    if (!payment.externalReference) {
      return NextResponse.json({ ok: true, skipped: 'no_matching_reserva' })
    }
    const { data: checkoutReserva } = await db
      .from('reservas')
      .select('id, pagamento_status')
      .eq('id', payment.externalReference)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!checkoutReserva) {
      return NextResponse.json({ ok: true, skipped: 'no_matching_reserva' })
    }
    if (checkoutReserva.pagamento_status === 'pago') {
      return NextResponse.json({ ok: true, skipped: 'already_paid' })
    }
    if (!payment.approved) {
      return NextResponse.json({ ok: true, status: payment.status })
    }
    await markPaidAndResume(checkoutReserva.id)
    return NextResponse.json({ ok: true, status: 'approved' })
  } catch (err) {
    console.error('[payments webhook] getPayment failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
