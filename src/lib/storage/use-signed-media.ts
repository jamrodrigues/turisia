"use client";

import { useEffect, useState } from "react";
import { parseStorageUrl, MEDIA_URL_TTL } from "./media-url";
import { signMediaUrlClient } from "./media-url.client";

// Module-level cache, keyed by the raw (unsigned) storage URL — shared by
// every mount of the hook in this tab. Signed URLs are valid for
// MEDIA_URL_TTL.browserDisplay (1h); without this, re-mounting a card
// (re-filtering a list, navigating away and back) re-signs an
// already-valid URL from scratch, a full Supabase round-trip per image.
// A safety margin means we refresh a little before the real expiry
// rather than risk serving a URL that dies mid-render.
const SAFETY_MARGIN_MS = 5 * 60 * 1000;
const signedUrlCache = new Map<string, { src: string; expiresAt: number }>();

async function signCached(url: string): Promise<string> {
  const cached = signedUrlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.src;
  const src = await signMediaUrlClient(url);
  signedUrlCache.set(url, {
    src,
    expiresAt: Date.now() + MEDIA_URL_TTL.browserDisplay * 1000 - SAFETY_MARGIN_MS,
  });
  return src;
}

/**
 * Resolve a stored media URL into something the browser can actually load.
 *
 * Desde a migration 054 os buckets `chat-media` / `flow-media` são
 * privados: a URL na forma pública que está gravada em
 * `messages.media_url` não abre mais sozinha. Este hook a troca por uma
 * URL assinada, usando a sessão do próprio usuário — a policy de SELECT
 * nova só assina objeto da conta dele.
 *
 * Para qualquer outra URL (link do provedor, link colado à mão) devolve o
 * valor original IMEDIATAMENTE, sem estado de carregamento — só mídia
 * nossa passa pela assinatura.
 *
 * `ready` existe para o chamador não renderizar um <img src=""> no
 * primeiro frame (o que dispara `onError` e mostra "indisponível" antes
 * mesmo de tentar).
 */
export function useSignedMediaUrl(url: string | null | undefined): {
  src: string;
  ready: boolean;
} {
  // Uma URL que não é nossa já está pronta no primeiro render.
  const precisaAssinar = !!url && !!parseStorageUrl(url);
  const [src, setSrc] = useState<string>(precisaAssinar ? "" : (url ?? ""));
  const [ready, setReady] = useState<boolean>(!precisaAssinar);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      if (!url) {
        if (!cancelado) {
          setSrc("");
          setReady(true);
        }
        return;
      }
      if (!parseStorageUrl(url)) {
        if (!cancelado) {
          setSrc(url);
          setReady(true);
        }
        return;
      }

      setReady(false);
      const assinada = await signCached(url);
      if (cancelado) return;
      setSrc(assinada);
      setReady(true);
    })();

    return () => {
      cancelado = true;
    };
  }, [url]);

  return { src, ready };
}
