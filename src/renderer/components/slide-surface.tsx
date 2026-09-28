import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import { cn } from "cn"

import type { PointerButton } from "@shared/input"
import type { LaserPoint, ScreenMode } from "@shared/ipc"

import { modifiersOf, toStageKeys } from "@/lib/keys"
import { bridge, useBridgeEvent } from "@/lib/webdeck"

const BUTTONS: PointerButton[] = ["left", "middle", "right"]

export interface SlideSurfaceProps {
  /** width / height of the deck. */
  aspect: number
  screen: ScreenMode
  /** Forward pointer + keyboard input into the slide. */
  interactive: boolean
  /** Laser mode: pointer drives the laser instead of the slide. */
  laserMode?: boolean
  onLaser?: (p: LaserPoint | null) => void
  /** Laser dot to draw (the audience draws the presenter's laser). */
  laser?: LaserPoint | null
  /** Dim the black/white screen overlay so the presenter can still see the slide. */
  translucentScreen?: boolean
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
  laserMode = false,
  onLaser,
  laser,
  translucentScreen = false,
  showFocus = false,
  dragsWindow = false,
  onDoubleClick,
  className,
}: SlideSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cursor, setCursor] = useState("default")
  const [localLaser, setLocalLaser] = useState<LaserPoint | null>(null)
  useBridgeEvent("cursor", setCursor)

  // Frame pipeline. Canvas backing store tracks its CSS size × DPR; resizing
  // clears it, so ask the stage to repaint.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true })
    if (!ctx) return
    ctx.imageSmoothingQuality = "high"

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

    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const dpr = window.devicePixelRatio || 1
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
          ctx.fillStyle = "#000"
          ctx.fillRect(0, 0, w, h)
          bridge().send("frames:ready") // re-arms the sink and repaints
        }
      })
    })
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      offFrame()
      offBitmap()
    }
  }, [])

  const point = (e: ReactPointerEvent): LaserPoint => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  // Coalesce pointer moves to one per frame.
  const pendingMove = useRef<{ p: LaserPoint; e: ReactPointerEvent } | null>(null)
  const moveRaf = useRef(0)
  // A left press in dragsWindow mode is held back until it's either a drag
  // (moves the window) or a click (forwarded to the slide on release).
  const press = useRef<{
    screenX: number
    screenY: number
    p: LaserPoint
    dragging: boolean
  } | null>(null)
  const DRAG_THRESHOLD = 4

  const onPointerMove = (e: ReactPointerEvent) => {
    const p = point(e)
    const pr = press.current
    if (pr) {
      const moved = Math.hypot(e.screenX - pr.screenX, e.screenY - pr.screenY)
      if (!pr.dragging && moved > DRAG_THRESHOLD) {
        pr.dragging = true
        bridge().send("window:drag", "start")
      }
      if (pr.dragging) {
        bridge().send("window:drag", "move")
      }
      return
    }
    if (laserMode) {
      setLocalLaser(p)
      onLaser?.(p)
      return
    }
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

  const sendButton = (e: ReactPointerEvent, kind: "down" | "up", p: LaserPoint) =>
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
      if (pr.dragging) {
        bridge().send("window:drag", "end")
      } else if (interactive && !laserMode) {
        sendButton(e, "down", pr.p)
        sendButton(e, "up", pr.p)
      }
      return
    }
    if (laserMode || !interactive) return
    if (kind === "down") (e.currentTarget as HTMLElement).focus()
    sendButton(e, kind, point(e))
  }

  const onPointerLeave = () => {
    if (laserMode) {
      setLocalLaser(null)
      onLaser?.(null)
    } else if (interactive) bridge().send("stage:input", { kind: "leave" })
  }

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!interactive || laserMode) return
    const r = e.currentTarget.getBoundingClientRect()
    bridge().send("stage:input", {
      kind: "wheel",
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
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

  const shownLaser = laserMode ? localLaser : laser

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
            cursor: laserMode ? "none" : interactive ? cursor : "default",
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
            <div
              className={cn(
                "pointer-events-none absolute inset-0",
                screen === "black" ? "bg-black" : "bg-white",
                translucentScreen && "opacity-85",
              )}
            />
          )}
          {shownLaser && <LaserDot point={shownLaser} />}
        </div>
      </div>
    </div>
  )
}

function LaserDot({ point }: { point: LaserPoint }) {
  return (
    <div
      className="pointer-events-none absolute size-[1.6cqh] min-h-2.5 min-w-2.5 -translate-1/2 rounded-full"
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        background: "radial-gradient(circle, #ff5a4f 0%, #ff2d20 45%, rgba(255,45,32,0) 72%)",
        boxShadow: "0 0 1.2cqh 0.4cqh rgba(255, 40, 30, 0.55)",
      }}
    />
  )
}
