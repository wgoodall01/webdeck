import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import { cn } from "cn"

import type { PointerButton } from "@shared/input"
import type { MarkerPoint, ScreenMode } from "@shared/ipc"

import { modifiersOf, toStageKeys } from "@/lib/keys"
import { bridge, useBridgeEvent } from "@/lib/webdeck"

const BUTTONS: PointerButton[] = ["left", "middle", "right"]
const DRAG_THRESHOLD = 4
/** Wait for resizes to settle before asking main for a crisp frame. */
const REPLAY_DEBOUNCE_MS = 120

export interface SlideSurfaceProps {
  /** width / height of the deck. */
  aspect: number
  screen: ScreenMode
  /** Forward pointer + keyboard input into the slide. */
  interactive: boolean
  /** Report where the pointer hovers over the slide (null when it leaves). */
  onHover?: (p: MarkerPoint | null) => void
  /** Hover marker to draw (the audience draws the presenter's). */
  marker?: MarkerPoint | null
  /** Caption shown over a black/white screen (presenter only). */
  screenCaption?: string
  /** Ring the slide while it holds keyboard focus (keys go to the slide). */
  showFocus?: boolean
  /**
   * QuickTime-style: pressing and dragging anywhere moves the window. A press
   * that doesn't move is still delivered to the slide as a click.
   */
  dragsWindow?: boolean
  onDoubleClick?: () => void
  className?: string
}

/**
 * Paints the live slide. Frames arrive as GPU-backed VideoFrames that share
 * memory with the offscreen stage, so every surface shows identical pixels.
 * Letterboxes to the deck's aspect ratio within whatever box it's given.
 */
export function SlideSurface({
  aspect,
  screen,
  interactive,
  onHover,
  marker,
  screenCaption,
  showFocus = false,
  dragsWindow = false,
  onDoubleClick,
  className,
}: SlideSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cursor, setCursor] = useState("default")
  useBridgeEvent("cursor", setCursor)

  useFramePipeline(canvasRef)

  const point = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  // Coalesce pointer moves to one per frame.
  const pendingMove = useRef<{ p: MarkerPoint; e: ReactPointerEvent } | null>(null)
  const moveRaf = useRef(0)
  // A left press in dragsWindow mode is held back until it's either a drag
  // (moves the window) or a click (forwarded to the slide on release).
  const press = useRef<{ screenX: number; screenY: number; p: MarkerPoint; dragging: boolean }>(
    null,
  )

  const onPointerMove = (e: ReactPointerEvent) => {
    const p = point(e)
    const pr = press.current
    if (pr) {
      const moved = Math.hypot(e.screenX - pr.screenX, e.screenY - pr.screenY)
      if (!pr.dragging && moved > DRAG_THRESHOLD) {
        pr.dragging = true
        bridge().send("window:drag", "start")
      }
      if (pr.dragging) bridge().send("window:drag", "move")
      return
    }
    onHover?.(p)
    if (!interactive) return
    pendingMove.current = { p, e }
    if (moveRaf.current) return
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0
      const m = pendingMove.current
      if (!m) return
      bridge().send("stage:input", {
        kind: "move",
        x: m.p.x,
        y: m.p.y,
        modifiers: modifiersOf(m.e),
      })
    })
  }

  const sendButton = (e: ReactPointerEvent, kind: "down" | "up", p: MarkerPoint) =>
    bridge().send("stage:input", {
      kind,
      x: p.x,
      y: p.y,
      button: BUTTONS[e.button] ?? "left",
      clickCount: Math.max(1, e.detail || 1),
      modifiers: modifiersOf(e),
    })

  const onPointerButton = (e: ReactPointerEvent, kind: "down" | "up") => {
    if (kind === "down") e.currentTarget.setPointerCapture(e.pointerId)
    if (dragsWindow && e.button === 0) {
      if (kind === "down") {
        press.current = { screenX: e.screenX, screenY: e.screenY, p: point(e), dragging: false }
        return
      }
      const pr = press.current
      press.current = null
      if (!pr) return
      if (pr.dragging) bridge().send("window:drag", "end")
      else if (interactive) {
        sendButton(e, "down", pr.p)
        sendButton(e, "up", pr.p)
      }
      return
    }
    if (!interactive) return
    if (kind === "down") (e.currentTarget as HTMLElement).focus()
    sendButton(e, kind, point(e))
  }

  const onPointerLeave = () => {
    onHover?.(null)
    if (interactive) bridge().send("stage:input", { kind: "leave" })
  }

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!interactive) return
    const p = point(e)
    bridge().send("stage:input", {
      kind: "wheel",
      x: p.x,
      y: p.y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      modifiers: modifiersOf(e),
    })
  }

  // Keys typed while the slide itself has focus go to the slide (e.g. an
  // input on an interactive slide). Navigation keys stay with the app.
  const onKey = (e: React.KeyboardEvent, type: "keyDown" | "keyUp") => {
    if (!interactive) return
    if (e.key === "Escape") {
      ;(e.currentTarget as HTMLElement).blur() // hand the keyboard back to the app
      return
    }
    if (/^(Arrow|Page)|^(Home|End| )$/.test(e.key)) return
    e.stopPropagation()
    e.preventDefault()
    for (const k of toStageKeys(e.nativeEvent, type)) bridge().send("stage:input", k)
  }

  return (
    <div className={cn("relative flex size-full items-center justify-center", className)}>
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ containerType: "size" }}
      >
        <div
          className={cn(
            "relative overflow-hidden bg-black outline-none",
            showFocus &&
              "focus:ring-2 focus:ring-sky-400/70 focus:ring-offset-2 focus:ring-offset-background",
          )}
          style={{
            aspectRatio: String(aspect),
            width: `min(100cqw, calc(100cqh * ${aspect}))`,
            cursor: interactive ? cursor : "default",
          }}
          tabIndex={interactive ? 0 : -1}
          onPointerMove={onPointerMove}
          onPointerDown={(e) => onPointerButton(e, "down")}
          onPointerUp={(e) => onPointerButton(e, "up")}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
          onKeyDown={(e) => onKey(e, "keyDown")}
          onKeyUp={(e) => onKey(e, "keyUp")}
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={onDoubleClick}
        >
          <canvas ref={canvasRef} className="block size-full" />
          {screen !== "normal" && (
            // Exactly what the audience sees, so the preview never lies.
            <div
              className={cn(
                "pointer-events-none absolute inset-0 flex items-end justify-center pb-[4cqh]",
                screen === "black" ? "bg-black text-white/45" : "bg-white text-black/45",
              )}
            >
              {screenCaption && <span className="text-xs">{screenCaption}</span>}
            </div>
          )}
          {marker && <Marker point={marker} />}
        </div>
      </div>
    </div>
  )
}

/**
 * Draws frames into the canvas. The backing store tracks the element's size
 * (× DPR) for sharp downscaling; on resize the current pixels are stretched
 * into the new size immediately (never a black flash) and main is asked to
 * replay the latest frame at full quality once resizing settles.
 */
function useFramePipeline(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d", { alpha: false })
    if (!canvas || !ctx) return

    const draw = (src: CanvasImageSource) => {
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
    }
    const offFrame = bridge().onFrame((frame) => {
      try {
        draw(frame)
      } finally {
        frame.close()
      }
    })
    const offBitmap = bridge().on("frame:bitmap", (jpeg) => {
      void createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" })).then((bmp) => {
        draw(bmp)
        bmp.close()
      })
    })

    let replayTimer: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width === w && canvas.height === h) return
      // Resizing clears the canvas: carry the old pixels across.
      const snapshot = new OffscreenCanvas(canvas.width, canvas.height)
      snapshot.getContext("2d")?.drawImage(canvas, 0, 0)
      canvas.width = w
      canvas.height = h
      draw(snapshot)
      clearTimeout(replayTimer)
      replayTimer = setTimeout(() => bridge().send("frames:ready"), REPLAY_DEBOUNCE_MS)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    return () => {
      ro.disconnect()
      clearTimeout(replayTimer)
      offFrame()
      offBitmap()
    }
  }, [canvasRef])
}

/** The presenter's hover position, as the audience sees it. */
function Marker({ point }: { point: MarkerPoint }) {
  return (
    <div
      className="pointer-events-none absolute size-[1.4cqh] min-h-2 min-w-2 -translate-1/2 rounded-full bg-black ring-[0.2cqh] ring-white"
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
    />
  )
}
