import { describe, expect, it } from "vitest"

import { clampIndex, stepIndex, type SlideInfo } from "./deck"
import { toElectronInput } from "./input"

describe("toElectronInput", () => {
  it("maps normalized coordinates onto the viewport", () => {
    expect(
      toElectronInput(
        { kind: "down", x: 0.5, y: 0.5, button: "left", clickCount: 1, modifiers: [] },
        1920,
        1080,
      ),
    ).toEqual({
      type: "mouseDown",
      x: 960,
      y: 540,
      button: "left",
      clickCount: 1,
      modifiers: [],
    })
  })

  it("clamps out-of-bounds points to the edge", () => {
    const ev = toElectronInput({ kind: "move", x: 1.4, y: -0.2, modifiers: [] }, 100, 50)
    expect(ev).toMatchObject({ type: "mouseMove", x: 99, y: 0 })
  })

  it("flips wheel deltas into Chromium's convention", () => {
    const ev = toElectronInput(
      { kind: "wheel", x: 0, y: 0, deltaX: 3, deltaY: 40, modifiers: [] },
      100,
      100,
    )
    expect(ev).toMatchObject({ type: "mouseWheel", deltaX: -3, deltaY: -40 })
  })

  it("passes keys through", () => {
    expect(toElectronInput({ kind: "char", keyCode: "a", modifiers: ["shift"] }, 1, 1)).toEqual({
      type: "char",
      keyCode: "a",
      modifiers: ["shift"],
    })
  })
})

describe("slide stepping", () => {
  const slides: SlideInfo[] = [0, 1, 2, 3].map((index) => ({
    index,
    label: "",
    notes: "",
    skipped: index === 2,
  }))

  it("skips skipped slides", () => {
    expect(stepIndex(slides, 1, 1)).toBe(3)
    expect(stepIndex(slides, 3, -1)).toBe(1)
  })

  it("returns null at the ends", () => {
    expect(stepIndex(slides, 3, 1)).toBeNull()
    expect(stepIndex(slides, 0, -1)).toBeNull()
  })

  it("clamps indices", () => {
    expect(clampIndex(slides, 99)).toBe(3)
    expect(clampIndex(slides, -4)).toBe(0)
  })
})
