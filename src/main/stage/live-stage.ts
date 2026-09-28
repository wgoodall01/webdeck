import { EventEmitter } from "node:events"

import {
  sharedTexture,
  type NativeImage,
  type OffscreenSharedTexture,
  type SharedTextureImported,
  type WebContents,
} from "electron"

import type { StageInput } from "@shared/input"
import { IPC_PREFIX } from "@shared/ipc"
import type { StageEvent, StageReport } from "@shared/stage-protocol"
import type { TweakValues } from "@shared/tweaks"

import { FrameFanout, type Frame } from "./frame-fanout"
import { StageHost, type StageSource } from "./stage-host"

interface TextureFrame extends Frame {
  imported: SharedTextureImported
}

interface BitmapFrame extends Frame {
  jpeg(): Uint8Array
}

interface LiveStageEvents {
  report: [StageReport]
  slide: [number]
  cursor: [string]
  error: [Error]
}

export interface LiveStageOptions {
  /** Output pixels per CSS px for a deck of the given design height. */
  scaleFor(designHeight: number): number
  frameRate: number
}

/**
 * The live slide surface: one offscreen stage whose GPU frames are shared,
 * zero-copy, into every attached window (audience + presenter preview), so
 * both show exactly the same pixels.
 *
 * Reloads (tweaks that need one, a resolution change) are double-buffered: a
 * new stage loads and settles off to the side, then takes over atomically,
 * so the audience never sees a blank or half-built frame.
 */
export class LiveStage extends EventEmitter<LiveStageEvents> {
  private host: StageHost | null = null
  private source: StageSource | null = null
  private textures = new FrameFanout<TextureFrame>({ onError: (id) => this.dropSink(id) })
  private bitmaps = new FrameFanout<BitmapFrame>({ onError: (id) => this.dropSink(id) })
  private sinks = new Map<number, () => void>()
  private warnedBitmap = false
  report: StageReport | null = null

  constructor(private options: LiveStageOptions) {
    super()
  }

  async open(source: StageSource): Promise<StageReport> {
    this.source = source
    // Most decks are 1920×1080; start there and correct once the deck reports.
    let report = await this.swapIn(1920, 1080)
    const { width, height } = report
    const cur = this.host?.options
    if (cur && (cur.width !== width || cur.height !== height)) {
      report = await this.swapIn(width, height, report.index)
    }
    return report
  }

  /** Reload the deck in place (e.g. after an EDITMODE tweak), keeping the slide. */
  async reload(): Promise<StageReport> {
    const r = this.report
    if (!r) throw new Error("stage not open")
    return this.swapIn(r.width, r.height, r.index)
  }

  goTo(index: number): void {
    this.host?.command({ type: "goTo", index })
  }

  step(dir: 1 | -1): void {
    this.host?.command({ type: "step", dir })
  }

  setTweaks(values: TweakValues): void {
    this.host?.command({ type: "setTweaks", values })
  }

  input(input: StageInput): void {
    this.host?.input(input)
  }

  addSink(wc: WebContents): void {
    const id = wc.id
    this.dropSink(id)
    this.textures.add({
      id,
      deliver: (f) =>
        wc.isDestroyed()
          ? Promise.resolve()
          : sharedTexture.sendSharedTexture({
              frame: wc.mainFrame,
              importedSharedTexture: f.imported,
            }),
    })
    this.bitmaps.add({
      id,
      deliver: async (f) => {
        if (!wc.isDestroyed()) wc.send(IPC_PREFIX + "frame:bitmap", f.jpeg())
      },
    })
    const drop = () => this.dropSink(id)
    const onNav = (d: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (d.isMainFrame && !d.isSameDocument) drop()
    }
    wc.on("destroyed", drop)
    wc.on("did-start-navigation", onNav)
    wc.on("render-process-gone", drop)
    this.sinks.set(id, () => {
      if (wc.isDestroyed()) return
      wc.off("destroyed", drop)
      wc.off("did-start-navigation", onNav)
      wc.off("render-process-gone", drop)
    })
    // A fresh sink has nothing on screen; have the stage repaint.
    this.host?.invalidate()
  }

  dropSink(id: number): void {
    this.sinks.get(id)?.()
    this.sinks.delete(id)
    this.textures.remove(id)
    this.bitmaps.remove(id)
  }

  /** Repaint (e.g. a sink resized its canvas). */
  invalidate(): void {
    this.host?.invalidate()
  }

  dispose(): void {
    this.textures.clear()
    this.bitmaps.clear()
    for (const off of this.sinks.values()) off()
    this.sinks.clear()
    this.host?.dispose()
    this.host = null
    this.removeAllListeners()
  }

  // ── internals ─────────────────────────────────────────────────────────

  private async swapIn(width: number, height: number, index?: number): Promise<StageReport> {
    const source = this.source
    if (!source) throw new Error("stage not open")
    const next = new StageHost({
      source,
      width,
      height,
      scale: this.options.scaleFor(height),
      sharedTexture: true,
      frameRate: this.options.frameRate,
      driver: { freezeAnimations: false },
    })
    let report: StageReport
    try {
      report = await next.load(index)
      if (index !== undefined && report.index !== index) {
        await next.goToSettled(index)
        report = { ...report, index }
      }
    } catch (err) {
      next.dispose()
      throw err
    }
    const prev = this.host
    this.host = next
    this.wire(next)
    prev?.dispose()
    this.report = report
    this.emit("report", report)
    next.invalidate()
    return report
  }

  private wire(host: StageHost): void {
    host.on("texture", (t) => this.onTexture(t))
    host.on("bitmap", (img) => this.onBitmap(img))
    host.on("cursor", (c) => this.emit("cursor", c))
    host.on("gone", (reason) => this.emit("error", new Error(`Slide renderer exited: ${reason}`)))
    host.on("event", (ev: StageEvent) => {
      if (host !== this.host) return
      if (ev.type === "slide" && this.report) {
        this.report = { ...this.report, index: ev.index }
        this.emit("slide", ev.index)
      } else if (ev.type === "changed") {
        this.report = ev.report
        this.emit("report", ev.report)
      } else if (ev.type === "log") {
        console[ev.level](`[stage] ${ev.message}`)
      }
    })
  }

  private onTexture(texture: OffscreenSharedTexture): void {
    if (!this.textures.sinkCount) {
      texture.release()
      return
    }
    const imported = sharedTexture.importSharedTexture({
      textureInfo: texture.textureInfo,
      allReferencesReleased: () => texture.release(),
    })
    this.textures.push({ imported, release: () => imported.release() })
  }

  private onBitmap(image: NativeImage): void {
    if (!this.bitmaps.sinkCount) return
    if (!this.warnedBitmap) {
      this.warnedBitmap = true
      console.warn("[webdeck] GPU shared textures unavailable; falling back to CPU frames")
    }
    let jpeg: Uint8Array | null = null
    this.bitmaps.push({
      jpeg: () => (jpeg ??= new Uint8Array(image.toJPEG(88))),
      release: () => {},
    })
  }
}
