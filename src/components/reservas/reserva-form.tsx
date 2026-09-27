"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import type { Contact, Pacote, PacoteHorario } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

// Maps `criar_reserva()`'s `motivo` column (058_pacote_horarios_reservas.sql)
// to a customer-facing message — keep in sync with the RPC's RETURN QUERY values.
const MOTIVO_MESSAGES: Record<string, string> = {
  sem_vagas: "Sem vagas para esse horário nessa data.",
  horario_invalido: "Horário inválido — recarregue a página e tente de novo.",
}

/**
 * Manual booking dialog for an agent. Always goes through the
 * `criar_reserva()` RPC (never a direct insert into `reservas`) so the
 * same row-locked capacity check that protects the AI/flow closing path
 * also protects a human typing a booking in here — see
 * turia_agenda_reservas_schema memory note.
 */
export function ReservaForm({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { accountId, user } = useAuth()

  const [pacotes, setPacotes] = useState<Pacote[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [horarios, setHorarios] = useState<PacoteHorario[]>([])

  const [pacoteId, setPacoteId] = useState("")
  const [horarioId, setHorarioId] = useState("")
  const [data, setData] = useState("")
  const [quantidade, setQuantidade] = useState("1")
  const [contactId, setContactId] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setPacoteId("")
    setHorarioId("")
    setData("")
    setQuantidade("1")
    setContactId("")
    const supabase = createClient()
    void Promise.all([
      supabase.from("pacotes").select("*").eq("is_active", true).order("name"),
      supabase.from("contacts").select("*").order("name"),
    ]).then(([p, c]) => {
      setPacotes((p.data ?? []) as Pacote[])
      setContacts((c.data ?? []) as Contact[])
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
    if (!pacoteId || !data) {
      toast.error("Pacote e data são obrigatórios")
      return
    }
    const qtd = Number(quantidade)
    if (!Number.isFinite(qtd) || qtd <= 0) {
      toast.error("Quantidade de pessoas inválida")
      return
    }
    if (!accountId || !user) {
      toast.error("Sessão inválida — recarregue a página")
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const { data: rows, error } = await supabase.rpc("criar_reserva", {
        p_account_id: accountId,
        p_pacote_id: pacoteId,
        p_pacote_horario_id: horarioId || null,
        p_data: data,
        p_quantidade_pessoas: qtd,
        p_contact_id: contactId || null,
        p_conversation_id: null,
        p_created_by: user.id,
      })
      if (error) throw error
      const result = (rows as { sucesso: boolean; motivo: string | null }[] | null)?.[0]
      if (!result?.sucesso) {
        toast.error(MOTIVO_MESSAGES[result?.motivo ?? ""] ?? "Não foi possível criar a reserva")
        return
      }
      toast.success("Reserva criada")
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar reserva")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova reserva</DialogTitle>
          <DialogDescription>
            Passa pelo mesmo controle de vagas que a IA usa — não estoura capacidade.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reserva-pacote">Pacote</Label>
            <select
              id="reserva-pacote"
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
              <Label htmlFor="reserva-horario">Horário</Label>
              <select
                id="reserva-horario"
                value={horarioId}
                onChange={(e) => setHorarioId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Selecione um horário</option>
                {horarios.map((h) => (
                  <option key={h.id} value={h.id}>
                    {formatTime(h.hora_saida)}
                    {h.hora_volta ? `–${formatTime(h.hora_volta)}` : ""} · até {h.capacidade_pessoas} pessoas
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reserva-data">Data</Label>
              <Input
                id="reserva-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reserva-qtd">Pessoas</Label>
              <Input
                id="reserva-qtd"
                inputMode="numeric"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reserva-contact">Cliente</Label>
            <select
              id="reserva-contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">Sem cliente vinculado</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Criar reserva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
