import { readFile } from "node:fs/promises"
import { join, normalize, sep } from "node:path"

import type { Session } from "electron"

import { APP_SCHEME, rendererRoot } from "../paths"
import { mimeType } from "./mime"

/**
 * Serves the built renderer at `app://renderer/…`. Unknown extension-less
 * paths fall back to the SPA shell so client-side routes resolve.
 */
export function registerAppProtocol(session: Session): void {
  const root = rendererRoot()
  session.protocol.handle(APP_SCHEME, async (req) => {
    const { pathname } = new URL(req.url)
    let rel: string
    try {
      rel = decodeURIComponent(pathname)
    } catch {
      return new Response("Bad path", { status: 400 })
    }
    const file = normalize(join(root, rel))
    if (file !== root && !file.startsWith(root + sep)) {
      return new Response("Forbidden", { status: 403 })
    }
    const isAsset = /\.[a-z0-9]+$/i.test(rel)
    const target = isAsset ? file : join(root, "index.html")
    try {
      const body = await readFile(target)
      return new Response(new Uint8Array(body), {
        headers: { "Content-Type": mimeType(target), "Access-Control-Allow-Origin": "*" },
      })
    } catch {
      return new Response("Not found", { status: 404 })
    }
  })
}
