-- ============================================================
-- 063_create_payment_node.sql
--
-- Adds the 'create_payment' flow node type — charges the reservation
-- via Mercado Pago Pix (src/lib/payments/mercadopago.ts) and SUSPENDS
-- the run (like send_buttons/send_list) until the payment webhook
-- resumes it — see `resumeFlowRunAfterPayment` in
-- src/lib/flows/engine.ts. This is the one node type that does NOT
-- resume from a customer WhatsApp reply; it resumes from an external
-- HTTP callback (src/app/api/payments/webhook/route.ts).
--
-- Same drop-and-recreate CHECK pattern as every prior node-type
-- addition (010/016/059).
--
-- Idempotent — safe to re-run.
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
    'create_payment',
    'send_voucher',
    'handoff',
    'http_fetch',
    'end'
  ));
