"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Package, Plus, Loader2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCan } from "@/hooks/use-can"
import type { Pacote } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PacoteMediaGallery } from "@/components/pacotes/pacote-media-gallery"
import { PacoteHorariosEditor } from "@/components/pacotes/pacote-horarios-editor"
import { PacoteClosingFlowButton } from "@/components/pacotes/pacote-closing-flow-button"
import { PacoteCard } from "@/components/pacotes/pacote-card"

interface FormState {
  name: string
  category: string
  price: string
  duration_minutes: string
  description: string
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "",
  price: "",
  duration_minutes: "",
  description: "",
  is_active: true,
}

export default function PacotesPage() {
  const { accountId } = useAuth()
  const canManage = useCan("send-messages")

  const [pacotes, setPacotes] = useState<Pacote[] | null>(null)
  const [coverByPacoteId, setCoverByPacoteId] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Pacote | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<Pacote | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    try {
      const supabase = createClient()
      const { data, error: fetchErr } = await supabase
        .from("pacotes")
        .select("*, pacote_media(url, position)")
        .order("created_at", { ascending: false })
      if (fetchErr) throw fetchErr
      const rows = (data ?? []) as unknown as (Pacote & {
        pacote_media: { url: string; position: number }[] | null
      })[]
      const covers: Record<string, string> = {}
      const plain: Pacote[] = rows.map((r) => {
        const { pacote_media, ...pacote } = r
        const [cover] = [...(pacote_media ?? [])].sort((a, b) => a.position - b.position)
        if (cover) covers[pacote.id] = cover.url
        return pacote
      })
      setCoverByPacoteId(covers)
      setPacotes(plain)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar pacotes")
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

  function openEdit(p: Pacote) {
    setEditing(p)
    setForm({
      name: p.name,
      category: p.category ?? "",
      price: String(p.price),
      duration_minutes: p.duration_minutes != null ? String(p.duration_minutes) : "",
      description: p.description ?? "",
      is_active: p.is_active,
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Nome é obrigatório")
      return
    }
    const price = Number(form.price.replace(",", "."))
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Preço inválido")
      return
    }
    const duration =
      form.duration_minutes.trim() === "" ? null : Number(form.duration_minutes)
    if (duration != null && (!Number.isFinite(duration) || duration < 0)) {
      toast.error("Duração inválida")
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        price,
        duration_minutes: duration,
        is_active: form.is_active,
      }

      if (editing) {
        const { error: updateErr } = await supabase
          .from("pacotes")
          .update(payload)
          .eq("id", editing.id)
        if (updateErr) throw updateErr
        toast.success("Pacote atualizado")
      } else {
        if (!accountId) throw new Error("Conta não identificada")
        const { error: insertErr } = await supabase
          .from("pacotes")
          .insert({ ...payload, account_id: accountId })
        if (insertErr) throw insertErr
        toast.success("Pacote criado")
      }

      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar pacote")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const supabase = createClient()
      const { error: deleteErr } = await supabase
        .from("pacotes")
        .delete()
        .eq("id", pendingDelete.id)
      if (deleteErr) throw deleteErr
      toast.success("Pacote removido")
      setPendingDelete(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover pacote")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Package className="h-5 w-5" />
            Pacotes
          </h1>
          <p className="text-sm text-muted-foreground">
            Passeios e pacotes que a IA usa para responder preço e disponibilidade no WhatsApp.
          </p>
        </div>
        <GatedButton canAct={canManage} gateReason="criar pacotes" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Novo pacote
        </GatedButton>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {pacotes === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : pacotes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum pacote cadastrado ainda. Crie o primeiro para a IA já poder responder sobre ele no WhatsApp.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          {pacotes.map((p) => (
            <PacoteCard
              key={p.id}
              pacote={p}
              coverUrl={coverByPacoteId[p.id] ?? null}
              canManage={canManage}
              onEdit={() => openEdit(p)}
              onDelete={() => setPendingDelete(p)}
            />
          ))}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar pacote" : "Novo pacote"}</DialogTitle>
            <DialogDescription>
              Essas informações entram direto na resposta da IA no WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pacote-name">Nome</Label>
              <Input
                id="pacote-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Passeio de Buggy pela Praia"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pacote-category">Categoria</Label>
                <Input
                  id="pacote-category"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="buggy, mergulho…"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pacote-price">Preço (R$)</Label>
                <Input
                  id="pacote-price"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="180,00"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pacote-duration">Duração (minutos)</Label>
              <Input
                id="pacote-duration"
                inputMode="numeric"
                value={form.duration_minutes}
                onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                placeholder="150"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pacote-description">Descrição</Label>
              <Textarea
                id="pacote-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="O que está incluso, ponto de encontro, o que levar…"
                rows={4}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Ativo</p>
                <p className="text-xs text-muted-foreground">
                  Pacotes inativos somem do catálogo e da resposta da IA.
                </p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(next) => setForm((f) => ({ ...f, is_active: next }))}
              />
            </div>
            {editing ? (
              <>
                <PacoteMediaGallery pacoteId={editing.id} canManage={canManage} />
                <PacoteHorariosEditor pacoteId={editing.id} canManage={canManage} />
                <PacoteClosingFlowButton pacoteId={editing.id} canManage={canManage} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Salve o pacote primeiro — depois volte para adicionar fotos, vídeos e horários.
              </p>
            )}
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
            <DialogTitle>Remover pacote</DialogTitle>
            <DialogDescription>
              Tem certeza que quer remover &quot;{pendingDelete?.name}&quot;? Essa ação não pode ser desfeita.
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
