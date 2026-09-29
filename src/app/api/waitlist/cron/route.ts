import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { engineSendText } from '@/lib/flows/meta-send'

/**
 * Sweep the waitlist (`lista_espera`, 073) and notify customers when a
 * cancellation frees a spot — the counterpart to
 * `join_waitlist` (generate-closing-flow.ts) putting them there in
 * the first place.
 *
 * Cancellations happen from plain UI updates (Reservas / Agenda
 * Operacional pages doing a direct `reservas.status = 'cancelada'`
 * update, no server route in between) — there's no single choke point
 * to hook a "notify the waitlist now" call into, so this polls
 * instead, same shape as flows/cron's abandonment sweep. A real
 * capacity re-check via `pacote_horario_vagas()` (058) happens here
 * regardless of what `lista_espera` rows say, so a stale/overgrown
 * waitlist can never cause an over-notify.
 *
 * Per (horario, data) group with `aguardando` rows: re-check real
 * vagas, then walk the queue OLDEST FIRST, notifying entries whose
 * cumulative party size still fits — a fair "first come, first
 * served" queue. Notifying is NOT booking: the customer still has to
 * reply and go through the normal closing-flow keyword to actually
 * claim the spot (via `criar_reserva`'s own atomic capacity check),
 * so two people notified for the same last spot can't both succeed —
 * whoever replies first wins, same as any real waitlist.
 *
 * Auth: same `AUTOMATION_CRON_SECRET` as flows/cron and
 * automations/cron — kept on its own URL so one failing doesn't block
 * the others.
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

  const { data: waiting, error } = await admin
    .from('lista_espera')
    .select('id, account_id, pacote_horario_id, data, quantidade_pessoas, contact_id, conversation_id')
    .eq('status', 'aguardando')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[waitlist-cron] scan failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!waiting?.length) return NextResponse.json({ notified: 0 })

  type Row = {
    id: string
    account_id: string
    pacote_horario_id: string
    data: string
    quantidade_pessoas: number
    contact_id: string | null
    conversation_id: string | null
  }

  // Group by (horario, data) — one capacity check per group instead of
  // per row.
  const groups = new Map<string, Row[]>()
  for (const row of waiting as Row[]) {
    const key = `${row.pacote_horario_id}:${row.data}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  let notified = 0
  for (const [, rows] of groups) {
    const { data: vagas, error: vagasErr } = await admin.rpc('pacote_horario_vagas', {
      p_horario_id: rows[0].pacote_horario_id,
      p_data: rows[0].data,
    })
    if (vagasErr || typeof vagas !== 'number' || vagas <= 0) continue

    let remaining = vagas
    for (const row of rows) {
      if (remaining < row.quantidade_pessoas) break // queue stays fair — don't skip ahead to a smaller party
      if (!row.contact_id || !row.conversation_id) continue

      try {
        await engineSendText({
          accountId: row.account_id,
          // Not consulted for tenancy by engineSendText (audit-column
          // placeholder only, never read in its body today) — no
          // natural "author" for a cron-driven notification.
          userId: '',
          conversationId: row.conversation_id,
          contactId: row.contact_id,
          text: 'Boa notícia! 🎉 Abriu uma vaga no horário que você queria. Se ainda tiver interesse, me chama por aqui que eu já vejo sua reserva!',
        })
        const { error: updErr } = await admin
          .from('lista_espera')
          .update({ status: 'notificado', notified_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('status', 'aguardando')
        if (!updErr) {
          notified += 1
          remaining -= row.quantidade_pessoas
        }
      } catch (err) {
        console.error(
          `[waitlist-cron] notify failed for lista_espera ${row.id}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  return NextResponse.json({ notified })
}
