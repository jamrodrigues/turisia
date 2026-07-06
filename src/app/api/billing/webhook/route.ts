import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * Provider-agnostic billing webhook.
 *
 * Instead of hard-coupling to one processor, the CRM accepts a tiny
 * normalized event and maps it onto accounts.subscription_status. Wire
 * ANY provider to it:
 *   - Stripe: a thin Stripe webhook (edge function / n8n) translates
 *     customer.subscription.* into this shape.
 *   - Mercado Pago / manual / n8n: same.
 *
 * Auth: a shared secret (BILLING_WEBHOOK_SECRET) in the x-billing-secret
 * header. Set it in the deploy env and on the caller.
 *
 * Body:
 *   {
 *     account_id: uuid,
 *     status: 'trialing'|'active'|'past_due'|'suspended'|'canceled',
 *     plan?: 'trial'|'monthly'|'annual',
 *     current_period_end?: ISO8601,
 *     trial_ends_at?: ISO8601
 *   }
 */

const STATUSES = ['trialing', 'active', 'past_due', 'suspended', 'canceled']
const PLANS = ['trial', 'monthly', 'annual']

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: Request) {
  const secret = process.env.BILLING_WEBHOOK_SECRET
  if (!secret) {
    console.error('[billing webhook] BILLING_WEBHOOK_SECRET not set — refusing')
    return NextResponse.json({ error: 'billing not configured' }, { status: 503 })
  }
  if (request.headers.get('x-billing-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    account_id?: string
    status?: string
    plan?: string
    current_period_end?: string
    trial_ends_at?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (!body.account_id || !body.status || !STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: 'account_id and a valid status are required' },
      { status: 400 },
    )
  }
  if (body.plan && !PLANS.includes(body.plan)) {
    return NextResponse.json({ error: 'invalid plan' }, { status: 400 })
  }

  const update: Record<string, unknown> = {
    subscription_status: body.status,
    updated_at: new Date().toISOString(),
  }
  if (body.plan) update.plan = body.plan
  if (body.current_period_end) update.current_period_end = body.current_period_end
  if (body.trial_ends_at) update.trial_ends_at = body.trial_ends_at

  const { error } = await admin()
    .from('accounts')
    .update(update)
    .eq('id', body.account_id)

  if (error) {
    console.error('[billing webhook] update failed:', error)
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
