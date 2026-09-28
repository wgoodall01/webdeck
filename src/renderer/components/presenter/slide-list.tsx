import { memo, useEffect, useRef } from "react"

import { cn } from "cn"

import type { DeckManifest, SlideInfo } from "@shared/deck"

import { bridge, useThumbnails } from "@/lib/webdeck"

/**
 * Every slide, top to bottom. The current slide scrolls to the centre when
 * it changes; between changes the list is free to browse.
 */
export function SlideList({ deck, index }: { deck: DeckManifest; index: number }) {
  const thumbs = useThumbnails("slide")
  const listRef = useRef<HTMLDivElement>(null)
  const first = useRef(true)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-slide="${index}"]`)
    el?.scrollIntoView({ block: "center", behavior: first.current ? "instant" : "smooth" })
    first.current = false
  }, [index])

  const aspect = deck.width / deck.height
  return (
    <div ref={listRef} className="h-full overflow-y-auto px-3 py-2">
      <ol className="flex flex-col gap-1">
        {deck.slides.map((s) => (
          <SlideRow
            key={s.index}
            slide={s}
            current={s.index === index}
            thumb={thumbs[String(s.index)]}
            aspect={aspect}
          />
        ))}
      </ol>
    </div>
  )
}

const SlideRow = memo(function SlideRow({
  slide,
  current,
  thumb,
  aspect,
}: {
  slide: SlideInfo
  current: boolean
  thumb: string | undefined
  aspect: number
}) {
  const firstNote = slide.notes.split("\n").find((l) => l.trim()) ?? ""
  return (
    <li data-slide={slide.index}>
      <button
        type="button"
        onClick={() => bridge().send("nav", { type: "goTo", index: slide.index })}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg p-1.5 pr-3 text-left transition-colors outline-none",
          "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
          current && "bg-muted",
          slide.skipped && "opacity-45",
        )}
      >
        <span
          className={cn(
            "w-6 shrink-0 text-right font-mono text-xs tabular-nums",
            current ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {slide.index + 1}
        </span>
        <div
          className={cn(
            "w-40 shrink-0 overflow-hidden rounded-md bg-black ring-1 transition-shadow",
            current ? "ring-2 ring-sky-400" : "ring-border",
          )}
          style={{ aspectRatio: String(aspect) }}
        >
          {thumb ? (
            <img src={thumb} alt="" className="size-full object-cover" draggable={false} />
          ) : (
            <div className="size-full animate-pulse bg-muted/30" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm", current ? "font-medium" : "text-foreground/85")}>
            {slide.label}
            {slide.skipped && <span className="ml-2 text-xs text-muted-foreground">Skipped</span>}
          </div>
          {firstNote && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{firstNote}</div>
          )}
        </div>
      </button>
    </li>
  )
})
