import { describe, expect, it } from "vitest"

import { normalizeArchivePath } from "../deck/files"
import { parseRange } from "./range"

describe("parseRange", () => {
  it("parses explicit, open-ended, and suffix ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 })
  })

  it("rejects unsatisfiable ranges", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable")
    expect(parseRange("bytes=5-2", 1000)).toBe("unsatisfiable")
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable")
  })

  it("ignores absent or malformed headers", () => {
    expect(parseRange(null, 10)).toBeNull()
    expect(parseRange("items=0-1", 10)).toBeNull()
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull()
  })
})

describe("normalizeArchivePath", () => {
  it("normalizes separators and dot segments", () => {
    expect(normalizeArchivePath("/assets/./logo.svg")).toBe("assets/logo.svg")
    expect(normalizeArchivePath("a\\b\\c.png")).toBe("a/b/c.png")
    expect(normalizeArchivePath("a/b/../c")).toBe("a/c")
  })

  it("refuses to escape the archive root", () => {
    expect(normalizeArchivePath("../secret")).toBeNull()
    expect(normalizeArchivePath("a/../../b")).toBeNull()
  })
})
