import { BrowserWindow } from "electron"

import { appPreloadPath, rendererUrl } from "../paths"

/** The presenter's console: preview, slide list, timers, notes, tweaks. */
export function createPresenterWindow(): BrowserWindow {
  const mac = process.platform === "darwin"
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Webdeck",
    backgroundColor: "#0a0a0a",
    ...(mac
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 14 } }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#0a0a0a", symbolColor: "#e5e5e5", height: 44 },
        }),
    webPreferences: {
      preload: appPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })
  win.once("ready-to-show", () => win.show())
  void win.loadURL(rendererUrl("/"))
  return win
}
