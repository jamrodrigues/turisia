import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  signWith,
  isSignedStorageUrl,
  parseStorageUrl,
  MEDIA_URL_TTL,
} from "./media-url";

export { MEDIA_URL_TTL } from "./media-url";

/**
 * Assina uma URL de mídia no SERVIDOR, com o client service-role.
 *
 * Use antes de entregar a URL a qualquer coisa que vá baixá-la sem sessão
 * de usuário: provedor de WhatsApp (Meta/uazapi), OpenAI, uma integração
 * externa do tenant, ou um fetch nosso.
 *
 * ⚠️ NUNCA importe este arquivo de um componente cliente. Ele vive à
 * parte do `media-url.ts` (puro) DE PROPÓSITO: aqui mora a chave
 * service-role, e o hook do navegador precisa das funções puras. Enquanto
 * as duas variantes estavam no mesmo módulo, o `admin-client` era
 * arrastado para o bundle do cliente — confirmado achando
 * `SUPABASE_SERVICE_ROLE_KEY` em `.next/static/chunks/` (o VALOR não
 * vazava, o Next resolve env não-NEXT_PUBLIC como undefined no
 * navegador, mas era código de servidor embarcado à toa).
 *
 * Para o navegador existe `./media-url.client`. Se um dia o pacote
 * `server-only` entrar no projeto, adicione `import "server-only"` aqui
 * para o erro sair no build em vez de depender da convenção do nome.
 * Como conferir depois de mexer:
 *     npm run build && grep -rl SUPABASE_SERVICE_ROLE .next/static/chunks/
 * não deve devolver nada.
 *
 * Tolerante a falha: URL que não é de bucket nosso passa direto, e
 * qualquer erro devolve a URL original. NUNCA lança.
 */
export async function signMediaUrl(
  url: string | null | undefined,
  expiresIn: number = MEDIA_URL_TTL.serverFetch,
): Promise<string> {
  if (!url) return "";
  // Decide ANTES de construir o client: `supabaseAdmin()` lança quando a
  // service-role key não está no ambiente, e a maioria das chamadas aqui
  // recebe URL que nem é nossa (link do provedor, link colado à mão) ou já
  // assinada. Construir o client primeiro fazia essas chamadas — e os
  // testes que nunca tocam em storage — estourarem à toa.
  if (isSignedStorageUrl(url) || !parseStorageUrl(url)) return url;
  return signWith(supabaseAdmin(), url, expiresIn);
}
