#!/usr/bin/env node
/**
 * set-account-status — manually set a client's subscription state.
 *
 * Until the billing webhook is wired to a processor, this is how you
 * activate/suspend a client (e.g. after receiving/failing a payment).
 *
 * Usage:
 *   node scripts/set-account-status.mjs \
 *     --supabase-url https://xxx.supabase.co --service-key sb_secret_xxx \
 *     --account-id <uuid> --status active --plan monthly \
 *     [--period-end 2026-08-05T00:00:00Z] [--trial-end 2026-07-19T00:00:00Z]
 *
 * status: trialing | active | past_due | suspended | canceled
 * plan:   trial | monthly | annual
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, c, i, arr) => {
    if (c.startsWith('--')) a.push([c.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]])
    return a
  }, []),
)
const need = (k, env) => {
  const v = args[k] ?? (env ? process.env[env] : undefined)
  if (!v || v === true) {
    console.error(`Missing --${k}`)
    process.exit(1)
  }
  return v
}

const supabaseUrl = need('supabase-url', 'NEXT_PUBLIC_SUPABASE_URL')
const serviceKey = need('service-key', 'SUPABASE_SERVICE_ROLE_KEY')
const accountId = need('account-id')
const status = need('status')
const plan = args.plan
const periodEnd = args['period-end']
const trialEnd = args['trial-end']

const STATUSES = ['trialing', 'active', 'past_due', 'suspended', 'canceled']
if (!STATUSES.includes(status)) {
  console.error(`status must be one of: ${STATUSES.join(', ')}`)
  process.exit(1)
}

const update = { subscription_status: status, updated_at: new Date().toISOString() }
if (plan) update.plan = plan
if (periodEnd) update.current_period_end = periodEnd
if (trialEnd) update.trial_ends_at = trialEnd

const res = await fetch(
  `${supabaseUrl.replace(/\/$/, '')}/rest/v1/accounts?id=eq.${accountId}`,
  {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(update),
  },
)
const text = await res.text()
if (!res.ok) {
  console.error(`Failed (${res.status}): ${text}`)
  process.exit(1)
}
console.log(`✅ Account ${accountId} → ${status}${plan ? ` (${plan})` : ''}`)
