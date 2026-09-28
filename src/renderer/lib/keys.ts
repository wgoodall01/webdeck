import type { Modifier, StageKeyInput } from "@shared/input"
import type { NavCommand } from "@shared/ipc"

export function modifiersOf(e: {
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}): Modifier[] {
  const m: Modifier[] = []
  if (e.shiftKey) m.push("shift")
  if (e.ctrlKey) m.push("control")
  if (e.altKey) m.push("alt")
  if (e.metaKey) m.push("meta")
  return m
}

/** True when the event target is somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === "TEXTAREA" || tag === "SELECT") return true
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type
    return !["checkbox", "radio", "button", "range", "color"].includes(type)
  }
  return false
}

/**
 * Slide navigation keys, shared by the presenter and audience windows —
 * including what presentation clickers send (PageUp/PageDown).
 */
export function navForKey(key: string, shift = false): NavCommand | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case "Enter":
    case "n":
    case "N":
      return { type: "step", dir: 1 }
    case " ":
      return { type: "step", dir: shift ? -1 : 1 }
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
    case "p":
    case "P":
      return { type: "step", dir: -1 }
    case "Home":
      return { type: "goTo", index: 0 }
    case "End":
      return { type: "goTo", index: Number.MAX_SAFE_INTEGER }
    default:
      return null
  }
}

const NAMED: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Escape: "Escape",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Tab: "Tab",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
}

/** DOM keyboard event → Electron key input(s) for the slide page. */
export function toStageKeys(e: KeyboardEvent, type: "keyDown" | "keyUp"): StageKeyInput[] {
  const modifiers = modifiersOf(e)
  const keyCode = NAMED[e.key] ?? (e.key.length === 1 ? e.key : null)
  if (!keyCode) return []
  const out: StageKeyInput[] = [{ kind: type, keyCode, modifiers }]
  // Printable keys also need a `char` event for text to be inserted.
  if (type === "keyDown" && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
    out.push({ kind: "char", keyCode: e.key, modifiers })
  }
  return out
}
