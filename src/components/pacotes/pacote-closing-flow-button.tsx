"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import Link from "next/link"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { generateClosingFlowForPacote } from "@/lib/flows/generate-closing-flow"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

/**
 * One-click generator for the package's automated-closing Flow
 * (turia_agenda_reservas_schema / turia — Fase A of the roadmap:
 * scale the Buggy flow's pattern to the rest of the catalog instead
 * of hand-authoring each one via SQL). Safe to click again after
 * changing horários — regenerates the same flow in place.
 */
export function PacoteClosingFlowButton({ pacoteId, canManage }: { pacoteId: string; canManage: boolean }) {
  const { accountId, user, accountRole } = useAuth()
  const canSeeFlows = accountRole === "owner" || accountRole === "admin"
  const [generating, setGenerating] = useState(false)
  const [flowName, setFlowName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Reload (not just reset) on every pacote switch — otherwise the
  // "already generated" state from whichever package was open last
  // leaks onto the next one (found live: editing Mergulho then
  // City Tour showed Mergulho's "Gerar novamente" label).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFlowName(null)
    if (!accountId) {
      setLoading(false)
      return
    }
    ;(async () => {
      const supabase = createClient()
      const { data: pacote } = await supabase
        .from("pacotes")
        .select("category")
        .eq("id", pacoteId)
        .maybeSingle()
      const category = (pacote?.category as string | null)?.trim().toLowerCase()
      if (!category) {
        if (!cancelled) setLoading(false)
        return
      }
      const { data: flow } = await supabase
        .from("flows")
        .select("name")
        .eq("account_id", accountId)
        .eq("ai_topic", category)
        .eq("status", "active")
        .maybeSingle()
      if (cancelled) return
      setFlowName((flow?.name as string | undefined) ?? null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [pacoteId, accountId])

  async function handleGenerate() {
    if (!accountId || !user) {
      toast.error("Sessão inválida — recarregue a página")
      return
    }
    setGenerating(true)
    try {
      const supabase = createClient()
      const { flowName: name } = await generateClosingFlowForPacote(supabase, {
        pacoteId,
        accountId,
        userId: user.id,
      })
      setFlowName(name)
      toast.success(`Fechamento automático pronto: "${name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar o fechamento automático")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        Fechamento automático
      </Label>
      <p className="text-xs text-muted-foreground">
        Gera (ou atualiza) o fluxo que fecha esse pacote sozinho no WhatsApp — a partir dos horários
        acima. Categoria do pacote vira a palavra-chave/tópico do fechamento.
      </p>
      {canManage && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={generating || loading}
          className="w-fit"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {flowName ? "Gerar novamente" : "Gerar fechamento automático"}
        </Button>
      )}
      {!loading && flowName && (
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
      )}
    </div>
  )
}
