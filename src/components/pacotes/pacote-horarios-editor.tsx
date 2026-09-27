"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Clock, Loader2, Plus, Trash2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import type { PacoteHorario } from "@/types"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

interface NewSlotForm {
  hora_saida: string
  hora_volta: string
  capacidade_pessoas: string
}

const EMPTY_SLOT: NewSlotForm = { hora_saida: "", hora_volta: "", capacidade_pessoas: "" }

function formatTime(t: string): string {
  return t.slice(0, 5)
}

/**
 * Recurring daily time-slot editor for one package — e.g. Buggy: 08h–12h
 * and 14h–18h, 16 pessoas por horário. Slots here are the capacity
 * template `criar_reserva()` (058_pacote_horarios_reservas.sql) checks
 * against; this UI only manages the template, not day-by-day bookings.
 *
 * Only rendered for an already-saved package, same constraint as
 * PacoteMediaGallery.
 */
export function PacoteHorariosEditor({
  pacoteId,
  canManage,
}: {
  pacoteId: string
  canManage: boolean
}) {
  const [slots, setSlots] = useState<PacoteHorario[] | null>(null)
  const [newSlot, setNewSlot] = useState<NewSlotForm>(EMPTY_SLOT)
  const [adding, setAdding] = useState(false)

  async function load() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("pacote_horarios")
      .select("*")
      .eq("pacote_id", pacoteId)
      .order("hora_saida")
    if (error) {
      toast.error("Falha ao carregar horários do pacote")
      return
    }
    setSlots((data ?? []) as PacoteHorario[])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacoteId])

  async function handleAdd() {
    if (!newSlot.hora_saida) {
      toast.error("Informe o horário de saída")
      return
    }
    const capacidade = Number(newSlot.capacidade_pessoas)
    if (!Number.isFinite(capacidade) || capacidade <= 0) {
      toast.error("Capacidade inválida")
      return
    }

    setAdding(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("pacote_horarios").insert({
        pacote_id: pacoteId,
        hora_saida: newSlot.hora_saida,
        hora_volta: newSlot.hora_volta || null,
        capacidade_pessoas: capacidade,
      })
      if (error) throw error
      setNewSlot(EMPTY_SLOT)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao adicionar horário")
    } finally {
      setAdding(false)
    }
  }

  async function toggleActive(slot: PacoteHorario, next: boolean) {
    setSlots((prev) => prev?.map((s) => (s.id === slot.id ? { ...s, is_active: next } : s)) ?? prev)
    const supabase = createClient()
    const { error } = await supabase
      .from("pacote_horarios")
      .update({ is_active: next })
      .eq("id", slot.id)
    if (error) {
      setSlots((prev) => prev?.map((s) => (s.id === slot.id ? { ...s, is_active: !next } : s)) ?? prev)
      toast.error("Não foi possível atualizar o horário")
    }
  }

  async function handleDelete(slot: PacoteHorario) {
    try {
      const supabase = createClient()
      const { error } = await supabase.from("pacote_horarios").delete().eq("id", slot.id)
      if (error) throw error
      setSlots((prev) => prev?.filter((s) => s.id !== slot.id) ?? prev)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover horário")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" />
        Horários e capacidade
      </Label>
      <p className="text-xs text-muted-foreground">
        Cada saída tem um limite de pessoas. Ex.: Buggy sai às 8h e às 14h, 16 pessoas por horário.
      </p>

      {slots === null ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : slots.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum horário cadastrado — reservas ficam sem limite de vagas.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {slots.map((slot) => (
            <div
              key={slot.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div className="text-sm text-foreground">
                {formatTime(slot.hora_saida)}
                {slot.hora_volta ? ` – ${formatTime(slot.hora_volta)}` : ""}
                <span className="ml-2 text-muted-foreground">{slot.capacidade_pessoas} pessoas</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={slot.is_active}
                  onCheckedChange={(next) => toggleActive(slot, next)}
                  disabled={!canManage}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!canManage}
                  onClick={() => handleDelete(slot)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 pt-1">
          <div className="flex flex-col gap-1">
            <Label htmlFor="horario-saida" className="text-xs">Saída</Label>
            <Input
              id="horario-saida"
              type="time"
              value={newSlot.hora_saida}
              onChange={(e) => setNewSlot((f) => ({ ...f, hora_saida: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="horario-volta" className="text-xs">Volta</Label>
            <Input
              id="horario-volta"
              type="time"
              value={newSlot.hora_volta}
              onChange={(e) => setNewSlot((f) => ({ ...f, hora_volta: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="horario-capacidade" className="text-xs">Capacidade</Label>
            <Input
              id="horario-capacidade"
              inputMode="numeric"
              placeholder="16"
              value={newSlot.capacidade_pessoas}
              onChange={(e) => setNewSlot((f) => ({ ...f, capacidade_pessoas: e.target.value }))}
            />
          </div>
          <Button variant="outline" size="icon" onClick={handleAdd} disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  )
}
