import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import type { LaserPoint } from "@shared/ipc"

import { SlideSurface } from "@/components/slide-surface"
import { isTypingTarget, navForKey } from "@/lib/keys"
import { bridge, useAppState, useBridgeEvent } from "@/lib/webdeck"

export const Route = createFileRoute("/audience")({ component: Audience })

const IDLE_MS = 1800

/**
 * The audience window: the slide and nothing else. Drag anywhere to move it
 * (QuickTime-style), double-click for fullscreen; the cursor hides when idle.
 */
function Audience() {
  const state = useAppState()
  const [laser, setLaser] = useState<LaserPoint | null>(null)
  const [active, setActive] = useState(false)
  useBridgeEvent("laser", setLaser)

  useEffect(() => {
    document.documentElement.style.background = "#000"
    document.body.style.background = "#000"
    let t: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      setActive(true)
      clearTimeout(t)
      t = setTimeout(() => setActive(false), IDLE_MS)
    }
    window.addEventListener("pointermove", wake)
    return () => {
      window.removeEventListener("pointermove", wake)
      clearTimeout(t)
    }
  }, [])

  const presenting = state.phase === "presenting" ? state : null

  useEffect(() => {
    if (!presenting) return
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey) return
      const nav = navForKey(e.key, e.shiftKey)
      const api = bridge()
      if (nav) api.send("nav", nav)
      else if (e.key === "b" || e.key === "B" || e.key === ".") {
        api.send("screen", presenting.screen === "black" ? "normal" : "black")
      } else if (e.key === "w" || e.key === "W" || e.key === ",") {
        api.send("screen", presenting.screen === "white" ? "normal" : "white")
      } else if (e.key === "f" || e.key === "F") {
        api.send("audience:set", { fullscreen: !presenting.audience.fullscreen })
      } else if (e.key === "Escape" && presenting.audience.fullscreen) {
        api.send("audience:set", { fullscreen: false })
      } else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [presenting])

  if (!presenting) return <div className="fixed inset-0 bg-black" />

  const { deck, screen, audience } = presenting
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-black"
      style={{ cursor: active ? undefined : "none" }}
    >
      <SlideSurface
        aspect={deck.width / deck.height}
        screen={screen}
        interactive
        laser={laser}
        dragsWindow={!audience.fullscreen}
        onDoubleClick={() => bridge().send("audience:set", { fullscreen: !audience.fullscreen })}
      />
    </div>
  )
}
