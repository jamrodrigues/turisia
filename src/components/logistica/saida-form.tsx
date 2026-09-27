"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import type { Guia, Motorista, Pacote, PacoteHorario, Veiculo } from "@/types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function formatTime(t: string): string {
  return t.slice(0, 5)
}

/**
 * Creates one "saída operacional" (a vehicle/driver/guide run) for a
 * given date — the unit the daily manifest (agenda-operacional page)
 * groups reservations onto. Fase C v1 (2026-09-08): cadastro + agenda
 * operacional, sem mapa ainda.
 */
export function SaidaForm({
  open,
  onOpenChange,
  data,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: string
  onSaved: () => void
}) {
  const { accountId } = useAuth()

  const [pacotes, setPacotes] = useState<Pacote[]>([])
  const [horarios, setHorarios] = useState<PacoteHorario[]>([])
  const [veiculos, setVeiculos] = useState<Veiculo[]>([])
  const [motoristas, setMotoristas] = useState<Motorista[]>([])
  const [guias, setGuias] = useState<Guia[]>([])

  const [pacoteId, setPacoteId] = useState("")
  const [horarioId, setHorarioId] = useState("")
  const [veiculoId, setVeiculoId] = useState("")
  const [motoristaId, setMotoristaId] = useState("")
  const [guiaId, setGuiaId] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setPacoteId("")
    setHorarioId("")
    setVeiculoId("")
    setMotoristaId("")
    setGuiaId("")
    const supabase = createClient()
    void Promise.all([
      supabase.from("pacotes").select("*").eq("is_active", true).order("name"),
      supabase.from("veiculos").select("*").neq("status", "inativo").order("modelo"),
      supabase.from("motoristas").select("*").eq("is_active", true).order("nome"),
      supabase.from("guias").select("*").eq("is_active", true).order("nome"),
    ]).then(([p, v, m, g]) => {
      setPacotes((p.data ?? []) as Pacote[])
      setVeiculos((v.data ?? []) as Veiculo[])
      setMotoristas((m.data ?? []) as Motorista[])
      setGuias((g.data ?? []) as Guia[])
    })
  }, [open])

  useEffect(() => {
    if (!pacoteId) {
      setHorarios([])
      setHorarioId("")
      return
    }
    const supabase = createClient()
    void supabase
      .from("pacote_horarios")
      .select("*")
      .eq("pacote_id", pacoteId)
      .eq("is_active", true)
      .order("hora_saida")
      .then(({ data: rows }) => {
        setHorarios((rows ?? []) as PacoteHorario[])
        setHorarioId("")
      })
  }, [pacoteId])

  async function handleSave() {
    if (!pacoteId) {
      toast.error("Selecione um pacote")
      return
    }
    if (!accountId) {
      toast.error("Sessão inválida — recarregue a página")
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("saidas_operacionais").insert({
        account_id: accountId,
        pacote_id: pacoteId,
        pacote_horario_id: horarioId || null,
        data,
        veiculo_id: veiculoId || null,
        motorista_id: motoristaId || null,
        guia_id: guiaId || null,
      })
      if (error) throw error
      toast.success("Saída criada")
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar saída")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova saída</DialogTitle>
          <DialogDescription>Escala um veículo/motorista/guia pra um passeio nesse dia.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="saida-pacote">Pacote</Label>
            <select
              id="saida-pacote"
              value={pacoteId}
              onChange={(e) => setPacoteId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">Selecione um pacote</option>
              {pacotes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {horarios.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="saida-horario">Horário</Label>
              <select
                id="saida-horario"
                value={horarioId}
                onChange={(e) => setHorarioId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Sem horário fixo</option>
                {horarios.map((h) => (
                  <option key={h.id} value={h.id}>
                    {formatTime(h.hora_saida)}
                    {h.hora_volta ? `–${formatTime(h.hora_volta)}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="saida-veiculo">Veículo</Label>
            <select
              id="saida-veiculo"
              value={veiculoId}
              onChange={(e) => {
                setVeiculoId(e.target.value)
                const v = veiculos.find((x) => x.id === e.target.value)
                if (v?.motorista_padrao_id) setMotoristaId(v.motorista_padrao_id)
              }}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">Sem veículo definido</option>
              {veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.modelo} {v.placa ? `(${v.placa})` : ""} · até {v.capacidade}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="saida-motorista">Motorista</Label>
              <select
                id="saida-motorista"
                value={motoristaId}
                onChange={(e) => setMotoristaId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Sem motorista</option>
                {motoristas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="saida-guia">Guia</Label>
              <select
                id="saida-guia"
                value={guiaId}
                onChange={(e) => setGuiaId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Sem guia</option>
                {guias.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Criar saída
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
