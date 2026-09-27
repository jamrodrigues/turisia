"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { UserCog, Plus, Pencil, Trash2, Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCan } from "@/hooks/use-can"
import type { Motorista } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
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
  nome: string
  telefone: string
  cnh: string
  observacoes: string
  is_active: boolean
}

const EMPTY_FORM: FormState = { nome: "", telefone: "", cnh: "", observacoes: "", is_active: true }

export default function MotoristasPage() {
  const { accountId } = useAuth()
  const canManage = useCan("send-messages")

  const [motoristas, setMotoristas] = useState<Motorista[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Motorista | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<Motorista | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    try {
      const supabase = createClient()
      const { data, error: fetchErr } = await supabase
        .from("motoristas")
        .select("*")
        .order("nome")
      if (fetchErr) throw fetchErr
      setMotoristas((data ?? []) as Motorista[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar motoristas")
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

  function openEdit(m: Motorista) {
    setEditing(m)
    setForm({
      nome: m.nome,
      telefone: m.telefone ?? "",
      cnh: m.cnh ?? "",
      observacoes: m.observacoes ?? "",
      is_active: m.is_active,
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      toast.error("Nome é obrigatório")
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()
      const payload = {
        nome: form.nome.trim(),
        telefone: form.telefone.trim() || null,
        cnh: form.cnh.trim() || null,
        observacoes: form.observacoes.trim() || null,
        is_active: form.is_active,
      }
      if (editing) {
        const { error: updateErr } = await supabase.from("motoristas").update(payload).eq("id", editing.id)
        if (updateErr) throw updateErr
        toast.success("Motorista atualizado")
      } else {
        if (!accountId) throw new Error("Conta não identificada")
        const { error: insertErr } = await supabase.from("motoristas").insert({ ...payload, account_id: accountId })
        if (insertErr) throw insertErr
        toast.success("Motorista criado")
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar motorista")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const supabase = createClient()
      const { error: deleteErr } = await supabase.from("motoristas").delete().eq("id", pendingDelete.id)
      if (deleteErr) throw deleteErr
      toast.success("Motorista removido")
      setPendingDelete(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover motorista")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <UserCog className="h-5 w-5" />
            Motoristas
          </h1>
          <p className="text-sm text-muted-foreground">Cadastro de motoristas pra escalar na agenda operacional.</p>
        </div>
        <GatedButton canAct={canManage} gateReason="criar motoristas" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Novo motorista
        </GatedButton>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {motoristas === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : motoristas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum motorista cadastrado ainda.
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>CNH</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {motoristas.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium text-foreground">{m.nome}</TableCell>
                  <TableCell>{m.telefone || "—"}</TableCell>
                  <TableCell>{m.cnh || "—"}</TableCell>
                  <TableCell>
                    <Switch checked={m.is_active} disabled className="pointer-events-none opacity-80" />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" disabled={!canManage} onClick={() => openEdit(m)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={!canManage} onClick={() => setPendingDelete(m)}>
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
            <DialogTitle>{editing ? "Editar motorista" : "Novo motorista"}</DialogTitle>
            <DialogDescription>Usado ao escalar veículos na agenda operacional.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mot-nome">Nome</Label>
              <Input id="mot-nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mot-telefone">Telefone</Label>
                <Input
                  id="mot-telefone"
                  value={form.telefone}
                  onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mot-cnh">CNH</Label>
                <Input id="mot-cnh" value={form.cnh} onChange={(e) => setForm((f) => ({ ...f, cnh: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mot-obs">Observações</Label>
              <Textarea
                id="mot-obs"
                value={form.observacoes}
                onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">Ativo</p>
              <Switch
                checked={form.is_active}
                onCheckedChange={(next) => setForm((f) => ({ ...f, is_active: next }))}
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
            <DialogTitle>Remover motorista</DialogTitle>
            <DialogDescription>
              Tem certeza que quer remover &quot;{pendingDelete?.nome}&quot;? Essa ação não pode ser desfeita.
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
