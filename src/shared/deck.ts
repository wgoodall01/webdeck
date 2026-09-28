/**
 * The deck model shared by every layer. Whatever the source format (Claude
 * Design HTML, PDF, …) the stage driver reduces it to a `DeckManifest`.
 */

export type DeckKind = "html" | "pdf"

export interface SlideInfo {
  /** 0-based position in the deck. */
  index: number
  /** Human label (`data-label` for HTML decks, "Page N" for PDFs). */
  label: string
  /** Speaker notes, as Markdown. */
  notes: string
  /** Skipped slides are omitted from next/prev navigation. */
  skipped: boolean
}

export interface DeckManifest {
  kind: DeckKind
  title: string
  /** Design size of a slide in CSS pixels. */
  width: number
  height: number
  slides: SlideInfo[]
}

/** A presentable file found inside an opened archive. */
export interface DeckCandidate {
  id: string
  /** Path inside the archive (or the file name for a bare PDF). */
  path: string
  title: string
  kind: DeckKind
}

/** Index of the next non-skipped slide in `dir`, or null at either end. */
export function stepIndex(slides: readonly SlideInfo[], from: number, dir: 1 | -1): number | null {
  for (let i = from + dir; i >= 0 && i < slides.length; i += dir) {
    if (!slides[i]?.skipped) return i
  }
  return null
}

export function clampIndex(slides: readonly SlideInfo[], index: number): number {
  return Math.max(0, Math.min(slides.length - 1, index))
}
