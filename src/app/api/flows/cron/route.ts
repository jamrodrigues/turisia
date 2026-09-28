import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveFallbackPolicy } from '@/lib/flows/fallback'
import { engineSendText } from '@/lib/flows/meta-send'

/**
 * Fraction of `on_timeout_hours` at which an abandoned run gets one
 * nudge message before the sweep gives up on it entirely — e.g. a 24h
 * default timeout nudges at the 12h mark, leaving another 12h for the
 * customer to come back before `timed_out`. A closing flow that goes
 * quiet mid-booking is a sale slipping away silently; one reminder
 * costs nothing and recovers some of them.
 */
const REMINDER_FRACTION = 0.5

const REMINDER_TEXT =
  'Ainda tá aí? 😊 Sua reserva ficou pela metade — se quiser continuar de onde parou, é só responder aqui!'

/**
 * Sweep abandoned active flow runs.
 *
 * Reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h). A run past
 * `REMINDER_FRACTION` of that window (and not yet nudged) gets one
 * best-effort WhatsApp reminder; a run past the full cutoff is marked
 * `timed_out`. Writes a matching `flow_run_events` row for the audit
 * trail either way.
 *
 * Without the timeout half of this sweep, a customer who abandons a
 * flow mid-conversation keeps a row in `idx_one_active_run_per_contact`
 * (the partial unique index on `flow_runs WHERE status='active'`)
 * forever — blocking any new triggers for them. The cron is therefore
 * not optional.
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET` so operators only have one
 * secret to provision. The two endpoints (`/api/automations/cron`
 * and this one) are independent operations; we keep them on separate
 * URLs so one failing doesn't block the other.
 *
 * Hosting: hit on a schedule (Vercel Cron / GitHub Actions / external
 * pinger). A 5-minute interval is more than enough for a 24h timeout
 * default; once per hour would also be acceptable for low-volume
 * tenants.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  // Constant-time compare so an attacker who can hit the endpoint
  // can't recover the secret byte-by-byte from response-time deltas.
  // Length pre-check is required by timingSafeEqual (throws otherwise)
  // and leaks only the length itself, which isn't sensitive.
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const now = new Date()

  // Pull all currently-active runs along with their parent flow's
  // fallback_policy. Joined in one query — the small set of active
  // runs per tenant keeps this cheap.
  const { data: runs, error } = await admin
    .from('flow_runs')
    .select(
      'id, flow_id, account_id, user_id, contact_id, conversation_id, last_advanced_at, reminder_sent_at, flows ( fallback_policy )',
    )
    .eq('status', 'active')

  if (error) {
    console.error('[flows-cron] active-run scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!runs?.length) return NextResponse.json({ swept: 0, reminded: 0 })

  type Row = {
    id: string
    flow_id: string
    account_id: string
    user_id: string
    contact_id: string | null
    conversation_id: string | null
    last_advanced_at: string
    reminder_sent_at: string | null
    flows: { fallback_policy: unknown } | { fallback_policy: unknown }[] | null
  }

  let swept = 0
  let reminded = 0
  for (const r of runs as Row[]) {
    const flowsField = Array.isArray(r.flows) ? r.flows[0] : r.flows
    const policy = resolveFallbackPolicy(flowsField?.fallback_policy ?? null)
    const lastAdvanced = new Date(r.last_advanced_at)
    const ageHours = (now.getTime() - lastAdvanced.getTime()) / (1000 * 60 * 60)

    if (ageHours < policy.on_timeout_hours) {
      const reminderAtHours = policy.on_timeout_hours * REMINDER_FRACTION
      if (
        ageHours >= reminderAtHours &&
        !r.reminder_sent_at &&
        r.contact_id &&
        r.conversation_id
      ) {
        // Best-effort — a failed nudge (no WhatsApp config, contact
        // gone, etc.) shouldn't crash the sweep for every other run;
        // it just gets retried next tick since reminder_sent_at stays
        // null until a send actually succeeds.
        try {
          await engineSendText({
            accountId: r.account_id,
            userId: r.user_id,
            conversationId: r.conversation_id,
            contactId: r.contact_id,
            text: REMINDER_TEXT,
          })
          await admin
            .from('flow_runs')
            .update({ reminder_sent_at: now.toISOString() })
            .eq('id', r.id)
            .eq('status', 'active')
          // 'message_sent' (not a new event_type) — the flow_run_events
          // CHECK constraint (010_flows.sql) has a fixed value list;
          // `kind: 'reminder'` in the payload disambiguates from a
          // regular node's send.
          await admin.from('flow_run_events').insert({
            flow_run_id: r.id,
            event_type: 'message_sent',
            payload: { kind: 'reminder', age_hours: Math.round(ageHours * 10) / 10 },
          })
          reminded += 1
        } catch (err) {
          console.error(
            `[flows-cron] reminder send failed for run ${r.id}:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
      continue
    }

    // Mark timed_out — guarded by the precondition `status='active'`
    // so concurrent advance from a late inbound doesn't overwrite a
    // legitimate update.
    const { data: updated } = await admin
      .from('flow_runs')
      .update({
        status: 'timed_out',
        ended_at: now.toISOString(),
        end_reason: 'stale_sweep',
      })
      .eq('id', r.id)
      .eq('status', 'active')
      .select('id')

    if (Array.isArray(updated) && updated.length > 0) {
      await admin.from('flow_run_events').insert({
        flow_run_id: r.id,
        event_type: 'timeout',
        payload: {
          age_hours: Math.round(ageHours * 10) / 10,
          policy_hours: policy.on_timeout_hours,
        },
      })
      swept += 1
    }
  }

  return NextResponse.json({ swept, reminded })
}
