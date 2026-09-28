/**
 * Pointer input captured on a rendered slide surface (audience window or
 * presenter preview), expressed in normalized slide coordinates so the
 * surface's on-screen size never matters.
 */

export type PointerButton = "left" | "middle" | "right"
export type Modifier = "shift" | "control" | "alt" | "meta"

export type StagePointerInput =
  | {
      kind: "down" | "up"
      x: number
      y: number
      button: PointerButton
      clickCount: number
      modifiers: Modifier[]
    }
  | { kind: "move"; x: number; y: number; modifiers: Modifier[] }
  | { kind: "leave" }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers: Modifier[] }

export interface StageKeyInput {
  kind: "keyDown" | "keyUp" | "char"
  /** Electron accelerator-style key code (e.g. "a", "Enter", "Backspace"). */
  keyCode: string
  modifiers: Modifier[]
}

export type StageInput = StagePointerInput | StageKeyInput

/** Electron's `sendInputEvent` payloads, minus the electron import. */
export type ElectronInputEvent =
  | {
      type: "mouseDown" | "mouseUp" | "mouseMove" | "mouseLeave"
      x: number
      y: number
      button?: PointerButton
      clickCount?: number
      modifiers?: Modifier[]
    }
  | {
      type: "mouseWheel"
      x: number
      y: number
      deltaX: number
      deltaY: number
      canScroll: boolean
      modifiers?: Modifier[]
    }
  | { type: "keyDown" | "keyUp" | "char"; keyCode: string; modifiers?: Modifier[] }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Map normalized input onto a `width`×`height` CSS-pixel viewport. */
export function toElectronInput(
  input: StageInput,
  width: number,
  height: number,
): ElectronInputEvent {
  const px = (x: number) => Math.round(clamp01(x) * (width - 1))
  const py = (y: number) => Math.round(clamp01(y) * (height - 1))
  switch (input.kind) {
    case "down":
    case "up":
      return {
        type: input.kind === "down" ? "mouseDown" : "mouseUp",
        x: px(input.x),
        y: py(input.y),
        button: input.button,
        clickCount: input.clickCount,
        modifiers: input.modifiers,
      }
    case "move":
      return { type: "mouseMove", x: px(input.x), y: py(input.y), modifiers: input.modifiers }
    case "leave":
      return { type: "mouseLeave", x: 0, y: 0 }
    case "wheel":
      // DOM wheel deltas are "content moves down" positive; Chromium's
      // synthetic wheel events are "wheel ticks up" positive.
      return {
        type: "mouseWheel",
        x: px(input.x),
        y: py(input.y),
        deltaX: -input.deltaX,
        deltaY: -input.deltaY,
        canScroll: true,
        modifiers: input.modifiers,
      }
    case "keyDown":
    case "keyUp":
    case "char":
      return { type: input.kind, keyCode: input.keyCode, modifiers: input.modifiers }
  }
}
