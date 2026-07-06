import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  uazapiConnectInstance,
  uazapiInstanceStatus,
} from '@/lib/whatsapp/uazapi-api'

/**
 * POST /api/uazapi/config/connect — start (or resume) QR pairing.
 * GET  /api/uazapi/config/connect — poll pairing status.
 *
 * Both proxy the uazapi server with the account's decrypted instance
 * token; the QR string/base64 is passed straight through for the
 * settings UI to render. Polling stops client-side once status flips
 * to 'connected'.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

async function loadCtx(): Promise<
  | { ok: true; ctx: { baseUrl: string; token: string } }
  | { ok: false; response: NextResponse }
> {
  let accountId: string
  try {
    ;({ accountId } = await requireRole('admin'))
  } catch (err) {
    const status = err instanceof ForbiddenError ? 403 : err instanceof UnauthorizedError ? 401 : 500
    return {
      ok: false,
      response: NextResponse.json(
        { error: err instanceof Error ? err.message : 'unauthorized' },
        { status },
      ),
    }
  }
  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('provider, uazapi_base_url, uazapi_instance_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (
    !config ||
    config.provider !== 'uazapi' ||
    !config.uazapi_base_url ||
    !config.uazapi_instance_token
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'uazapi is not configured for this account' },
        { status: 400 },
      ),
    }
  }
  return {
    ok: true,
    ctx: {
      baseUrl: config.uazapi_base_url,
      token: decrypt(config.uazapi_instance_token),
    },
  }
}

export async function POST() {
  try {
    const loaded = await loadCtx()
    if (!loaded.ok) return loaded.response
    const status = await uazapiConnectInstance(loaded.ctx)
    return NextResponse.json({
      status: status.status,
      qrcode: status.qrcode ?? null,
    })
  } catch (err) {
    console.error('[uazapi connect] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'connect failed' },
      { status: 502 },
    )
  }
}

export async function GET() {
  try {
    const loaded = await loadCtx()
    if (!loaded.ok) return loaded.response
    const status = await uazapiInstanceStatus(loaded.ctx)
    return NextResponse.json({
      status: status.status,
      qrcode: status.qrcode ?? null,
    })
  } catch (err) {
    console.error('[uazapi connect] status failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'status failed' },
      { status: 502 },
    )
  }
}
