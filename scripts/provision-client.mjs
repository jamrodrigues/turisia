#!/usr/bin/env node
/**
 * provision-client — stand up a new client on the managed CRM.
 *
 * Codifies the manual steps proven during Fase 01/02 so a new client
 * takes minutes, not an afternoon. It:
 *   1. (optional) runs the DB migrations against the client's Supabase
 *   2. creates a uazapi instance on the server (admin token)
 *   3. points that instance's webhook at the client's deploy
 *   4. seeds whatsapp_config (provider=uazapi, encrypted tokens) and,
 *      when --ai-tier is given, an ai_configs row
 *
 * It does NOT create the Supabase project or the deploy — those are one
 * click each in their dashboards (the Management API needs a personal
 * token we deliberately don't bake in). The script prints exactly what
 * to click when it can't do it headless.
 *
 * Usage (env or flags):
 *   node scripts/provision-client.mjs \
 *     --slug clinica-neuza \
 *     --supabase-url https://xxx.supabase.co \
 *     --service-key sb_secret_xxx \
 *     --encryption-key <64-hex> \
 *     --deploy-url https://crm.clinicaneuza.com.br \
 *     --uazapi-base https://cloudefender.uazapi.com \
 *     --uazapi-admin <admintoken> \
 *     --admin-user-id <auth uuid> --account-id <account uuid> \
 *     [--ai-tier advanced --n8n-url https://n8n/... --n8n-secret xyz] \
 *     [--db-url postgres://... --run-migrations]
 *
 * Every secret is passed by flag/env, never hardcoded. Re-runnable:
 * upserts the config row for the account.
 */

import crypto from 'node:crypto'
import { execSync } from 'node:child_process'

// ---------- arg parsing ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) {
      const key = cur.slice(2)
      const next = arr[i + 1]
      acc.push([key, !next || next.startsWith('--') ? true : next])
    }
    return acc
  }, []),
)
const opt = (name, envName, required = false) => {
  const v = args[name] ?? (envName ? process.env[envName] : undefined)
  if (required && (v === undefined || v === true)) {
    console.error(`Missing required --${name}`)
    process.exit(1)
  }
  return v
}

const slug = String(opt('slug', 'CLIENT_SLUG', true)).toLowerCase()
if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug)) {
  console.error('slug: lowercase letters, digits, dot, dash, underscore only')
  process.exit(1)
}
const supabaseUrl = opt('supabase-url', 'NEXT_PUBLIC_SUPABASE_URL', true)
const serviceKey = opt('service-key', 'SUPABASE_SERVICE_ROLE_KEY', true)
const encryptionKey = opt('encryption-key', 'ENCRYPTION_KEY', true)
const deployUrl = String(opt('deploy-url', 'NEXT_PUBLIC_SITE_URL', true)).replace(/\/$/, '')
const uazapiBase = String(opt('uazapi-base', 'UAZAPI_BASE_URL', true)).replace(/\/$/, '')
const uazapiAdmin = opt('uazapi-admin', 'UAZAPI_ADMIN_KEY', true)
const accountId = opt('account-id', null, true)
const adminUserId = opt('admin-user-id', null, true)
const aiTier = opt('ai-tier', null) // off | simple | advanced
const n8nUrl = opt('n8n-url', null)
const n8nSecret = opt('n8n-secret', null)
const dbUrl = opt('db-url', 'SUPABASE_DB_URL')
const runMigrations = !!args['run-migrations']

// ---------- crypto (mirrors src/lib/whatsapp/encryption.ts GCM) ----------
function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(encryptionKey, 'hex'),
    iv,
  )
  let enc = cipher.update(text, 'utf8', 'hex')
  enc += cipher.final('hex')
  return `${iv.toString('hex')}:${enc}:${cipher.getAuthTag().toString('hex')}`
}

// ---------- helpers ----------
async function rest(path, init = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase ${path} ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function uazapi(path, init = {}, token = uazapiAdmin, header = 'admintoken') {
  const res = await fetch(`${uazapiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      [header]: token,
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`uazapi ${path} ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

// ---------- steps ----------
async function main() {
  console.log(`\n▶ Provisioning client "${slug}"\n`)

  // 1. migrations (optional)
  if (runMigrations) {
    if (!dbUrl) {
      console.error('--run-migrations needs --db-url (postgres connection string)')
      process.exit(1)
    }
    console.log('1/4 Applying migrations (supabase db push)…')
    execSync(`npx -y supabase@latest db push --db-url "${dbUrl}"`, {
      stdio: 'inherit',
    })
  } else {
    console.log('1/4 Skipping migrations (pass --run-migrations --db-url to run).')
  }

  // 2. uazapi instance
  console.log(`2/4 Creating uazapi instance "${slug}"…`)
  let instanceToken
  try {
    const created = await uazapi('/instance/init', {
      method: 'POST',
      body: JSON.stringify({ name: slug }),
    })
    const inst = created.instance ?? created
    instanceToken = inst.token
    console.log(`    instance token: ${instanceToken}`)
  } catch (err) {
    console.error(`    Could not create instance: ${err.message}`)
    console.error('    If it already exists, pass --instance-token to reuse it.')
    if (args['instance-token']) instanceToken = args['instance-token']
    else process.exit(1)
  }

  // 3. webhook → deploy
  const webhookSecret = crypto.randomBytes(24).toString('hex')
  const webhookUrl = `${deployUrl}/api/uazapi/webhook?secret=${webhookSecret}`
  console.log('3/4 Pointing instance webhook at the deploy…')
  await uazapi(
    '/webhook',
    {
      method: 'POST',
      body: JSON.stringify({ url: webhookUrl, events: ['messages'], enabled: true }),
    },
    instanceToken,
    'token',
  )

  // 4. seed whatsapp_config (+ ai_configs)
  console.log('4/4 Seeding whatsapp_config…')
  const row = {
    account_id: accountId,
    user_id: adminUserId,
    provider: 'uazapi',
    phone_number_id: `uazapi:${slug}`,
    access_token: encrypt('uazapi-placeholder'),
    uazapi_base_url: uazapiBase,
    uazapi_instance_name: slug,
    uazapi_instance_token: encrypt(instanceToken),
    uazapi_webhook_secret: encrypt(webhookSecret),
    status: 'disconnected',
    updated_at: new Date().toISOString(),
  }
  // upsert on account_id (unique)
  await rest('whatsapp_config?on_conflict=account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  })

  if (aiTier) {
    console.log(`    Seeding ai_configs (tier=${aiTier})…`)
    const aiRow = {
      account_id: accountId,
      created_by: adminUserId,
      provider: 'openai',
      ai_tier: aiTier,
      is_active: aiTier !== 'off',
      auto_reply_enabled: aiTier !== 'off',
      auto_reply_max_per_conversation: 5,
      ...(n8nUrl ? { n8n_webhook_url: n8nUrl } : {}),
      ...(n8nSecret ? { n8n_shared_secret: encrypt(n8nSecret) } : {}),
      updated_at: new Date().toISOString(),
    }
    await rest('ai_configs?on_conflict=account_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(aiRow),
    })
  }

  console.log('\n✅ Done. Remaining MANUAL steps:')
  console.log(`   • Log into ${deployUrl} as the admin, open Settings → WhatsApp → uazapi, click "Conectar (QR)" and scan.`)
  console.log('   • Invite the client\'s attendants as role "agent".')
  if (aiTier === 'simple') console.log('   • Add the AI provider key + knowledge base in Settings → AI.')
  if (aiTier === 'advanced') console.log('   • Point the n8n flow\'s webhook-in at the CRM and add a Respond-to-Webhook returning { reply | handoff }.')
  console.log('')
}

main().catch((err) => {
  console.error('\n❌ Provisioning failed:', err.message)
  process.exit(1)
})
