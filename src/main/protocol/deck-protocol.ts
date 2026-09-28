import { randomUUID } from "node:crypto"

import type { Session } from "electron"

import type { DeckFiles } from "../deck/files"
import { normalizeArchivePath } from "../deck/files"
import { mimeType } from "./mime"
import { parseRange } from "./range"

export const DECK_SCHEME = "deck"

/** Rewrites a file's bytes on the way out (used for EDITMODE tweaks). */
export type FileTransform = (path: string, body: Buffer) => Buffer

interface Mount {
  files: DeckFiles
  transform: FileTransform | null
}

/**
 * Serves mounted decks at `deck://<mount-id>/<path>`. Each mount gets its own
 * origin, so decks can't read each other's storage, and relative URLs inside
 * a deck resolve exactly as they did in Claude Design.
 */
export class DeckMounts {
  private mounts = new Map<string, Mount>()

  mount(files: DeckFiles): string {
    const id = randomUUID().replace(/-/g, "").slice(0, 16)
    this.mounts.set(id, { files, transform: null })
    return id
  }

  unmount(id: string): void {
    this.mounts.delete(id)
  }

  setTransform(id: string, transform: FileTransform | null): void {
    const m = this.mounts.get(id)
    if (m) m.transform = transform
  }

  url(id: string, path: string): string {
    const encoded = path.split("/").map(encodeURIComponent).join("/")
    return `${DECK_SCHEME}://${id}/${encoded}`
  }

  /** Protocol handlers are per-session; call once for each session that loads decks. */
  register(session: Session): void {
    session.protocol.handle(DECK_SCHEME, (req) => this.handle(req))
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const mount = this.mounts.get(url.host)
    if (!mount) return new Response("Unknown deck", { status: 404 })
    let decoded: string
    try {
      decoded = decodeURIComponent(url.pathname)
    } catch {
      return new Response("Bad path", { status: 400 })
    }
    const path = normalizeArchivePath(decoded)
    if (!path || !mount.files.has(path)) return new Response("Not found", { status: 404 })

    let body = await mount.files.read(path)
    if (mount.transform) body = mount.transform(path, body)

    const headers = new Headers({
      "Content-Type": mimeType(path),
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    })
    const range = parseRange(req.headers.get("Range"), body.length)
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${body.length}`)
      return new Response(null, { status: 416, headers })
    }
    if (range) {
      const slice = body.subarray(range.start, range.end + 1)
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${body.length}`)
      headers.set("Content-Length", String(slice.length))
      return new Response(new Uint8Array(slice), { status: 206, headers })
    }
    headers.set("Content-Length", String(body.length))
    return new Response(new Uint8Array(body), { status: 200, headers })
  }
}
