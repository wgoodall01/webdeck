import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { app, BrowserWindow } from "electron"

import type { AppController } from "./app-controller"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * End-to-end smoke run (`WEBDECK_SMOKE=<out dir> electron . <deck>`): opens
 * the deck, screenshots every window as it presents, steps through a few
 * slides, then quits. Exercises the real GPU texture path, which unit tests
 * can't.
 */
export async function runSmoke(controller: AppController, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const log: string[] = []
  const shoot = async (tag: string) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isVisible()) continue
      const name = w.webContents.getURL().includes("/audience") ? "audience" : "presenter"
      const img = await w.webContents.capturePage()
      writeFileSync(join(outDir, `${tag}-${name}.png`), img.toPNG())
    }
  }
  /** Fraction of non-black pixels: in the audience window, or the presenter's preview area. */
  const lit = async (w: BrowserWindow) => {
    const audienceWin = w.webContents.getURL().includes("/audience")
    const [cw = 0, ch = 0] = w.getContentSize()
    const rect = audienceWin
      ? undefined
      : {
          x: Math.round(cw * 0.08),
          y: Math.round(ch * 0.15),
          width: Math.round(cw * 0.45),
          height: Math.round(ch * 0.3),
        }
    const bmp = (await w.webContents.capturePage(rect)).toBitmap()
    let on = 0
    for (let i = 0; i < bmp.length; i += 16) {
      if ((bmp[i] ?? 0) + (bmp[i + 1] ?? 0) + (bmp[i + 2] ?? 0) > 90) on++
    }
    return Math.round((on / (bmp.length / 16)) * 100)
  }
  const litReport = async (tag: string) => {
    const parts: string[] = []
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isVisible()) continue
      const name = w.webContents.getURL().includes("/audience") ? "audience" : "preview"
      parts.push(`${name}=${await lit(w)}%`)
    }
    log.push(`lit ${tag}: ${parts.join(" ")}`)
  }
  const waitFor = async (pred: () => boolean, ms: number) => {
    const end = Date.now() + ms
    while (!pred() && Date.now() < end) await sleep(100)
    return pred()
  }
  try {
    if (!(await waitFor(() => controller.state().phase === "presenting", 60_000))) {
      log.push(`never presented: ${JSON.stringify(controller.state())}`)
      return
    }
    await sleep(4000) // let thumbnails trickle in
    await shoot("01-open")
    await litReport("at open")
    const wins = BrowserWindow.getAllWindows().filter((w) => w.isVisible())
    const aud = wins.find((w) => w.webContents.getURL().includes("/audience"))
    const pres = wins.find((w) => !w.webContents.getURL().includes("/audience"))
    if (aud) {
      const b = aud.getBounds()
      aud.setBounds({ ...b, width: b.width + 240, height: b.height + 135 })
      await sleep(800)
      await litReport("after audience resize")
    }
    if (pres) {
      const b = pres.getBounds()
      pres.setBounds({ ...b, width: b.width - 200, height: b.height - 100 })
      await sleep(800)
      await litReport("after presenter resize")
      await shoot("01a-resized")
    }
    const s = controller.state()
    if (s.phase === "presenting") {
      log.push(
        `deck ${s.deck.title} ${s.deck.width}x${s.deck.height} slides=${s.deck.slides.length}`,
      )
      log.push(`tweaks=${s.tweaks ? s.tweaks.schema.fields.map((f) => f.key).join(",") : "none"}`)
    }
    if (s.phase === "presenting" && s.tweaks) {
      const patch: Record<string, string> = {}
      for (const f of s.tweaks.schema.fields) {
        if (f.control.kind === "color") patch[f.key] = "#3926d3"
        else if (f.control.kind === "text") patch[f.key] = "Tweaked live"
      }
      controller.command("tweaks:set", patch)
      await sleep(2500)
      await shoot("01b-tweaked")
      log.push(`applied tweaks ${JSON.stringify(patch)}`)
    }
    for (const n of [1, 2]) {
      controller.command("nav", { type: "step", dir: 1 })
      await sleep(1500)
      const st = controller.state()
      log.push(`after step ${n}: index=${st.phase === "presenting" ? st.index : "?"}`)
    }
    await shoot("02-stepped")
    const audience = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes("/audience"),
    )
    if (audience) {
      // Drag distance needs a real cursor (main reads the OS pointer), so only
      // check the click path: a press without movement must not move the window.
      const wc = audience.webContents
      const before = audience.getBounds()
      wc.sendInputEvent({ type: "mouseDown", x: 100, y: 100, button: "left", clickCount: 1 })
      wc.sendInputEvent({ type: "mouseUp", x: 100, y: 100, button: "left", clickCount: 1 })
      await sleep(300)
      for (const [x, y] of [
        [50, 50],
        [300, 300],
        [600, 400],
        [900, 500],
      ] as const) {
        wc.sendInputEvent({ type: "mouseMove", x, y })
        await sleep(200)
      }
      const after = audience.getBounds()
      log.push(`click: moved ${after.x - before.x},${after.y - before.y}`)
    }
    controller.command("screen", "black")
    await sleep(500)
    await shoot("03-black")
    controller.command("screen", "normal")
  } catch (err) {
    log.push(`error: ${String(err)}`)
  } finally {
    writeFileSync(join(outDir, "smoke.log"), log.join("\n") + "\n")
    app.quit()
  }
}
