import type { SupabaseClient } from '@supabase/supabase-js'
import { localDayKey } from './date-utils'

// ============================================================
// Tourism-agency-specific dashboard data — separate from queries.ts
// (generic CRM metrics) because these read the `pacotes` /
// `pacote_horarios` / `reservas` tables added for turia's actual
// business (058_pacote_horarios_reservas.sql) and answer questions a
// CRM dashboard never asks: "quantos passeios saem hoje?", "quanto
// disso a IA fechou sozinha?".
// ============================================================

type DB = SupabaseClient

export interface AgendaSlot {
  pacoteNome: string
  horaSaida: string
  horaVolta: string | null
  capacidade: number
  ocupado: number
}

export interface AgenciaMetrics {
  reservasHoje: number
  reservasAmanha: number
  /** Sum of `pacotes.price` for non-cancelled reservas this calendar month. */
  receitaMes: number
  /** % of this month's non-cancelled reservas created with no human agent (created_by IS NULL). */
  percentFechadoIA: number
  pacoteTopNome: string | null
  pacoteTopCount: number
}

interface ReservaRow {
  data: string
  status: string
  quantidade_pessoas: number
  created_by: string | null
  pacote_id: string
  pacotes: { name: string; price: number } | null
}

/**
 * Today's departures across every active package, with live occupancy
 * (capacity minus non-cancelled reservas for that slot+date). This is
 * the single most agency-relevant fact a dashboard can show — "o que
 * sai hoje e tem vaga?" — and no generic CRM metric captures it.
 */
export async function loadAgendaHoje(db: DB): Promise<AgendaSlot[]> {
  const today = localDayKey(new Date())

  const { data: horarios, error } = await db
    .from('pacote_horarios')
    .select('id, hora_saida, hora_volta, capacidade_pessoas, pacotes!inner(name, is_active)')
    .eq('is_active', true)
    .eq('pacotes.is_active', true)
    .order('hora_saida')
  if (error || !horarios) return []

  type HorarioRow = {
    id: string
    hora_saida: string
    hora_volta: string | null
    capacidade_pessoas: number
    pacotes: { name: string } | null
  }
  const rows = horarios as unknown as HorarioRow[]
  if (rows.length === 0) return []

  const { data: reservas } = await db
    .from('reservas')
    .select('pacote_horario_id, quantidade_pessoas')
    .eq('data', today)
    .neq('status', 'cancelada')
    .in('pacote_horario_id', rows.map((r) => r.id))

  const ocupadoByHorario = new Map<string, number>()
  for (const r of (reservas ?? []) as { pacote_horario_id: string | null; quantidade_pessoas: number }[]) {
    if (!r.pacote_horario_id) continue
    ocupadoByHorario.set(
      r.pacote_horario_id,
      (ocupadoByHorario.get(r.pacote_horario_id) ?? 0) + r.quantidade_pessoas,
    )
  }

  return rows.map((r) => ({
    pacoteNome: r.pacotes?.name ?? '—',
    horaSaida: r.hora_saida,
    horaVolta: r.hora_volta,
    capacidade: r.capacidade_pessoas,
    ocupado: ocupadoByHorario.get(r.id) ?? 0,
  }))
}

export async function loadAgenciaMetrics(db: DB): Promise<AgenciaMetrics> {
  const now = new Date()
  const today = localDayKey(now)
  const tomorrow = localDayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const [hojeCount, amanhaCount, monthRows] = await Promise.all([
    db
      .from('reservas')
      .select('id', { count: 'exact', head: true })
      .eq('data', today)
      .neq('status', 'cancelada'),
    db
      .from('reservas')
      .select('id', { count: 'exact', head: true })
      .eq('data', tomorrow)
      .neq('status', 'cancelada'),
    db
      .from('reservas')
      .select('data, status, quantidade_pessoas, created_by, pacote_id, pacotes(name, price)')
      .gte('data', monthStart)
      .neq('status', 'cancelada'),
  ])

  const rows = (monthRows.data ?? []) as unknown as ReservaRow[]

  const receitaMes = rows.reduce((sum, r) => sum + (r.pacotes?.price ?? 0), 0)
  const fechadoIA = rows.filter((r) => r.created_by === null).length
  const percentFechadoIA = rows.length > 0 ? Math.round((fechadoIA / rows.length) * 100) : 0

  const countByPacote = new Map<string, { nome: string; count: number }>()
  for (const r of rows) {
    const key = r.pacote_id
    const prev = countByPacote.get(key)
    const nome = r.pacotes?.name ?? '—'
    countByPacote.set(key, { nome, count: (prev?.count ?? 0) + 1 })
  }
  let pacoteTopNome: string | null = null
  let pacoteTopCount = 0
  for (const { nome, count } of countByPacote.values()) {
    if (count > pacoteTopCount) {
      pacoteTopCount = count
      pacoteTopNome = nome
    }
  }

  return {
    reservasHoje: hojeCount.count ?? 0,
    reservasAmanha: amanhaCount.count ?? 0,
    receitaMes,
    percentFechadoIA,
    pacoteTopNome,
    pacoteTopCount,
  }
}
