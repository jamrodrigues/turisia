import { describe, it, expect, vi, afterEach } from 'vitest'
import crypto from 'crypto'
import {
  createPixOrder,
  getOrder,
  createCheckoutPreference,
  getPayment,
  verifyWebhookSignature,
  MercadoPagoError,
} from './mercadopago'

afterEach(() => vi.unstubAllGlobals())

function okResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: () => Promise.resolve(body) } as Response
}

describe('createPixOrder', () => {
  it('posts to /v1/orders with the pix payment method and returns the QR data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        id: 'ORD123',
        status: 'action_required',
        transactions: {
          payments: [
            {
              id: 'PAY456',
              status: 'action_required',
              payment_method: {
                qr_code: '00020126...copia-e-cola',
                qr_code_base64: 'iVBORw0KG...',
                ticket_url: 'https://mp.example/ticket',
              },
            },
          ],
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPixOrder({
      accessToken: 'APP_USR-token',
      amount: 180,
      description: 'Passeio de Buggy',
      payerEmail: 'cliente@example.com',
      externalReference: 'reserva-1',
    })

    expect(result).toEqual({
      orderId: 'ORD123',
      paymentId: 'PAY456',
      status: 'action_required',
      qrCode: '00020126...copia-e-cola',
      qrCodeBase64: 'iVBORw0KG...',
      ticketUrl: 'https://mp.example/ticket',
    })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/v1/orders')
    expect(opts.headers.Authorization).toBe('Bearer APP_USR-token')
    expect(opts.headers['X-Idempotency-Key']).toBe('reserva-reserva-1')
    const body = JSON.parse(opts.body)
    expect(body.transactions.payments[0].payment_method).toEqual({ id: 'pix', type: 'bank_transfer' })
    expect(body.total_amount).toBe('180.00')
    expect(body.payer.email).toBe('cliente@example.com')
  })

  it('throws MercadoPagoError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ message: 'invalid token' }, 401)))
    await expect(
      createPixOrder({
        accessToken: 'bad',
        amount: 100,
        description: 'x',
        payerEmail: 'a@b.com',
        externalReference: 'r1',
      }),
    ).rejects.toThrow(MercadoPagoError)
  })

  it('throws when the response is missing Pix payment data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ id: 'ORD1', transactions: { payments: [] } })))
    await expect(
      createPixOrder({
        accessToken: 'ok',
        amount: 100,
        description: 'x',
        payerEmail: 'a@b.com',
        externalReference: 'r1',
      }),
    ).rejects.toThrow(/missing Pix payment data/)
  })
})

describe('getOrder', () => {
  it('reports approved:true only when status is approved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ id: 'ORD1', status: 'action_required', transactions: { payments: [{ status: 'approved' }] } }),
      ),
    )
    const result = await getOrder('token', 'ORD1')
    expect(result).toEqual({ orderId: 'ORD1', status: 'approved', approved: true })
  })

  it('reports approved:false for a pending order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ id: 'ORD1', status: 'action_required', transactions: { payments: [{ status: 'pending' }] } }),
      ),
    )
    const result = await getOrder('token', 'ORD1')
    expect(result.approved).toBe(false)
  })
})

describe('createCheckoutPreference', () => {
  it('posts to /checkout/preferences with items/external_reference/notification_url and returns init_point', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ id: 'PREF123', init_point: 'https://mp.example/checkout/PREF123' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createCheckoutPreference({
      accessToken: 'APP_USR-token',
      amount: 180,
      description: 'Passeio de Buggy',
      payerEmail: 'cliente@example.com',
      externalReference: 'reserva-1',
      notificationUrl: 'https://turisia.example/api/payments/webhook/acc-1',
    })

    expect(result).toEqual({ preferenceId: 'PREF123', initPoint: 'https://mp.example/checkout/PREF123' })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences')
    expect(opts.headers.Authorization).toBe('Bearer APP_USR-token')
    expect(opts.headers['X-Idempotency-Key']).toBe('reserva-checkout-reserva-1')
    const body = JSON.parse(opts.body)
    expect(body.external_reference).toBe('reserva-1')
    expect(body.notification_url).toBe('https://turisia.example/api/payments/webhook/acc-1')
    expect(body.items[0]).toMatchObject({ title: 'Passeio de Buggy', quantity: 1, unit_price: 180, currency_id: 'BRL' })
    expect(body.payment_methods.installments).toBe(12)
  })

  it('respects a custom maxInstallments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: 'PREF1', init_point: 'https://x' }))
    vi.stubGlobal('fetch', fetchMock)
    await createCheckoutPreference({
      accessToken: 't',
      amount: 100,
      description: 'x',
      payerEmail: 'a@b.com',
      externalReference: 'r1',
      notificationUrl: 'https://x/webhook',
      maxInstallments: 3,
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.payment_methods.installments).toBe(3)
  })

  it('throws MercadoPagoError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ message: 'invalid token' }, 401)))
    await expect(
      createCheckoutPreference({
        accessToken: 'bad',
        amount: 100,
        description: 'x',
        payerEmail: 'a@b.com',
        externalReference: 'r1',
        notificationUrl: 'https://x/webhook',
      }),
    ).rejects.toThrow(MercadoPagoError)
  })

  it('throws when the response is missing id/init_point', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({})))
    await expect(
      createCheckoutPreference({
        accessToken: 'ok',
        amount: 100,
        description: 'x',
        payerEmail: 'a@b.com',
        externalReference: 'r1',
        notificationUrl: 'https://x/webhook',
      }),
    ).rejects.toThrow(/missing preference id/)
  })
})

describe('getPayment', () => {
  it('reports approved:true and the external_reference for an approved payment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ status: 'approved', external_reference: 'reserva-1' })),
    )
    const result = await getPayment('token', 'PAY1')
    expect(result).toEqual({ paymentId: 'PAY1', status: 'approved', approved: true, externalReference: 'reserva-1' })
  })

  it('reports approved:false for a pending payment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ status: 'pending', external_reference: 'r1' })))
    const result = await getPayment('token', 'PAY1')
    expect(result.approved).toBe(false)
  })

  it('throws MercadoPagoError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ message: 'not found' }, 404)))
    await expect(getPayment('token', 'missing')).rejects.toThrow(MercadoPagoError)
  })
})

describe('verifyWebhookSignature', () => {
  const SECRET = 'test-secret'

  function sign(manifest: string, secret = SECRET): string {
    return crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  }

  it('accepts a correctly-signed notification', () => {
    const ts = '1704908010'
    const dataId = '999999999'
    const requestId = 'req-abc'
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`
    const v1 = sign(manifest)
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: requestId,
        dataId,
        secret: SECRET,
      }),
    ).toBe(true)
  })

  it('lowercases data.id before signing', () => {
    const ts = '1704908010'
    const dataId = 'ABC123'
    const requestId = 'req-abc'
    const manifest = `id:abc123;request-id:${requestId};ts:${ts};`
    const v1 = sign(manifest)
    expect(
      verifyWebhookSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: requestId, dataId, secret: SECRET }),
    ).toBe(true)
  })

  it('omits a missing field from the manifest rather than leaving a blank segment', () => {
    const ts = '1704908010'
    const dataId = '999999999'
    // No x-request-id this time.
    const manifest = `id:${dataId};ts:${ts};`
    const v1 = sign(manifest)
    expect(
      verifyWebhookSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: null, dataId, secret: SECRET }),
    ).toBe(true)
  })

  it('rejects a tampered signature', () => {
    const ts = '1704908010'
    const dataId = '999999999'
    expect(
      verifyWebhookSignature({
        xSignature: `ts=${ts},v1=${'0'.repeat(64)}`,
        xRequestId: 'req-abc',
        dataId,
        secret: SECRET,
      }),
    ).toBe(false)
  })

  it('rejects when signed with the wrong secret', () => {
    const ts = '1704908010'
    const dataId = '999999999'
    const requestId = 'req-abc'
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
    const v1 = sign(manifest, 'wrong-secret')
    expect(
      verifyWebhookSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: requestId, dataId, secret: SECRET }),
    ).toBe(false)
  })

  it('rejects a missing or malformed x-signature header', () => {
    expect(verifyWebhookSignature({ xSignature: null, xRequestId: 'r', dataId: 'd', secret: SECRET })).toBe(false)
    expect(verifyWebhookSignature({ xSignature: 'garbage', xRequestId: 'r', dataId: 'd', secret: SECRET })).toBe(
      false,
    )
  })

  it('rejects when no secret is configured', () => {
    expect(
      verifyWebhookSignature({ xSignature: 'ts=1,v1=abc', xRequestId: 'r', dataId: 'd', secret: '' }),
    ).toBe(false)
  })
})
