import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWithRetry } from './send-retry'

describe('sendWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns immediately on first success (no retry)', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(sendWithRetry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries once after a transient failure and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('uazapi error 404 on /send/text'))
      .mockResolvedValueOnce('ok')
    const p = sendWithRetry(fn)
    await vi.advanceTimersByTimeAsync(3000)
    await expect(p).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws the second error when both attempts fail', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('uazapi error 503'))
      .mockRejectedValueOnce(new Error('uazapi error 503 again'))
    const p = sendWithRetry(fn)
    // attach the rejection expectation BEFORE advancing timers so the
    // rejection is never unhandled
    const assertion = expect(p).rejects.toThrow('503 again')
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry when the message already reached WhatsApp (DB insert failed)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error('sent to Meta but DB insert failed: boom'))
    await expect(sendWithRetry(fn)).rejects.toThrow('DB insert failed')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
