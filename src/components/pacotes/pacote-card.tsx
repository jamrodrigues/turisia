"use client"

import { Package as PackageIcon, Pencil, Trash2 } from "lucide-react"

import type { Pacote } from "@/types"
import { useSignedMediaUrl } from "@/lib/storage/use-signed-media"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

/**
 * Catalog card for one package — cover photo first, price/duration
 * second. Replaces the old data-table row: a tourism package is
 * customer-facing catalog content (it already has a cover photo via
 * PacoteMediaGallery), not a generic record, and the table treated it
 * exactly like a Motorista or a Contact row. Per the 2026-09-09
 * "agência, não CRM" feedback — this is the single highest-visibility
 * place that distinction should show up.
 */
export function PacoteCard({
  pacote,
  coverUrl,
  canManage,
  onEdit,
  onDelete,
}: {
  pacote: Pacote
  coverUrl: string | null
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { src, ready } = useSignedMediaUrl(coverUrl ?? undefined)

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onEdit}
        className="relative aspect-[4/3] w-full bg-muted text-left"
      >
        {coverUrl && ready && src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <PackageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
        {!pacote.is_active && (
          <Badge variant="secondary" className="absolute left-2 top-2">
            Inativo
          </Badge>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{pacote.name}</p>
            {pacote.category && (
              <Badge variant="secondary" className="mt-1">
                {pacote.category}
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon-sm" disabled={!canManage} onClick={onEdit} aria-label="Editar pacote">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" disabled={!canManage} onClick={onDelete} aria-label="Remover pacote">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between text-sm">
          <span className="font-semibold text-foreground">{formatPrice(pacote.price)}</span>
          {pacote.duration_minutes ? (
            <span className="text-muted-foreground">{formatDuration(pacote.duration_minutes)}</span>
          ) : (
            <span />
          )}
        </div>
      </div>
    </div>
  )
}
