import { useEffect, useLayoutEffect, useRef, useState } from "react"

import type { AppState, EventMap, ThumbnailEvent } from "@shared/ipc"

/** The preload bridge. Only touch it in effects/handlers (never during SSR). */
export function bridge() {
  return window.webdeck
}

export function useBridgeEvent<K extends keyof EventMap>(
  channel: K,
  cb: (payload: EventMap[K]) => void,
): void {
  const ref = useRef(cb)
  useLayoutEffect(() => {
    ref.current = cb
  })
  useEffect(() => bridge().on(channel, (p) => ref.current(p)), [channel])
}

export function useAppState(): AppState {
  const [state, setState] = useState<AppState>({ phase: "idle" })
  useBridgeEvent("state", setState)
  useEffect(() => {
    void bridge().invoke("state:get").then(setState)
  }, [])
  return state
}

/** Thumbnails for one scope, keyed by slide index or candidate id. */
export function useThumbnails(scope: ThumbnailEvent["scope"]): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useBridgeEvent("thumbnail", (t) => {
    if (t.scope === scope) setThumbs((prev) => ({ ...prev, [t.key]: t.dataUrl }))
  })
  useEffect(() => {
    void bridge()
      .invoke("thumbnails:get")
      .then((all) =>
        setThumbs((prev) => {
          const next = { ...prev }
          for (const t of all) if (t.scope === scope) next[t.key] ??= t.dataUrl
          return next
        }),
      )
  }, [scope])
  return thumbs
}
