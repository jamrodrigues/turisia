import { describe, expect, it } from 'vitest'
import {
  buildUazapiWebhookUrl,
  maskWebhookSecret,
  parseWebhookList,
} from './uazapi-webhook-url'

describe('buildUazapiWebhookUrl', () => {
  it('builds the inbound webhook URL with the secret in the query', () => {
    expect(buildUazapiWebhookUrl('https://crm.example.com', 'abc123')).toBe(
      'https://crm.example.com/api/uazapi/webhook?secret=abc123',
    )
  })

  it('strips a trailing slash from the site URL', () => {
    expect(buildUazapiWebhookUrl('https://crm.example.com/', 's')).toBe(
      'https://crm.example.com/api/uazapi/webhook?secret=s',
    )
  })

  it('URL-encodes a secret with reserved characters', () => {
    expect(buildUazapiWebhookUrl('https://x.com', 'a b/c?d')).toBe(
      'https://x.com/api/uazapi/webhook?secret=a%20b%2Fc%3Fd',
    )
  })
})

describe('maskWebhookSecret', () => {
  it('masks the raw secret anywhere it appears', () => {
    const url = 'https://x.com/api/uazapi/webhook?secret=topsecret'
    expect(maskWebhookSecret(url, 'topsecret')).toBe(
      'https://x.com/api/uazapi/webhook?secret=***',
    )
  })

  it('masks the URL-encoded form of the secret too', () => {
    const secret = 'a b/c'
    const url = buildUazapiWebhookUrl('https://x.com', secret)
    const masked = maskWebhookSecret(url, secret)
    expect(masked).toBe('https://x.com/api/uazapi/webhook?secret=***')
    expect(masked).not.toContain('a%20b%2Fc')
  })

  it('returns the text unchanged when the secret is empty', () => {
    expect(maskWebhookSecret('nothing to hide', '')).toBe('nothing to hide')
  })
})

describe('parseWebhookList', () => {
  const url = 'https://x.com/api/uazapi/webhook?secret=s'

  it('reads enabled + events from the entry matching our URL', () => {
    const data = [
      { id: '1', url: 'https://other/webhook', enabled: false, events: ['x'] },
      { id: '2', url, enabled: true, events: ['messages'] },
    ]
    expect(parseWebhookList(data, url)).toEqual({
      enabled: true,
      events: ['messages'],
    })
  })

  it('falls back to the first entry when none matches the URL', () => {
    const data = [{ id: '1', url: 'https://other/webhook', enabled: true, events: ['messages'] }]
    expect(parseWebhookList(data, url)).toEqual({
      enabled: true,
      events: ['messages'],
    })
  })

  it('filters out non-string events defensively', () => {
    const data = [{ url, enabled: true, events: ['messages', 5, null] }]
    expect(parseWebhookList(data, url)).toEqual({
      enabled: true,
      events: ['messages'],
    })
  })

  it('collapses unexpected shapes to a disabled/empty summary', () => {
    expect(parseWebhookList(null, url)).toEqual({ enabled: false, events: [] })
    expect(parseWebhookList([], url)).toEqual({ enabled: false, events: [] })
    expect(parseWebhookList('nope', url)).toEqual({ enabled: false, events: [] })
    expect(parseWebhookList([{ url }], url)).toEqual({ enabled: false, events: [] })
  })
})
