import { describe, expect, it } from "vitest"

import { cssCursor } from "./cursor"

describe("cssCursor", () => {
  it("translates Electron's names, which differ from CSS", () => {
    expect(cssCursor("pointer")).toBe("default") // Electron's arrow
    expect(cssCursor("hand")).toBe("pointer") // Electron's link hand
    expect(cssCursor("text")).toBe("text")
    expect(cssCursor("something-new")).toBe("default")
  })
})
