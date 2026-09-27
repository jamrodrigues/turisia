"use client";

import { createClient } from "@/lib/supabase/client";
import { signWith, MEDIA_URL_TTL } from "./media-url";

/**
 * Assina uma URL de mídia no NAVEGADOR, com a sessão do usuário logado.
 *
 * Passa pela policy de SELECT da migration 054, que exige que o primeiro
 * segmento do caminho seja `account-<id>` de uma conta da qual o usuário é
 * membro — ou seja, um agente só consegue assinar mídia da própria conta.
 * É esse escopo que substitui a leitura pública irrestrita anterior.
 *
 * Tolerante a falha, igual à variante de servidor: URL que não é nossa
 * passa direto, e erro devolve a URL original. NUNCA lança.
 */
export async function signMediaUrlClient(
  url: string | null | undefined,
  expiresIn: number = MEDIA_URL_TTL.browserDisplay,
): Promise<string> {
  if (!url) return "";
  return signWith(createClient(), url, expiresIn);
}
