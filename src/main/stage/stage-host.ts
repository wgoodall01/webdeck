import { EventEmitter } from "node:events"

import {
  BrowserWindow,
  ipcMain,
  shell,
  type NativeImage,
  type OffscreenSharedTexture,
  type WebContents,
} from "electron"

import { toElectronInput, type StageInput } from "@shared/input"
import {
  STAGE_COMMAND_CHANNEL,
  STAGE_EVENT_CHANNEL,
  type StageCommand,
  type StageDriverOptions,
  type StageEvent,
  type StageReport,
} from "@shared/stage-protocol"

import type { DeckKind } from "@shared/deck"

import { stagePreloadPath } from "../paths"
import { PDF_VIEWER_FRAGMENT, PdfViewerDriver } from "./pdf-viewer-driver"

export const STAGE_PARTITION = "webdeck-stage"

/** What a stage shows: a deck page, or a PDF in Chromium's viewer. */
export interface StageSource {
  kind: DeckKind
  url: string
  title: string
}

/** The source URL, opening at `index` (0-based) when given. */
export function stageUrl(source: StageSource, index?: number): string {
  const base = source.url.replace(/#.*$/, "")
  if (source.kind === "pdf") {
    const page = index === undefined ? "" : `&page=${index + 1}`
    return base + PDF_VIEWER_FRAGMENT + page
  }
  // deck-stage restores `#<1-based slide>` on load.
  return index === undefined ? base : `${base}#${index + 1}`
}

export interface StageHostOptions {
  source: StageSource
  /** Viewport in CSS px — the deck's design size. */
  width: number
  height: number
  /** Output pixels per CSS px. */
  scale: number
  /** GPU shared textures (live stage) vs. CPU bitmaps (thumbnails). */
  sharedTexture: boolean
  frameRate: number
  driver: StageDriverOptions
}

interface StageHostEvents {
  event: [StageEvent]
  texture: [OffscreenSharedTexture]
  bitmap: [NativeImage]
  cursor: [string]
  gone: [string]
}

const READY_TIMEOUT_MS = 30_000

/** Hosts registered by webContents id, so the stage preload can fetch its options. */
const hosts = new Map<number, StageHost>()

ipcMain.on("webdeck:stage-options", (e) => {
  e.returnValue = hosts.get(e.sender.id)?.options.driver ?? { freezeAnimations: false }
})
ipcMain.on(STAGE_EVENT_CHANNEL, (e, event: StageEvent) => {
  hosts.get(e.sender.id)?.emit("event", event)
})

/**
 * One isolated, offscreen slide web context. It knows nothing about windows
 * or presenters: it loads a URL, relays driver events, forwards input, and
 * emits frames.
 */
export class StageHost extends EventEmitter<StageHostEvents> {
  private win: BrowserWindow
  private wc: WebContents
  private ackSeq = 0
  private disposed = false
  private pdf: PdfViewerDriver | null = null
  private sawTexture = false

  constructor(readonly options: StageHostOptions) {
    super()
    this.win = new BrowserWindow({
      show: false,
      width: options.width,
      height: options.height,
      useContentSize: true,
      frame: false,
      transparent: false,
      backgroundColor: "#000000",
      webPreferences: {
        offscreen: {
          useSharedTexture: options.sharedTexture,
          deviceScaleFactor: options.scale,
        },
        // PDFs are driven from main (see PdfViewerDriver); no page driver.
        preload: options.source.kind === "pdf" ? undefined : stagePreloadPath(),
        partition: STAGE_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    })
    const wc = this.win.webContents
    this.wc = wc
    const wcId = wc.id
    hosts.set(wcId, this)
    // Electron destroys every window on quit, hidden stages included; after
    // that, nothing here may touch the window.
    this.win.once("closed", () => {
      this.disposed = true
      hosts.delete(wcId)
      this.pdf?.dispose()
    })
    if (options.source.kind === "pdf") {
      this.pdf = new PdfViewerDriver(wc, options.source.title, (ev) => this.emit("event", ev))
    }
    wc.setFrameRate(options.frameRate)
    wc.setAudioMuted(false)

    wc.on("paint", (e, _dirty, image) => {
      const texture = (e as unknown as { texture?: OffscreenSharedTexture }).texture
      if (texture) {
        this.sawTexture = true
        if (this.listenerCount("texture")) this.emit("texture", texture)
        else texture.release()
      } else if (!this.sawTexture) {
        // No GPU (or shared textures unsupported): CPU bitmaps instead. A
        // stray texture-less paint after textures have flowed is ignored.
        this.emit("bitmap", image)
      }
    })
    wc.on("cursor-changed", (_e, type) => this.emit("cursor", type))
    wc.on("render-process-gone", (_e, d) => this.emit("gone", d.reason))
    wc.on("console-message", (e) => {
      if (e.level === "error") console.warn(`[stage] ${e.message} (${e.sourceId}:${e.lineNumber})`)
    })

    // Decks stay put: links open in the system browser, never in the stage.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
    wc.on("will-navigate", (e) => {
      const target = new URL(e.url)
      const current = wc.getURL() ? new URL(wc.getURL()) : null
      if (current && target.origin === current.origin && target.pathname === current.pathname) {
        return // in-page (hash) navigation
      }
      e.preventDefault()
      if (/^https?:$/i.test(target.protocol)) void shell.openExternal(e.url)
    })
  }

  get webContents(): WebContents {
    return this.wc
  }

  private get alive(): boolean {
    return !this.disposed && !this.win.isDestroyed()
  }

  /** Load the source (at slide `index`); resolves with its first report once the driver attaches. */
  load(index?: number): Promise<StageReport> {
    const url = stageUrl(this.options.source, index)
    return new Promise<StageReport>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error("The deck didn't finish loading."))
      }, READY_TIMEOUT_MS)
      const onEvent = (ev: StageEvent) => {
        if (ev.type !== "ready") return
        cleanup()
        resolve(ev.report)
      }
      const onGone = (reason: string) => {
        cleanup()
        reject(new Error(`The deck's renderer exited (${reason}).`))
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.off("event", onEvent)
        this.off("gone", onGone)
      }
      this.on("event", onEvent)
      this.on("gone", onGone)
      if (!this.alive) return reject(new Error("stage disposed"))
      this.win.loadURL(url).catch((err: unknown) => {
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })
  }

  command(cmd: StageCommand): void {
    if (!this.alive) return
    if (this.pdf) this.pdf.run(cmd)
    else this.wc.send(STAGE_COMMAND_CHANNEL, cmd)
  }

  /** Navigate and wait until the slide has fonts, images, and two frames painted. */
  goToSettled(index: number, timeoutMs = 5000): Promise<void> {
    const ack = ++this.ackSeq
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, timeoutMs)
      function done() {
        clearTimeout(timer)
        off()
        resolve()
      }
      const onEvent = (ev: StageEvent) => {
        if (ev.type === "settled" && ev.ack === ack) done()
      }
      const off = () => this.off("event", onEvent)
      this.on("event", onEvent)
      this.command({ type: "goTo", index, ack })
    })
  }

  input(input: StageInput): void {
    if (!this.alive) return
    const ev = toElectronInput(input, this.options.width, this.options.height)
    this.wc.sendInputEvent(
      ev as Electron.MouseInputEvent | Electron.MouseWheelInputEvent | Electron.KeyboardInputEvent,
    )
  }

  resize(width: number, height: number): void {
    this.options.width = width
    this.options.height = height
    if (this.alive) this.win.setContentSize(width, height)
  }

  invalidate(): void {
    if (this.alive) this.wc.invalidate()
  }

  capture(): Promise<NativeImage> {
    if (!this.alive) return Promise.reject(new Error("stage disposed"))
    return this.wc.capturePage()
  }

  dispose(): void {
    this.removeAllListeners()
    if (this.disposed) return
    this.disposed = true
    this.pdf?.dispose()
    if (!this.win.isDestroyed()) {
      hosts.delete(this.wc.id)
      this.win.destroy()
    }
  }
}
