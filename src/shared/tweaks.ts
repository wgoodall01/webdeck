/**
 * Tweaks: author-declared knobs on a deck (colors, toggles, copy variants).
 *
 * Claude Design emits them in two shapes, both normalized to `TweakSchema`:
 *
 *  - Design Components (`.dc.html`): root-component props declared as JSON in
 *    `<script data-dc-script data-props='{"accent":{"default":"#f00"}}'>`,
 *    applied live through the runtime's `window.__dcSetProps(root, values)`.
 *  - Legacy HTML decks: a `/*EDITMODE-BEGIN*\/{…}/*EDITMODE-END*\/` JSON block of
 *    defaults in the page source. There is no live setter, so values are
 *    applied by rewriting the block and reloading the page.
 */

export type TweakValue =
  | string
  | number
  | boolean
  | null
  | TweakValue[]
  | { [k: string]: TweakValue }
export type TweakValues = Record<string, TweakValue>

export type TweakControl =
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "color" }
  | { kind: "select"; options: { value: string | number; label: string }[] }
  | { kind: "text"; multiline: boolean }
  | { kind: "json" }

export interface TweakField {
  key: string
  label: string
  description?: string
  control: TweakControl
  default: TweakValue
}

export type TweakSource = "dc-props" | "edit-mode"

export interface TweakSchema {
  source: TweakSource
  fields: TweakField[]
}

const COLOR_RE =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(.*\))$/i

export function isColorString(v: unknown): v is string {
  return typeof v === "string" && COLOR_RE.test(v.trim())
}

/** "accentColor" / "accent_color" / "accent-color" → "Accent color". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

type Meta = Record<string, unknown>

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function readOptions(meta: Meta): { value: string | number; label: string }[] | null {
  const raw = meta.options ?? meta.enum ?? meta.choices ?? meta.values
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: { value: string | number; label: string }[] = []
  for (const o of raw) {
    if (typeof o === "string" || typeof o === "number") out.push({ value: o, label: String(o) })
    else if (o && typeof o === "object" && "value" in o) {
      const value = (o as Meta).value
      if (typeof value !== "string" && typeof value !== "number") continue
      const label = (o as Meta).label
      out.push({ value, label: typeof label === "string" ? label : String(value) })
    }
  }
  return out.length ? out : null
}

function inferControl(meta: Meta, value: TweakValue): TweakControl {
  const declared = typeof meta.type === "string" ? meta.type.toLowerCase() : null
  const options = readOptions(meta)
  if (options || declared === "select" || declared === "enum") {
    return { kind: "select", options: options ?? [] }
  }
  if (declared === "color" || (declared === null && isColorString(value))) return { kind: "color" }
  if (declared === "boolean" || declared === "bool" || typeof value === "boolean") {
    return { kind: "boolean" }
  }
  if (declared === "number" || declared === "range" || typeof value === "number") {
    return {
      kind: "number",
      min: asNumber(meta.min),
      max: asNumber(meta.max),
      step: asNumber(meta.step),
    }
  }
  if (declared === "json" || (value !== null && typeof value === "object")) return { kind: "json" }
  const text = typeof value === "string" ? value : ""
  return {
    kind: "text",
    multiline: declared === "textarea" || declared === "multiline" || text.includes("\n"),
  }
}

function field(key: string, meta: Meta, value: TweakValue): TweakField {
  return {
    key,
    label: typeof meta.label === "string" ? meta.label : humanizeKey(key),
    description: typeof meta.description === "string" ? meta.description : undefined,
    control: inferControl(meta, value),
    default: value,
  }
}

/**
 * Normalize Design Component `propsMeta` (`{ key: { default, type?, … } }`).
 * Entries without a `default` are still exposed (as empty text) so authors
 * who declare a prop but no default can still drive it.
 */
export function schemaFromDcProps(raw: unknown): TweakSchema | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const fields: TweakField[] = []
  for (const [key, m] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith("$")) continue
    const meta: Meta =
      m && typeof m === "object" && !Array.isArray(m) ? (m as Meta) : { default: m }
    const value = (meta.default ?? null) as TweakValue
    fields.push(field(key, meta, value))
  }
  return fields.length ? { source: "dc-props", fields } : null
}

/** Normalize an EDITMODE defaults object (`{ key: value }`, no metadata). */
export function schemaFromEditMode(defaults: TweakValues): TweakSchema | null {
  const fields = Object.entries(defaults).map(([k, v]) => field(k, {}, v))
  return fields.length ? { source: "edit-mode", fields } : null
}

export function defaultValues(schema: TweakSchema): TweakValues {
  return Object.fromEntries(schema.fields.map((f) => [f.key, f.default]))
}

// ── EDITMODE source blocks ────────────────────────────────────────────────

const EDIT_BEGIN = "/*EDITMODE-BEGIN*/"
const EDIT_END = "/*EDITMODE-END*/"

export interface EditModeBlock {
  start: number
  end: number
  values: TweakValues
}

/** Locate and parse the EDITMODE block. Returns null if absent or not JSON. */
export function findEditModeBlock(source: string): EditModeBlock | null {
  const b = source.indexOf(EDIT_BEGIN)
  if (b === -1) return null
  const start = b + EDIT_BEGIN.length
  const end = source.indexOf(EDIT_END, start)
  if (end === -1) return null
  try {
    const parsed: unknown = JSON.parse(source.slice(start, end))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return { start, end, values: parsed as TweakValues }
  } catch {
    return null
  }
}

/** Rewrite the EDITMODE block with `overrides` merged over its defaults. */
export function applyEditModeOverrides(source: string, overrides: TweakValues): string {
  const block = findEditModeBlock(source)
  if (!block) return source
  const merged = JSON.stringify({ ...block.values, ...overrides })
  return source.slice(0, block.start) + merged + source.slice(block.end)
}
