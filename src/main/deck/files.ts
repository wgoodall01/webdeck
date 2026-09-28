import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"

import yauzl from "yauzl"

/**
 * Read-only view of a deck's files. Decks are served straight out of the
 * archive — nothing is extracted to disk, keeping the app stateless.
 */
export interface DeckFiles {
  /** Display name of the source (archive or file name). */
  readonly name: string
  list(): string[]
  has(path: string): boolean
  read(path: string): Promise<Buffer>
  close(): void
}

/** Normalize an archive-relative path; returns null if it escapes the root. */
export function normalizeArchivePath(p: string): string | null {
  const out: string[] = []
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      if (!out.length) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join("/")
}

const CACHE_LIMIT = 256 * 1024 * 1024

export class ZipDeckFiles implements DeckFiles {
  private cache = new Map<string, Buffer>()
  private cacheBytes = 0

  private constructor(
    readonly name: string,
    private zip: yauzl.ZipFile,
    private entries: Map<string, yauzl.Entry>,
  ) {}

  static async open(path: string): Promise<ZipDeckFiles> {
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
      yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, z) =>
        err || !z ? reject(err ?? new Error("Could not open archive")) : resolve(z),
      ),
    )
    const entries = new Map<string, yauzl.Entry>()
    await new Promise<void>((resolve, reject) => {
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!entry.fileName.endsWith("/")) {
          const p = normalizeArchivePath(entry.fileName)
          if (p) entries.set(p, entry)
        }
        zip.readEntry()
      })
      zip.on("end", () => resolve())
      zip.on("error", reject)
      zip.readEntry()
    })
    return new ZipDeckFiles(basename(path), zip, entries)
  }

  list(): string[] {
    return [...this.entries.keys()]
  }

  has(path: string): boolean {
    return this.entries.has(path)
  }

  async read(path: string): Promise<Buffer> {
    const hit = this.cache.get(path)
    if (hit) return hit
    const entry = this.entries.get(path)
    if (!entry) throw new Error(`No such file in archive: ${path}`)
    const buf = await new Promise<Buffer>((resolve, reject) => {
      this.zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err ?? new Error("Could not read entry"))
        const chunks: Buffer[] = []
        stream.on("data", (c: Buffer) => chunks.push(c))
        stream.on("end", () => resolve(Buffer.concat(chunks)))
        stream.on("error", reject)
      })
    })
    if (this.cacheBytes + buf.length <= CACHE_LIMIT) {
      this.cache.set(path, buf)
      this.cacheBytes += buf.length
    }
    return buf
  }

  close(): void {
    this.cache.clear()
    this.zip.close()
  }
}

/** A single file on disk (a bare PDF) exposed as a one-entry deck. */
export class SingleFileDeckFiles implements DeckFiles {
  readonly name: string
  private constructor(private path: string) {
    this.name = basename(path)
  }

  static async open(path: string): Promise<SingleFileDeckFiles> {
    const s = await stat(path)
    if (!s.isFile()) throw new Error(`${path} is not a file`)
    return new SingleFileDeckFiles(path)
  }

  list(): string[] {
    return [this.name]
  }

  has(path: string): boolean {
    return path === this.name
  }

  read(path: string): Promise<Buffer> {
    if (path !== this.name) return Promise.reject(new Error(`No such file: ${path}`))
    return readFile(this.path)
  }

  close(): void {}
}
