/**
 * Map Electron `cursor-changed` types onto CSS cursor values.
 *
 * Careful: Electron's names aren't CSS's. Its `pointer` is the plain arrow
 * and `hand` is the link cursor (CSS `pointer`).
 */
const CURSORS: Record<string, string> = {
  default: "default",
  pointer: "default",
  hand: "pointer",
  text: "text",
  crosshair: "crosshair",
  wait: "wait",
  help: "help",
  move: "move",
  progress: "progress",
  "not-allowed": "not-allowed",
  "context-menu": "context-menu",
  cell: "cell",
  "vertical-text": "vertical-text",
  alias: "alias",
  copy: "copy",
  "no-drop": "no-drop",
  grab: "grab",
  grabbing: "grabbing",
  "zoom-in": "zoom-in",
  "zoom-out": "zoom-out",
  "col-resize": "col-resize",
  "row-resize": "row-resize",
  "e-resize": "e-resize",
  "n-resize": "n-resize",
  "ne-resize": "ne-resize",
  "nw-resize": "nw-resize",
  "s-resize": "s-resize",
  "se-resize": "se-resize",
  "sw-resize": "sw-resize",
  "w-resize": "w-resize",
  "ew-resize": "ew-resize",
  "ns-resize": "ns-resize",
  "nesw-resize": "nesw-resize",
  "nwse-resize": "nwse-resize",
  none: "none",
}

export function cssCursor(electronType: string): string {
  return CURSORS[electronType] ?? "default"
}
