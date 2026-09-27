import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrieveBookableTopics } from './booking-topics'

function makeDb(rows: Record<string, unknown>[] | null, error: unknown = null) {
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => Promise.resolve({ data: rows, error }),
          }),
        }),
      }),
    }),
  }
  return db as unknown as SupabaseClient
}

describe('retrieveBookableTopics', () => {
  it('returns [] when no active flow has an ai_topic', async () => {
    expect(await retrieveBookableTopics(makeDb([]), 'acct')).toEqual([])
  })

  it('returns [] on a query error instead of throwing', async () => {
    expect(await retrieveBookableTopics(makeDb(null, new Error('boom')), 'acct')).toEqual([])
  })

  it('returns the distinct list of topics', async () => {
    const rows = [{ ai_topic: 'buggy' }, { ai_topic: 'mergulho' }]
    expect(await retrieveBookableTopics(makeDb(rows), 'acct')).toEqual(['buggy', 'mergulho'])
  })

  it('dedupes repeated topics', async () => {
    const rows = [{ ai_topic: 'buggy' }, { ai_topic: 'buggy' }]
    expect(await retrieveBookableTopics(makeDb(rows), 'acct')).toEqual(['buggy'])
  })
})
