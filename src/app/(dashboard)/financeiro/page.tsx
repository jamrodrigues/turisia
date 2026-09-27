"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Wallet, Plus, Pencil, Trash2, Loader2, ArrowUpCircle, ArrowDownCircle } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCan } from "@/hooks/use-can"
import type {
  ContaFinanceira,
  ContaFinanceiraTipo,
  LancamentoFinanceiro,
  LancamentoTipo,
  LancamentoCategoria,
} from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { FilterBar, FilterField } from "@/components/ui/filter-bar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

const CONTA_TIPO_LABEL: Record<ContaFinanceiraTipo, string> = {
  banco: "Banco",
  cartao: "Cartão",
  maquininha: "Maquininha",
  caixa: "Caixa",
}

const CATEGORIA_LABEL: Record<LancamentoCategoria, string> = {
  reserva: "Reserva",
  despesa_operacional: "Despesa operacional",
  taxa: "Taxa",
  salario: "Salário",
  outro: "Outro",
}

function formatMoney(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

interface ContaFormState {
  nome: string
  tipo: ContaFinanceiraTipo
  saldo_inicial: string
  observacoes: string
}

const EMPTY_CONTA_FORM: ContaFormState = {
  nome: "",
  tipo: "banco",
  saldo_inicial: "0",
  observacoes: "",
}

interface LancamentoFormState {
  conta_id: string
  tipo: LancamentoTipo
  categoria: LancamentoCategoria
  valor: string
  data: string
  descricao: string
}

function emptyLancamentoForm(contaId: string): LancamentoFormState {
  return {
    conta_id: contaId,
    tipo: "entrada",
    categoria: "outro",
    valor: "",
    data: new Date().toISOString().slice(0, 10),
    descricao: "",
  }
}

export default function FinanceiroPage() {
  const { accountId } = useAuth()
  // Ledger entries: gated at "agent" level, matching the RLS floor for
  // lancamentos_financeiros insert/update. Accounts (contas) are a step
  // more sensitive (RLS requires admin), so they get the stricter check.
  const canManageLancamentos = useCan("send-messages")
  const canManageContas = useCan("edit-settings")

  const [contas, setContas] = useState<ContaFinanceira[] | null>(null)
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [tipoFilter, setTipoFilter] = useState<"todos" | LancamentoTipo>("todos")
  const [contaFilter, setContaFilter] = useState<string>("todas")

  const [contaFormOpen, setContaFormOpen] = useState(false)
  const [editingConta, setEditingConta] = useState<ContaFinanceira | null>(null)
  const [contaForm, setContaForm] = useState<ContaFormState>(EMPTY_CONTA_FORM)
  const [savingConta, setSavingConta] = useState(false)
  const [pendingDeleteConta, setPendingDeleteConta] = useState<ContaFinanceira | null>(null)

  const [lancFormOpen, setLancFormOpen] = useState(false)
  const [editingLanc, setEditingLanc] = useState<LancamentoFinanceiro | null>(null)
  const [lancForm, setLancForm] = useState<LancamentoFormState>(emptyLancamentoForm(""))
  const [savingLanc, setSavingLanc] = useState(false)
  const [pendingDeleteLanc, setPendingDeleteLanc] = useState<LancamentoFinanceiro | null>(null)

  async function load() {
    try {
      const supabase = createClient()
      const [c, l] = await Promise.all([
        supabase.from("contas_financeiras").select("*").order("nome"),
        supabase
          .from("lancamentos_financeiros")
          .select("*, conta:contas_financeiras(*)")
          .order("data", { ascending: false }),
      ])
      if (c.error) throw c.error
      if (l.error) throw l.error
      setContas((c.data ?? []) as unknown as ContaFinanceira[])
      setLancamentos((l.data ?? []) as unknown as LancamentoFinanceiro[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar dados financeiros")
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Saldo per conta = saldo_inicial + entradas - saídas registradas nela.
  // Computed in memory from what's already loaded — no separate query.
  const saldoPorConta = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of contas ?? []) map.set(c.id, c.saldo_inicial)
    for (const l of lancamentos ?? []) {
      const delta = l.tipo === "entrada" ? l.valor : -l.valor
      map.set(l.conta_id, (map.get(l.conta_id) ?? 0) + delta)
    }
    return map
  }, [contas, lancamentos])

  const saldoTotal = useMemo(
    () => Array.from(saldoPorConta.values()).reduce((a, b) => a + b, 0),
    [saldoPorConta],
  )

  const { entradasMes, saidasMes } = useMemo(() => {
    const mk = currentMonthKey()
    let entradas = 0
    let saidas = 0
    for (const l of lancamentos ?? []) {
      if (!l.data.startsWith(mk)) continue
      if (l.tipo === "entrada") entradas += l.valor
      else saidas += l.valor
    }
    return { entradasMes: entradas, saidasMes: saidas }
  }, [lancamentos])

  const visibleLancamentos = (lancamentos ?? [])
    .filter((l) => tipoFilter === "todos" || l.tipo === tipoFilter)
    .filter((l) => contaFilter === "todas" || l.conta_id === contaFilter)

  // ---- Contas ----

  function openCreateConta() {
    setEditingConta(null)
    setContaForm(EMPTY_CONTA_FORM)
    setContaFormOpen(true)
  }

  function openEditConta(c: ContaFinanceira) {
    setEditingConta(c)
    setContaForm({
      nome: c.nome,
      tipo: c.tipo,
      saldo_inicial: String(c.saldo_inicial),
      observacoes: c.observacoes ?? "",
    })
    setContaFormOpen(true)
  }

  async function handleSaveConta() {
    if (!contaForm.nome.trim()) {
      toast.error("Nome é obrigatório")
      return
    }
    const saldoInicial = Number(contaForm.saldo_inicial.replace(",", "."))
    if (!Number.isFinite(saldoInicial)) {
      toast.error("Saldo inicial inválido")
      return
    }
    setSavingConta(true)
    try {
      const supabase = createClient()
      const payload = {
        nome: contaForm.nome.trim(),
        tipo: contaForm.tipo,
        saldo_inicial: saldoInicial,
        observacoes: contaForm.observacoes.trim() || null,
      }
      if (editingConta) {
        const { error: updateErr } = await supabase
          .from("contas_financeiras")
          .update(payload)
          .eq("id", editingConta.id)
        if (updateErr) throw updateErr
        toast.success("Conta atualizada")
      } else {
        if (!accountId) throw new Error("Conta não identificada")
        const { error: insertErr } = await supabase
          .from("contas_financeiras")
          .insert({ ...payload, account_id: accountId })
        if (insertErr) throw insertErr
        toast.success("Conta criada")
      }
      setContaFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar conta")
    } finally {
      setSavingConta(false)
    }
  }

  async function handleDeleteConta() {
    if (!pendingDeleteConta) return
    try {
      const supabase = createClient()
      const { error: deleteErr } = await supabase
        .from("contas_financeiras")
        .delete()
        .eq("id", pendingDeleteConta.id)
      if (deleteErr) throw deleteErr
      toast.success("Conta removida")
      setPendingDeleteConta(null)
      await load()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Falha ao remover conta — ela pode ter lançamentos vinculados",
      )
    }
  }

  // ---- Lançamentos ----

  function openCreateLancamento() {
    setEditingLanc(null)
    setLancForm(emptyLancamentoForm(contas?.[0]?.id ?? ""))
    setLancFormOpen(true)
  }

  function openEditLancamento(l: LancamentoFinanceiro) {
    setEditingLanc(l)
    setLancForm({
      conta_id: l.conta_id,
      tipo: l.tipo,
      categoria: l.categoria,
      valor: String(l.valor),
      data: l.data,
      descricao: l.descricao ?? "",
    })
    setLancFormOpen(true)
  }

  async function handleSaveLancamento() {
    if (!lancForm.conta_id) {
      toast.error("Escolha uma conta")
      return
    }
    const valor = Number(lancForm.valor.replace(",", "."))
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Valor inválido")
      return
    }
    setSavingLanc(true)
    try {
      const supabase = createClient()
      const payload = {
        conta_id: lancForm.conta_id,
        tipo: lancForm.tipo,
        categoria: lancForm.categoria,
        valor,
        data: lancForm.data,
        descricao: lancForm.descricao.trim() || null,
      }
      if (editingLanc) {
        const { error: updateErr } = await supabase
          .from("lancamentos_financeiros")
          .update(payload)
          .eq("id", editingLanc.id)
        if (updateErr) throw updateErr
        toast.success("Lançamento atualizado")
      } else {
        if (!accountId) throw new Error("Conta não identificada")
        const { error: insertErr } = await supabase
          .from("lancamentos_financeiros")
          .insert({ ...payload, account_id: accountId })
        if (insertErr) throw insertErr
        toast.success("Lançamento registrado")
      }
      setLancFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar lançamento")
    } finally {
      setSavingLanc(false)
    }
  }

  async function handleDeleteLancamento() {
    if (!pendingDeleteLanc) return
    try {
      const supabase = createClient()
      const { error: deleteErr } = await supabase
        .from("lancamentos_financeiros")
        .delete()
        .eq("id", pendingDeleteLanc.id)
      if (deleteErr) throw deleteErr
      toast.success("Lançamento removido")
      setPendingDeleteLanc(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover lançamento")
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Wallet className="h-5 w-5" />
            Financeiro
          </h1>
          <p className="text-sm text-muted-foreground">
            Contas e lançamentos manuais — livro-caixa da agência. Sem importação bancária ainda.
          </p>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="px-4">
          <p className="text-xs text-muted-foreground">Saldo total</p>
          <p className="text-2xl font-semibold text-foreground">{formatMoney(saldoTotal)}</p>
        </Card>
        <Card className="px-4">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowUpCircle className="h-3.5 w-3.5" /> Entradas no mês
          </p>
          <p className="text-2xl font-semibold text-foreground">{formatMoney(entradasMes)}</p>
        </Card>
        <Card className="px-4">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowDownCircle className="h-3.5 w-3.5" /> Saídas no mês
          </p>
          <p className="text-2xl font-semibold text-foreground">{formatMoney(saidasMes)}</p>
        </Card>
      </div>

      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-foreground">Contas</h2>
          <GatedButton canAct={canManageContas} gateReason="criar contas financeiras" onClick={openCreateConta}>
            <Plus className="h-4 w-4" />
            Nova conta
          </GatedButton>
        </div>

        {contas === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : contas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma conta cadastrada ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contas.map((c) => (
              <Card key={c.id} className="px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{c.nome}</p>
                    <Badge variant="secondary" className="mt-1">
                      {CONTA_TIPO_LABEL[c.tipo]}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon-sm" disabled={!canManageContas} onClick={() => openEditConta(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canManageContas}
                      onClick={() => setPendingDeleteConta(c)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {formatMoney(saldoPorConta.get(c.id) ?? c.saldo_inicial)}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-foreground">Lançamentos</h2>
          <GatedButton
            canAct={canManageLancamentos && contas !== null && contas.length > 0}
            gateReason={contas && contas.length === 0 ? "cadastrar uma conta primeiro" : "registrar lançamentos"}
            onClick={openCreateLancamento}
          >
            <Plus className="h-4 w-4" />
            Novo lançamento
          </GatedButton>
        </div>

        {lancamentos !== null && lancamentos.length > 0 && (
          <FilterBar className="mb-4 rounded-lg border border-border bg-card">
            <FilterField label="Tipo" htmlFor="lanc-tipo-filter">
              <Select value={tipoFilter} onValueChange={(v) => v && setTipoFilter(v as "todos" | LancamentoTipo)}>
                <SelectTrigger id="lanc-tipo-filter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Conta" htmlFor="lanc-conta-filter">
              <Select value={contaFilter} onValueChange={(v) => v && setContaFilter(v)}>
                <SelectTrigger id="lanc-conta-filter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {(contas ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </FilterBar>
        )}

        {lancamentos === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : lancamentos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum lançamento registrado ainda.
          </div>
        ) : visibleLancamentos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum lançamento encontrado com esse filtro.
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-24 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleLancamentos.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(l.data + "T00:00:00").toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>{l.conta?.nome ?? "—"}</TableCell>
                    <TableCell>
                      {l.tipo === "entrada" ? (
                        <Badge variant="default" className="gap-1">
                          <ArrowUpCircle className="h-3 w-3" />
                          Entrada
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <ArrowDownCircle className="h-3 w-3" />
                          Saída
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{CATEGORIA_LABEL[l.categoria]}</TableCell>
                    <TableCell className="max-w-64 truncate">{l.descricao || "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(l.valor)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!canManageLancamentos}
                          onClick={() => openEditLancamento(l)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={!canManageLancamentos}
                          onClick={() => setPendingDeleteLanc(l)}
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
        )}
      </div>

      {/* Conta dialog */}
      <Dialog open={contaFormOpen} onOpenChange={setContaFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingConta ? "Editar conta" : "Nova conta"}</DialogTitle>
            <DialogDescription>Banco, cartão, maquininha ou caixa — onde o dinheiro entra/sai.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="conta-nome">Nome</Label>
                <Input
                  id="conta-nome"
                  value={contaForm.nome}
                  onChange={(e) => setContaForm((f) => ({ ...f, nome: e.target.value }))}
                  placeholder="Banco do Brasil"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="conta-tipo">Tipo</Label>
                <select
                  id="conta-tipo"
                  value={contaForm.tipo}
                  onChange={(e) => setContaForm((f) => ({ ...f, tipo: e.target.value as ContaFinanceiraTipo }))}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {Object.entries(CONTA_TIPO_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conta-saldo">Saldo inicial</Label>
              <Input
                id="conta-saldo"
                inputMode="decimal"
                value={contaForm.saldo_inicial}
                onChange={(e) => setContaForm((f) => ({ ...f, saldo_inicial: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conta-obs">Observações</Label>
              <Textarea
                id="conta-obs"
                value={contaForm.observacoes}
                onChange={(e) => setContaForm((f) => ({ ...f, observacoes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContaFormOpen(false)} disabled={savingConta}>
              Cancelar
            </Button>
            <Button onClick={handleSaveConta} disabled={savingConta}>
              {savingConta ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDeleteConta} onOpenChange={(open) => !open && setPendingDeleteConta(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover conta</DialogTitle>
            <DialogDescription>
              Tem certeza que quer remover &quot;{pendingDeleteConta?.nome}&quot;? Lançamentos vinculados a ela
              serão removidos junto — essa ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteConta(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteConta}>
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lançamento dialog */}
      <Dialog open={lancFormOpen} onOpenChange={setLancFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLanc ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
            <DialogDescription>Uma entrada ou saída manual numa conta.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lanc-conta">Conta</Label>
              <select
                id="lanc-conta"
                value={lancForm.conta_id}
                onChange={(e) => setLancForm((f) => ({ ...f, conta_id: e.target.value }))}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="" disabled>
                  Selecione
                </option>
                {(contas ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lanc-tipo">Tipo</Label>
                <select
                  id="lanc-tipo"
                  value={lancForm.tipo}
                  onChange={(e) => setLancForm((f) => ({ ...f, tipo: e.target.value as LancamentoTipo }))}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lanc-categoria">Categoria</Label>
                <select
                  id="lanc-categoria"
                  value={lancForm.categoria}
                  onChange={(e) => setLancForm((f) => ({ ...f, categoria: e.target.value as LancamentoCategoria }))}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {Object.entries(CATEGORIA_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lanc-valor">Valor</Label>
                <Input
                  id="lanc-valor"
                  inputMode="decimal"
                  value={lancForm.valor}
                  onChange={(e) => setLancForm((f) => ({ ...f, valor: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lanc-data">Data</Label>
                <Input
                  id="lanc-data"
                  type="date"
                  value={lancForm.data}
                  onChange={(e) => setLancForm((f) => ({ ...f, data: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lanc-descricao">Descrição</Label>
              <Textarea
                id="lanc-descricao"
                value={lancForm.descricao}
                onChange={(e) => setLancForm((f) => ({ ...f, descricao: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLancFormOpen(false)} disabled={savingLanc}>
              Cancelar
            </Button>
            <Button onClick={handleSaveLancamento} disabled={savingLanc}>
              {savingLanc ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDeleteLanc} onOpenChange={(open) => !open && setPendingDeleteLanc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover lançamento</DialogTitle>
            <DialogDescription>Essa ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteLanc(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteLancamento}>
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
