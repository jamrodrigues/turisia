import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { engineSendText } from '@/lib/flows/meta-send'

/**
 * Sends the post-trip satisfaction survey the day after a confirmed
 * reservation's `data` — "de 1 a 5, como foi seu passeio?". The
 * customer's reply is captured by process-inbound.ts (it checks for a
 * pending 'enviado' avaliacoes row before handing the message to
 * flows/automations/AI), not by this route.
 *
 * Window: `data = yesterday` exactly, run once a day — a reserva only
 * ever gets ONE survey (UNIQUE(reserva_id) on avaliacoes, 074, backs
 * this up against a double-fire from two overlapping cron ticks).
 * Reservas with no contact/conversation (shouldn't happen for a real
 * booking, but the columns are nullable) are silently skipped — no
 * one to send it to.
 *
 * Auth: same AUTOMATION_CRON_SECRET as flows/cron, automations/cron,
 * and waitlist/cron — own URL so one failing doesn't block the others.
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
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: reservas, error } = await admin
    .from('reservas')
    .select('id, account_id, pacote_id, contact_id, conversation_id, pacotes(name)')
    .eq('status', 'confirmada')
    .eq('data', yesterday)

  if (error) {
    console.error('[surveys-cron] scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!reservas?.length) return NextResponse.json({ sent: 0 })

  type Row = {
    id: string
    account_id: string
    pacote_id: string
    contact_id: string | null
    conversation_id: string | null
    pacotes: { name: string } | { name: string }[] | null
  }

  let sent = 0
  for (const r of reservas as Row[]) {
    if (!r.contact_id || !r.conversation_id) continue

    // Skip if a survey already exists for this reserva (re-run
    // safety — the UNIQUE constraint would also catch this on
    // insert, but checking first avoids sending a duplicate message
    // before that insert fails).
    const { data: existing } = await admin
      .from('avaliacoes')
      .select('id')
      .eq('reserva_id', r.id)
      .maybeSingle()
    if (existing) continue

    const pacote = Array.isArray(r.pacotes) ? r.pacotes[0] : r.pacotes
    const pacoteName = pacote?.name ?? 'seu passeio'

    try {
      await engineSendText({
        accountId: r.account_id,
        // Not consulted for tenancy by engineSendText (audit-column
        // placeholder only) — no natural "author" for a cron send.
        userId: '',
        conversationId: r.conversation_id,
        contactId: r.contact_id,
        text: `E aí, como foi o(a) ${pacoteName}? 😊 Me dá uma nota de 1 a 5 (só responder o número) — sua opinião ajuda muito a gente!`,
      })
      const { error: insErr } = await admin.from('avaliacoes').insert({
        account_id: r.account_id,
        reserva_id: r.id,
        pacote_id: r.pacote_id,
        contact_id: r.contact_id,
        conversation_id: r.conversation_id,
      })
      if (insErr) {
        console.error(`[surveys-cron] avaliacoes insert failed for reserva ${r.id}:`, insErr.message)
        continue
      }
      sent += 1
    } catch (err) {
      console.error(
        `[surveys-cron] send failed for reserva ${r.id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return NextResponse.json({ sent })
}
