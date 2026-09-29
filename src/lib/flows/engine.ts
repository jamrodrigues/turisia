/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Meta API calls — `meta-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the runner refuses to advance
 *     an active run twice for the same Meta message — protects against
 *     Meta's retries.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises 23505 and the runner catches & exits.
 */

import { supabaseAdmin } from "./admin-client";
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from "./meta-send";
import { decideFallback, resolveFallbackPolicy } from "./fallback";
import { renderVoucherPdf, voucherFilename } from "./voucher";
import { signMediaUrl } from "@/lib/storage/media-url.server";
import { MEDIA_URL_TTL } from "@/lib/storage/media-url";
import { loadPaymentConfig } from "@/lib/payments/config";
import { createPixOrder, createCheckoutPreference } from "@/lib/payments/mercadopago";
import {
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type CreatePaymentNodeConfig,
  type CreateReservationNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type FlowNodeRow,
  type FlowRow,
  type FlowRunRow,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMediaNodeConfig,
  type SendMessageNodeConfig,
  type SendVoucherNodeConfig,
  type SetTagNodeConfig,
  type SetVarNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from "./types";

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
): string | null {
  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (matchType === "exact" ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === "start" ||
    node_type === "send_message" ||
    node_type === "send_media" ||
    node_type === "condition" ||
    node_type === "set_tag" ||
    node_type === "set_var" ||
    node_type === "create_reservation" ||
    node_type === "send_voucher"
  );
}

/**
 * Parses a customer-typed date into `YYYY-MM-DD`, or `null` if it
 * doesn't look like a date. Accepts the ISO form and Brazilian
 * `DD/MM` / `DD/MM/YY` / `DD/MM/YYYY` — a `collect_input` node has no
 * validation (v1.5 runner, see CollectInputNodeConfig), so a
 * `create_reservation` node reading a free-typed date must tolerate
 * what a WhatsApp customer actually types ("09/09", not "2026-09-09").
 *
 * A bare `DD/MM` with no year rolls forward to next year when that day
 * has already passed this year — "9/9" typed in October means next
 * September, not a September that already happened.
 */
export function parseFlexibleDateToISO(raw: string, now: Date = new Date()): string | null {
  const s = raw.trim();

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return isRealCalendarDate(Number(y), Number(m), Number(d)) ? s : null;
  }

  const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (brMatch) {
    const [, dStr, mStr, yStr] = brMatch;
    const day = Number(dStr);
    const month = Number(mStr);
    let year: number;
    if (yStr) {
      year = yStr.length === 2 ? 2000 + Number(yStr) : Number(yStr);
    } else {
      year = now.getFullYear();
      const candidate = new Date(year, month - 1, day);
      // Already passed this year (strictly before today) → assume next year.
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (candidate < today) year += 1;
    }
    if (!isRealCalendarDate(year, month, day)) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/** Rejects e.g. 2026-02-30 — Date's constructor silently rolls those into March. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Nodes that suspend the run. `create_payment` is the one exception
 * to the name — it does NOT wait for a customer WhatsApp reply, it
 * waits for the Mercado Pago webhook (see `resumeFlowRunAfterPayment`)
 * — but it persists `current_node_key` and returns the same way, so it
 * belongs in this bucket for every caller that branches on "does this
 * node end the synchronous advance loop".
 */
export function isSuspending(node_type: string): boolean {
  return (
    node_type === "send_buttons" ||
    node_type === "send_list" ||
    node_type === "collect_input" ||
    node_type === "create_payment"
  );
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return node_type === "handoff" || node_type === "end";
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"];
  /**
   * Resolved value of the subject. `undefined` means the subject is
   * absent (no var with that key / no such tag / contact field is
   * null). Pure function: caller does the DB lookup.
   */
  subjectValue: string | undefined;
  /** The configured comparison value, when applicable. */
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? "");
    case "contains":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? "");
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

type AdminClient = ReturnType<typeof supabaseAdmin>;

async function loadActiveRunForContact(
  db: AdminClient,
  accountId: string,
  contactId: string,
): Promise<FlowRunRow | null> {
  // The partial unique index `idx_one_active_run_per_contact` was
  // rebuilt in migration 017 over `(account_id, contact_id)` — so
  // "two active runs for one contact in one account" is impossible
  // by design. But a future migration glitch or manual SQL could
  // create one, and .maybeSingle() throws on >1 row — which would
  // kill dispatch for that contact's webhook entirely. .limit(1) is
  // forgiving: pick the newest, let the cron sweep clean up the
  // stale one.
  const { data, error } = await db
    .from("flow_runs")
    .select("*")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[flows] loadActiveRunForContact error:", error.message);
    return null;
  }
  const rows = (data as FlowRunRow[] | null) ?? [];
  return rows[0] ?? null;
}

async function loadFlow(
  db: AdminClient,
  flowId: string,
): Promise<FlowRow | null> {
  const { data, error } = await db
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .maybeSingle();
  if (error) {
    console.error("[flows] loadFlow error:", error.message);
    return null;
  }
  return (data as FlowRow | null) ?? null;
}

/**
 * Load every node of a flow in one round trip and key them by
 * `node_key`. The advance loop is then in-memory — a 5-node
 * auto-advancing chain costs one SELECT, not five.
 *
 * Returns an empty map on error so the caller can still dispatch
 * cleanly (every subsequent .get() returns undefined → the run
 * fails with node_not_found, same as the old per-node lookup).
 */
async function loadAllNodes(
  db: AdminClient,
  flowId: string,
): Promise<Map<string, FlowNodeRow>> {
  const { data, error } = await db
    .from("flow_nodes")
    .select("*")
    .eq("flow_id", flowId);
  if (error) {
    console.error("[flows] loadAllNodes error:", error.message);
    return new Map();
  }
  const map = new Map<string, FlowNodeRow>();
  for (const row of (data ?? []) as FlowNodeRow[]) {
    map.set(row.node_key, row);
  }
  return map;
}

async function logEvent(
  db: AdminClient,
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("flow_run_events").insert({
    flow_run_id: flowRunId,
    event_type,
    node_key,
    payload,
  });
  if (error) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error("[flows] logEvent error:", error.message);
  }
}

/**
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 *
 * Implementation note: scoped to runs belonging to this user/contact
 * so the lookup is cheap (the index on flow_run_events(flow_run_id,
 * event_type) plus the small set of runs per contact).
 */
async function isDuplicateInbound(
  db: AdminClient,
  accountId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  // Fetch ALL run ids for this contact in this account (active +
  // historical). Bounded by how many flows the customer has been
  // through — small.
  const { data: runs } = await db
    .from("flow_runs")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId);
  if (!runs?.length) return false;
  const runIds = runs.map((r) => (r as { id: string }).id);

  const { count } = await db
    .from("flow_run_events")
    .select("id", { count: "exact", head: true })
    .in("flow_run_id", runIds)
    .eq("event_type", "reply_received")
    .filter("payload->>meta_message_id", "eq", metaMessageId);
  return (count ?? 0) > 0;
}

async function findEntryFlow(
  db: AdminClient,
  accountId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
): Promise<FlowRow | null> {
  // Only text messages can match an entry trigger. Interactive replies
  // are responses to existing prompts; they never start a new flow.
  if (message.kind !== "text") return null;

  // Pull all active flows for this account. Active set is bounded
  // (the builder discourages double-trigger overlap; partial index
  // makes the lookup index-supported).
  const { data: flows, error } = await db
    .from("flows")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error || !flows) return null;

  const typed = flows as FlowRow[];
  for (const flow of typed) {
    if (flow.trigger_type === "keyword") {
      if (matchesKeywordTrigger(
        message.text,
        flow.trigger_config as KeywordTriggerConfig,
      )) {
        return flow;
      }
    } else if (flow.trigger_type === "first_inbound_message" && isFirstInbound) {
      return flow;
    }
    // 'manual' triggers do not auto-start from inbound messages.
  }
  return null;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function sendButtonsAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_buttons",
    whatsapp_message_id,
  });
  // Look up our internal message id so we can stash it on the run.
  // Cheap — indexed on `messages.message_id`.
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function sendListAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_list",
    whatsapp_message_id,
  });
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function executeHandoff(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string };
  const convUpdate: Record<string, unknown> = {
    status: "pending",
    updated_at: new Date().toISOString(),
  };
  if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;
  if (run.conversation_id) {
    await db
      .from("conversations")
      .update(convUpdate)
      .eq("id", run.conversation_id);
  }
  await logEvent(db, run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(db, run.id, "handed_off", "handoff_node");
}

/**
 * Merge one key into a run's vars, persist to `flow_runs.vars`, and
 * mirror the merge onto the in-memory `run` so the rest of THIS
 * dispatch pass (still holding the old object) sees it immediately —
 * shared by every simple "write one var and move on" site
 * (create_reservation's success/failure branches, the `set_var` node).
 * A write failure is tolerated the same way at every call site: the
 * in-memory mirror is skipped, so the run just resumes from a slightly
 * stale `vars` next time rather than throwing here.
 *
 * Not used by collect_input's capture path — that one also resets
 * `reprompt_count` and logs in the same UPDATE, genuinely more than
 * "merge a var", so it stays its own inline block.
 */
async function mergeRunVar(
  db: AdminClient,
  run: FlowRunRow,
  key: string,
  value: unknown,
): Promise<void> {
  const newVars = { ...run.vars, [key]: value };
  const { error } = await db.from("flow_runs").update({ vars: newVars }).eq("id", run.id);
  if (!error) run.vars = newVars;
}

/**
 * Runs `create_reservation`: reads pacote_horario/data/quantidade from
 * vars, calls `criar_reserva()` (058_pacote_horarios_reservas.sql —
 * row-locked, capacity-checked), and branches to success_next or
 * failure_next. `vars.reserva_id` / `vars.reserva_erro` are set for
 * downstream nodes (send_voucher reads reserva_id; a send_message on
 * the failure branch can interpolate {{vars.reserva_erro}}).
 *
 * This is the ONLY place a flow may create a `reservas` row — never a
 * direct insert, so the same capacity guard that protects a human
 * agent's manual booking (src/components/reservas/reserva-form.tsx)
 * also protects the automated closing path.
 */
async function executeCreateReservation(
  db: AdminClient,
  run: FlowRunRow,
  cfg: CreateReservationNodeConfig,
): Promise<{ nextKey: string }> {
  const fail = async (motivo: string): Promise<{ nextKey: string }> => {
    await mergeRunVar(db, run, "reserva_erro", motivo);
    return { nextKey: cfg.failure_next };
  };

  const horarioId = cfg.pacote_horario_var_key
    ? (run.vars[cfg.pacote_horario_var_key] as string | undefined)
    : undefined;
  const rawData = run.vars[cfg.data_var_key];
  const rawQtd = run.vars[cfg.quantidade_var_key];

  const dataISO =
    typeof rawData === "string" ? parseFlexibleDateToISO(rawData) : null;
  if (!dataISO) return fail("data_invalida");

  const quantidade = typeof rawQtd === "string" ? Number(rawQtd.trim()) : NaN;
  if (!Number.isFinite(quantidade) || quantidade <= 0) return fail("quantidade_invalida");

  const { data: rows, error } = await db.rpc("criar_reserva", {
    p_account_id: run.account_id,
    p_pacote_id: cfg.pacote_id,
    p_pacote_horario_id: horarioId || null,
    p_data: dataISO,
    p_quantidade_pessoas: quantidade,
    p_contact_id: run.contact_id,
    p_conversation_id: run.conversation_id,
    p_created_by: null, // NULL = booked by the flow, not a human — drives the dashboard's "% fechado por IA/fluxo".
  });
  if (error) {
    console.error("[flows] criar_reserva rpc error:", error.message);
    return fail("erro_interno");
  }
  const result = (rows as { reserva_id: string | null; sucesso: boolean; motivo: string | null }[] | null)?.[0];
  if (!result?.sucesso || !result.reserva_id) {
    return fail(result?.motivo ?? "falha_desconhecida");
  }

  await mergeRunVar(db, run, "reserva_id", result.reserva_id);
  return { nextKey: cfg.success_next };
}

interface ReservaForPayment {
  id: string;
  pacotes: { name: string; price: number } | null;
  contacts: { email: string | null } | null;
}

/**
 * Runs `create_payment`: creates a Mercado Pago Pix charge for the
 * reservation and texts the customer the copia-e-cola code.
 * `suspend: true` means the node parked the run here — the caller
 * persists `current_node_key` and stops; `suspend: false` means the
 * charge could not even be created, so the caller auto-advances to
 * `failure_next` immediately (nothing to wait for).
 *
 * Payer email: WhatsApp bookings rarely have a real email on file.
 * Mercado Pago's Order schema requires `payer.email`, so a contact
 * with none gets a synthetic `reserva-<id>@pix.invalid` — Pix never
 * emails the payer, so this is a schema formality, not a deliverable
 * address. Revisit if Mercado Pago ever starts validating deliverability.
 */
async function executeCreatePayment(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  cfg: CreatePaymentNodeConfig,
): Promise<{ suspend: boolean; nextKey: string }> {
  const reservaId = run.vars[cfg.reserva_var_key ?? "reserva_id"];
  if (typeof reservaId !== "string" || !reservaId) {
    await logEvent(db, run.id, "error", node.node_key, { reason: "no_reserva_id_in_vars" });
    return { suspend: false, nextKey: cfg.failure_next };
  }

  // Independent reads (neither depends on the other's result) — run
  // concurrently instead of paying two sequential round-trips. The
  // reservas query runs even when payment turns out unconfigured; it's
  // a read with no side effect, so the wasted query on that failure
  // path is cheaper than serializing the common (configured) path.
  const [paymentConfig, reservaResult] = await Promise.all([
    loadPaymentConfig(db, run.account_id),
    db
      .from("reservas")
      .select("id, pacotes(name, price), contacts(email)")
      .eq("id", reservaId)
      .maybeSingle(),
  ]);
  if (!paymentConfig) {
    await logEvent(db, run.id, "error", node.node_key, { reason: "payments_not_configured" });
    return { suspend: false, nextKey: cfg.failure_next };
  }

  const { data, error } = reservaResult;
  if (error || !data) {
    await logEvent(db, run.id, "error", node.node_key, { reason: "reserva_not_found" });
    return { suspend: false, nextKey: cfg.failure_next };
  }
  const reserva = data as unknown as ReservaForPayment;
  const amount = reserva.pacotes?.price ?? 0;
  if (amount <= 0) {
    await logEvent(db, run.id, "error", node.node_key, { reason: "invalid_amount" });
    return { suspend: false, nextKey: cfg.failure_next };
  }

  const payerEmail = reserva.contacts?.email?.trim() || `reserva-${reservaId}@pix.invalid`;

  // Opt-in per account (072) — Pix-only accounts take the exact same
  // path as before this feature; nothing changes for them.
  if (paymentConfig.acceptCardInstallments) {
    try {
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
      const preference = await createCheckoutPreference({
        accessToken: paymentConfig.accessToken,
        amount,
        description: reserva.pacotes?.name ?? "Reserva",
        payerEmail,
        externalReference: reservaId,
        notificationUrl: `${siteUrl}/api/payments/webhook/${run.account_id}`,
      });

      await db
        .from("reservas")
        .update({
          pagamento_status: "pendente",
          mp_preference_id: preference.preferenceId,
          pagamento_valor: amount,
        })
        .eq("id", reservaId);

      await engineSendText({
        accountId: run.account_id,
        userId: run.user_id,
        conversationId: run.conversation_id!,
        contactId: run.contact_id!,
        text:
          "Pra confirmar sua reserva, é só pagar por aqui (Pix ou cartão parcelado) — assim que cair, eu confirmo automaticamente! 💳\n\n" +
          preference.initPoint,
      });

      return { suspend: true, nextKey: node.node_key };
    } catch (err) {
      console.error("[flows] createCheckoutPreference failed:", err instanceof Error ? err.message : err);
      await logEvent(db, run.id, "error", node.node_key, {
        reason: "mercadopago_create_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      return { suspend: false, nextKey: cfg.failure_next };
    }
  }

  try {
    const order = await createPixOrder({
      accessToken: paymentConfig.accessToken,
      amount,
      description: reserva.pacotes?.name ?? "Reserva",
      payerEmail,
      externalReference: reservaId,
    });

    await db
      .from("reservas")
      .update({
        pagamento_status: "pendente",
        mp_order_id: order.orderId,
        mp_payment_id: order.paymentId,
        pagamento_valor: amount,
        pagamento_pix_copia_cola: order.qrCode,
      })
      .eq("id", reservaId);

    await engineSendText({
      accountId: run.account_id,
      userId: run.user_id,
      conversationId: run.conversation_id!,
      contactId: run.contact_id!,
      text:
        "Pra confirmar sua reserva, é só pagar via Pix (copia e cola abaixo, cole no seu banco) — assim que cair, eu confirmo automaticamente! 💳\n\n" +
        order.qrCode,
    });

    return { suspend: true, nextKey: node.node_key };
  } catch (err) {
    console.error("[flows] createPixOrder failed:", err instanceof Error ? err.message : err);
    await logEvent(db, run.id, "error", node.node_key, {
      reason: "mercadopago_create_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return { suspend: false, nextKey: cfg.failure_next };
  }
}

interface ReservaForVoucher {
  id: string;
  data: string;
  quantidade_pessoas: number;
  account_id: string;
  contact_id: string | null;
  pacotes: { name: string; description: string | null; price: number } | null;
  pacote_horarios: { hora_saida: string; hora_volta: string | null } | null;
  contacts: { name: string | null; phone: string } | null;
  accounts: {
    name: string;
    cnpj: string | null;
    telefone: string | null;
    endereco: string | null;
    logo_url: string | null;
    pix_key: string | null;
    politica_cancelamento: string | null;
  } | null;
}

/**
 * Best-effort logo fetch for the voucher header. The `agency-logo`
 * bucket is public (060_agency_profile_and_contact_fiscal.sql), so a
 * plain fetch needs no signing. Returns null on any failure — a
 * missing/unreachable logo must never block the voucher itself.
 */
async function fetchLogoBytes(logoUrl: string | null): Promise<Uint8Array | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error("[flows] voucher logo fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Runs `send_voucher`: loads the reservation created earlier in the
 * run, renders its voucher PDF (src/lib/flows/voucher.ts), uploads it
 * to the private `vouchers` bucket, and sends it as a WhatsApp
 * document via a freshly-signed URL — the same private-bucket +
 * signMediaUrl pattern already proven live for pacote photos this
 * session. Throws on failure; the caller treats that as non-fatal
 * (the booking itself already succeeded).
 */
async function executeSendVoucher(
  db: AdminClient,
  run: FlowRunRow,
  cfg: SendVoucherNodeConfig,
): Promise<void> {
  const reservaId = run.vars[cfg.reserva_var_key ?? "reserva_id"];
  if (typeof reservaId !== "string" || !reservaId) {
    throw new Error("no reserva_id in vars");
  }

  const { data, error } = await db
    .from("reservas")
    .select(
      "id, data, quantidade_pessoas, account_id, contact_id, pacotes(name, description, price), pacote_horarios(hora_saida, hora_volta), contacts(name, phone), accounts(name, cnpj, telefone, endereco, logo_url, pix_key, politica_cancelamento)",
    )
    .eq("id", reservaId)
    .maybeSingle();
  if (error || !data) throw new Error("reserva not found for voucher");
  const reserva = data as unknown as ReservaForVoucher;

  const logoBytes = await fetchLogoBytes(reserva.accounts?.logo_url ?? null);

  const pdfBytes = await renderVoucherPdf({
    agenciaNome: reserva.accounts?.name ?? "Agência",
    agenciaCnpj: reserva.accounts?.cnpj ?? null,
    agenciaTelefone: reserva.accounts?.telefone ?? null,
    agenciaEndereco: reserva.accounts?.endereco ?? null,
    agenciaPixKey: reserva.accounts?.pix_key ?? null,
    agenciaPoliticaCancelamento: reserva.accounts?.politica_cancelamento ?? null,
    pacoteNome: reserva.pacotes?.name ?? "Passeio",
    pacoteDescricao: reserva.pacotes?.description ?? null,
    data: reserva.data,
    horaSaida: reserva.pacote_horarios?.hora_saida ?? null,
    horaVolta: reserva.pacote_horarios?.hora_volta ?? null,
    quantidadePessoas: reserva.quantidade_pessoas,
    precoTotal: reserva.pacotes?.price ?? 0,
    clienteNome: reserva.contacts?.name ?? null,
    reservaId: reserva.id,
    logoBytes,
  });

  const path = `account-${reserva.account_id}/${reserva.id}.pdf`;
  const { error: uploadErr } = await db.storage
    .from("vouchers")
    .upload(path, Buffer.from(pdfBytes), { contentType: "application/pdf", upsert: true });
  if (uploadErr) throw new Error(`voucher upload failed: ${uploadErr.message}`);

  const {
    data: { publicUrl },
  } = db.storage.from("vouchers").getPublicUrl(path);
  // Neither depends on the other's result — the DB stamp and the
  // signed-URL mint both only need `publicUrl`, computed above.
  const [, signedUrl] = await Promise.all([
    db.from("reservas").update({ voucher_url: publicUrl }).eq("id", reserva.id),
    signMediaUrl(publicUrl, MEDIA_URL_TTL.outboundSend),
  ]);

  await engineSendMedia({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    kind: "document",
    link: signedUrl,
    filename: voucherFilename(reserva.id),
    caption: "Aqui está o voucher da sua reserva! 🎉",
  });
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a Supabase mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input
 *     or http_fetch in v2).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *     `subject_key` IS the tag UUID; the SELECT returns 1 row or 0.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
async function evaluateConditionNode(
  db: AdminClient,
  run: FlowRunRow,
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const { count } = await db
      .from("contact_tags")
      .select("contact_id", { count: "exact", head: true })
      .eq("contact_id", run.contact_id!)
      .eq("tag_id", cfg.subject_key);
    // For tags, "present" really is the only meaningful test — the
    // `present`/`absent` operators are the natural fit. equals/contains
    // against a tag UUID would still work mechanically (compare its
    // existence to the value).
    subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const { data } = await db
      .from("contacts")
      .select(cfg.subject_key)
      .eq("id", run.contact_id!)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

/**
 * Tiny `{{vars.foo}}` interpolation. Used by send_message + collect_input
 * prompt text so a captured `name` can show up in the next prompt
 * ("Thanks {{vars.name}}, what's your email?"). Missing vars render as
 * empty string — the same behavior as the automations engine.
 */
function interpolateVars(template: string, vars: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

async function endRun(
  db: AdminClient,
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  await db
    .from("flow_runs")
    .update({
      status,
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq("id", runId);
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

/**
 * Persist the run's new current_node_key (optimistic UPDATE, see
 * advanceCurrentNodeKey below) and report the "advanced" outcome —
 * shared by every node type that suspends here (collect_input,
 * create_payment, send_buttons, send_list) so the race-lost log line
 * and the outcome shape can't drift between them.
 */
async function advanceAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced" }> {
  const advanced = await advanceCurrentNodeKey(
    db,
    run.id,
    run.current_node_key,
    node.node_key,
  );
  if (!advanced) {
    await logEvent(db, run.id, "error", node.node_key, {
      reason: "lost_race_during_advance",
    });
  }
  return { outcome: "advanced" };
}

async function advanceFromNodeKey(
  db: AdminClient,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  let currentKey: string | null = startNodeKey;
  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(db, run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(db, run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: FlowNodeRow | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(db, run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(db, run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === "start") {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_message",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_media") {
      const cfg = node.config as unknown as SendMediaNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendMedia({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          kind: cfg.media_type,
          link: cfg.media_url,
          caption: cfg.caption
            ? interpolateVars(cfg.caption, run.vars)
            : undefined,
          filename: cfg.filename,
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_media",
          media_type: cfg.media_type,
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_media_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_media_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "collect_input",
          whatsapp_message_id,
        });
        const { data: msg } = await db
          .from("messages")
          .select("id")
          .eq("message_id", whatsapp_message_id)
          .maybeSingle();
        await db
          .from("flow_runs")
          .update({
            last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
          })
          .eq("id", run.id);
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "collect_input_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "collect_input_prompt_failed");
        return { outcome: "completed" };
      }
      return await advanceAndSuspend(db, run, node);
    }
    if (node.node_type === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: "true" | "false";
      try {
        branch = (await evaluateConditionNode(db, run, cfg))
          ? "true"
          : "false";
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "condition_evaluation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "condition_evaluation_failed");
        return { outcome: "completed" };
      }
      currentKey =
        branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(db, run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      try {
        if (cfg.mode === "add") {
          await db
            .from("contact_tags")
            .upsert(
              { contact_id: run.contact_id!, tag_id: cfg.tag_id },
              { onConflict: "contact_id,tag_id" },
            );
        } else {
          await db
            .from("contact_tags")
            .delete()
            .eq("contact_id", run.contact_id!)
            .eq("tag_id", cfg.tag_id);
        }
      } catch (err) {
        // Non-fatal — log + advance. A tag-write failure shouldn't
        // strand the customer mid-flow.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "set_tag_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "set_var") {
      const cfg = node.config as unknown as SetVarNodeConfig;
      await mergeRunVar(db, run, cfg.var_key, cfg.value);
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "create_reservation") {
      const cfg = node.config as unknown as CreateReservationNodeConfig;
      const outcome = await executeCreateReservation(db, run, cfg);
      currentKey = outcome.nextKey;
      continue;
    }
    if (node.node_type === "create_payment") {
      const cfg = node.config as unknown as CreatePaymentNodeConfig;
      const outcome = await executeCreatePayment(db, run, node, cfg);
      if (outcome.suspend) {
        return await advanceAndSuspend(db, run, node);
      }
      currentKey = outcome.nextKey;
      continue;
    }
    if (node.node_type === "send_voucher") {
      const cfg = node.config as unknown as SendVoucherNodeConfig;
      try {
        await executeSendVoucher(db, run, cfg);
      } catch (err) {
        // Non-fatal — the booking already exists; a voucher-send
        // failure shouldn't strand the customer mid-flow or make it
        // look like the reservation itself failed.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_voucher_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_buttons") {
      await sendButtonsAndSuspend(db, run, node);
      return await advanceAndSuspend(db, run, node);
    }
    if (node.node_type === "send_list") {
      await sendListAndSuspend(db, run, node);
      return await advanceAndSuspend(db, run, node);
    }
    if (node.node_type === "handoff") {
      await executeHandoff(db, run, node);
      return { outcome: "handed_off" };
    }
    if (node.node_type === "end") {
      await logEvent(db, run.id, "completed", node.node_key);
      await endRun(db, run.id, "completed", "end_node");
      return { outcome: "completed" };
    }
    // Unknown node type — shouldn't happen given the CHECK constraint.
    await logEvent(db, run.id, "error", node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(db, run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  // Safety break — log + fail.
  await logEvent(db, run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(db, run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

/**
 * Optimistic UPDATE — only advance current_node_key when it matches
 * the value we read at the top of dispatch. If another webhook beat
 * us, the row's pointer has already moved and our UPDATE returns
 * zero rows; we treat that as a no-op and let the other run continue.
 */
async function advanceCurrentNodeKey(
  db: AdminClient,
  runId: string,
  expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  // PostgREST: when expectedOldKey is null we can't `.eq` (would match
  // any row); use `.is('current_node_key', null)` instead.
  let q = db
    .from("flow_runs")
    .update({
      current_node_key: newKey,
      last_advanced_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "active");
  if (expectedOldKey === null) {
    q = q.is("current_node_key", null);
  } else {
    q = q.eq("current_node_key", expectedOldKey);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.error("[flows] advanceCurrentNodeKey error:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    const activeRun = await loadActiveRunForContact(
      db,
      input.accountId,
      input.contactId,
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        db,
        input.accountId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }
      // One SELECT for the whole flow's nodes — advance loop is now
      // in-memory. See loadAllNodes.
      const nodes = await loadAllNodes(db, activeRun.flow_id);
      return handleReplyForActiveRun(db, activeRun, input.message, nodes);
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      db,
      input.accountId,
      input.message,
      input.isFirstInboundMessage,
    );
    if (!flow || !flow.entry_node_id) {
      return { consumed: false, outcome: "no_match" };
    }
    const nodes = await loadAllNodes(db, flow.id);
    return startNewRun(db, flow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

/**
 * Starts the account's active flow whose `ai_topic` matches — called
 * by the AI auto-reply path (src/lib/ai/auto-reply.ts) when the model
 * emits the `[[RESERVAR:<topic>]]` sentinel, instead of requiring the
 * customer to type an exact keyword trigger. Reuses `startNewRun`
 * verbatim (same idempotency/uniqueness guarantees as the keyword
 * path) — the only difference is HOW the flow is found.
 *
 * Declines to start (consumed: false) when the contact already has an
 * active run — the AI shouldn't have offered the sentinel mid-flow,
 * but if it did, this is the safe no-op rather than a second
 * concurrent run for the same contact.
 */
export async function startFlowByAiTopic(
  input: DispatchInboundInput & { topic: string },
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    const activeRun = await loadActiveRunForContact(db, input.accountId, input.contactId);
    if (activeRun) {
      return { consumed: false, outcome: "no_match" };
    }

    const { data: flow, error } = await db
      .from("flows")
      .select("*")
      .eq("account_id", input.accountId)
      .eq("status", "active")
      .eq("ai_topic", input.topic)
      .maybeSingle();
    if (error || !flow || !(flow as FlowRow).entry_node_id) {
      return { consumed: false, outcome: "no_match" };
    }

    const nodes = await loadAllNodes(db, (flow as FlowRow).id);
    return startNewRun(db, flow as FlowRow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] startFlowByAiTopic threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

/**
 * Resumes a flow run that's parked at a `create_payment` node, called
 * by the Mercado Pago webhook handler once it has independently
 * confirmed (via `getOrder`, never trusting the webhook body alone)
 * that the charge is `approved`. Finds the run by matching
 * `flow_runs.vars->>'reserva_id'` — the same field `create_reservation`
 * sets and `create_payment`/`send_voucher` already key off of.
 *
 * Returns false (does nothing) when there's no active run parked
 * there — a webhook retry after the first one already resumed the
 * run, or the run timed out/was handed off in the meantime. Either
 * way, silently doing nothing is correct: there's no run left to
 * advance.
 */
export async function resumeFlowRunAfterPayment(reservaId: string): Promise<boolean> {
  const db = supabaseAdmin();
  try {
    const { data: runs, error } = await db
      .from("flow_runs")
      .select("*")
      .eq("status", "active")
      .filter("vars->>reserva_id", "eq", reservaId)
      .limit(1);
    if (error) {
      console.error("[flows] resumeFlowRunAfterPayment lookup error:", error.message);
      return false;
    }
    const run = (runs as FlowRunRow[] | null)?.[0];
    if (!run || !run.current_node_key) return false;

    const nodes = await loadAllNodes(db, run.flow_id);
    const currentNode = nodes.get(run.current_node_key);
    if (!currentNode || currentNode.node_type !== "create_payment") {
      // Not parked at a payment node (already advanced, or a stale
      // notification for a run that moved on) — nothing to resume.
      return false;
    }
    const cfg = currentNode.config as unknown as CreatePaymentNodeConfig;
    await advanceFromNodeKey(db, run, cfg.success_next, nodes);
    return true;
  } catch (err) {
    console.error(
      "[flows] resumeFlowRunAfterPayment threw:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function handleReplyForActiveRun(
  db: AdminClient,
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(db, run.id, "reply_received", run.current_node_key, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

  if (!run.current_node_key) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(db, run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.current_node_key) ?? null;
  if (!currentNode) {
    await endRun(db, run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  if (
    message.kind === "interactive_reply" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchReplyId(currentNode, message.reply_id);
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (captured.length > 0 && cfg.var_key) {
      // Persist captured value + reset reprompt count atomically.
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      const { error: capErr } = await db
        .from("flow_runs")
        .update({
          vars: newVars,
          reprompt_count: 0,
        })
        .eq("id", run.id);
      if (!capErr) {
        // Mirror the UPDATE in-memory so downstream interpolation in
        // the advance loop sees the captured var without us having to
        // re-SELECT the whole row.
        run.vars = newVars;
        run.reprompt_count = 0;
        await logEvent(db, run.id, "node_entered", currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      }
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0. The previous re-read of
    // the whole row was needed only because we weren't mirroring the
    // capture UPDATE into the in-memory `run`; now that we do, the
    // local copy is the source of truth.
    if (run.reprompt_count !== 0) {
      const { error } = await db
        .from("flow_runs")
        .update({ reprompt_count: 0 })
        .eq("id", run.id);
      if (!error) run.reprompt_count = 0;
    }
    const outcome = await advanceFromNodeKey(db, run, matched, nodes);
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const policy = resolveFallbackPolicy(
    (await loadFlow(db, run.flow_id))?.fallback_policy,
  );
  const newReprompts = run.reprompt_count + 1;
  await db
    .from("flow_runs")
    .update({ reprompt_count: newReprompts })
    .eq("id", run.id);

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(db, run.id, "fallback_fired", run.current_node_key, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "reprompt") {
    // Re-send the same prompt. Same node, no current_node_key change.
    if (currentNode.node_type === "send_buttons") {
      await sendButtonsAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === "send_list") {
      await sendListAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(db, run.id, "error", currentNode.node_key, {
          reason: "reprompt_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversation_id) {
      await db
        .from("conversations")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", run.conversation_id);
    }
    await logEvent(db, run.id, "handoff", run.current_node_key, {
      reason: "fallback_exhausted",
    });
    await endRun(db, run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  await endRun(db, run.id, "completed", "fallback_exhausted_end");
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  db: AdminClient,
  flow: FlowRow,
  input: DispatchInboundInput,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // INSERT — partial unique index `idx_one_active_run_per_contact`
  // catches concurrent inserts with 23505. We catch and return as
  // consumed:true (the parallel webhook handles it).
  const { data: inserted, error: insErr } = await db
    .from("flow_runs")
    .insert({
      flow_id: flow.id,
      // Tenancy: NOT NULL post-017. The partial unique index
      // `idx_one_active_run_per_contact` is over (account_id,
      // contact_id) WHERE status='active', so two accounts sharing
      // a contact phone number each run their own flows independently.
      account_id: flow.account_id,
      // Audit: preserves the flow's author on the run row for log
      // attribution.
      user_id: flow.user_id,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      status: "active",
      current_node_key: flow.entry_node_id,
    })
    .select("*")
    .maybeSingle();
  if (insErr) {
    // 23505 = unique_violation → another webhook is starting the run.
    const msg = insErr.message ?? "";
    if (msg.includes("23505") || msg.includes("duplicate key")) {
      return { consumed: true, outcome: "duplicate_inbound_ignored" };
    }
    console.error("[flows] startNewRun insert error:", insErr.message);
    return { consumed: false, outcome: "no_match" };
  }
  const run = inserted as FlowRunRow;
  await logEvent(db, run.id, "started", flow.entry_node_id, {
    flow_id: flow.id,
    trigger_type: flow.trigger_type,
    meta_message_id: input.message.meta_message_id,
  });
  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  //
  // Atomic RPC (migration 012) rather than read-modify-write: two
  // concurrent webhooks starting runs for different contacts on the
  // same flow would otherwise both read N and both write N+1, losing
  // a count. Mirrors the automations engine's use of
  // `increment_automation_execution_count` (migration 007).
  const { error: incErr } = await db.rpc("increment_flow_execution_count", {
    p_flow_id: flow.id,
  });
  if (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error("[flows] execution_count rpc error:", incErr.message);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(db, run, flow.entry_node_id!, nodes);
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
  };
}
