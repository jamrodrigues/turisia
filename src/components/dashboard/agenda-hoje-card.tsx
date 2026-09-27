import { CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgendaSlot } from '@/lib/dashboard/agencia'
import { Skeleton } from './skeleton'

function formatTime(t: string): string {
  return t.slice(0, 5)
}

function OcupacaoBar({ ocupado, capacidade }: { ocupado: number; capacidade: number }) {
  const pct = capacidade > 0 ? Math.min(100, Math.round((ocupado / capacidade) * 100)) : 0
  const full = ocupado >= capacidade
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', full ? 'bg-red-400' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-xs tabular-nums', full ? 'text-red-400' : 'text-muted-foreground')}>
        {ocupado}/{capacidade}
      </span>
    </div>
  )
}

/**
 * "O que sai hoje" — the one question a tourism-agency owner actually
 * opens the dashboard to answer, which no generic CRM widget shows.
 * Reads live occupancy from `pacote_horarios` + `reservas`
 * (058_pacote_horarios_reservas.sql), same source `criar_reserva()`
 * checks before accepting a booking.
 */
export function AgendaHojeCard({
  slots,
  loading,
}: {
  slots: AgendaSlot[] | null
  loading: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Passeios de hoje</h3>
      </div>
      {loading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !slots || slots.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhum horário cadastrado ainda — configure em Pacotes.
        </p>
      ) : (
        <div className="mt-3 flex flex-col divide-y divide-border">
          {slots.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{s.pacoteNome}</p>
                <p className="text-xs text-muted-foreground">
                  {formatTime(s.horaSaida)}
                  {s.horaVolta ? `–${formatTime(s.horaVolta)}` : ''}
                </p>
              </div>
              <OcupacaoBar ocupado={s.ocupado} capacidade={s.capacidade} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
