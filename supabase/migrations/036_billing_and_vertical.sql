-- ============================================================
-- 036_billing_and_vertical
--
-- Commercial layer (Fase 06): per-account subscription state so the
-- app can gate access when a client stops paying, plus the vertical
-- tag (Fase 05) recording which preset the account was set up from.
--
-- White-label (brand name/logo/theme) is intentionally NOT here — with
-- one deploy per client it's env-based (NEXT_PUBLIC_BRAND_*), which
-- also works on the pre-login screen. See src/lib/brand.ts.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial', 'monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS vertical text;

COMMENT ON COLUMN accounts.subscription_status IS
  'trialing/active = allowed; past_due = allowed (grace); suspended/canceled = blocked at login.';
COMMENT ON COLUMN accounts.vertical IS
  'Which preset the account was provisioned from: clinica | clube | agencia | generico.';

-- ------------------------------------------------------------
-- account_billing_status() — secrets-free, member-readable gate input.
-- Returns the caller account's access decision + a few display fields.
-- SECURITY DEFINER so agents (who can't SELECT sensitive columns) can
-- still learn "am I allowed in / is my trial over".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_billing_status()
RETURNS TABLE (
  status         text,
  plan           text,
  allowed        boolean,
  trial_ends_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT account_id INTO v_account_id FROM profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.subscription_status,
    a.plan,
    -- Blocked only on hard-stop states. Trial with a past end date is
    -- also blocked. past_due is a soft grace period → still allowed.
    (a.subscription_status NOT IN ('suspended', 'canceled'))
      AND NOT (
        a.subscription_status = 'trialing'
        AND a.trial_ends_at IS NOT NULL
        AND a.trial_ends_at < now()
      ),
    a.trial_ends_at
  FROM accounts a
  WHERE a.id = v_account_id;
END;
$$;

ALTER FUNCTION public.account_billing_status() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.account_billing_status() TO authenticated, service_role;
