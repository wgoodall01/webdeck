import { describe, expect, it } from "vitest"

import {
  applyEditModeOverrides,
  defaultValues,
  findEditModeBlock,
  humanizeKey,
  isColorString,
  schemaFromDcProps,
  schemaFromEditMode,
} from "./tweaks"

describe("schemaFromDcProps", () => {
  it("infers controls from defaults and metadata", () => {
    const schema = schemaFromDcProps({
      accentColor: { default: "#f72ca6" },
      showGrid: { default: true },
      density: { default: 2, min: 1, max: 3, step: 1 },
      scale: { default: 1.5 },
      layout: { default: "wide", options: ["wide", { value: "tall", label: "Tall" }] },
      title: { default: "Hello", label: "Headline", description: "Cover title" },
      body: { default: "a\nb" },
      data: { default: { a: 1 } },
      $preview: { width: 100 },
    })
    expect(schema?.source).toBe("dc-props")
    const byKey = Object.fromEntries(schema!.fields.map((f) => [f.key, f]))
    expect(byKey.accentColor?.control).toEqual({ kind: "color" })
    expect(byKey.accentColor?.label).toBe("Accent color")
    expect(byKey.showGrid?.control).toEqual({ kind: "boolean" })
    expect(byKey.density?.control).toEqual({ kind: "number", min: 1, max: 3, step: 1 })
    expect(byKey.scale?.control.kind).toBe("number")
    expect(byKey.layout?.control).toEqual({
      kind: "select",
      options: [
        { value: "wide", label: "wide" },
        { value: "tall", label: "Tall" },
      ],
    })
    expect(byKey.title?.label).toBe("Headline")
    expect(byKey.title?.description).toBe("Cover title")
    expect(byKey.body?.control).toEqual({ kind: "text", multiline: true })
    expect(byKey.data?.control).toEqual({ kind: "json" })
    expect(byKey.$preview).toBeUndefined()
  })

  it("accepts bare values as defaults", () => {
    const schema = schemaFromDcProps({ n: 3 })
    expect(schema?.fields[0]?.default).toBe(3)
  })

  it("returns null for nothing usable", () => {
    expect(schemaFromDcProps(null)).toBeNull()
    expect(schemaFromDcProps([])).toBeNull()
    expect(schemaFromDcProps({})).toBeNull()
  })

  it("respects a declared type over inference", () => {
    const schema = schemaFromDcProps({ c: { default: "red", type: "color" } })
    expect(schema?.fields[0]?.control).toEqual({ kind: "color" })
  })
})

describe("EDITMODE blocks", () => {
  const src = `const T = /*EDITMODE-BEGIN*/{"accent":"#ff0000","dark":false}/*EDITMODE-END*/;`

  it("finds and parses the block", () => {
    expect(findEditModeBlock(src)?.values).toEqual({ accent: "#ff0000", dark: false })
    expect(findEditModeBlock("nothing here")).toBeNull()
    expect(findEditModeBlock("/*EDITMODE-BEGIN*/{not json/*EDITMODE-END*/")).toBeNull()
  })

  it("rewrites the block with overrides merged over defaults", () => {
    const out = applyEditModeOverrides(src, { dark: true })
    expect(findEditModeBlock(out)?.values).toEqual({ accent: "#ff0000", dark: true })
    expect(out.startsWith("const T = /*EDITMODE-BEGIN*/")).toBe(true)
    expect(out.endsWith("/*EDITMODE-END*/;")).toBe(true)
  })

  it("leaves sources without a block untouched", () => {
    expect(applyEditModeOverrides("x", { a: 1 })).toBe("x")
  })

  it("builds a schema and defaults", () => {
    const schema = schemaFromEditMode({ accent: "#fff", dark: false })
    expect(schema?.source).toBe("edit-mode")
    expect(defaultValues(schema!)).toEqual({ accent: "#fff", dark: false })
  })
})

describe("helpers", () => {
  it("humanizes keys", () => {
    expect(humanizeKey("accentColor")).toBe("Accent color")
    expect(humanizeKey("show_grid")).toBe("Show grid")
    expect(humanizeKey("font-size")).toBe("Font size")
  })

  it("recognizes colors", () => {
    for (const c of ["#fff", "#ffffff", "#ffffff80", "rgb(1,2,3)", "oklch(0.5 0.1 20)"]) {
      expect(isColorString(c)).toBe(true)
    }
    for (const c of ["red", "#ff", "hello", 3]) expect(isColorString(c)).toBe(false)
  })
})
