'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, RefreshCw, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Painel "Consumo de IA" (admin) — lê ai_usage_summary() (migration 039)
 * e mostra o gasto do período: totais, por modelo, por recurso e por dia.
 * Custos são ESTIMATIVAS calculadas com a tabela de preços em
 * src/lib/ai/pricing.ts no momento de cada chamada.
 */

interface SummaryRow {
  day: string;
  feature: string;
  provider: string;
  model: string;
  calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

type Period = '7d' | '30d' | 'month';

const FEATURE_LABEL: Record<string, string> = {
  auto_reply: 'Bot (tier simples)',
  n8n_reply: 'Bot (tier avançado / n8n)',
  draft: 'Rascunhos no inbox',
  playground: 'Playground',
  transcription: 'Transcrição de áudio',
  embedding: 'Base de conhecimento',
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtUsd(n: number): string {
  return '$' + n.toFixed(n >= 1 ? 2 : 4);
}

function periodStart(p: Period): Date {
  const now = new Date();
  if (p === '7d') return new Date(now.getTime() - 7 * 864e5);
  if (p === '30d') return new Date(now.getTime() - 30 * 864e5);
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function AiUsage() {
  const [rows, setRows] = useState<SummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcErr } = await supabase.rpc('ai_usage_summary', {
      p_from: periodStart(period).toISOString(),
      p_to: new Date().toISOString(),
    });
    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setRows((data ?? []) as SummaryRow[]);
  }, [period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (rows === null && !error) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totals = (rows ?? []).reduce(
    (acc, r) => {
      acc.calls += Number(r.calls);
      acc.errors += Number(r.errors);
      acc.input += Number(r.input_tokens);
      acc.output += Number(r.output_tokens);
      acc.cost += Number(r.cost_usd);
      return acc;
    },
    { calls: 0, errors: 0, input: 0, output: 0, cost: 0 },
  );

  const groupBy = (key: (r: SummaryRow) => string) => {
    const m = new Map<string, { calls: number; input: number; output: number; cost: number; errors: number }>();
    for (const r of rows ?? []) {
      const k = key(r);
      const g = m.get(k) ?? { calls: 0, input: 0, output: 0, cost: 0, errors: 0 };
      g.calls += Number(r.calls);
      g.errors += Number(r.errors);
      g.input += Number(r.input_tokens);
      g.output += Number(r.output_tokens);
      g.cost += Number(r.cost_usd);
      m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost || b[1].calls - a[1].calls);
  };

  const byModel = groupBy((r) => `${r.model}`);
  const byFeature = groupBy((r) => r.feature);
  const byDay = groupBy((r) => r.day).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14);

  return (
    <div className="space-y-6">
      {/* Header: período + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(
            [
              ['month', 'Mês atual'],
              ['30d', '30 dias'],
              ['7d', '7 dias'],
            ] as [Period, string][]
          ).map(([p, label]) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error.includes('does not exist')
            ? 'A migration 039 (ai_usage) ainda não foi aplicada neste projeto Supabase.'
            : `Falha ao carregar: ${error}`}
        </div>
      )}

      {/* Totais */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Custo estimado', fmtUsd(totals.cost)],
          ['Chamadas', String(totals.calls) + (totals.errors ? ` (${totals.errors} erros)` : '')],
          ['Tokens entrada', fmtTokens(totals.input)],
          ['Tokens saída', fmtTokens(totals.output)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {(rows ?? []).length === 0 && !error && (
        <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-border bg-card">
          <Coins className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum consumo registrado no período.</p>
        </div>
      )}

      {(rows ?? []).length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Por modelo */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Por modelo</h3>
            <table className="mt-3 w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="pb-2 font-medium">Modelo</th>
                  <th className="pb-2 text-right font-medium">Chamadas</th>
                  <th className="pb-2 text-right font-medium">In / Out</th>
                  <th className="pb-2 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {byModel.map(([model, g]) => (
                  <tr key={model} className="border-t border-border">
                    <td className="py-2 pr-2 font-mono">{model}</td>
                    <td className="py-2 text-right tabular-nums">{g.calls}</td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtTokens(g.input)} / {fmtTokens(g.output)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtUsd(g.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Por recurso */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Por recurso</h3>
            <table className="mt-3 w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="pb-2 font-medium">Recurso</th>
                  <th className="pb-2 text-right font-medium">Chamadas</th>
                  <th className="pb-2 text-right font-medium">In / Out</th>
                  <th className="pb-2 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {byFeature.map(([feature, g]) => (
                  <tr key={feature} className="border-t border-border">
                    <td className="py-2 pr-2">{FEATURE_LABEL[feature] ?? feature}</td>
                    <td className="py-2 text-right tabular-nums">
                      {g.calls}
                      {g.errors > 0 && (
                        <span className="ml-1 text-red-400">({g.errors} err)</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtTokens(g.input)} / {fmtTokens(g.output)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtUsd(g.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Por dia */}
          <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-foreground">Últimos dias</h3>
            <table className="mt-3 w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="pb-2 font-medium">Dia</th>
                  <th className="pb-2 text-right font-medium">Chamadas</th>
                  <th className="pb-2 text-right font-medium">Tokens (in/out)</th>
                  <th className="pb-2 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {byDay.map(([day, g]) => (
                  <tr key={day} className="border-t border-border">
                    <td className="py-2 pr-2 tabular-nums">
                      {new Date(day + 'T00:00:00Z').toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        timeZone: 'UTC',
                      })}
                    </td>
                    <td className="py-2 text-right tabular-nums">{g.calls}</td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtTokens(g.input)} / {fmtTokens(g.output)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtUsd(g.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Custos estimados com base na tabela de preços dos provedores
        (USD por 1M de tokens) no momento de cada chamada. Modelos fora da
        tabela aparecem com custo $0 — os tokens são registrados mesmo assim.
      </p>
    </div>
  );
}
