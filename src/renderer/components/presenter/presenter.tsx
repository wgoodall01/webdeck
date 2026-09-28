import { useEffect, useLayoutEffect, useRef, useState } from "react"

import type { AppState, MarkerPoint } from "@shared/ipc"

import { SlideSurface } from "@/components/slide-surface"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { isTypingTarget, navForKey } from "@/lib/keys"
import { bridge } from "@/lib/webdeck"

import { NotesPanel } from "./notes-panel"
import { PresenterTitleBar, SlideControls } from "./toolbar"
import { SlideList } from "./slide-list"
import { TimersPanel } from "./timers-panel"
import { TweaksPanel } from "./tweaks-panel"

export type PresentingState = Extract<AppState, { phase: "presenting" }>

/**
 * The presenter console.
 *
 *   ┌──────────────── title bar ──────────────┐
 *   │ live preview        │ timers · up next  │
 *   │ slide controls      │───────────────────│
 *   │─────────────────────│ notes             │
 *   │ slide list          │ tweaks            │
 *   └─────────────────────┴───────────────────┘
 */
export function Presenter({ state }: { state: PresentingState }) {
  const { deck, index, screen, tweaks } = state
  const aspect = deck.width / deck.height
  const slide = deck.slides[index]
  const marker = useMarker()
  useShortcuts(state, marker.on, marker.setOn)

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <PresenterTitleBar state={state} />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="62%" minSize="35%">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="62%" minSize="25%">
              <div className="flex h-full flex-col p-4 pb-3">
                <SlideSurface
                  aspect={aspect}
                  screen={screen}
                  interactive
                  onHover={marker.hover}
                  marker={marker.point}
                  screenCaption={
                    screen === "black"
                      ? "Black screen · B to return"
                      : screen === "white"
                        ? "White screen · W to return"
                        : undefined
                  }
                  showFocus
                  className="min-h-0 flex-1"
                />
                <SlideControls state={state} markerOn={marker.on} onMarker={marker.setOn} />
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel minSize="15%">
              <SlideList deck={deck} index={index} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="38%" minSize="22%">
          <div className="flex h-full flex-col">
            <TimersPanel deck={deck} index={index} />
            <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
              <ResizablePanel minSize="20%">
                <NotesPanel key={index} notes={slide?.notes ?? ""} label={slide?.label ?? ""} />
              </ResizablePanel>
              {tweaks && (
                <>
                  <ResizableHandle />
                  <ResizablePanel defaultSize="40%" minSize="12%">
                    <TweaksPanel tweaks={tweaks} />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

/**
 * The hover marker: while on, wherever the presenter hovers the preview is
 * shown as a dot on both the preview and the audience window.
 */
function useMarker() {
  const [on, setOnState] = useState(true)
  const [point, setPoint] = useState<MarkerPoint | null>(null)
  const onRef = useRef(on)
  const hover = (p: MarkerPoint | null) => {
    if (!onRef.current) return
    setPoint(p)
    bridge().send("marker", p)
  }
  const setOn = (v: boolean) => {
    onRef.current = v
    setOnState(v)
    if (!v) {
      setPoint(null)
      bridge().send("marker", null)
    }
  }
  return { on, setOn, hover, point: on ? point : null }
}

/**
 * Presenter keyboard: PowerPoint/Keynote-style navigation (plus clicker
 * keys), digits + Enter to jump, B/W (or . and ,) for black/white screen,
 * L to toggle the hover marker, F to fullscreen the audience window.
 */
function useShortcuts(state: PresentingState, markerOn: boolean, setMarker: (v: boolean) => void) {
  const typed = useRef("")
  const typedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ state, markerOn, setMarker })
  useLayoutEffect(() => {
    latest.current = { state, markerOn, setMarker }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || e.metaKey || e.ctrlKey) return
      const { state: s, markerOn: on, setMarker: set } = latest.current
      const api = bridge()
      if (/^[0-9]$/.test(e.key)) {
        typed.current += e.key
        clearTimeout(typedTimer.current)
        typedTimer.current = setTimeout(() => (typed.current = ""), 1500)
        e.preventDefault()
        return
      }
      if (e.key === "Enter" && typed.current) {
        api.send("nav", { type: "goTo", index: Number(typed.current) - 1 })
        typed.current = ""
        e.preventDefault()
        return
      }
      const nav = navForKey(e.key, e.shiftKey)
      if (nav) api.send("nav", nav)
      else if (e.key === "b" || e.key === "B" || e.key === ".") {
        api.send("screen", s.screen === "black" ? "normal" : "black")
      } else if (e.key === "w" || e.key === "W" || e.key === ",") {
        api.send("screen", s.screen === "white" ? "normal" : "white")
      } else if (e.key === "l" || e.key === "L") {
        set(!on)
      } else if (e.key === "f" || e.key === "F") {
        api.send("audience:set", { fullscreen: !s.audience.fullscreen })
      } else if (e.key === "Escape" && s.screen !== "normal") {
        api.send("screen", "normal")
      } else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
