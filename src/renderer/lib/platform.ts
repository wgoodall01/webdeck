import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/** Platform check that's safe during the prerendered (SSR) shell. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.webdeck?.platform === "darwin",
    () => true,
  )
}
