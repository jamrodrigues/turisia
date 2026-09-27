import type { SupabaseClient } from "@supabase/supabase-js";
import { isUniqueViolation } from "@/lib/contacts/dedupe";

/**
 * Shared "insert conversation, and on unique-violation re-query and use
 * the winner" core, used by BOTH the outbound send path
 * (resolve-conversation.ts) and the inbound webhook path
 * (process-inbound.ts). One conversation per (account, contact) — the
 * unique index from migration 052 is what makes the race detectable —
 * and both the Meta and uazapi webhooks retry-deliver in parallel, so
 * two inbounds (or an inbound racing an outbound send) can both try to
 * create the same conversation at once.
 *
 * Callers differ in client (service-role vs a caller-supplied client),
 * in what columns they need back (`id` only vs the full row), and in
 * how they want to fail (throw vs return null) — so this returns a
 * plain discriminated result and leaves those decisions to the caller
 * instead of trying to paper over them here.
 */
export async function findOrCreateConversationRow<T extends { id: string }>(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  contactId: string;
  /** Postgrest select string — `'id'` for callers that only need the id, `'*'` for the full row. */
  select: string;
}): Promise<{ row: T; created: boolean } | { row: null; created: false; error: unknown }> {
  const { db, accountId, ownerUserId, contactId, select } = args;

  const { data: existing } = await db
    .from("conversations")
    .select(select)
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existing) return { row: existing as unknown as T, created: false };

  const { data: created, error } = await db
    .from("conversations")
    .insert({ account_id: accountId, user_id: ownerUserId, contact_id: contactId })
    .select(select)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from("conversations")
        .select(select)
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .maybeSingle();
      if (raced) return { row: raced as unknown as T, created: false };
    }
    return { row: null, created: false, error };
  }

  return { row: created as unknown as T, created: true };
}
