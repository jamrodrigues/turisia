const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Delay before the single retry — long enough for a uazapi instance
 *  mid-reconnection (number swap, server restart) to come back. */
const RETRY_DELAY_MS = 3000

/**
 * Run a bot-reply send with ONE retry after a short pause.
 *
 * Why: the reply slot is claimed BEFORE the send (fail-safe direction),
 * so a transient provider failure — observed in production as a uazapi
 * 404 on /send/text while the instance was reconnecting after a number
 * swap — permanently loses the bot's answer AND burns a cap slot. One
 * retry ~3s later covers exactly that window.
 *
 * Never retries when the message already reached WhatsApp and only the
 * DB insert failed (engineSend* throws '… DB insert failed …') — a
 * retry there would double-text the customer, which is worse than a
 * missing inbox row.
 */
export async function sendWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('DB insert failed')) throw err
    console.warn('[ai send] first attempt failed, retrying in 3s:', msg)
    await sleep(RETRY_DELAY_MS)
    return await fn()
  }
}
