import type { DeckCandidate } from "./deck"

/**
 * Directories a Claude Design export uses for support files. HTML under them
 * is never a deck (design-system previews, uploads, …).
 */
const SUPPORT_DIRS = new Set(["_ds", "assets", "uploads", "node_modules", "__MACOSX"])

export interface ArchiveFile {
  path: string
  /** First few KB of the file, used to sniff for deck markers. */
  head?: string
}

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path)
}

function isSupportPath(path: string): boolean {
  return path.split("/").some((seg) => SUPPORT_DIRS.has(seg) || seg.startsWith("."))
}

/** Sniff whether an HTML file is a slide deck (vs. a one-off page). */
export function looksLikeDeck(head: string): boolean {
  return /deck-stage|<x-dc[\s>]/i.test(head)
}

export function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path
  return base
    .replace(/\.dc\.html$/i, "")
    .replace(/\.html?$/i, "")
    .replace(/\.pdf$/i, "")
}

/**
 * Pick the presentable files inside an archive. Deck-looking HTML wins; if
 * nothing sniffs as a deck, any top-level-ish HTML is offered instead so the
 * user can still try it.
 */
export function findDeckCandidates(files: readonly ArchiveFile[]): DeckCandidate[] {
  const html = files.filter((f) => isHtmlPath(f.path) && !isSupportPath(f.path))
  const pdf = files.filter((f) => /\.pdf$/i.test(f.path) && !isSupportPath(f.path))
  const decks = html.filter((f) => f.head !== undefined && looksLikeDeck(f.head))
  const chosen = decks.length ? decks : html
  return [...chosen, ...pdf]
    .map((f) => ({
      id: f.path,
      path: f.path,
      title: titleFromPath(f.path),
      kind: /\.pdf$/i.test(f.path) ? ("pdf" as const) : ("html" as const),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}
