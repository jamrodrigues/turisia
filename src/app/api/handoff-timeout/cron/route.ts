import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

/** No human reply within this window after handoff → auto-return to bot. */
const TIMEOUT_MS = 2 * 60 * 60 * 1000

/**
 * Sweep conversations handed off to a human (`ai_autoreply_disabled`,
 * migration 033) where nobody actually answered — the counterpart to the
 * inbox's manual "Devolver ao robô" button
 * (`return_conversation_to_bot` RPC). That RPC requires `auth.uid()`
 * (agent-authenticated), which a cron never has, so this applies the
 * same reset directly via service-role instead of calling it.
 *
 * Eligible: `ai_autoreply_disabled = true`, `handoff_at` older than
 * TIMEOUT_MS, AND no `messages` row with `sender_type = 'agent'` created
 * after `handoff_at` — an agent who DID reply is presumably still
 * working the thread even past 2h, so this only reclaims conversations a
 * human never picked up at all.
 *
 * Auth: same `AUTOMATION_CRON_SECRET` as the other cron endpoints.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
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
  const cutoff = new Date(Date.now() - TIMEOUT_MS).toISOString()

  const { data: candidates, error } = await admin
    .from('conversations')
    .select('id, handoff_at')
    .eq('ai_autoreply_disabled', true)
    .not('handoff_at', 'is', null)
    .lt('handoff_at', cutoff)

  if (error) {
    console.error('[handoff-timeout-cron] scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!candidates?.length) return NextResponse.json({ reclaimed: 0 })

  let reclaimed = 0
  for (const conv of candidates as { id: string; handoff_at: string }[]) {
    const { count: agentReplies } = await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .eq('sender_type', 'agent')
      .gt('created_at', conv.handoff_at)
    if ((agentReplies ?? 0) > 0) continue // a human is already on it — leave it alone

    // Guarded by the same preconditions as the SELECT so a fresh manual
    // handoff (or an agent reply) landing between scan and update can't
    // be clobbered.
    const { data: updated, error: updErr } = await admin
      .from('conversations')
      .update({
        ai_autoreply_disabled: false,
        assigned_agent_id: null,
        ai_reply_count: 0,
        handoff_at: null,
        handoff_reason: null,
        handoff_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conv.id)
      .eq('ai_autoreply_disabled', true)
      .eq('handoff_at', conv.handoff_at)
      .select('id')
    if (updErr) {
      console.error(`[handoff-timeout-cron] reset failed for ${conv.id}:`, updErr.message)
      continue
    }
    if (updated && updated.length > 0) reclaimed += 1
  }

  return NextResponse.json({ reclaimed })
}
