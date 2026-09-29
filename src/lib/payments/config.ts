import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

export interface PaymentConfig {
  provider: 'mercadopago'
  accessToken: string
  webhookSecret: string | null
  isActive: boolean
  /** Opt-in: create_payment sends a Checkout Pro link (Pix + card +
   *  installments) instead of a Pix-only charge. See 072. */
  acceptCardInstallments: boolean
}

interface PaymentConfigRow {
  provider: 'mercadopago'
  access_token_encrypted: string | null
  webhook_secret_encrypted: string | null
  is_active: boolean
  accept_card_installments: boolean
}

/**
 * Load and decrypt the account's payment config for *use* (the
 * `create_payment` flow node, the webhook handler). Returns `null`
 * when there's no row, the master switch is off, or the access token
 * is missing/undecryptable — all mean "payments aren't available",
 * which every caller treats identically (the flow's create_payment
 * node fails closed, same severity as criar_reserva's sem_vagas).
 *
 * Works with any client — pass the RLS-scoped SSR client from a
 * settings route, or the service-role admin client from the flow
 * engine/webhook.
 */
export async function loadPaymentConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<PaymentConfig | null> {
  const { data, error } = await db
    .from('payment_config')
    .select('provider, access_token_encrypted, webhook_secret_encrypted, is_active, accept_card_installments')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as PaymentConfigRow
  if (!row.is_active) return null
  if (!row.access_token_encrypted) return null

  let accessToken: string
  try {
    accessToken = decrypt(row.access_token_encrypted)
  } catch (err) {
    console.error(
      `[payments config] access token for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
      err,
    )
    return null
  }

  let webhookSecret: string | null = null
  if (row.webhook_secret_encrypted) {
    try {
      webhookSecret = decrypt(row.webhook_secret_encrypted)
    } catch (err) {
      console.error(
        `[payments config] webhook secret for account ${accountId} could not be decrypted — webhook validation will fail closed.`,
        err,
      )
    }
  }

  return {
    provider: row.provider,
    accessToken,
    webhookSecret,
    isActive: row.is_active,
    acceptCardInstallments: row.accept_card_installments,
  }
}
