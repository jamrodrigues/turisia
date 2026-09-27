/**
 * Pure helpers for building and verifying the uazapi instance webhook
 * URL. Kept free of network / env access so they can be unit-tested and
 * reused by both the config save route and the "repoint webhook" action.
 *
 * The inbound webhook URL carries the account's webhook secret in the
 * query string:
 *
 *   ${SITE}/api/uazapi/webhook?secret=<secret>
 *
 * The secret must NEVER be echoed back to the browser, so anything the
 * repoint route returns is passed through `maskWebhookSecret` first.
 */

type Dict = Record<string, unknown>

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Build the inbound webhook URL the uazapi server should POST to. */
export function buildUazapiWebhookUrl(siteUrl: string, secret: string): string {
  const base = (siteUrl || '').replace(/\/$/, '')
  return `${base}/api/uazapi/webhook?secret=${encodeURIComponent(secret)}`
}

/**
 * Replace every occurrence of the secret — raw and URL-encoded — with
 * `***`. Used before returning any uazapi payload/URL to the client so
 * the webhook secret never reaches the browser.
 */
export function maskWebhookSecret(text: string, secret: string): string {
  if (!secret) return text
  let out = text.split(secret).join('***')
  const enc = encodeURIComponent(secret)
  if (enc !== secret) out = out.split(enc).join('***')
  return out
}

export interface WebhookVerification {
  /** Whether the server reports the webhook as enabled. */
  enabled: boolean
  /** Events the webhook is subscribed to (e.g. ['messages']). */
  events: string[]
}

/**
 * Parse the array returned by GET /webhook into a compact verification
 * summary. Prefers the entry whose `url` matches the one we just set,
 * falling back to the first entry. Defensive against server-version
 * shape drift — anything unexpected collapses to a disabled/empty
 * summary rather than throwing.
 */
export function parseWebhookList(
  data: unknown,
  expectedUrl: string,
): WebhookVerification {
  const arr = Array.isArray(data) ? data : []
  const entry =
    arr.find((e) => isDict(e) && e.url === expectedUrl) ??
    arr.find(isDict) ??
    null
  if (!isDict(entry)) return { enabled: false, events: [] }
  const events = Array.isArray(entry.events)
    ? entry.events.filter((e): e is string => typeof e === 'string')
    : []
  return { enabled: entry.enabled === true, events }
}
