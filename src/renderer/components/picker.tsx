import { FilePdfIcon, PresentationChartIcon } from "@phosphor-icons/react"

import type { DeckCandidate } from "@shared/deck"

import { TitleBar } from "@/components/title-bar"
import { bridge, useThumbnails } from "@/lib/webdeck"

/** Choose one deck from an archive that holds several. */
export function Picker({
  archiveName,
  candidates,
}: {
  archiveName: string
  candidates: DeckCandidate[]
}) {
  const thumbs = useThumbnails("candidate")
  return (
    <div className="flex h-svh flex-col">
      <TitleBar>
        <span className="truncate text-sm text-muted-foreground">{archiveName}</span>
      </TitleBar>
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-1 text-lg font-medium">Which deck?</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          This export contains {candidates.length} presentable files.
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
          {candidates.map((c) => {
            const thumb = thumbs[c.id]
            const Icon = c.kind === "pdf" ? FilePdfIcon : PresentationChartIcon
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => bridge().send("picker:choose", c.id)}
                className="group flex flex-col gap-2.5 rounded-xl p-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black ring-1 ring-border transition-shadow group-hover:ring-foreground/30">
                  {thumb ? (
                    <img src={thumb} alt="" className="size-full object-contain" />
                  ) : (
                    <div className="size-full animate-pulse bg-muted/40" />
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-2 px-1">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{c.title}</span>
                </div>
                {c.path !== c.title && (
                  <span className="-mt-2 truncate px-1 font-mono text-xs text-muted-foreground">
                    {c.path}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </main>
    </div>
  )
}
