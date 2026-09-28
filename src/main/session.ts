import { screen, type WebContents } from "electron"

import { clampIndex, type DeckCandidate, type DeckManifest } from "@shared/deck"
import type { StageInput } from "@shared/input"
import type {
  AppState,
  AudienceState,
  DisplayInfo,
  EventMap,
  MarkerPoint,
  NavCommand,
  ScreenMode,
  ThumbnailEvent,
} from "@shared/ipc"
import { IPC_PREFIX } from "@shared/ipc"
import { cssCursor } from "@shared/cursor"
import type { StageReport } from "@shared/stage-protocol"
import { defaultValues, type TweakValues } from "@shared/tweaks"

import type { DeckFiles } from "./deck/files"
import type { DeckMounts } from "./protocol/deck-protocol"
import { LiveStage } from "./stage/live-stage"
import type { StageSource } from "./stage/stage-host"
import { SlideThumbnailer } from "./stage/thumbnailer"
import { dcPropsBackend, editModeBackend, type TweakBackend } from "./tweaks/backends"
import { AudienceWindow } from "./windows/audience-window"

export interface SessionHost {
  /** Presenting state changed; re-broadcast it. */
  changed(): void
  /** Send an event to the presenter window. */
  toPresenter<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void
  displays(): DisplayInfo[]
}

/** Pick an output scale so the slide is pixel-sharp on the largest display. */
function scaleFor(designHeight: number): number {
  const tallest = Math.max(
    ...screen.getAllDisplays().map((d) => d.size.height * d.scaleFactor),
    designHeight,
  )
  return Math.min(3, Math.max(1, Math.ceil((tallest / designHeight) * 4) / 4))
}

function debounce(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  const d = () => {
    clearTimeout(t)
    t = setTimeout(fn, ms)
  }
  d.cancel = () => clearTimeout(t)
  return d
}

/**
 * One deck being presented: the live stage, its thumbnails, its tweaks, and
 * the audience window. The presenter window outlives sessions.
 */
export class PresentationSession {
  private stage = new LiveStage({ scaleFor, frameRate: 60 })
  private thumbnailer: SlideThumbnailer
  private thumbs = new Map<number, string>()
  private audience: AudienceWindow | null = null
  private mountId: string
  private source: StageSource
  private report: StageReport | null = null
  private screenMode: ScreenMode = "normal"
  private tweakBackend: TweakBackend | null = null
  private tweakValues: TweakValues = {}
  private cursor = "default"
  private disposed = false

  constructor(
    private files: DeckFiles,
    private mounts: DeckMounts,
    readonly candidate: DeckCandidate,
    private host: SessionHost,
  ) {
    this.mountId = mounts.mount(files)
    this.source = {
      kind: candidate.kind,
      url: mounts.url(this.mountId, candidate.path),
      title: candidate.title,
    }
    this.thumbnailer = new SlideThumbnailer((index, dataUrl) => {
      this.thumbs.set(index, dataUrl)
      host.toPresenter("thumbnail", { scope: "slide", key: String(index), dataUrl })
    })
    this.stage.on("slide", (index) => {
      if (this.report) this.report = { ...this.report, index }
      this.host.changed()
    })
    this.stage.on("report", (r) => {
      const structural = this.report && this.report.slides.length !== r.slides.length
      this.report = r
      this.audience?.setAspect(r.width / r.height)
      this.host.changed()
      if (structural) this.rethumb()
    })
    this.stage.on("cursor", (type) => {
      this.cursor = cssCursor(type)
      this.broadcast("cursor", this.cursor)
    })
    this.stage.on("error", (err) => console.error("[stage]", err))
  }

  async start(): Promise<void> {
    this.report = await this.stage.open(this.source)
    if (this.report.dcProps) this.tweakBackend = dcPropsBackend(this.report.dcProps)
    else if (this.candidate.kind === "html") {
      this.tweakBackend = await editModeBackend(this.files, this.mounts, this.mountId)
    }
    if (this.tweakBackend) this.tweakValues = defaultValues(this.tweakBackend.schema)
    this.openAudience()
    this.rethumb()
  }

  manifest(): DeckManifest | null {
    const r = this.report
    if (!r) return null
    return {
      kind: r.kind,
      title: r.title || this.candidate.title,
      width: r.width,
      height: r.height,
      slides: r.slides,
    }
  }

  state(): AppState {
    const deck = this.manifest()
    if (!deck || !this.report) return { phase: "loading", title: this.candidate.title }
    return {
      phase: "presenting",
      deck,
      index: this.report.index,
      screen: this.screenMode,
      tweaks: this.tweakBackend
        ? { schema: this.tweakBackend.schema, values: this.tweakValues }
        : null,
      audience: this.audienceState(),
      displays: this.host.displays(),
    }
  }

  thumbnails(): ThumbnailEvent[] {
    return [...this.thumbs].map(([i, dataUrl]) => ({ scope: "slide", key: String(i), dataUrl }))
  }

  // ── commands ──────────────────────────────────────────────────────────

  nav(cmd: NavCommand): void {
    const r = this.report
    if (cmd.type === "goTo") this.stage.goTo(r ? clampIndex(r.slides, cmd.index) : cmd.index)
    else this.stage.step(cmd.dir)
  }

  setScreen(mode: ScreenMode): void {
    this.screenMode = mode
    this.host.changed()
  }

  marker(point: MarkerPoint | null): void {
    const wc = this.audienceContents
    if (wc && !wc.isDestroyed()) wc.send(IPC_PREFIX + "marker", point)
  }

  input(input: StageInput): void {
    this.stage.input(input)
  }

  setTweaks(values: TweakValues): void {
    if (!this.tweakBackend) return
    this.tweakValues = { ...this.tweakValues, ...values }
    this.host.changed()
    this.applyTweaks()
  }

  resetTweaks(): void {
    if (!this.tweakBackend) return
    this.tweakValues = defaultValues(this.tweakBackend.schema)
    this.host.changed()
    this.applyTweaks()
  }

  setAudience(patch: Partial<AudienceState>): void {
    if (patch.open && !this.audience) this.openAudience()
    if (!this.audience) return
    if (patch.displayId != null) this.audience.moveToDisplay(patch.displayId)
    if (patch.fullscreen !== undefined) this.audience.setFullscreen(patch.fullscreen)
    this.host.changed()
  }

  get audienceContents(): WebContents | null {
    const a = this.audience
    return a && !a.win.isDestroyed() ? a.webContents : null
  }

  addSink(wc: WebContents): void {
    if (this.disposed || wc.isDestroyed()) return
    this.stage.addSink(wc)
    wc.send(IPC_PREFIX + "cursor", this.cursor)
  }

  /** Re-send display info etc. (called when displays change). */
  refresh(): void {
    this.host.changed()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.applyLive.cancel()
    this.applyReload.cancel()
    this.thumbDebounce.cancel()
    this.thumbnailer.dispose()
    this.stage.dispose()
    this.audience?.close()
    this.audience = null
    this.mounts.unmount(this.mountId)
  }

  // ── internals ─────────────────────────────────────────────────────────

  private audienceState(): AudienceState {
    return this.audience?.state() ?? { open: false, displayId: null, fullscreen: false }
  }

  private openAudience(): void {
    const r = this.report
    const a = new AudienceWindow({
      title: r?.title || this.candidate.title,
      aspect: r ? r.width / r.height : 16 / 9,
    })
    this.audience = a
    const changed = () => this.host.changed()
    a.win.on("enter-full-screen", changed)
    a.win.on("leave-full-screen", changed)
    a.win.on("moved", changed)
    a.win.once("closed", () => {
      if (this.audience === a) this.audience = null
      if (!this.disposed) this.host.changed()
    })
  }

  private broadcast<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void {
    const wc = this.audienceContents
    if (wc && !wc.isDestroyed()) wc.send(IPC_PREFIX + channel, payload)
    this.host.toPresenter(channel, payload)
  }

  private applyLive = debounce(() => {
    this.stage.setTweaks(this.tweakValues)
    this.thumbDebounce()
  }, 16)

  private applyReload = debounce(() => {
    this.tweakBackend?.stage(this.tweakValues)
    this.stage
      .reload()
      .then(() => this.rethumb(true))
      .catch((err: unknown) => console.error("[tweaks] reload failed:", err))
  }, 350)

  private applyTweaks(): void {
    if (this.tweakBackend?.live) this.applyLive()
    else this.applyReload()
  }

  private thumbDebounce = debounce(() => this.rethumb(), 400)

  private rethumb(reload = false): void {
    const r = this.report
    if (!r || this.disposed) return
    const live = this.tweakBackend?.live ?? false
    this.thumbnailer
      .render({
        source: this.source,
        report: r,
        tweaks: live ? this.tweakValues : null,
        reload,
        focus: r.index,
      })
      .catch((err: unknown) => console.warn("[thumbnails]", err))
  }
}
