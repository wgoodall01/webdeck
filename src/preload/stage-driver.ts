/**
 * The stage driver: runs in the slide page's MAIN world and adapts whatever
 * the page is to the stage protocol (see `@shared/stage-protocol`).
 *
 * `installDriver` is injected with `contextBridge.executeInMainWorld`, which
 * serializes the function's source — so it must be fully self-contained:
 * no imports, no references to module scope. Types only.
 *
 * Adapters, tried in order until one attaches:
 *  1. Claude Design `<deck-stage>` (plain HTML or `.dc.html` decks).
 *  2. Fallback: the page as a single static slide.
 *
 * (PDFs don't use this: Chromium's viewer lives in a cross-origin extension
 * frame, so main drives it directly — see `main/stage/pdf-viewer-driver.ts`.)
 */

import type { SlideInfo } from "@shared/deck"
import type {
  StageCommand,
  StageDriverOptions,
  StageEvent,
  StageReport,
} from "@shared/stage-protocol"

export interface HostBridge {
  emit(event: StageEvent): void
  onCommand(cb: (cmd: StageCommand) => void): void
}

interface Adapter {
  report(): StageReport
  goTo(index: number): void
  step(dir: 1 | -1): void
  setTweaks(values: Record<string, unknown>): void
  settle(): Promise<void>
}

export function installDriver(options: StageDriverOptions): void {
  const w = window as unknown as Record<string, any>
  const host = w.__webdeckHost as HostBridge
  if (!host || w.__webdeckDriverInstalled) return
  w.__webdeckDriverInstalled = true

  const log = (level: "info" | "warn" | "error", message: string) =>
    host.emit({ type: "log", level, message })

  // ── Animation freezing (thumbnails) ───────────────────────────────────
  const FREEZE_CSS =
    "*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;" +
    "transition-delay:0s!important;transition-duration:0s!important;caret-color:transparent!important}"
  function addStyle(root: Document | ShadowRoot, css: string) {
    const s = document.createElement("style")
    s.setAttribute("data-webdeck", "")
    s.textContent = css
    ;(root instanceof Document ? root.head || root.documentElement : root).appendChild(s)
  }
  if (options.freezeAnimations) {
    if (document.head) addStyle(document, FREEZE_CSS)
    else document.addEventListener("DOMContentLoaded", () => addStyle(document, FREEZE_CSS))
  }

  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
  const timeout = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  async function settleDom(root: ParentNode | null) {
    const imgs = root ? Array.from(root.querySelectorAll("img")) : []
    await Promise.race([
      Promise.all([
        document.fonts ? document.fonts.ready.then(() => {}) : Promise.resolve(),
        ...imgs.map((img) => img.decode().catch(() => {})),
      ]),
      timeout(3000),
    ])
    await nextFrame()
    await nextFrame()
  }

  function debounce(fn: () => void, ms: number) {
    let t: ReturnType<typeof setTimeout> | undefined
    return () => {
      clearTimeout(t)
      t = setTimeout(fn, ms)
    }
  }

  function jsonSafe(v: unknown): unknown {
    try {
      return v === undefined ? null : JSON.parse(JSON.stringify(v))
    } catch {
      return null
    }
  }

  // ── Design Component runtime (tweaks) ─────────────────────────────────
  function dcRootName(): string | null {
    try {
      return typeof w.__dcRootName === "function" ? (w.__dcRootName() as string) : null
    } catch {
      return null
    }
  }
  function dcProps(): unknown {
    const root = dcRootName()
    const entry = root && w.__dcRegistry ? w.__dcRegistry[root] : null
    return entry ? jsonSafe(entry.propsMeta) : null
  }
  function dcSetProps(values: Record<string, unknown>) {
    const root = dcRootName()
    if (root && typeof w.__dcSetProps === "function") w.__dcSetProps(root, values)
    else log("warn", "setTweaks: page has no Design Component runtime")
  }

  // ── Adapter: Claude Design <deck-stage> ───────────────────────────────
  function deckStageAdapter(): Adapter | null {
    const el = document.querySelector("deck-stage") as any
    if (!el || !customElements.get("deck-stage")) return null
    if (!(el.length > 0) || !el.shadowRoot) return null

    // Presenting chrome off: no thumbnail rail, no nav overlay, no slide
    // edge ring. The audience must only ever see the slide itself.
    el.setAttribute("no-rail", "")
    addStyle(
      el.shadowRoot,
      ".overlay,.rail,.rail-resize,.menu,.confirm{display:none!important}" +
        ".canvas{box-shadow:none!important}",
    )
    window.postMessage({ __omelette_presenting: true, __omelette_preview_mode: true }, "*")
    window.dispatchEvent(new Event("resize"))

    const slideEls = (): Element[] =>
      Array.isArray(el._slides)
        ? el._slides
        : Array.from(el.children as HTMLCollection).filter(
            (c) => !["TEMPLATE", "SCRIPT", "STYLE"].includes(c.tagName),
          )

    function legacyNotes(): unknown[] | null {
      const tag = document.getElementById("speaker-notes")
      if (!tag) return null
      try {
        const parsed: unknown = JSON.parse(tag.textContent || "[]")
        return Array.isArray(parsed) ? parsed : null
      } catch {
        return null
      }
    }

    function slides(): SlideInfo[] {
      const legacy = legacyNotes()
      return slideEls().map((s, i) => {
        const attr = s.getAttribute("data-speaker-notes")
        const fromJson = legacy?.[i]
        const screenLabel = (s.getAttribute("data-screen-label") || "").replace(/^\d+\s+/, "")
        return {
          index: i,
          label: s.getAttribute("data-label") || screenLabel || `Slide ${i + 1}`,
          notes: attr !== null ? attr : typeof fromJson === "string" ? fromJson : "",
          skipped: s.hasAttribute("data-deck-skip"),
        }
      })
    }

    const report = (): StageReport => ({
      kind: "html",
      title: document.title || "",
      width: el.designWidth || 1920,
      height: el.designHeight || 1080,
      slides: slides(),
      index: el.index ?? 0,
      dcProps: dcProps(),
    })

    el.addEventListener("slidechange", () => host.emit({ type: "slide", index: el.index }))

    // Slides can change under us: a DC re-render after a tweak, or a deck
    // that builds slides from script. Report structure changes, debounced.
    const changed = debounce(() => host.emit({ type: "changed", report: report() }), 150)
    new MutationObserver(changed).observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-label", "data-speaker-notes", "data-deck-skip"],
    })

    return {
      report,
      goTo: (i) => el.goTo(i),
      step: (d) => (d > 0 ? el.next() : el.prev()),
      setTweaks: dcSetProps,
      settle: () => settleDom(slideEls()[el.index] ?? null),
    }
  }

  // ── Adapter: fallback single page ─────────────────────────────────────
  function staticAdapter(): Adapter {
    return {
      report: () => ({
        kind: "html",
        title: document.title || "",
        width: window.innerWidth || 1920,
        height: window.innerHeight || 1080,
        slides: [{ index: 0, label: document.title || "Page", notes: "", skipped: false }],
        index: 0,
        dcProps: dcProps(),
      }),
      goTo: () => {},
      step: () => {},
      setTweaks: dcSetProps,
      settle: () => settleDom(document),
    }
  }

  // ── Attach ────────────────────────────────────────────────────────────
  let adapter: Adapter | null = null
  const pending: StageCommand[] = []

  function run(cmd: StageCommand) {
    if (!adapter) {
      pending.push(cmd)
      return
    }
    const a = adapter
    switch (cmd.type) {
      case "goTo":
        a.goTo(cmd.index)
        if (cmd.ack !== undefined) {
          const ack = cmd.ack
          void a.settle().then(() => host.emit({ type: "settled", ack }))
        }
        break
      case "step":
        a.step(cmd.dir)
        break
      case "setTweaks":
        a.setTweaks(cmd.values)
        break
    }
  }
  host.onCommand(run)

  function attach(a: Adapter) {
    if (adapter) return
    adapter = a
    observer.disconnect()
    clearInterval(poll)
    host.emit({ type: "ready", report: a.report() })
    for (const cmd of pending.splice(0)) run(cmd)
  }

  function tryAttach() {
    if (adapter) return
    const a = deckStageAdapter()
    if (a) attach(a)
  }

  const observer = new MutationObserver(tryAttach)
  observer.observe(document, { childList: true, subtree: true })
  // deck-stage upgrades and gains slides without DOM mutations we'd see.
  const poll = setInterval(tryAttach, 100)
  void customElements.whenDefined("deck-stage").then(tryAttach)

  // Nothing deck-like showed up: present the page as one slide. Pages that
  // announce a deck runtime get longer (React/Babel load from a CDN).
  window.addEventListener("load", () => {
    const expectsDeck = !!document.querySelector("x-dc, x-import, deck-stage")
    setTimeout(
      () => {
        if (adapter) return
        if (expectsDeck) log("warn", "deck runtime never attached; presenting page as one slide")
        attach(staticAdapter())
      },
      expectsDeck ? 20000 : 1500,
    )
  })
}
