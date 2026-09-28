import { ArrowCounterClockwiseIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { stepIndex, type DeckManifest } from "@shared/deck"

import { Button } from "@/components/ui/button"
import { formatDuration, stopwatch, type Stopwatch } from "@/lib/time"
import { useThumbnails } from "@/lib/webdeck"

function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/** Whole-presentation and current-slide timers, wall clock, and up-next preview. */
export function TimersPanel({ deck, index }: { deck: DeckManifest; index: number }) {
  const now = useNow()
  const [total, setTotal] = useState<Stopwatch>(() => stopwatch.started(Date.now()))
  const [slide, setSlide] = useState<Stopwatch>(() => stopwatch.started(Date.now()))
  const lastIndex = useRef(index)

  // Slide timer restarts on every slide change (and follows pause state).
  useEffect(() => {
    if (lastIndex.current === index) return
    lastIndex.current = index
    setSlide((sw) => stopwatch.reset(sw, Date.now()))
  }, [index])

  const running = total.since !== null
  const toggle = () => {
    const t = Date.now()
    setTotal((sw) => (running ? stopwatch.pause(sw, t) : stopwatch.resume(sw, t)))
    setSlide((sw) => (running ? stopwatch.pause(sw, t) : stopwatch.resume(sw, t)))
  }

  const thumbs = useThumbnails("slide")
  const next = stepIndex(deck.slides, index, 1)
  const nextThumb = next === null ? undefined : thumbs[String(next)]
  const clock = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

  return (
    <section className="flex shrink-0 gap-4 border-b border-border/60 p-4">
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
        <div className="flex items-end gap-6">
          <Timer
            label="Elapsed"
            value={formatDuration(stopwatch.elapsed(total, now))}
            big
            dim={!running}
            onReset={() => setTotal((sw) => stopwatch.reset(sw, Date.now()))}
          />
          <Timer
            label="This slide"
            value={formatDuration(stopwatch.elapsed(slide, now))}
            dim={!running}
            onReset={() => setSlide((sw) => stopwatch.reset(sw, Date.now()))}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="px-4" onClick={toggle}>
            {running ? (
              <PauseIcon data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {running ? "Pause" : "Resume"}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{clock}</span>
        </div>
      </div>
      <div className="w-36 shrink-0">
        <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Up next
        </div>
        <div
          className="overflow-hidden rounded-md bg-black ring-1 ring-border"
          style={{ aspectRatio: String(deck.width / deck.height) }}
        >
          {next === null ? (
            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
              End of deck
            </div>
          ) : nextThumb ? (
            <img src={nextThumb} alt="" className="size-full object-cover" />
          ) : null}
        </div>
      </div>
    </section>
  )
}

function Timer({
  label,
  value,
  big = false,
  dim,
  onReset,
}: {
  label: string
  value: string
  big?: boolean
  dim: boolean
  onReset: () => void
}) {
  return (
    <button
      type="button"
      onClick={onReset}
      title={`Reset ${label.toLowerCase()}`}
      className="group -m-2 rounded-lg p-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
    >
      <div className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
        <ArrowCounterClockwiseIcon className="size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>
      <div
        className={
          (big ? "text-4xl" : "text-2xl text-foreground/80") +
          " font-mono font-medium tracking-tight tabular-nums" +
          (dim ? " opacity-50" : "")
        }
      >
        {value}
      </div>
    </button>
  )
}
