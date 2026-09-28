/**
 * Wire protocol between the main process (`StageHost`) and the driver that
 * runs inside the isolated slide web context.
 *
 * The driver adapts whatever the page is (a Claude Design `<deck-stage>`, our
 * PDF stage, …) to this one small vocabulary. Commands are fire-and-forget;
 * the driver reports the resulting state back as events, so the page — not
 * the host — is the source of truth for which slide is showing.
 */

import type { DeckKind, SlideInfo } from "./deck"
import type { TweakValues } from "./tweaks"

export const STAGE_COMMAND_CHANNEL = "webdeck:stage-command"
export const STAGE_EVENT_CHANNEL = "webdeck:stage-event"

export interface StageDriverOptions {
  /**
   * Jump every animation/transition straight to its end state. Used for
   * thumbnails so each slide is captured fully built.
   */
  freezeAnimations: boolean
}

export type StageCommand =
  | { type: "goTo"; index: number; /** Echoed back in a `settled` event. */ ack?: number }
  | { type: "step"; dir: 1 | -1 }
  | { type: "setTweaks"; values: TweakValues }

export interface StageReport {
  kind: DeckKind
  title: string
  width: number
  height: number
  slides: SlideInfo[]
  index: number
  /** Raw Design Component `propsMeta`, if the page is a DC with props. */
  dcProps: unknown
}

export type StageEvent =
  | { type: "ready"; report: StageReport }
  | { type: "changed"; report: StageReport }
  | { type: "slide"; index: number }
  | { type: "settled"; ack: number }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
