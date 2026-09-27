"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Compass, Plus, Pencil, Trash2, Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCan } from "@/hooks/use-can"
import type { Guia } from "@/types"
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
  credenciais: string
  observacoes: string
  is_active: boolean
}

const EMPTY_FORM: FormState = { nome: "", telefone: "", credenciais: "", observacoes: "", is_active: true }

export default function GuiasPage() {
  const { accountId } = useAuth()
  const canManage = useCan("send-messages")

  const [guias, setGuias] = useState<Guia[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Guia | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<Guia | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    try {
      const supabase = createClient()
      const { data, error: fetchErr } = await supabase.from("guias").select("*").order("nome")
      if (fetchErr) throw fetchErr
      setGuias((data ?? []) as Guia[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar guias")
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

  function openEdit(g: Guia) {
    setEditing(g)
    setForm({
      nome: g.nome,
      telefone: g.telefone ?? "",
      credenciais: g.credenciais ?? "",
      observacoes: g.observacoes ?? "",
      is_active: g.is_active,
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
        credenciais: form.credenciais.trim() || null,
        observacoes: form.observacoes.trim() || null,
        is_active: form.is_active,
      }
      if (editing) {
        const { error: updateErr } = await supabase.from("guias").update(payload).eq("id", editing.id)
        if (updateErr) throw updateErr
        toast.success("Guia atualizado")
      } else {
        if (!accountId) throw new Error("Conta não identificada")
        const { error: insertErr } = await supabase.from("guias").insert({ ...payload, account_id: accountId })
        if (insertErr) throw insertErr
        toast.success("Guia criado")
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar guia")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const supabase = createClient()
      const { error: deleteErr } = await supabase.from("guias").delete().eq("id", pendingDelete.id)
      if (deleteErr) throw deleteErr
      toast.success("Guia removido")
      setPendingDelete(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover guia")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Compass className="h-5 w-5" />
            Guias
          </h1>
          <p className="text-sm text-muted-foreground">Cadastro de guias pra escalar na agenda operacional.</p>
        </div>
        <GatedButton canAct={canManage} gateReason="criar guias" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Novo guia
        </GatedButton>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {guias === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : guias.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum guia cadastrado ainda.
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Credenciais</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guias.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium text-foreground">{g.nome}</TableCell>
                  <TableCell>{g.telefone || "—"}</TableCell>
                  <TableCell>{g.credenciais || "—"}</TableCell>
                  <TableCell>
                    <Switch checked={g.is_active} disabled className="pointer-events-none opacity-80" />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" disabled={!canManage} onClick={() => openEdit(g)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" disabled={!canManage} onClick={() => setPendingDelete(g)}>
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
            <DialogTitle>{editing ? "Editar guia" : "Novo guia"}</DialogTitle>
            <DialogDescription>Usado ao escalar passeios na agenda operacional.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guia-nome">Nome</Label>
              <Input id="guia-nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="guia-telefone">Telefone</Label>
                <Input
                  id="guia-telefone"
                  value={form.telefone}
                  onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="guia-credenciais">Credenciais</Label>
                <Input
                  id="guia-credenciais"
                  value={form.credenciais}
                  onChange={(e) => setForm((f) => ({ ...f, credenciais: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guia-obs">Observações</Label>
              <Textarea
                id="guia-obs"
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
            <DialogTitle>Remover guia</DialogTitle>
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
