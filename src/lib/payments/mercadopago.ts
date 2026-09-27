import crypto from 'crypto'

// ============================================================
// Mercado Pago Orders API v2 client — Pix only.
//
// Verified live against Mercado Pago's own docs (2026-09-08, since
// their API/docs churn and must never be guessed — see the
// `supabase`/`claude-api` skill discipline applied to third-party
// APIs too):
//   - POST https://api.mercadopago.com/v1/orders is the CURRENT
//     recommended integration (Orders API v2 supersedes the older
//     /v1/payments for new integrations).
//   - Pix charge: payment_method.id = 'pix', type = 'bank_transfer'.
//   - The Pix "copia e cola" string and QR image live at
//     transactions.payments[0].payment_method.qr_code /
//     qr_code_base64 / ticket_url.
//   - Webhook signature: HMAC-SHA256 of the manifest
//     `id:<data.id lowercased>;request-id:<x-request-id>;ts:<ts>;`
//     (only include segments whose source value is present), keyed
//     with the account's webhook secret, hex-compared to the `v1`
//     field of the `x-signature` header (`ts=...,v1=...`).
// ============================================================

const ORDERS_URL = 'https://api.mercadopago.com/v1/orders'

export interface CreatePixOrderArgs {
  accessToken: string
  /** Reais, e.g. 180.00 */
  amount: number
  description: string
  payerEmail: string
  /** Our reserva id — round-trips back on the order for reconciliation. */
  externalReference: string
}

export interface CreatePixOrderResult {
  orderId: string
  paymentId: string
  status: string
  qrCode: string
  qrCodeBase64: string
  ticketUrl: string | null
}

/**
 * Creates a Pix charge for one reservation. Throws `MercadoPagoError`
 * on any non-2xx response — callers decide how to surface that (the
 * `create_payment` flow node treats it as a hard failure, same
 * severity as `criar_reserva` returning `sucesso: false`).
 */
export async function createPixOrder(args: CreatePixOrderArgs): Promise<CreatePixOrderResult> {
  const amount = args.amount.toFixed(2)
  const res = await fetch(ORDERS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
      // Mercado Pago dedupes retried creates on this header — a flow
      // retry (e.g. transient network error) must not double-charge.
      'X-Idempotency-Key': `reserva-${args.externalReference}`,
    },
    body: JSON.stringify({
      type: 'online',
      processing_mode: 'automatic',
      external_reference: args.externalReference,
      total_amount: amount,
      payer: { email: args.payerEmail },
      transactions: {
        payments: [
          {
            amount,
            payment_method: { id: 'pix', type: 'bank_transfer' },
          },
        ],
      },
    }),
  })

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new MercadoPagoError(
      `Mercado Pago order creation failed (${res.status}): ${body?.message ?? 'unknown error'}`,
      res.status,
    )
  }

  const payment = body?.transactions?.payments?.[0]
  const pm = payment?.payment_method
  if (!payment?.id || !pm?.qr_code) {
    throw new MercadoPagoError('Mercado Pago response missing Pix payment data', res.status)
  }

  return {
    orderId: body.id,
    paymentId: payment.id,
    status: payment.status ?? body.status,
    qrCode: pm.qr_code,
    qrCodeBase64: pm.qr_code_base64 ?? '',
    ticketUrl: pm.ticket_url ?? null,
  }
}

export interface OrderStatus {
  orderId: string
  status: string
  /** True once Mercado Pago has actually confirmed the transfer. */
  approved: boolean
}

/**
 * Re-fetches an order's status directly from Mercado Pago. ALWAYS
 * call this after a webhook notification before trusting a payment is
 * confirmed — the webhook body itself is not proof, only a prompt to
 * go check (standard Mercado Pago integration guidance).
 */
export async function getOrder(accessToken: string, orderId: string): Promise<OrderStatus> {
  const res = await fetch(`${ORDERS_URL}/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new MercadoPagoError(
      `Mercado Pago order fetch failed (${res.status}): ${body?.message ?? 'unknown error'}`,
      res.status,
    )
  }
  const payment = body?.transactions?.payments?.[0]
  const status: string = payment?.status ?? body?.status ?? 'unknown'
  return { orderId, status, approved: status === 'approved' }
}

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message)
    this.name = 'MercadoPagoError'
  }
}

export interface WebhookSignatureInput {
  /** Raw `x-signature` header, e.g. "ts=123,v1=abcdef". */
  xSignature: string | null
  /** Raw `x-request-id` header. */
  xRequestId: string | null
  /** The notification's `data.id` field (payment/order id). */
  dataId: string | null
  secret: string
}

/**
 * Validates a Mercado Pago webhook's `x-signature` header. Manifest
 * format and HMAC-SHA256 confirmed against Mercado Pago's own
 * documentation (see file header) — this is the ONLY function that
 * should ever parse/verify it; don't re-derive the manifest string
 * elsewhere.
 *
 * Returns false (never throws) for any malformed input — a webhook
 * with a missing/garbled signature is simply not valid, not a bug.
 */
export function verifyWebhookSignature(input: WebhookSignatureInput): boolean {
  const { xSignature, xRequestId, dataId, secret } = input
  if (!xSignature || !secret) return false

  const parts = Object.fromEntries(
    xSignature.split(',').map((p) => {
      const [k, ...rest] = p.trim().split('=')
      return [k, rest.join('=')]
    }),
  )
  const ts = parts.ts
  const v1 = parts.v1
  if (!ts || !v1) return false

  const manifestParts: string[] = []
  if (dataId) manifestParts.push(`id:${dataId.toLowerCase()};`)
  if (xRequestId) manifestParts.push(`request-id:${xRequestId};`)
  manifestParts.push(`ts:${ts};`)
  const manifest = manifestParts.join('')

  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')

  // Constant-time compare — a timing side-channel on this check would
  // let an attacker binary-search their way to a valid signature.
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(v1, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
