import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { maybeResetReplyCountForNewSession } from './dispatch'

/**
 * Fake Supabase client for maybeResetReplyCountForNewSession:
 *   messages:      from().select().eq().order().limit(2) → { data }
 *   conversations: from().update().eq().gt()            → resolves
 * Records whether the conversations UPDATE ran and with what payload.
 */
function fakeDb(recentRows: { created_at: string }[]) {
  const updates: Record<string, unknown>[] = []

  const messagesChain = {
    select: () => messagesChain,
    eq: () => messagesChain,
    order: () => messagesChain,
    limit: () => Promise.resolve({ data: recentRows, error: null }),
  }

  const conversationsChain = {
    update: (payload: Record<string, unknown>) => {
      updates.push(payload)
      return conversationsChain
    },
    eq: () => conversationsChain,
    gt: () => Promise.resolve({ error: null }),
  }

  const db = {
    from: (table: string) =>
      table === 'messages' ? messagesChain : conversationsChain,
  } as unknown as SupabaseClient

  return { db, updates }
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const HOUR = 60 * 60 * 1000

describe('maybeResetReplyCountForNewSession', () => {
  it('resets the count when the previous turn is >24h old', async () => {
    // [0] = current inbound (just now), [1] = previous turn (25h ago).
    const { db, updates } = fakeDb([
      { created_at: iso(0) },
      { created_at: iso(25 * HOUR) },
    ])
    await maybeResetReplyCountForNewSession(db, 'conv-1')
    expect(updates).toEqual([{ ai_reply_count: 0 }])
  })

  it('does NOT reset when the previous turn is within 24h', async () => {
    const { db, updates } = fakeDb([
      { created_at: iso(0) },
      { created_at: iso(2 * HOUR) },
    ])
    await maybeResetReplyCountForNewSession(db, 'conv-1')
    expect(updates).toEqual([])
  })

  it('does nothing for the first message in a thread (no previous turn)', async () => {
    const { db, updates } = fakeDb([{ created_at: iso(0) }])
    await maybeResetReplyCountForNewSession(db, 'conv-1')
    expect(updates).toEqual([])
  })

  it('never throws — swallows a DB error to a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.reject(new Error('boom')),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    await expect(
      maybeResetReplyCountForNewSession(db, 'conv-1'),
    ).resolves.toBeUndefined()
    warn.mockRestore()
  })
})
