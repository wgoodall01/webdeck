import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import type { MarkerPoint } from "@shared/ipc"

import { SlideSurface } from "@/components/slide-surface"
import { isTypingTarget, navForKey } from "@/lib/keys"
import { bridge, useAppState, useBridgeEvent } from "@/lib/webdeck"

export const Route = createFileRoute("/audience")({ component: Audience })

const IDLE_MS = 1800

/**
 * The audience window: the slide and nothing else. Drag anywhere to move it
 * (QuickTime-style), double-click for fullscreen. While the pointer is active
 * the traffic lights show; when idle, they and the cursor hide.
 */
function Audience() {
  const state = useAppState()
  const [marker, setMarker] = useState<MarkerPoint | null>(null)
  const [active, setActive] = useState(false)
  useBridgeEvent("marker", setMarker)

  useEffect(() => {
    document.documentElement.style.background = "#000"
    document.body.style.background = "#000"
    let t: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      setActive(true)
      clearTimeout(t)
      t = setTimeout(() => setActive(false), IDLE_MS)
    }
    const sleep = () => {
      clearTimeout(t)
      setActive(false)
    }
    window.addEventListener("pointermove", wake)
    document.documentElement.addEventListener("pointerleave", sleep)
    window.addEventListener("blur", sleep)
    return () => {
      window.removeEventListener("pointermove", wake)
      document.documentElement.removeEventListener("pointerleave", sleep)
      window.removeEventListener("blur", sleep)
      clearTimeout(t)
    }
  }, [])

  // Traffic lights follow pointer activity (macOS).
  useEffect(() => bridge().send("window:controls", active), [active])

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
        marker={marker}
        dragsWindow={!audience.fullscreen}
        onDoubleClick={() => bridge().send("audience:set", { fullscreen: !audience.fullscreen })}
      />
    </div>
  )
}
