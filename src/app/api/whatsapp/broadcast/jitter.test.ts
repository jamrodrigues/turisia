import { afterEach, describe, expect, it, vi } from 'vitest'

// The broadcast route pulls in server-only Supabase SSR (next/headers).
// Stub it so we can import the module just to exercise the pure jitter
// helper — we never call the route handler here.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { broadcastExceedsDailyLimit, uazapiSendDelayMs } from './route'

describe('uazapiSendDelayMs (broadcast jitter)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('stays within the 900–2400ms band', () => {
    for (let i = 0; i < 1000; i++) {
      const d = uazapiSendDelayMs()
      expect(d).toBeGreaterThanOrEqual(900)
      expect(d).toBeLessThanOrEqual(2400)
    }
  })

  it('maps Math.random extremes to the band edges', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(uazapiSendDelayMs()).toBe(900)
    // floor(0.999999 * 1500) = 1499 → 900 + 1499 = 2399 (max attainable).
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(uazapiSendDelayMs()).toBe(2399)
  })

  it('is not a fixed metronome across calls', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 50; i++) seen.add(uazapiSendDelayMs())
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('broadcastExceedsDailyLimit (daily send ceiling)', () => {
  it('no cap when limit is null/undefined/0', () => {
    expect(broadcastExceedsDailyLimit(null, 100, 100)).toBe(false)
    expect(broadcastExceedsDailyLimit(undefined, 100, 100)).toBe(false)
    expect(broadcastExceedsDailyLimit(0, 100, 100)).toBe(false)
  })

  it('blocks when today + batch crosses the limit', () => {
    // limit 1, already 0, batch 2 → 2 > 1 → blocked
    expect(broadcastExceedsDailyLimit(1, 0, 2)).toBe(true)
    // limit 50, already 40, batch 20 → 60 > 50 → blocked
    expect(broadcastExceedsDailyLimit(50, 40, 20)).toBe(true)
  })

  it('allows when it fits exactly or under', () => {
    // limit 1, already 0, batch 1 → 1 > 1 false → allowed
    expect(broadcastExceedsDailyLimit(1, 0, 1)).toBe(false)
    expect(broadcastExceedsDailyLimit(50, 40, 10)).toBe(false)
    expect(broadcastExceedsDailyLimit(50, 0, 1)).toBe(false)
  })
})
