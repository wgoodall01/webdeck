import {
  ArrowsInIcon,
  ArrowsOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  FolderOpenIcon,
  HandTapIcon,
  MonitorIcon,
  SquareIcon,
} from "@phosphor-icons/react"

import { stepIndex } from "@shared/deck"
import type { ScreenMode } from "@shared/ipc"

import { NoDrag, TitleBar } from "@/components/title-bar"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { bridge } from "@/lib/webdeck"

import type { PresentingState } from "./presenter"

function Tip({
  label,
  keys,
  children,
}: {
  label: string
  keys?: string
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        {label}
        {keys && <Kbd className="ml-1.5">{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/** Window title bar: deck title, where the audience window is, open. */
export function PresenterTitleBar({ state }: { state: PresentingState }) {
  const { deck, audience, displays } = state
  const api = bridge()
  return (
    <TitleBar>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{deck.title}</span>
      <NoDrag>
        {audience.open ? (
          <>
            {displays.length > 1 && (
              <Select
                value={audience.displayId ?? undefined}
                onValueChange={(id) => id != null && api.send("audience:set", { displayId: id })}
              >
                <SelectTrigger size="sm" className="w-44">
                  <MonitorIcon />
                  <SelectValue>
                    {(id: number) => displays.find((d) => d.id === id)?.label ?? "Display"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {displays.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                      <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                        {d.width}×{d.height}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Tip label={audience.fullscreen ? "Exit fullscreen" : "Fullscreen audience"} keys="F">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => api.send("audience:set", { fullscreen: !audience.fullscreen })}
              >
                {audience.fullscreen ? <ArrowsInIcon /> : <ArrowsOutIcon />}
              </Button>
            </Tip>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => api.send("audience:set", { open: true })}
          >
            <MonitorIcon data-icon="inline-start" />
            Show audience window
          </Button>
        )}
        <Tip label="Open another deck" keys="⌘O">
          <Button variant="ghost" size="icon-sm" onClick={() => api.send("app:open")}>
            <FolderOpenIcon />
          </Button>
        </Tip>
      </NoDrag>
    </TitleBar>
  )
}

/** Slide controls, directly under the preview. */
export function SlideControls({
  state,
  markerOn,
  onMarker,
}: {
  state: PresentingState
  markerOn: boolean
  onMarker: (on: boolean) => void
}) {
  const { deck, index, screen } = state
  const api = bridge()
  const setScreen = (mode: ScreenMode) => api.send("screen", screen === mode ? "normal" : mode)
  const visible = deck.slides.filter((s) => !s.skipped).length
  const position = deck.slides.slice(0, index + 1).filter((s) => !s.skipped).length

  return (
    <div className="flex shrink-0 items-center justify-center gap-1 pt-2.5">
      <Tip label="Previous" keys="←">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={stepIndex(deck.slides, index, -1) === null}
          onClick={() => api.send("nav", { type: "step", dir: -1 })}
        >
          <CaretLeftIcon />
        </Button>
      </Tip>
      <span className="min-w-16 text-center font-mono text-xs text-muted-foreground tabular-nums">
        {deck.slides[index]?.skipped ? "–" : position} / {visible}
      </span>
      <Tip label="Next" keys="→">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={stepIndex(deck.slides, index, 1) === null}
          onClick={() => api.send("nav", { type: "step", dir: 1 })}
        >
          <CaretRightIcon />
        </Button>
      </Tip>

      <Separator orientation="vertical" className="mx-2 h-5" />

      <Tip label="Black screen" keys="B">
        <Toggle size="sm" pressed={screen === "black"} onPressedChange={() => setScreen("black")}>
          <SquareIcon weight="fill" />
        </Toggle>
      </Tip>
      <Tip label="White screen" keys="W">
        <Toggle size="sm" pressed={screen === "white"} onPressedChange={() => setScreen("white")}>
          <SquareIcon />
        </Toggle>
      </Tip>
      <Tip label="Show pointer to audience" keys="L">
        <Toggle size="sm" pressed={markerOn} onPressedChange={onMarker}>
          <HandTapIcon />
        </Toggle>
      </Tip>
    </div>
  )
}
