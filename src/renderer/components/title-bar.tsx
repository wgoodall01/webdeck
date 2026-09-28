import { cn } from "cn"

import { useIsMac } from "@/lib/platform"

/**
 * Window title bar region. Draggable; leaves room for the traffic lights on
 * macOS and the caption buttons (title bar overlay) on Windows.
 */
export function TitleBar({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  const mac = useIsMac()
  return (
    <header
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3 select-none",
        mac ? "pl-20" : "pr-36",
        className,
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {children}
    </header>
  )
}

/** Wrap interactive controls inside the title bar so they receive clicks. */
export function NoDrag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("flex items-center gap-1", className)}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
