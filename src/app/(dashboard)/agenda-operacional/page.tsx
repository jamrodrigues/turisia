"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Route, Users } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { Reserva, SaidaOperacional, VeiculoStatus } from "@/types"
import { GatedButton } from "@/components/ui/gated-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { FilterBar, FilterField } from "@/components/ui/filter-bar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SaidaForm } from "@/components/logistica/saida-form"

function formatTime(t: string): string {
  return t.slice(0, 5)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Daily operational manifest — Fase C v1 (2026-09-08): groups the
 * day's reservations onto vehicle/driver/guide "saídas", the exact
 * shape the agency's own spec asked for (§15): "Van 01, Motorista
 * Carlos, Guia João, 08:00 Pousada A 4 pessoas, ...". No map yet —
 * that's a separate, later slice (needs a geocoding API key).
 */
const VEICULO_STATUS_FILTER_OPTIONS: { value: "todos" | VeiculoStatus; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "disponivel", label: "Disponível" },
  { value: "manutencao", label: "Manutenção" },
  { value: "inativo", label: "Inativo" },
]

export default function AgendaOperacionalPage() {
  const canManage = useCan("send-messages")

  const [data, setData] = useState(today())
  const [saidas, setSaidas] = useState<SaidaOperacional[] | null>(null)
  const [unassigned, setUnassigned] = useState<Reserva[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [veiculoStatusFilter, setVeiculoStatusFilter] = useState<"todos" | VeiculoStatus>("todos")
  const [passageiroSearch, setPassageiroSearch] = useState("")

  async function load() {
    setSaidas(null)
    setUnassigned(null)
    try {
      const supabase = createClient()
      const [saidasRes, reservasRes] = await Promise.all([
        supabase
          .from("saidas_operacionais")
          .select(
            "*, pacote:pacotes(*), pacote_horario:pacote_horarios(*), veiculo:veiculos(*), motorista:motoristas(*), guia:guias(*), reservas(*, contact:contacts(*))",
          )
          .eq("data", data)
          .order("created_at"),
        supabase
          .from("reservas")
          .select("*, pacote:pacotes(*), pacote_horario:pacote_horarios(*), contact:contacts(*)")
          .eq("data", data)
          .neq("status", "cancelada")
          .is("saida_operacional_id", null),
      ])
      if (saidasRes.error) throw saidasRes.error
      if (reservasRes.error) throw reservasRes.error
      setSaidas((saidasRes.data ?? []) as unknown as SaidaOperacional[])
      setUnassigned((reservasRes.data ?? []) as unknown as Reserva[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a agenda operacional")
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  async function assignToSaida(reservaId: string, saidaId: string) {
    setAssigning(reservaId)
    try {
      const supabase = createClient()
      const { error: updateErr } = await supabase
        .from("reservas")
        .update({ saida_operacional_id: saidaId || null })
        .eq("id", reservaId)
      if (updateErr) throw updateErr
      toast.success(saidaId ? "Reserva alocada" : "Reserva desalocada")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao alocar reserva")
    } finally {
      setAssigning(null)
    }
  }

  const loading = saidas === null || unassigned === null

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Route className="h-5 w-5" />
            Agenda operacional
          </h1>
          <p className="text-sm text-muted-foreground">
            Veículos, motoristas e guias escalados por dia — e quais reservas (traslados) cada saída carrega.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="agenda-data" className="sr-only">
            Data
          </Label>
          <Input
            id="agenda-data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="w-auto"
          />
          <GatedButton canAct={canManage} gateReason="criar saídas" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            Nova saída
          </GatedButton>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {saidas !== null && saidas.length > 0 && (
            <FilterBar className="rounded-lg border border-border bg-card">
              <FilterField label="Status do veículo" htmlFor="saida-veiculo-status-filter">
                <Select
                  value={veiculoStatusFilter}
                  onValueChange={(v) => v && setVeiculoStatusFilter(v as "todos" | VeiculoStatus)}
                >
                  <SelectTrigger id="saida-veiculo-status-filter" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VEICULO_STATUS_FILTER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Passageiro" htmlFor="saida-passageiro-search">
                <Input
                  id="saida-passageiro-search"
                  value={passageiroSearch}
                  onChange={(e) => setPassageiroSearch(e.target.value)}
                  placeholder="Buscar por nome..."
                />
              </FilterField>
            </FilterBar>
          )}

          {(() => {
            const search = passageiroSearch.trim().toLowerCase()
            const filtered = saidas!
              .filter((s) => veiculoStatusFilter === "todos" || s.veiculo?.status === veiculoStatusFilter)
              .filter(
                (s) =>
                  !search ||
                  (s.reservas ?? []).some((r) =>
                    (r.contact?.name ?? r.contact?.phone ?? "").toLowerCase().includes(search),
                  ),
              )

            if (saidas!.length === 0) {
              return (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Nenhuma saída escalada pra esse dia ainda.
                </div>
              )
            }

            if (filtered.length === 0) {
              return (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Nenhuma saída encontrada com esse filtro.
                </div>
              )
            }

            return (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filtered.map((s) => {
                const reservas = s.reservas ?? []
                const totalPessoas = reservas.reduce((sum, r) => sum + r.quantidade_pessoas, 0)
                return (
                  <div key={s.id} className="rounded-lg border border-border p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">{s.pacote?.name ?? "—"}</p>
                        {s.pacote_horario && (
                          <p className="text-xs text-muted-foreground">
                            {formatTime(s.pacote_horario.hora_saida)}
                            {s.pacote_horario.hora_volta ? `–${formatTime(s.pacote_horario.hora_volta)}` : ""}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="gap-1">
                        <Users className="h-3 w-3" />
                        {totalPessoas}
                      </Badge>
                    </div>
                    <div className="mb-3 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      <span className="rounded-full border border-border px-2 py-0.5">
                        🚐 {s.veiculo?.modelo ?? "Sem veículo"}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5">
                        🧑‍✈️ {s.motorista?.nome ?? "Sem motorista"}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5">
                        🧭 {s.guia?.nome ?? "Sem guia"}
                      </span>
                    </div>
                    {reservas.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhuma reserva alocada ainda.</p>
                    ) : (
                      <div className="flex flex-col divide-y divide-border">
                        {reservas.map((r) => (
                          <div key={r.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                            <div className="min-w-0">
                              <p className="truncate text-foreground">{r.contact?.name || r.contact?.phone || "—"}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {r.contact?.pousada || "Pousada não informada"}
                                {r.contact?.apartamento ? ` · Apto ${r.contact.apartamento}` : ""}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-xs text-muted-foreground">{r.quantidade_pessoas} pax</span>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => assignToSaida(r.id, "")}
                                  disabled={assigning === r.id}
                                  className="text-xs text-muted-foreground hover:text-destructive"
                                >
                                  remover
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            )
          })()}

          <div>
            <h2 className="mb-2 text-sm font-medium text-foreground">Reservas sem alocação nesse dia</h2>
            {unassigned!.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todas as reservas do dia já foram alocadas.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {unassigned!.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {r.pacote?.name ?? "—"}
                        {r.pacote_horario && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {formatTime(r.pacote_horario.hora_saida)}
                            {r.pacote_horario.hora_volta ? `–${formatTime(r.pacote_horario.hora_volta)}` : ""}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.contact?.name || r.contact?.phone || "—"} · {r.quantidade_pessoas} pax ·{" "}
                        {r.contact?.pousada || "pousada não informada"}
                      </p>
                    </div>
                    <select
                      value=""
                      disabled={!canManage || assigning === r.id}
                      onChange={(e) => assignToSaida(r.id, e.target.value)}
                      className="h-8 rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                    >
                      <option value="">Alocar a uma saída…</option>
                      {saidas!
                        .filter((s) => s.pacote_id === r.pacote_id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.veiculo?.modelo ?? "Saída"} {s.motorista?.nome ? `· ${s.motorista.nome}` : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <SaidaForm open={formOpen} onOpenChange={setFormOpen} data={data} onSaved={load} />
    </div>
  )
}
