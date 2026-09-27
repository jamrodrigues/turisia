import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * FilterBar — the "Consultar X" pattern (DESIGN.md §5): a row of labeled
 * compact fields plus an optional trailing action (usually a "Filtrar"
 * button), sitting directly under a panel's header on the SAME background
 * as the rest of the card.
 *
 * Deliberately just layout — it renders whatever fields/actions its caller
 * passes as children, so each page keeps its own filter state and query
 * logic instead of this component trying to be generic over every possible
 * data shape. Only `FilterField` below is opinionated (label + control).
 */
function FilterBar({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="filter-bar"
      className={cn(
        "flex flex-wrap items-end gap-3 border-b border-border px-4 py-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function FilterField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex min-w-36 flex-1 flex-col gap-1", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

export { FilterBar, FilterField }
