import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// GET /api/uazapi/config must never echo the webhook secret back to the
// browser. The response carries the webhook URL so the operator can see
// WHERE it points, but the `?secret=` value is masked — same rule the
// repoint-webhook route already follows. An admin session is authenticated,
// but the plaintext secret in a JSON body is still one XSS / screenshot /
// proxy log away from being an inbound-webhook forgery key.
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'deadbeefdeadbeefdeadbeefdeadbeef'

let currentRole: string | null = 'admin'
let configRow: Record<string, unknown> | null = {
  provider: 'uazapi',
  uazapi_base_url: 'https://uaz.example.com',
  uazapi_instance_name: 'es-olinda',
  uazapi_instance_token: 'enc-token',
  uazapi_webhook_secret: 'enc-secret',
  status: 'connected',
  daily_send_limit: null,
}

function builder(table: string, result: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const chain = () => b
  for (const m of ['select', 'eq', 'neq', 'ilike', 'update', 'insert', 'delete']) {
    b[m] = vi.fn(chain)
  }
  b.single = vi.fn(() => Promise.resolve(result()))
  b.maybeSingle = vi.fn(() => Promise.resolve(result()))
  b.then = (resolve: (v: unknown) => unknown) => resolve(result())
  void table
  return b
}

const sessionClient = {
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
  },
  from: vi.fn((table: string) =>
    builder(table, () => {
      if (table === 'profiles') {
        return {
          data: currentRole
            ? { account_id: 'acct-1', account_role: currentRole }
            : null,
          error: null,
        }
      }
      if (table === 'accounts') {
        return { data: { id: 'acct-1', name: 'Acme' }, error: null }
      }
      return { data: null, error: null }
    }),
  ),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => sessionClient),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => builder(table, () => ({ data: configRow, error: null })),
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) =>
    v === 'enc-secret' ? WEBHOOK_SECRET : 'plaintext-instance-token',
  ),
}))

vi.mock('@/lib/whatsapp/uazapi-api', () => ({
  uazapiInstanceStatus: vi.fn(async () => ({ status: 'connected' })),
  uazapiSetWebhook: vi.fn(async () => undefined),
}))

import { GET } from './route'

beforeEach(() => {
  currentRole = 'admin'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com'
  configRow = {
    provider: 'uazapi',
    uazapi_base_url: 'https://uaz.example.com',
    uazapi_instance_name: 'es-olinda',
    uazapi_instance_token: 'enc-token',
    uazapi_webhook_secret: 'enc-secret',
    status: 'connected',
    daily_send_limit: null,
  }
})

describe('GET /api/uazapi/config', () => {
  it('masks the webhook secret in the returned URL', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.configured).toBe(true)
    expect(json.webhook_url).toBe(
      'https://crm.example.com/api/uazapi/webhook?secret=***',
    )
    // Belt and braces: the secret must not appear anywhere in the body.
    expect(JSON.stringify(json)).not.toContain(WEBHOOK_SECRET)
  })

  it('refuses a non-admin caller', async () => {
    currentRole = 'agent'
    const res = await GET()
    expect(res.status).toBe(403)
  })
})
