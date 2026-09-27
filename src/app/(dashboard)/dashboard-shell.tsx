"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/layout/app-header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { AccountBlocked } from "@/components/billing/account-blocked";

// Plumbing routes an agent/viewer (the managed-SaaS client) must not
// reach even by typing the URL. Real enforcement is RLS + route
// requireRole; this is the matching client-side redirect so they land
// on the inbox instead of a broken/empty admin page.
const ADMIN_ONLY_PREFIXES = [
  "/dashboard",
  "/settings",
  "/automations",
  "/flows",
  "/agents",
  "/broadcasts",
  "/financeiro",
];

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, accountRole, profileLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Billing gate — block the whole app when the subscription is a
  // hard-stop state (suspended/canceled) or the trial lapsed. Uses the
  // secrets-free account_billing_status() RPC (migration 036).
  const [billingBlock, setBillingBlock] = useState<
    "suspended" | "canceled" | "trial_ended" | null
  >(null);
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient().rpc("account_billing_status");
      const row = Array.isArray(data) ? data[0] : data;
      if (cancelled || !row || row.allowed) {
        if (!cancelled) setBillingBlock(null);
        return;
      }
      const reason =
        row.status === "canceled"
          ? "canceled"
          : row.status === "trialing"
            ? "trial_ended"
            : "suspended";
      setBillingBlock(reason);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  // Bounce agent/viewer off plumbing routes (URL-typed or bookmarked).
  useEffect(() => {
    if (loading || profileLoading || !user) return;
    const canSeePlumbing = accountRole === "owner" || accountRole === "admin";
    if (canSeePlumbing) return;
    if (ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
      router.replace("/inbox");
    }
  }, [loading, profileLoading, user, accountRole, pathname, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{"Carregando…"}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (billingBlock) return <AccountBlocked reason={billingBlock} />;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <AppHeader />
      {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
