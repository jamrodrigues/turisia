import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * POST /api/conversations/[id]/return-to-bot
 *
 * Re-enables the AI on a conversation after a handoff. The heavy
 * lifting + authorization live in the SECURITY DEFINER RPC
 * return_conversation_to_bot (migration 033), which verifies the
 * caller is an agent+ member of the conversation's account before
 * clearing the handoff flag, unassigning the human, and resetting the
 * reply counter.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await getCurrentAccount()
    const { id } = await params

    const { error } = await supabase.rpc('return_conversation_to_bot', {
      p_conversation_id: id,
    })
    if (error) {
      // The RPC raises 42501 (not authorized) / P0002 (not found).
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
