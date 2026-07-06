/**
 * Central date formatting with the Brazilian Portuguese locale.
 *
 * The app is pt-BR only, so every date-fns call should route through
 * here (or pass `{ locale: ptBR }`) to get "há 5 minutos" / "ontem" /
 * "12 de julho" instead of English. Timezone for display is
 * America/Sao_Paulo.
 */
import {
  format,
  formatDistanceToNow,
  type FormatDistanceToNowOptions,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'

export { ptBR }

/** Wrapper around date-fns `format` with the pt-BR locale baked in. */
export function formatBR(date: Date | number, fmt: string): string {
  return format(date, fmt, { locale: ptBR })
}

/** "há 5 minutos", "há 2 horas" — relative time in pt-BR. */
export function distanceToNowBR(
  date: Date | number,
  opts?: Omit<FormatDistanceToNowOptions, 'locale'>,
): string {
  return formatDistanceToNow(date, { ...opts, locale: ptBR })
}
