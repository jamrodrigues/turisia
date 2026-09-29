"use client"

import { useEffect, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import Link from "next/link"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { Label } from "@/components/ui/label"

/**
 * Read-only status for the package's automated-closing Flow — no
 * manual trigger here. Generation is tied to the pacote form's own
 * "Salvar" (and to PacoteHorariosEditor's per-slot save), so this
 * only ever *reports* the outcome, it never causes it. Having a
 * separate "Gerar" button here used to leave it ambiguous whether
 * saving the form already generated the flow or not — it always did.
 *
 * `refreshSignal` — bump it (any changing value) after a save that may
 * have changed the flow, to force a refetch.
 */
export function PacoteClosingFlowButton({
  pacoteId,
  category,
  refreshSignal,
}: {
  pacoteId: string
  category: string | null | undefined
  refreshSignal?: number
}) {
  const { accountId, accountRole } = useAuth()
  const canSeeFlows = accountRole === "owner" || accountRole === "admin"
  const [flowName, setFlowName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const trimmedCategory = category?.trim().toLowerCase()
    setLoading(true)
    if (!accountId || !trimmedCategory) {
      setFlowName(null)
      setLoading(false)
      return
    }
    ;(async () => {
      const supabase = createClient()
      const { data: flow } = await supabase
        .from("flows")
        .select("name")
        .eq("account_id", accountId)
        .eq("ai_topic", trimmedCategory)
        .eq("status", "active")
        .maybeSingle()
      if (cancelled) return
      setFlowName((flow?.name as string | undefined) ?? null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [pacoteId, accountId, category, refreshSignal])

  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        Fechamento automático
      </Label>
      <p className="text-xs text-muted-foreground">
        Gerado (ou atualizado) automaticamente sempre que você salva o pacote ou muda os
        horários acima — a partir da categoria. Nenhuma ação manual necessária.
      </p>
      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Verificando…
        </p>
      ) : !category?.trim() ? (
        <p className="text-xs text-muted-foreground">
          Defina uma categoria e salve pra gerar o fechamento automático.
        </p>
      ) : flowName ? (
        <p className="text-xs text-muted-foreground">
          {canSeeFlows ? (
            <>
              Fluxo &quot;{flowName}&quot; ativo — veja em{" "}
              <Link href="/flows" className="text-primary hover:underline">
                Fluxos
              </Link>
              .
            </>
          ) : (
            <>Fluxo &quot;{flowName}&quot; ativo.</>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ainda não gerado — salve o pacote de novo pra gerar.
        </p>
      )}
    </div>
  )
}
