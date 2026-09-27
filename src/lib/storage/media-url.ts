/**
 * Assinatura de URLs de mídia dos nossos buckets do Supabase Storage.
 *
 * ------------------------------------------------------------------
 * O problema que isto resolve
 * ------------------------------------------------------------------
 * Os buckets `chat-media` e `flow-media` nasceram PÚBLICOS (migrations
 * 016/023) porque a Meta precisa baixar a URL na hora do envio, sem
 * credencial. Só que "público" no Supabase Storage é literal: qualquer
 * pessoa com a URL baixa o arquivo, sem login e sem pertencer à conta —
 * e as URLs são previsíveis o bastante (`account-<uuid>/<timestamp>-<nome>`)
 * para não serem segredo. Como esses buckets guardam foto de documento,
 * comprovante e áudio enviados por clientes, isso é vazamento de dado
 * sensível entre tenants. A policy de SELECT ainda era `USING (bucket_id =
 * 'chat-media')`, ou seja, sem escopo nenhum de conta.
 *
 * A migration 054 fecha os buckets (`public = false`) e reescreve as
 * policies de SELECT com o MESMO escopo por `account-<uuid>` que as de
 * INSERT/UPDATE/DELETE já usavam. A partir daí a URL "pública" para de
 * funcionar e todo consumidor precisa de uma URL ASSINADA.
 *
 * ------------------------------------------------------------------
 * Como o sistema passa a funcionar
 * ------------------------------------------------------------------
 * O que fica GRAVADO no banco (`messages.media_url`, `flows` config,
 * `message_templates.header_media_url`) continua sendo a URL na forma
 * pública. Ela é o IDENTIFICADOR DURÁVEL do objeto — não muda, não expira
 * e permite achar o objeto anos depois. Guardar URL assinada no banco
 * seria guardar algo que morre em minutos.
 *
 * A assinatura acontece no MOMENTO DO USO:
 *   - servidor (`signMediaUrl`, em ./media-url.server) — antes de entregar
 *     a URL a quem vai baixá-la: provedor de WhatsApp, OpenAI, um serviço
 *     externo do tenant, ou nós mesmos num fetch;
 *   - navegador (`signMediaUrlClient`, em ./media-url.client) — antes de
 *     colocar em <img>/<a>. Funciona porque o membro logado passa na
 *     policy de SELECT nova.
 *
 * ------------------------------------------------------------------
 * Por que este arquivo é PURO
 * ------------------------------------------------------------------
 * Ele não importa nenhum client do Supabase. As duas variantes vivem em
 * arquivos irmãos porque a do servidor usa a chave SERVICE-ROLE: se ela
 * estivesse aqui, o hook do navegador (que precisa de `parseStorageUrl`)
 * arrastaria o admin-client para o bundle do cliente. Verificado no build
 * — antes da separação, `admin-client` aparecia em .next/static/chunks.
 *
 * Nada disto exige migrar dado: a URL pública já gravada é convertida em
 * (bucket, path) por parsing, então as linhas antigas seguem exibíveis.
 *
 * TOLERANTE A FALHA por decisão: se a URL não é de um bucket nosso (link
 * do provedor, link colado à mão) ou a assinatura falha, devolvemos a URL
 * original. Perder a mídia é pior do que uma tentativa que não deu certo.
 */

/** Buckets cujas URLs sabemos assinar. */
export const OUR_MEDIA_BUCKETS = ["chat-media", "flow-media", "pacote-media", "vouchers"] as const;

export interface ParsedStorageUrl {
  bucket: string;
  /** Caminho do objeto DENTRO do bucket (ex.: `account-<uuid>/123-foto.jpg`). */
  path: string;
}

/**
 * Extrai (bucket, path) de uma URL do Supabase Storage.
 *
 * Reconhece as três formas que o Supabase serve:
 *   /storage/v1/object/public/<bucket>/<path>
 *   /storage/v1/object/sign/<bucket>/<path>?token=…   (já assinada)
 *   /storage/v1/object/<bucket>/<path>                (autenticada)
 *
 * Devolve null para qualquer outra coisa — inclusive URLs de bucket que
 * não é nosso, para não assinarmos às cegas o que não controlamos.
 */
export function parseStorageUrl(url: string): ParsedStorageUrl | null {
  if (!url || typeof url !== "string") return null;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null; // não é URL absoluta (ex.: caminho de proxy interno)
  }

  const marker = "/storage/v1/object/";
  const at = pathname.indexOf(marker);
  if (at === -1) return null;

  let rest = pathname.slice(at + marker.length);
  for (const prefix of ["public/", "sign/", "authenticated/"]) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }

  const slash = rest.indexOf("/");
  if (slash <= 0) return null;

  const bucket = decodeURIComponent(rest.slice(0, slash));
  const path = rest
    .slice(slash + 1)
    .split("/")
    .map(decodeURIComponent)
    .join("/");

  if (!path) return null;
  if (!(OUR_MEDIA_BUCKETS as readonly string[]).includes(bucket)) return null;

  return { bucket, path };
}

/** Já é uma URL assinada? Assinar de novo seria desperdício. */
export function isSignedStorageUrl(url: string): boolean {
  return (
    typeof url === "string" &&
    url.includes("/storage/v1/object/sign/") &&
    url.includes("token=")
  );
}

/**
 * TTLs por finalidade (segundos). Nomeados para que a escolha no ponto de
 * uso diga POR QUE aquele prazo, em vez de espalhar números soltos.
 */
export const MEDIA_URL_TTL = {
  /** Provedor (Meta/uazapi) baixa na hora do envio; a folga cobre retry. */
  outboundSend: 60 * 60, // 1 h
  /** Fetch nosso, no mesmo request (OpenAI vision, upload de header). */
  serverFetch: 10 * 60, // 10 min
  /** Integração externa baixa o anexo do lado dela; folga para fila/retry. */
  externalIntegration: 24 * 60 * 60, // 24 h
  /** Exibição no navegador — cobre uma sessão longa de inbox aberta. */
  browserDisplay: 60 * 60, // 1 h
} as const;

/** Cliente mínimo de storage — evita amarrar este módulo a um SupabaseClient
 *  concreto (o do servidor e o do navegador têm tipos diferentes). */
interface StorageLike {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
}

/**
 * Núcleo compartilhado: assina se for URL de bucket nosso; senão devolve a
 * original. NUNCA lança.
 */
export async function signWith(
  client: StorageLike,
  url: string | null | undefined,
  expiresIn: number,
): Promise<string> {
  if (!url) return "";
  if (isSignedStorageUrl(url)) return url;

  const parsed = parseStorageUrl(url);
  if (!parsed) return url; // link externo / do provedor — passa direto

  try {
    const { data, error } = await client.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, expiresIn);
    if (error || !data?.signedUrl) {
      console.error(
        "[media-url] falha ao assinar",
        `${parsed.bucket}/${parsed.path}:`,
        error instanceof Error ? error.message : error,
      );
      return url;
    }
    return data.signedUrl;
  } catch (err) {
    console.error(
      "[media-url] erro ao assinar",
      `${parsed.bucket}/${parsed.path}:`,
      err instanceof Error ? err.message : err,
    );
    return url;
  }
}
