import { useEffect, useLayoutEffect, useRef, useState } from "react"

import type { AppState } from "@shared/ipc"

import { SlideSurface } from "@/components/slide-surface"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { isTypingTarget, navForKey } from "@/lib/keys"
import { bridge } from "@/lib/webdeck"

import { NotesPanel } from "./notes-panel"
import { PresenterToolbar } from "./toolbar"
import { SlideList } from "./slide-list"
import { TimersPanel } from "./timers-panel"
import { TweaksPanel } from "./tweaks-panel"

export type PresentingState = Extract<AppState, { phase: "presenting" }>

/**
 * The presenter console.
 *
 *   ┌──────────────── toolbar ────────────────┐
 *   │ live preview        │ timers · up next  │
 *   │─────────────────────│ notes             │
 *   │ slide list          │ tweaks            │
 *   └─────────────────────┴───────────────────┘
 */
export function Presenter({ state }: { state: PresentingState }) {
  const { deck, index, screen, tweaks } = state
  const [laser, setLaser] = useState(false)
  const aspect = deck.width / deck.height
  const slide = deck.slides[index]
  useShortcuts(state, laser, setLaser)

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <PresenterToolbar state={state} laser={laser} onLaser={setLaser} />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="62%" minSize="35%">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="62%" minSize="25%" className="p-4 pb-3">
              <SlideSurface
                aspect={aspect}
                screen={screen}
                interactive={!laser}
                laserMode={laser}
                onLaser={(p) => bridge().send("laser", p)}
                translucentScreen
                showFocus
                className="rounded-lg"
              />
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
 * Presenter keyboard: PowerPoint/Keynote-style navigation (plus clicker
 * keys), digits + Enter to jump, B/W (or . and ,) for black/white screen,
 * L for the laser, F to fullscreen the audience window.
 */
function useShortcuts(state: PresentingState, laser: boolean, setLaser: (v: boolean) => void) {
  const typed = useRef("")
  const typedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ state, laser })
  useLayoutEffect(() => {
    latest.current = { state, laser }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || e.metaKey || e.ctrlKey) return
      const { state: s, laser: on } = latest.current
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
        if (on) api.send("laser", null)
        setLaser(!on)
      } else if (e.key === "f" || e.key === "F") {
        api.send("audience:set", { fullscreen: !s.audience.fullscreen })
      } else if (e.key === "Escape" && s.screen !== "normal") {
        api.send("screen", "normal")
      } else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setLaser])
}
