"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Car, Plus, Pencil, Trash2, Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCan } from "@/hooks/use-can"
import type { Motorista, Veiculo, VeiculoStatus } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface FormState {
  modelo: string
  placa: string
  capacidade: string
  motorista_padrao_id: string
  status: VeiculoStatus
  observacoes: string
}

const EMPTY_FORM: FormState = {
  modelo: "",
  placa: "",
  capacidade: "4",
  motorista_padrao_id: "",
  status: "disponivel",
  observacoes: "",
}

const STATUS_LABEL: Record<VeiculoStatus, string> = {
  disponivel: "Disponível",
  manutencao: "Manutenção",
  inativo: "Inativo",
}

const STATUS_VARIANT: Record<VeiculoStatus, "default" | "secondary" | "destructive"> = {
  disponivel: "default",
  manutencao: "secondary",
  inativo: "destructive",
}

export default function VeiculosPage() {
  const { accountId } = useAuth()
  const canManage = useCan("send-messages")

  const [veiculos, setVeiculos] = useState<Veiculo[] | null>(null)
  const [motoristas, setMotoristas] = useState<Motorista[]>([])
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Veiculo | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<Veiculo | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    try {
      const supabase = createClient()
      const [v, m] = await Promise.all([
        supabase.from("veiculos").select("*, motorista_padrao:motoristas(*)").order("modelo"),
        supabase.from("motoristas").select("*").eq("is_active", true).order("nome"),
      ])
      if (v.error) throw v.error
      setVeiculos((v.data ?? []) as unknown as Veiculo[])
      setMotoristas((m.data ?? []) as Motorista[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar veículos")
    }
  }

  useEffect(() => {
    load()
  }, [])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEdit(v: Veiculo) {
    setEditing(v)
    setForm({
      modelo: v.modelo,
      placa: v.placa ?? "",
      capacidade: String(v.capacidade),
      motorista_padrao_id: v.motorista_padrao_id ?? "",
      status: v.status,
      observacoes: v.observacoes ?? "",
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!form.modelo.trim()) {
      toast.error("Modelo é obrigatório")
      return
    }
    const capacidade = Number(form.capacidade)
    if (!Number.isFinite(capacidade) || capacidade <= 0) {
      toast.error("Capacidade inválida")
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()
      const payload = {
        modelo: form.modelo.trim(),
        placa: form.placa.trim() || null,
        capacidade,
        motorista_padrao_id: form.motorista_padrao_id || null,
        status: form.status,
        observacoes: form.observacoes.trim() || null,
      }
      if (editing) {
        const { error: updateErr } = await supabase.from("veiculos").update(payload).eq("id", editing.id)
        if (updateErr) throw updateErr
        toast.success("Veículo atualizado")
      } else {
        if (!accountId) throw new Error("Conta não identificada")
        const { error: insertErr } = await supabase.from("veiculos").insert({ ...payload, account_id: accountId })
        if (insertErr) throw insertErr
        toast.success("Veículo criado")
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar veículo")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const supabase = createClient()
      const { error: deleteErr } = await supabase.from("veiculos").delete().eq("id", pendingDelete.id)
      if (deleteErr) throw deleteErr
      toast.success("Veículo removido")
      setPendingDelete(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover veículo")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Car className="h-5 w-5" />
            Veículos
          </h1>
          <p className="text-sm text-muted-foreground">Cadastro de veículos pra escalar na agenda operacional.</p>
        </div>
        <GatedButton canAct={canManage} gateReason="criar veículos" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Novo veículo
        </GatedButton>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {veiculos === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : veiculos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum veículo cadastrado ainda.
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Placa</TableHead>
                <TableHead>Capacidade</TableHead>
                <TableHead>Motorista padrão</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {veiculos.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium text-foreground">{v.modelo}</TableCell>
                  <TableCell>{v.placa || "—"}</TableCell>
                  <TableCell>{v.capacidade}</TableCell>
                  <TableCell>{v.motorista_padrao?.nome || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" disabled={!canManage} onClick={() => openEdit(v)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={!canManage} onClick={() => setPendingDelete(v)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar veículo" : "Novo veículo"}</DialogTitle>
            <DialogDescription>Usado ao montar a agenda operacional do dia.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="veic-modelo">Modelo</Label>
                <Input
                  id="veic-modelo"
                  value={form.modelo}
                  onChange={(e) => setForm((f) => ({ ...f, modelo: e.target.value }))}
                  placeholder="Van Sprinter"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="veic-placa">Placa</Label>
                <Input id="veic-placa" value={form.placa} onChange={(e) => setForm((f) => ({ ...f, placa: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="veic-capacidade">Capacidade</Label>
                <Input
                  id="veic-capacidade"
                  inputMode="numeric"
                  value={form.capacidade}
                  onChange={(e) => setForm((f) => ({ ...f, capacidade: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="veic-status">Status</Label>
                <select
                  id="veic-status"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as VeiculoStatus }))}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="disponivel">Disponível</option>
                  <option value="manutencao">Manutenção</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="veic-motorista">Motorista padrão</Label>
              <select
                id="veic-motorista"
                value={form.motorista_padrao_id}
                onChange={(e) => setForm((f) => ({ ...f, motorista_padrao_id: e.target.value }))}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Sem motorista padrão</option>
                {motoristas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="veic-obs">Observações</Label>
              <Textarea
                id="veic-obs"
                value={form.observacoes}
                onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover veículo</DialogTitle>
            <DialogDescription>
              Tem certeza que quer remover &quot;{pendingDelete?.modelo}&quot;? Essa ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
