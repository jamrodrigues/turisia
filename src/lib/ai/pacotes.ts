import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Tour/package catalog grounding for the AI auto-reply engine.
//
// Unlike the knowledge base (chunked text, retrieved by relevance),
// this returns the account's *entire* active catalog every time. A
// tourism agency's catalog is small (a handful to a few dozen tours),
// so a keyword/semantic search would only risk missing a match on
// wording the model needed — returning everything is both simpler and
// more reliable. Caps at MAX_PACOTES as a sanity bound, not a search.
// ============================================================

const MAX_PACOTES = 50

interface PacoteHorarioRow {
  hora_saida: string
  hora_volta: string | null
  capacidade_pessoas: number
}

interface PacoteRow {
  name: string
  category: string | null
  description: string | null
  price: number
  duration_minutes: number | null
  pacote_horarios: PacoteHorarioRow[] | null
}

/**
 * Fetch every active package for the account, formatted as one string
 * per package for the system prompt. Best-effort: any failure (no
 * `pacotes` table use for this account, RLS denial, network error)
 * degrades to `[]` and never throws into the auto-reply path.
 */
export async function retrieveActivePacotes(
  db: SupabaseClient,
  accountId: string,
): Promise<string[]> {
  try {
    const { data, error } = await db
      .from('pacotes')
      .select(
        'name, category, description, price, duration_minutes, pacote_horarios(hora_saida, hora_volta, capacidade_pessoas)',
      )
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('name')
      .limit(MAX_PACOTES)
    if (error || !data || data.length === 0) return []
    return (data as PacoteRow[]).map(formatPacote)
  } catch (err) {
    console.error('[ai pacotes] retrieval failed:', err)
    return []
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function formatTime(t: string): string {
  return t.slice(0, 5)
}

function formatHorarios(horarios: PacoteHorarioRow[] | null): string | null {
  if (!horarios || horarios.length === 0) return null
  const lines = [...horarios]
    .sort((a, b) => a.hora_saida.localeCompare(b.hora_saida))
    .map((h) => {
      const range = h.hora_volta
        ? `${formatTime(h.hora_saida)}–${formatTime(h.hora_volta)}`
        : formatTime(h.hora_saida)
      return `${range} (até ${h.capacidade_pessoas} pessoas)`
    })
  return `Horários disponíveis: ${lines.join(', ')}`
}

function formatPacote(p: PacoteRow): string {
  const label = p.category ? `${p.name} (${p.category})` : p.name
  const price = `R$ ${p.price.toFixed(2).replace('.', ',')}`
  const duration = p.duration_minutes ? ` · ${formatDuration(p.duration_minutes)}` : ''
  const header = `${label} — ${price}${duration}`
  const lines = [header]
  if (p.description) lines.push(p.description.trim())
  const horariosLine = formatHorarios(p.pacote_horarios)
  if (horariosLine) lines.push(horariosLine)
  return lines.join('\n')
}

// ============================================================
// Auto-send a package photo/video when the customer's message clearly
// points at ONE specific active package. Deterministic keyword match,
// not a model decision — the LLM has no tool-calling in this engine
// (see src/lib/ai/generate.ts), so "the AI sends a photo" is really
// "a photo follows the text reply when exactly one package matched".
// Ambiguous (0 or 2+ matches) sends nothing rather than guessing wrong.
// ============================================================

interface PacoteMediaRow {
  media_type: 'image' | 'video'
  url: string
  position: number
}

interface PacoteWithMediaRow {
  name: string
  category: string | null
  pacote_media: PacoteMediaRow[] | null
}

export interface PacoteMediaMatch {
  mediaType: 'image' | 'video'
  url: string
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Best-effort: any failure (query error, no match, no media) returns
 * null and never throws into the auto-reply path.
 */
export async function matchPacoteMedia(
  db: SupabaseClient,
  accountId: string,
  customerMessage: string,
): Promise<PacoteMediaMatch | null> {
  const msg = normalize(customerMessage.trim())
  if (!msg) return null

  try {
    const { data, error } = await db
      .from('pacotes')
      .select('name, category, pacote_media(media_type, url, position)')
      .eq('account_id', accountId)
      .eq('is_active', true)
    if (error || !data) return null

    const matches = (data as PacoteWithMediaRow[]).filter((p) => {
      const media = p.pacote_media ?? []
      if (media.length === 0) return false
      const categoryHit = p.category ? msg.includes(normalize(p.category)) : false
      const nameHit = normalize(p.name)
        .split(/\s+/)
        .filter((w) => w.length >= 4)
        .some((w) => msg.includes(w))
      return categoryHit || nameHit
    })

    // Ambiguous (no match, or more than one) → send nothing.
    if (matches.length !== 1) return null

    const media = matches[0].pacote_media ?? []
    const [cover] = [...media].sort((a, b) => a.position - b.position)
    if (!cover) return null
    return { mediaType: cover.media_type, url: cover.url }
  } catch (err) {
    console.error('[ai pacotes] media match failed:', err)
    return null
  }
}
