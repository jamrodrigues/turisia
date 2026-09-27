"use client"

import { useEffect, useState, type ChangeEvent } from "react"
import { toast } from "sonner"
import { ImagePlus, Loader2, Trash2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from "@/lib/storage/upload-media"
import { useSignedMediaUrl } from "@/lib/storage/use-signed-media"
import { Label } from "@/components/ui/label"

interface PacoteMediaItem {
  id: string
  media_type: "image" | "video"
  url: string
  position: number
}

const ACCEPTED_MIME = "image/png,image/jpeg,image/webp,video/mp4,video/3gpp"

function PacoteMediaThumb({
  item,
  onDelete,
  disabled,
}: {
  item: PacoteMediaItem
  onDelete: () => void
  disabled: boolean
}) {
  const { src, ready } = useSignedMediaUrl(item.url)

  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
      {ready && src ? (
        item.media_type === "video" ? (
          <video src={src} className="h-full w-full object-cover" muted />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-destructive opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
        aria-label="Remover mídia"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * Photo/video gallery for one package — used both by an agent (manual
 * pick-and-send in the inbox, future work) and by the AI auto-reply's
 * "send the cover photo when this package comes up" behavior
 * (src/lib/ai/pacotes.ts matchPacoteMedia, position 0 = cover).
 *
 * Only rendered for an already-saved package (needs a real
 * `pacote_id` to attach uploads to).
 */
export function PacoteMediaGallery({
  pacoteId,
  canManage,
}: {
  pacoteId: string
  canManage: boolean
}) {
  const [items, setItems] = useState<PacoteMediaItem[] | null>(null)
  const [uploading, setUploading] = useState(false)

  async function load() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("pacote_media")
      .select("id, media_type, url, position")
      .eq("pacote_id", pacoteId)
      .order("position")
    if (error) {
      toast.error("Falha ao carregar mídia do pacote")
      return
    }
    setItems((data ?? []) as PacoteMediaItem[])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacoteId])

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    const isVideo = file.type.startsWith("video/")
    const isImage = file.type.startsWith("image/")
    if (!isVideo && !isImage) {
      toast.error("Envie uma imagem ou vídeo")
      return
    }
    const limit = isVideo ? MEDIA_MAX_BYTES_BY_KIND.video : MEDIA_MAX_BYTES_BY_KIND.image
    if (file.size > limit) {
      toast.error(`Arquivo muito grande (máx. ${Math.round(limit / 1024 / 1024)} MB)`)
      return
    }

    setUploading(true)
    try {
      const { publicUrl } = await uploadAccountMedia("pacote-media", file)
      const supabase = createClient()
      const nextPosition =
        items && items.length > 0 ? Math.max(...items.map((i) => i.position)) + 1 : 0
      const { error } = await supabase.from("pacote_media").insert({
        pacote_id: pacoteId,
        media_type: isVideo ? "video" : "image",
        url: publicUrl,
        position: nextPosition,
      })
      if (error) throw error
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar mídia")
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(item: PacoteMediaItem) {
    try {
      const supabase = createClient()
      const { error } = await supabase.from("pacote_media").delete().eq("id", item.id)
      if (error) throw error
      setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? prev)
      // Storage cleanup is best-effort — an orphaned object is a nit,
      // the DB row (what the AI/UI actually read) is already gone.
      const path = item.url.split("/pacote-media/")[1]?.split("?")[0]
      if (path) void deleteAccountMedia("pacote-media", path).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover mídia")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Fotos e vídeos</Label>
        {canManage && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
            Adicionar
            <input
              type="file"
              accept={ACCEPTED_MIME}
              className="hidden"
              disabled={uploading}
              onChange={handleUpload}
            />
          </label>
        )}
      </div>
      {items === null ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma foto ou vídeo ainda. Fotos ajudam bastante a fechar passeios.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {items.map((item) => (
            <PacoteMediaThumb
              key={item.id}
              item={item}
              disabled={!canManage}
              onDelete={() => handleDelete(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
