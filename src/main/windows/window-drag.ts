import { BrowserWindow, screen, type WebContents } from "electron"

import type { CommandMap } from "@shared/ipc"

interface Drag {
  pointerX: number
  pointerY: number
  winX: number
  winY: number
  width: number
  height: number
}

const drags = new Map<number, Drag>()

/**
 * Move a window by dragging its content, QuickTime-style. The renderer
 * decides what counts as a drag (vs. a click on the slide); positions come
 * from the OS cursor, which stays correct across mixed-DPI displays where
 * renderer screen coordinates don't.
 */
export function handleWindowDrag(sender: WebContents, phase: CommandMap["window:drag"]): void {
  const win = BrowserWindow.fromWebContents(sender)
  if (!win || win.isDestroyed() || win.isFullScreen()) return
  const cursor = screen.getCursorScreenPoint()
  if (phase === "start") {
    const b = win.getBounds()
    drags.set(sender.id, {
      pointerX: cursor.x,
      pointerY: cursor.y,
      winX: b.x,
      winY: b.y,
      width: b.width,
      height: b.height,
    })
    return
  }
  const d = drags.get(sender.id)
  if (!d) return
  // setBounds (not setPosition) pins the size: moving between displays with
  // different scale factors must not resize the window.
  win.setBounds({
    x: Math.round(d.winX + cursor.x - d.pointerX),
    y: Math.round(d.winY + cursor.y - d.pointerY),
    width: d.width,
    height: d.height,
  })
  if (phase === "end") drags.delete(sender.id)
}
