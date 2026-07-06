import { DEFAULT_THEME, isThemeId, type ThemeId } from './themes'

/**
 * White-label branding — per DEPLOY, via env (one deploy per client).
 *
 * Env-based (not DB) on purpose: it must render on the pre-login screen
 * where there's no account context yet, and each client already gets
 * their own deploy. Set these in the client's .env:
 *
 *   NEXT_PUBLIC_BRAND_NAME=Clínica da Neuza
 *   NEXT_PUBLIC_BRAND_LOGO_URL=https://.../logo.png   (optional)
 *   NEXT_PUBLIC_BRAND_THEME=emerald                    (optional; a ThemeId)
 *
 * All are optional — falling back to the neutral product defaults keeps
 * an unbranded deploy working.
 */
export interface Brand {
  name: string
  logoUrl: string | null
  theme: ThemeId
}

const DEFAULT_BRAND_NAME = 'CRM WhatsApp'

export function getBrand(): Brand {
  const name = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || DEFAULT_BRAND_NAME
  const logoUrl = process.env.NEXT_PUBLIC_BRAND_LOGO_URL?.trim() || null
  const themeEnv = process.env.NEXT_PUBLIC_BRAND_THEME?.trim()
  const theme = themeEnv && isThemeId(themeEnv) ? themeEnv : DEFAULT_THEME
  return { name, logoUrl, theme }
}
