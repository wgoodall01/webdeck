import { BrowserWindow, screen, type Display } from "electron"

import type { AudienceState, DisplayInfo } from "@shared/ipc"

import { appPreloadPath, rendererUrl } from "../paths"

export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    primary: d.id === primary,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
  }))
}

/** The display the audience window should start on: an external one, if any. */
function preferredDisplay(): Display {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().find((d) => d.id !== primary.id) ?? primary
}

/** Largest `aspect` rectangle covering `fraction` of the display's work area. */
function fitBounds(display: Display, aspect: number, fraction: number) {
  const wa = display.workArea
  let width = Math.round(wa.width * fraction)
  let height = Math.round(width / aspect)
  if (height > wa.height * fraction) {
    height = Math.round(wa.height * fraction)
    width = Math.round(height * aspect)
  }
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height,
  }
}

/**
 * The audience-facing window: nothing but the slide. Chromeless, locked to the
 * deck's aspect ratio, and dragged by its content, like QuickTime Player. On
 * macOS the traffic lights show only while the pointer is active over it.
 * Black letterbox when fullscreen on a display of a different shape. Built to
 * be window-shared on a call or fullscreened onto a projector.
 */
export class AudienceWindow {
  readonly win: BrowserWindow
  private displayId: number

  constructor(opts: { title: string; aspect: number }) {
    const display = preferredDisplay()
    this.displayId = display.id
    const onPrimary = display.id === screen.getPrimaryDisplay().id
    const mac = process.platform === "darwin"
    this.win = new BrowserWindow({
      ...fitBounds(display, opts.aspect, onPrimary ? 0.5 : 0.8),
      title: opts.title,
      // macOS: a hidden title bar keeps the native traffic lights, which are
      // shown only while the pointer is active over the window. Elsewhere:
      // fully frameless.
      ...(mac
        ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 12, y: 12 } }
        : { frame: false }),
      show: false,
      backgroundColor: "#000000",
      hasShadow: true,
      fullscreenable: true,
      minWidth: 320,
      minHeight: 180,
      webPreferences: {
        preload: appPreloadPath(),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    })
    this.win.setAspectRatio(opts.aspect)
    if (mac) this.win.setWindowButtonVisibility(false)
    this.win.once("ready-to-show", () => this.win.showInactive())
    // Keep the deck title (not the page's) for window-share pickers.
    this.win.on("page-title-updated", (e) => e.preventDefault())
    void this.win.loadURL(rendererUrl("/audience"))
  }

  get webContents() {
    return this.win.webContents
  }

  state(): AudienceState {
    if (this.win.isDestroyed()) return { open: false, displayId: null, fullscreen: false }
    const d = screen.getDisplayMatching(this.win.getBounds())
    return { open: true, displayId: d?.id ?? this.displayId, fullscreen: this.win.isFullScreen() }
  }

  setAspect(aspect: number): void {
    if (this.win.isDestroyed()) return
    this.win.setAspectRatio(aspect)
    if (!this.win.isFullScreen()) {
      const b = this.win.getBounds()
      this.win.setBounds({ ...b, height: Math.round(b.width / aspect) })
    }
  }

  moveToDisplay(id: number): void {
    const display = screen.getAllDisplays().find((d) => d.id === id)
    if (!display || this.win.isDestroyed()) return
    this.displayId = id
    const wasFull = this.win.isFullScreen()
    const move = () => {
      const [w = 16, h = 9] = this.win.getContentSize()
      this.win.setBounds(fitBounds(display, w / h, 0.8))
      if (wasFull) this.win.setFullScreen(true)
    }
    if (wasFull) {
      this.win.once("leave-full-screen", move)
      this.win.setFullScreen(false)
    } else move()
  }

  setFullscreen(on: boolean): void {
    if (!this.win.isDestroyed()) this.win.setFullScreen(on)
  }

  close(): void {
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}
