"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ListChecks, Plus, Pencil, Trash2, Loader2, Check, Circle } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCan } from "@/hooks/use-can"
import type { Tarefa, TarefaStatus } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { FilterBar, FilterField } from "@/components/ui/filter-bar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface FormState {
  titulo: string
  descricao: string
  prazo: string
  responsavel_id: string
  contact_id: string
  status: TarefaStatus
}

interface Membro {
  id: string
  full_name: string
}

interface Contato {
  id: string
  name: string
}

const EMPTY_FORM: FormState = {
  titulo: "",
  descricao: "",
  prazo: "",
  responsavel_id: "",
  contact_id: "",
  status: "pendente",
}

function isDatePast(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  const [y, m, d] = dateStr.split("-").map(Number)
  const tarefa = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return tarefa < today
}

export default function TarefasPage() {
  const { accountId } = useAuth()
  const canManage = useCan("send-messages")

  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null)
  const [membros, setMembros] = useState<Membro[]>([])
  const [contatos, setContatos] = useState<Contato[]>([])
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Tarefa | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<Tarefa | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [statusFilter, setStatusFilter] = useState<"todas" | TarefaStatus>("todas")
  const [responsavelFilter, setResponsavelFilter] = useState<"todos" | string>("todos")

  async function load() {
    try {
      const supabase = createClient()
      const [t, m, c] = await Promise.all([
        supabase
          .from("tarefas")
          .select("*, responsavel:profiles!responsavel_id(id, full_name), contact:contacts!contact_id(id, name)")
          .order("prazo", { ascending: true, nullsFirst: false }),
        supabase.from("profiles").select("id, full_name").order("full_name"),
        supabase.from("contacts").select("id, name").order("name").limit(200),
      ])
      if (t.error) throw t.error
      setTarefas((t.data ?? []) as unknown as Tarefa[])
      setMembros((m.data ?? []) as Membro[])
      setContatos((c.data ?? []) as Contato[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar tarefas")
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

  function openEdit(t: Tarefa) {
    setEditing(t)
    setForm({
      titulo: t.titulo,
      descricao: t.descricao ?? "",
      prazo: t.prazo ?? "",
      responsavel_id: t.responsavel_id ?? "",
      contact_id: t.contact_id ?? "",
      status: t.status,
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!form.titulo.trim()) {
      toast.error("Título é obrigatório")
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()
      const payload = {
        titulo: form.titulo.trim(),
        descricao: form.descricao.trim() || null,
        prazo: form.prazo || null,
        responsavel_id: form.responsavel_id || null,
        contact_id: form.contact_id || null,
        status: form.status,
      }
      if (editing) {
        const { error: updateErr } = await supabase.from("tarefas").update(payload).eq("id", editing.id)
        if (updateErr) throw updateErr
        toast.success("Tarefa atualizada")
      } else {
        if (!accountId) throw new Error("Conta não identificada")
        const { error: insertErr } = await supabase
          .from("tarefas")
          .insert({ ...payload, account_id: accountId })
        if (insertErr) throw insertErr
        toast.success("Tarefa criada")
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar tarefa")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const supabase = createClient()
      const { error: deleteErr } = await supabase.from("tarefas").delete().eq("id", pendingDelete.id)
      if (deleteErr) throw deleteErr
      toast.success("Tarefa removida")
      setPendingDelete(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover tarefa")
    } finally {
      setDeleting(false)
    }
  }

  async function toggleStatus(tarefa: Tarefa) {
    const newStatus: TarefaStatus = tarefa.status === "pendente" ? "concluida" : "pendente"
    try {
      const supabase = createClient()
      const { error: updateErr } = await supabase
        .from("tarefas")
        .update({
          status: newStatus,
          completed_at: newStatus === "concluida" ? new Date().toISOString() : null,
        })
        .eq("id", tarefa.id)
      if (updateErr) throw updateErr
      setTarefas(
        (prev) =>
          prev?.map((t) =>
            t.id === tarefa.id
              ? {
                  ...t,
                  status: newStatus,
                  completed_at: newStatus === "concluida" ? new Date().toISOString() : null,
                }
              : t,
          ) ?? prev,
      )
      toast.success(newStatus === "concluida" ? "Tarefa concluída" : "Tarefa reaberta")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar tarefa")
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <ListChecks className="h-5 w-5" />
            Tarefas
          </h1>
          <p className="text-sm text-muted-foreground">
            Prazos e follow-ups da equipe — não confundir com as automações de IA pro cliente.
          </p>
        </div>
        <GatedButton canAct={canManage} gateReason="criar tarefas" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nova tarefa
        </GatedButton>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {tarefas !== null && tarefas.length > 0 && (
        <FilterBar className="mb-4 rounded-lg border border-border bg-card">
          <FilterField label="Status" htmlFor="tarefas-status-filter">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "todas" | TarefaStatus)}>
              <SelectTrigger id="tarefas-status-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="concluida">Concluída</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Responsável" htmlFor="tarefas-responsavel-filter">
            <Select
              value={responsavelFilter}
              onValueChange={(v) => v && setResponsavelFilter(v)}
            >
              <SelectTrigger id="tarefas-responsavel-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {membros.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </FilterBar>
      )}

      {(() => {
        if (tarefas === null) {
          return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          )
        }
        const visible = tarefas
          .filter((t) => statusFilter === "todas" || t.status === statusFilter)
          .filter((t) => responsavelFilter === "todos" || t.responsavel_id === responsavelFilter)

        if (tarefas.length === 0) {
          return (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhuma tarefa cadastrada ainda.
            </div>
          )
        }
        if (visible.length === 0) {
          return (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhuma tarefa encontrada com esse filtro.
            </div>
          )
        }
        return (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Status</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead className="w-24 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canManage}
                        onClick={() => toggleStatus(t)}
                        aria-label={t.status === "pendente" ? "Concluir tarefa" : "Reabrir tarefa"}
                      >
                        {t.status === "concluida" ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "font-medium",
                        t.status === "concluida" && "line-through text-muted-foreground",
                      )}
                    >
                      {t.titulo}
                    </TableCell>
                    <TableCell
                      className={cn(
                        t.prazo && t.status === "pendente" && isDatePast(t.prazo) && "text-destructive font-medium",
                      )}
                    >
                      {t.prazo
                        ? new Date(t.prazo + "T00:00:00").toLocaleDateString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>{t.responsavel?.full_name || "—"}</TableCell>
                    <TableCell>{t.contact?.name || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" disabled={!canManage} onClick={() => openEdit(t)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!canManage}
                          onClick={() => setPendingDelete(t)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      })()}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
            <DialogDescription>Prazos e follow-ups para a equipe.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tarefa-titulo">Título</Label>
              <Input
                id="tarefa-titulo"
                value={form.titulo}
                onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                placeholder="Ligar pra cliente"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tarefa-descricao">Descrição</Label>
              <Textarea
                id="tarefa-descricao"
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tarefa-prazo">Prazo</Label>
                <Input
                  id="tarefa-prazo"
                  type="date"
                  value={form.prazo}
                  onChange={(e) => setForm((f) => ({ ...f, prazo: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tarefa-status">Status</Label>
                <select
                  id="tarefa-status"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TarefaStatus }))}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="pendente">Pendente</option>
                  <option value="concluida">Concluída</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tarefa-responsavel">Responsável</Label>
              <select
                id="tarefa-responsavel"
                value={form.responsavel_id}
                onChange={(e) => setForm((f) => ({ ...f, responsavel_id: e.target.value }))}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Sem responsável</option>
                {membros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tarefa-contato">Contato</Label>
              <select
                id="tarefa-contato"
                value={form.contact_id}
                onChange={(e) => setForm((f) => ({ ...f, contact_id: e.target.value }))}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Nenhum</option>
                {contatos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
            <DialogTitle>Remover tarefa</DialogTitle>
            <DialogDescription>
              Tem certeza que quer remover &quot;{pendingDelete?.titulo}&quot;? Essa ação não pode ser desfeita.
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
