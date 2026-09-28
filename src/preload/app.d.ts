import type { WebdeckApi } from "@shared/ipc"

declare global {
  interface Window {
    webdeck: WebdeckApi
  }
}

export {}
