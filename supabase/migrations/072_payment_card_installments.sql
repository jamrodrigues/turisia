-- ============================================================
-- 072_payment_card_installments.sql
--
-- Adds opt-in credit-card + installments ("parcelamento") on top of
-- the existing Pix-only create_payment node (062). Pix-only accounts
-- are completely unaffected — accept_card_installments defaults to
-- false, and executeCreatePayment (engine.ts) only takes the new
-- Checkout Pro path when an admin explicitly turns it on.
--
-- `mp_preference_id` is NOT used for webhook reconciliation (a
-- Checkout Pro preference has no payment id until the customer
-- actually pays) — it's stored purely for support/debugging so an
-- admin looking at a stuck reserva can tell whether a checkout link
-- was ever generated for it. Reconciliation for this path instead
-- matches on `external_reference` after re-fetching the payment by
-- the id Mercado Pago's webhook gives us — see
-- src/app/api/payments/webhook/[accountId]/route.ts.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE payment_config
  ADD COLUMN IF NOT EXISTS accept_card_installments boolean NOT NULL DEFAULT false;

ALTER TABLE reservas
  ADD COLUMN IF NOT EXISTS mp_preference_id text;
