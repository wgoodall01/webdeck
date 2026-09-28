import { MinusIcon, PlusIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { Button } from "@/components/ui/button"

const SIZES = [14, 16, 18, 21, 24, 28, 32]

/** Survives the per-slide remount; forgotten on quit (the app is stateless). */
let sessionSize = 2

/** Speaker notes for the current slide, rendered as Markdown. */
export function NotesPanel({ notes, label }: { notes: string; label: string }) {
  const [size, setSize] = useState(sessionSize)
  useEffect(() => {
    sessionSize = size
  }, [size])

  return (
    <section className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 px-4">
        <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Notes
        </h2>
        <span className="truncate text-xs text-muted-foreground/70">· {label}</span>
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost"
            size="icon-xs"
            title="Smaller text"
            disabled={size === 0}
            onClick={() => setSize((s) => Math.max(0, s - 1))}
          >
            <MinusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Larger text"
            disabled={size === SIZES.length - 1}
            onClick={() => setSize((s) => Math.min(SIZES.length - 1, s + 1))}
          >
            <PlusIcon />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {notes.trim() ? (
          <div className="notes-md leading-relaxed" style={{ fontSize: SIZES[size] }}>
            <Markdown remarkPlugins={[remarkGfm]}>{notes}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/60 italic">No notes for this slide.</p>
        )}
      </div>
    </section>
  )
}
