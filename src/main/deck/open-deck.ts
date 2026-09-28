import type { DeckCandidate } from "@shared/deck"
import { findDeckCandidates, isHtmlPath, type ArchiveFile } from "@shared/detect"

import { SingleFileDeckFiles, ZipDeckFiles, type DeckFiles } from "./files"

export interface OpenedArchive {
  files: DeckFiles
  candidates: DeckCandidate[]
}

const SNIFF_BYTES = 64 * 1024

/** Open a `.zip` export or a bare `.pdf` and find what's presentable in it. */
export async function openDeckSource(path: string): Promise<OpenedArchive> {
  if (/\.pdf$/i.test(path)) {
    const files = await SingleFileDeckFiles.open(path)
    return { files, candidates: findDeckCandidates([{ path: files.name }]) }
  }
  const files = await ZipDeckFiles.open(path)
  try {
    const listing: ArchiveFile[] = await Promise.all(
      files.list().map(async (p) => {
        if (!isHtmlPath(p)) return { path: p }
        const buf = await files.read(p)
        return { path: p, head: buf.subarray(0, SNIFF_BYTES).toString("utf8") }
      }),
    )
    const candidates = findDeckCandidates(listing)
    if (!candidates.length) throw new Error(`${files.name} doesn't contain an HTML deck or PDF.`)
    return { files, candidates }
  } catch (err) {
    files.close()
    throw err
  }
}
