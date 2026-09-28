import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import { useState } from "react"

import type { TweaksState } from "@shared/ipc"
import type { TweakField, TweakValue } from "@shared/tweaks"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { bridge } from "@/lib/webdeck"

/**
 * The deck's Tweaks, as presenter-only controls. Changes apply to the live
 * slide (and thumbnails); the deck's own Tweaks panel is never shown.
 */
export function TweaksPanel({ tweaks }: { tweaks: TweaksState }) {
  const { schema, values } = tweaks
  const set = (key: string, value: TweakValue) => bridge().send("tweaks:set", { [key]: value })
  return (
    <section className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 px-4">
        <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Tweaks
        </h2>
        {schema.source === "edit-mode" && (
          <Badge variant="outline" className="text-[10px]" title="Changes reload the deck">
            reloads
          </Badge>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={() => bridge().send("tweaks:reset")}
        >
          <ArrowCounterClockwiseIcon data-icon="inline-start" />
          Reset
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
        {schema.fields.map((f) => (
          <TweakControl key={f.key} field={f} value={values[f.key] ?? f.default} onChange={set} />
        ))}
      </div>
    </section>
  )
}

function TweakControl({
  field,
  value,
  onChange,
}: {
  field: TweakField
  value: TweakValue
  onChange: (key: string, v: TweakValue) => void
}) {
  const id = `tweak-${field.key}`
  const c = field.control
  const change = (v: TweakValue) => onChange(field.key, v)

  const header = (
    <div className="flex items-baseline justify-between gap-2">
      <Label htmlFor={id} className="text-sm">
        {field.label}
      </Label>
      {c.kind === "number" && (
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {String(value)}
        </span>
      )}
    </div>
  )
  const description = field.description && (
    <p className="text-xs text-muted-foreground">{field.description}</p>
  )

  switch (c.kind) {
    case "boolean":
      return (
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor={id} className="text-sm">
              {field.label}
            </Label>
            {description}
          </div>
          <Switch id={id} checked={value === true} onCheckedChange={(v) => change(v)} />
        </div>
      )
    case "number": {
      const n = typeof value === "number" ? value : Number(value) || 0
      return (
        <div className="space-y-2">
          {header}
          {c.min !== undefined && c.max !== undefined ? (
            <Slider
              id={id}
              min={c.min}
              max={c.max}
              step={c.step ?? ((c.max - c.min) / 100 || 1)}
              value={[n]}
              onValueChange={(v) => change(Array.isArray(v) ? (v[0] ?? n) : v)}
            />
          ) : (
            <Input
              id={id}
              type="number"
              step={c.step ?? "any"}
              value={n}
              onChange={(e) => e.target.value !== "" && change(Number(e.target.value))}
            />
          )}
          {description}
        </div>
      )
    }
    case "color":
      return (
        <div className="space-y-2">
          {header}
          <ColorInput id={id} value={String(value ?? "")} onChange={change} />
          {description}
        </div>
      )
    case "select":
      return (
        <div className="space-y-2">
          {header}
          {/* Option values may be numbers; the select works in strings. */}
          <Select
            value={String(value)}
            onValueChange={(v) => {
              const opt = c.options.find((o) => String(o.value) === v)
              if (opt) change(opt.value)
            }}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue>
                {(v: string) => c.options.find((o) => String(o.value) === v)?.label ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {c.options.map((o) => (
                <SelectItem key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description}
        </div>
      )
    case "text":
      return (
        <div className="space-y-2">
          {header}
          {c.multiline ? (
            <Textarea
              id={id}
              value={String(value ?? "")}
              onChange={(e) => change(e.target.value)}
            />
          ) : (
            <Input id={id} value={String(value ?? "")} onChange={(e) => change(e.target.value)} />
          )}
          {description}
        </div>
      )
    case "json":
      return (
        <div className="space-y-2">
          {header}
          <JsonInput id={id} value={value} onChange={change} />
          {description}
        </div>
      )
  }
}

const HEX = /^#[0-9a-f]{6}$/i
const expandHex = (v: string) =>
  /^#[0-9a-f]{3}$/i.test(v) ? `#${v.slice(1).replace(/./g, (ch) => ch + ch)}` : v

function ColorInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (v: string) => void
}) {
  // An in-progress edit, discarded as soon as the value changes underneath it.
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null)
  const draft = edit && edit.base === value ? edit.text : value
  const setDraft = (text: string) => setEdit({ base: value, text })
  const hex = expandHex(value)
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Pick color"
        value={HEX.test(hex) ? hex : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
      />
      <Input
        id={id}
        value={draft}
        className="font-mono text-xs"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onChange(draft)}
        onKeyDown={(e) => e.key === "Enter" && onChange(draft)}
      />
    </div>
  )
}

function JsonInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: TweakValue
  onChange: (v: TweakValue) => void
}) {
  const text = JSON.stringify(value, null, 2)
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null)
  const draft = edit && edit.base === text ? edit.text : text
  const setDraft = (t: string) => setEdit({ base: text, text: t })
  const [error, setError] = useState(false)
  return (
    <Textarea
      id={id}
      value={draft}
      aria-invalid={error}
      className="font-mono text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(draft) as TweakValue)
          setError(false)
        } catch {
          setError(true)
        }
      }}
    />
  )
}
