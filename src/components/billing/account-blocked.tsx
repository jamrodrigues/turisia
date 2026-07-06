"use client";

import { getBrand } from "@/lib/brand";

/**
 * Full-screen block shown when the account's subscription is suspended
 * or canceled (or a trial has lapsed). Deliberately minimal and
 * self-contained — it renders instead of the app shell, so it must not
 * depend on any dashboard context.
 */
export function AccountBlocked({
  reason,
}: {
  reason: "suspended" | "canceled" | "trial_ended";
}) {
  const brand = getBrand();
  const title =
    reason === "trial_ended"
      ? "Seu período de teste terminou"
      : "Conta suspensa";
  const message =
    reason === "trial_ended"
      ? "Para continuar usando o atendimento, ative um plano mensal ou anual."
      : "O acesso a esta conta está temporariamente suspenso. Regularize a assinatura para voltar a atender.";

  return (
    <div className="flex h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-2xl">
          ⏸️
        </div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <p className="mt-6 text-xs text-muted-foreground">
          Fale com o suporte de <span className="font-medium">{brand.name}</span> para
          regularizar.
        </p>
      </div>
    </div>
  );
}
