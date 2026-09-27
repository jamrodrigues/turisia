-- ============================================================
-- 059_flow_booking_nodes.sql
--
-- Adds the node types the automated-closing flow needs — see the
-- corrected product vision (Flow/AI closes the booking, human is
-- last-resort only) in project memory
-- (product_vision_automated_closing / turia_agenda_reservas_schema):
--
--   'set_var'             — write a literal into flow_runs.vars.
--   'create_reservation'  — book via criar_reserva() (058), the only
--                            place a flow may create a `reservas` row.
--   'send_voucher'        — render + send the booking's voucher PDF.
--
-- Same drop-and-recreate CHECK pattern migrations 010/016 used.
--
-- 2. `vouchers` Supabase Storage bucket — PRIVATE (unlike flow-media),
--    same account-scoped signed-URL pattern as `pacote-media` /
--    `chat-media` post-054: a voucher can carry a customer's name and
--    booking details, so it isn't publicly guessable-URL-readable.
--    engineSendMedia already proved private + signMediaUrl works for
--    Meta/uazapi delivery (pacote-media photos sent live over
--    WhatsApp this session).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. flow_nodes.node_type — add the three new values
-- ============================================================
ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'set_var',
    'create_reservation',
    'send_voucher',
    'handoff',
    'http_fetch',
    'end'
  ));

-- ============================================================
-- 2. vouchers storage bucket (private)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vouchers',
  'vouchers',
  FALSE,
  5242880, -- 5 MB — a text-only A4 voucher PDF never gets close to this.
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Account-scoped RLS, same EXISTS-over-profiles shape as migration
-- 054's chat-media/flow-media read policies: first path segment must
-- be 'account-<account_id>' of an account the caller has a profile
-- in. Read-only — the only writer is the flow engine's supabaseAdmin
-- client (service_role), which bypasses RLS entirely, so no
-- INSERT/UPDATE/DELETE policy is needed here.
DROP POLICY IF EXISTS "Members can read vouchers" ON storage.objects;
CREATE POLICY "Members can read vouchers"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'vouchers'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
