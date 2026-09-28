import type { WebContents, WebFrameMain } from "electron"

import type { StageCommand, StageEvent, StageReport } from "@shared/stage-protocol"

/** PDFs are laid out at this height in CSS px, whatever their page size. */
export const PDF_DESIGN_HEIGHT = 1080

/** Initial URL fragment for Chromium's viewer: no toolbar, fit a page. */
export const PDF_VIEWER_FRAGMENT = "#toolbar=0&navpanes=0&view=Fit"

/**
 * Chromium's viewer rasterizes tiles asynchronously after a page change and
 * gives no "done" signal; give it this long before calling a page settled.
 */
const RASTER_SETTLE_MS = 350

/**
 * Script evaluated inside the PDF viewer's extension frame. It drives the
 * viewer's internal `viewport_` — not a public API, but pinned by the
 * Chromium that ships with our Electron version (verified on Electron 44).
 */
const VIEWER_SHIM = String.raw`
(() => {
  if (window.__webdeckPdf) return true
  const viewer = document.querySelector("pdf-viewer")
  const vp = viewer && viewer.viewport_
  if (!vp || !vp.pageDimensions_ || !vp.pageDimensions_.length) return false

  // Chrome-free: no scrollbars, black surround, no focus rings.
  const css = "::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}" +
    "body,#main,#scroller,#content{background:#000!important}"
  for (const root of [document, viewer.shadowRoot].filter(Boolean)) {
    const s = document.createElement("style")
    s.textContent = css
    ;(root.head || root).appendChild(s)
  }

  let current = Math.max(0, vp.getMostVisiblePage())
  // Zoom so page 'i' exactly covers the viewport (overfilling by a hair so
  // no sub-pixel sliver of the neighbouring page or margin shows), then
  // centre it.
  function snap(i) {
    if (vp.fitToNone) vp.fitToNone()
    const r0 = vp.getPageScreenRect(i)
    if (r0.width > 0 && r0.height > 0) {
      const k = Math.min(innerWidth / r0.width, innerHeight / r0.height) * 1.003
      vp.setZoom(vp.getZoom() * k)
    }
    vp.goToPage(i)
    const r = vp.getPageScreenRect(i)
    const p = vp.position
    vp.setPosition({ x: p.x + r.x - (innerWidth - r.width) / 2, y: p.y + r.y - (innerHeight - r.height) / 2 })
  }
  addEventListener("resize", () => requestAnimationFrame(() => snap(current)))

  window.__webdeckPdf = {
    pages: () => vp.pageDimensions_.map((d) => ({ width: d.width, height: d.height })),
    current: () => current,
    goTo(i) {
      current = Math.max(0, Math.min(vp.pageDimensions_.length - 1, i))
      snap(current)
      return current
    },
    // An in-document link or a stray scroll moved the viewer: follow it.
    poll() {
      const seen = vp.getMostVisiblePage()
      if (seen !== current && seen >= 0) {
        current = seen
        snap(current)
      }
      return current
    },
  }
  snap(current)
  return true
})()
`

function viewerFrame(wc: WebContents): WebFrameMain | undefined {
  return wc.mainFrame.framesInSubtree.find((f) => f.url.startsWith("chrome-extension://"))
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Drives Chromium's built-in PDF viewer from the main process, speaking the
 * same stage events as the in-page driver so `StageHost` can't tell them apart.
 */
export class PdfViewerDriver {
  private frame: WebFrameMain | null = null
  private report: StageReport | null = null
  private poller: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(
    private wc: WebContents,
    private title: string,
    private emit: (ev: StageEvent) => void,
  ) {
    wc.on("did-finish-load", () => void this.attach())
  }

  private async eval<T>(js: string): Promise<T | null> {
    const f = this.frame
    if (!f || f.isDestroyed()) return null
    try {
      return (await f.executeJavaScript(js)) as T
    } catch {
      return null
    }
  }

  /** The viewer frame and its document load after the outer page; wait for both. */
  private async attach(): Promise<void> {
    for (let tries = 0; tries < 200 && !this.disposed; tries++) {
      this.frame = viewerFrame(this.wc) ?? null
      if (this.frame && (await this.eval<boolean>(VIEWER_SHIM))) break
      await sleep(50)
    }
    if (this.disposed) return
    const pages = await this.eval<{ width: number; height: number }[]>("__webdeckPdf.pages()")
    const index = (await this.eval<number>("__webdeckPdf.current()")) ?? 0
    if (!pages?.length) {
      this.emit({ type: "log", level: "error", message: "PDF viewer never attached" })
      return
    }
    const [first = { width: 4, height: 3 }] = pages
    this.report = {
      kind: "pdf",
      title: this.title,
      width: Math.round((PDF_DESIGN_HEIGHT * first.width) / first.height),
      height: PDF_DESIGN_HEIGHT,
      slides: pages.map((_, i) => ({
        index: i,
        label: `Page ${i + 1}`,
        notes: "",
        skipped: false,
      })),
      index,
      dcProps: null,
    }
    this.emit({ type: "ready", report: this.report })
    this.poller = setInterval(() => void this.poll(), 250)
  }

  private async poll(): Promise<void> {
    const i = await this.eval<number>("__webdeckPdf.poll()")
    if (i !== null) this.moved(i)
  }

  private moved(i: number): void {
    if (!this.report || this.report.index === i) return
    this.report = { ...this.report, index: i }
    this.emit({ type: "slide", index: i })
  }

  run(cmd: StageCommand): void {
    const r = this.report
    if (!r) return
    const target = cmd.type === "goTo" ? cmd.index : cmd.type === "step" ? r.index + cmd.dir : null
    if (target === null) return // PDFs have no tweaks
    void this.eval<number>(`__webdeckPdf.goTo(${Math.trunc(target)})`).then(async (i) => {
      if (i !== null) this.moved(i)
      if (cmd.type === "goTo" && cmd.ack !== undefined) {
        await sleep(RASTER_SETTLE_MS)
        this.emit({ type: "settled", ack: cmd.ack })
      }
    })
  }

  dispose(): void {
    this.disposed = true
    if (this.poller) clearInterval(this.poller)
  }
}
