import { CalendarCheck, CalendarPlus, Sparkles, Wallet } from 'lucide-react'
import type { AgenciaMetrics } from '@/lib/dashboard/agencia'
import { MetricCard } from './metric-card'
import { SkeletonCard } from './skeleton'

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Tourism-agency KPIs — what the owner actually cares about day to day. */
export function AgenciaMetricCards({
  metrics,
  loading,
}: {
  metrics: AgenciaMetrics | null
  loading: boolean
}) {
  if (loading || !metrics) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Reservas hoje"
        value={metrics.reservasHoje.toLocaleString()}
        icon={CalendarCheck}
      />
      <MetricCard
        title="Reservas amanhã"
        value={metrics.reservasAmanha.toLocaleString()}
        icon={CalendarPlus}
      />
      <MetricCard
        title="Receita do mês"
        value={formatBRL(metrics.receitaMes)}
        icon={Wallet}
        subtitle={
          metrics.pacoteTopNome
            ? `Mais vendido: ${metrics.pacoteTopNome} (${metrics.pacoteTopCount})`
            : undefined
        }
      />
      <MetricCard
        title="Fechado pela IA/fluxo"
        value={`${metrics.percentFechadoIA}%`}
        icon={Sparkles}
        subtitle="Reservas deste mês sem intervenção humana"
      />
    </div>
  )
}
