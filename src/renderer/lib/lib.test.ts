import { describe, expect, it } from "vitest"

import { navForKey } from "./keys"
import { notePreview } from "./markdown"
import { formatDuration, stopwatch } from "./time"

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBe("0:00")
    expect(formatDuration(75_000)).toBe("1:15")
    expect(formatDuration(3_725_000)).toBe("1:02:05")
    expect(formatDuration(-5)).toBe("0:00")
  })
})

describe("stopwatch", () => {
  it("accumulates across pauses", () => {
    let sw = stopwatch.started(0)
    expect(stopwatch.elapsed(sw, 1000)).toBe(1000)
    sw = stopwatch.pause(sw, 1000)
    expect(stopwatch.elapsed(sw, 5000)).toBe(1000)
    sw = stopwatch.resume(sw, 5000)
    expect(stopwatch.elapsed(sw, 6000)).toBe(2000)
  })

  it("resets without changing run state", () => {
    const running = stopwatch.reset(stopwatch.started(0), 3000)
    expect(stopwatch.elapsed(running, 4000)).toBe(1000)
    const paused = stopwatch.reset(stopwatch.pause(stopwatch.started(0), 10), 3000)
    expect(stopwatch.elapsed(paused, 9000)).toBe(0)
  })
})

describe("navForKey", () => {
  it("covers keyboard and clicker keys", () => {
    for (const k of ["ArrowRight", "PageDown", " ", "Enter"]) {
      expect(navForKey(k)).toEqual({ type: "step", dir: 1 })
    }
    for (const k of ["ArrowLeft", "PageUp", "Backspace"]) {
      expect(navForKey(k)).toEqual({ type: "step", dir: -1 })
    }
    expect(navForKey(" ", true)).toEqual({ type: "step", dir: -1 })
    expect(navForKey("Home")).toEqual({ type: "goTo", index: 0 })
    expect(navForKey("x")).toBeNull()
  })
})

describe("notePreview", () => {
  it("strips Markdown down to plain text", () => {
    expect(notePreview("Sunset is at **4:12pm**, mostly *after* dark.")).toBe(
      "Sunset is at 4:12pm, mostly after dark.",
    )
    expect(notePreview("\n\n- Use `pnpm dev` and [the docs](https://x.y)")).toBe(
      "Use pnpm dev and the docs",
    )
    expect(notePreview("## Heading\nbody")).toBe("Heading")
    expect(notePreview("")).toBe("")
  })
})
