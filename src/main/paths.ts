import { join } from "node:path"

import { app } from "electron"

export const APP_SCHEME = "app"
const APP_HOST = "renderer"

const outDir = () => join(app.getAppPath(), "out")

export const appPreloadPath = () => join(outDir(), "preload/app.cjs")
export const stagePreloadPath = () => join(outDir(), "preload/stage.cjs")
export const rendererRoot = () => join(outDir(), "renderer/client")

/** URL of a renderer route: the Vite dev server in dev, `app://` when packaged. */
export function rendererUrl(route: string): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  const base = dev ? dev.replace(/\/$/, "") : `${APP_SCHEME}://${APP_HOST}`
  return base + (route.startsWith("/") ? route : `/${route}`)
}
