import type { SupabaseClient } from '@supabase/supabase-js'
import { buildMediaPath } from '@/lib/storage/upload-media'

/**
 * Persist inbound WhatsApp media into Supabase Storage.
 *
 * uazapi hands us a URL on ITS OWN server (POST /message/download →
 * fileURL). That URL is ephemeral — it disappears when the instance is
 * recreated or the server prunes files — so storing it raw on
 * `messages.media_url` means the inbox loses the audio/image later. This
 * fetches those bytes once, on receipt, and re-uploads them to the
 * account-scoped `chat-media` bucket (public, 16 MB, same bucket the
 * dashboard composer uses) so the media is ours and durable.
 *
 * Runs server-side with the service-role client (the webhook's admin
 * client), which bypasses RLS — the `account-<id>/…` path is kept only
 * for convention/consistency with dashboard uploads.
 *
 * Best-effort: any failure returns null so the caller falls back to the
 * original provider URL. Losing durability is better than losing the
 * message.
 */

const CHAT_MEDIA_BUCKET = 'chat-media'
/** Matches the bucket's file_size_limit (migration 023). */
const MAX_BYTES = 16 * 1024 * 1024

/** MIME → extension for the kinds the chat-media bucket allows. */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
}

function extFor(contentType: string): string {
  const base = contentType.split(';')[0].trim().toLowerCase()
  return MIME_EXT[base] ?? 'bin'
}

/**
 * Fetch `sourceUrl` and upload it to `chat-media`, returning the public
 * URL — or null on any failure (caller falls back to `sourceUrl`).
 */
export async function storeInboundMediaToBucket(
  db: SupabaseClient,
  accountId: string,
  sourceUrl: string,
  mimetype: string | null,
): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      console.warn('[store-media] source fetch non-2xx:', res.status)
      return null
    }
    const contentType =
      mimetype ||
      res.headers.get('content-type') ||
      'application/octet-stream'

    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0) return null
    if (bytes.byteLength > MAX_BYTES) {
      console.warn(
        '[store-media] media exceeds bucket limit, keeping provider URL:',
        bytes.byteLength,
      )
      return null
    }

    const path = buildMediaPath(accountId, `uazapi.${extFor(contentType)}`)
    const { error } = await db.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, bytes, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      })
    if (error) {
      console.warn('[store-media] upload failed:', error.message)
      return null
    }

    const {
      data: { publicUrl },
    } = db.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)
    return publicUrl
  } catch (err) {
    console.warn(
      '[store-media] failed, keeping provider URL:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
