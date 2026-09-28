import type { StageReport } from "@shared/stage-protocol"
import type { TweakValues } from "@shared/tweaks"

import { StageHost, type StageSource } from "./stage-host"

/** Physical width of generated thumbnails (≈2× a typical list item). */
const THUMB_WIDTH = 640

export type ThumbCallback = (index: number, dataUrl: string) => void

function hostFor(source: StageSource, width: number, height: number): StageHost {
  return new StageHost({
    source,
    width,
    height,
    scale: THUMB_WIDTH / width,
    sharedTexture: false,
    frameRate: 30,
    driver: { freezeAnimations: true },
  })
}

async function snap(host: StageHost): Promise<string> {
  const img = await host.capture()
  return `data:image/jpeg;base64,${img.toJPEG(82).toString("base64")}`
}

/** Render a deck's cover (current slide on load) for the picker. */
export async function renderCover(source: StageSource): Promise<string> {
  const host = hostFor(source, 1920, 1080)
  try {
    const report = await host.load()
    if (report.width !== 1920 || report.height !== 1080) {
      host.resize(report.width, report.height)
    }
    await host.goToSettled(report.index)
    return await snap(host)
  } finally {
    host.dispose()
  }
}

/**
 * Renders every slide of the open deck, in its own offscreen stage with all
 * animations jumped to their end state. Rendering restarts (and stale work is
 * abandoned) whenever `render` is called again — e.g. after a tweak.
 */
export class SlideThumbnailer {
  private host: StageHost | null = null
  private generation = 0
  private loaded: StageSource | null = null

  constructor(private onThumb: ThumbCallback) {}

  /**
   * @param reload force a fresh page load (EDITMODE tweaks change the source).
   * @param focus slide to render first; the rest follow outward from it.
   */
  async render(opts: {
    source: StageSource
    report: StageReport
    tweaks: TweakValues | null
    reload: boolean
    focus: number
  }): Promise<void> {
    const gen = ++this.generation
    const { source, report } = opts
    const stale = () => gen !== this.generation

    if (!this.host || opts.reload || this.loaded !== source) {
      this.host?.dispose()
      this.host = hostFor(source, report.width, report.height)
      this.loaded = source
      await this.host.load()
      if (stale()) return
    }
    const host = this.host
    if (opts.tweaks) host.command({ type: "setTweaks", values: opts.tweaks })

    const order = report.slides
      .map((s) => s.index)
      .sort((a, b) => Math.abs(a - opts.focus) - Math.abs(b - opts.focus) || a - b)
    for (const i of order) {
      if (stale()) return
      await host.goToSettled(i)
      if (stale()) return
      try {
        this.onThumb(i, await snap(host))
      } catch (err) {
        console.warn(`[thumbnails] slide ${i}:`, err)
      }
    }
  }

  dispose(): void {
    this.generation++
    this.host?.dispose()
    this.host = null
  }
}
