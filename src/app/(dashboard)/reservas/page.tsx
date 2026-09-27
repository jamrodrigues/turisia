"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CalendarCheck, Check, FileText, Loader2, Plus, Sparkles, X } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import type { PagamentoStatus, Reserva, ReservaStatus } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ReservaForm } from "@/components/reservas/reserva-form"
import { FilterBar, FilterField } from "@/components/ui/filter-bar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const STATUS_FILTER_OPTIONS: { value: "todos" | ReservaStatus; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "pendente", label: "Pendente" },
  { value: "confirmada", label: "Confirmada" },
  { value: "cancelada", label: "Cancelada" },
]

const STRIP_DAYS = 14

/** YYYY-MM-DD for today + the next `STRIP_DAYS - 1` days, local time. */
function upcomingDayKeys(): string[] {
  const out: string[] = []
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  for (let i = 0; i < STRIP_DAYS; i++) {
    const d = new Date(base)
    d.setDate(d.getDate() + i)
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    )
  }
  return out
}

function formatDate(d: string): string {
  // `d` is a DATE column (YYYY-MM-DD) — parse as local, not UTC, so
  // "2026-09-08" doesn't shift a day back in negative-UTC timezones.
  const [y, m, day] = d.split("-").map(Number)
  return new Date(y, m - 1, day).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  })
}

function formatTime(t: string): string {
  return t.slice(0, 5)
}

const STATUS_BADGE: Record<ReservaStatus, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendente: { label: "Pendente", variant: "secondary" },
  confirmada: { label: "Confirmada", variant: "default" },
  cancelada: { label: "Cancelada", variant: "destructive" },
}

const PAGAMENTO_BADGE: Record<PagamentoStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  nao_iniciado: { label: "—", variant: "outline" },
  pendente: { label: "Aguardando Pix", variant: "secondary" },
  pago: { label: "Pago", variant: "default" },
  falhou: { label: "Falhou", variant: "destructive" },
}

export default function ReservasPage() {
  const canManage = useCan("send-messages")

  const [reservas, setReservas] = useState<Reserva[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [dayKeys] = useState<string[]>(() => upcomingDayKeys())
  const [statusFilter, setStatusFilter] = useState<"todos" | ReservaStatus>("todos")

  async function load() {
    try {
      const supabase = createClient()
      const today = new Date().toISOString().slice(0, 10)
      let query = supabase
        .from("reservas")
        .select("*, pacote:pacotes(*), pacote_horario:pacote_horarios(*), contact:contacts(*)")
        .order("data", { ascending: true })
      if (!showPast) query = query.gte("data", today)
      const { data, error: fetchErr } = await query
      if (fetchErr) throw fetchErr
      setReservas((data ?? []) as unknown as Reserva[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar reservas")
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPast])

  async function updateStatus(reserva: Reserva, status: ReservaStatus) {
    setBusyId(reserva.id)
    try {
      const supabase = createClient()
      const { error: updateErr } = await supabase
        .from("reservas")
        .update({ status })
        .eq("id", reserva.id)
      if (updateErr) throw updateErr
      setReservas((prev) => prev?.map((r) => (r.id === reserva.id ? { ...r, status } : r)) ?? prev)
      toast.success(status === "confirmada" ? "Reserva confirmada" : "Reserva cancelada")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar reserva")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <CalendarCheck className="h-5 w-5" />
            Reservas
          </h1>
          <p className="text-sm text-muted-foreground">
            Passeios reservados por clientes — pela IA/fluxo ou por um atendente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowPast((v) => !v)
              setSelectedDate(null)
            }}
          >
            {showPast ? "Só próximas" : "Ver histórico"}
          </Button>
          <GatedButton canAct={canManage} gateReason="criar reservas" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            Nova reserva
          </GatedButton>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!showPast && reservas !== null && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {dayKeys.map((day, i) => {
            const count = reservas.filter((r) => r.data === day && r.status !== "cancelada").length
            const isToday = i === 0
            const isSelected = selectedDate === day
            const [, m, dd] = day.split("-")
            const weekday = new Date(day + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short" })
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDate((prev) => (prev === day ? null : day))}
                className={cn(
                  "flex w-14 shrink-0 flex-col items-center gap-0.5 rounded-lg border px-1.5 py-2 text-center transition-colors",
                  isSelected
                    ? "border-primary bg-primary/10"
                    : isToday
                      ? "border-primary/40"
                      : "border-border hover:bg-muted",
                )}
              >
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{weekday}</span>
                <span className={cn("text-sm font-semibold", isSelected && "text-primary")}>
                  {dd}/{m}
                </span>
                <span
                  className={cn(
                    "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium",
                    count > 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {count > 0 ? count : "–"}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {reservas !== null && reservas.length > 0 && (
        <FilterBar className="mb-4 rounded-lg border border-border bg-card">
          <FilterField label="Status" htmlFor="reservas-status-filter">
            <Select
              value={statusFilter}
              onValueChange={(v) => v && setStatusFilter(v as "todos" | ReservaStatus)}
            >
              <SelectTrigger id="reservas-status-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </FilterBar>
      )}

      {(() => {
        if (reservas === null) {
          return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          )
        }
        const visible = reservas
          .filter((r) => !selectedDate || r.data === selectedDate)
          .filter((r) => statusFilter === "todos" || r.status === statusFilter)
        if (reservas.length === 0) {
          return (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {showPast
                ? "Nenhuma reserva registrada ainda."
                : "Nenhuma reserva futura. Reservas fechadas pela IA/fluxo no WhatsApp aparecem aqui automaticamente."}
            </div>
          )
        }
        if (visible.length === 0) {
          return (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhuma reserva encontrada com esse filtro.
            </div>
          )
        }
        return (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Horário</TableHead>
                <TableHead>Pacote</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Pessoas</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => {
                const badge = STATUS_BADGE[r.status]
                const isBusy = busyId === r.id
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-medium text-foreground">
                      {formatDate(r.data)}
                    </TableCell>
                    <TableCell>
                      {r.pacote_horario
                        ? `${formatTime(r.pacote_horario.hora_saida)}${
                            r.pacote_horario.hora_volta ? `–${formatTime(r.pacote_horario.hora_volta)}` : ""
                          }`
                        : "—"}
                    </TableCell>
                    <TableCell>{r.pacote?.name ?? "—"}</TableCell>
                    <TableCell>{r.contact?.name || r.contact?.phone || "—"}</TableCell>
                    <TableCell>{r.quantidade_pessoas}</TableCell>
                    <TableCell>
                      {r.created_by === null ? (
                        <Badge variant="secondary" className="gap-1">
                          <Sparkles className="h-3 w-3" />
                          IA/Fluxo
                        </Badge>
                      ) : (
                        <Badge variant="outline">Atendente</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const pb = PAGAMENTO_BADGE[r.pagamento_status ?? "nao_iniciado"]
                        return <Badge variant={pb.variant}>{pb.label}</Badge>
                      })()}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status !== "cancelada" && (
                        <div className="flex justify-end gap-1">
                          {r.pagamento_status === "pago" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              render={
                                <a
                                  href={`/api/documentos/recibo?reserva_id=${r.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label="Baixar recibo"
                                  title="Baixar recibo"
                                />
                              }
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}
                          {r.status === "pendente" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={!canManage || isBusy}
                              onClick={() => updateStatus(r, "confirmada")}
                              aria-label="Confirmar reserva"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canManage || isBusy}
                            onClick={() => updateStatus(r, "cancelada")}
                            aria-label="Cancelar reserva"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        )
      })()}

      <ReservaForm open={formOpen} onOpenChange={setFormOpen} onSaved={load} />
    </div>
  )
}
