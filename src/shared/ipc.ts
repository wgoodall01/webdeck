/**
 * The typed IPC contract between main and the app's own windows (presenter,
 * audience). The slide web context speaks a separate protocol — see
 * `stage-protocol.ts`.
 */

import type { DeckCandidate, DeckManifest } from "./deck"
import type { StageInput } from "./input"
import type { TweakSchema, TweakValues } from "./tweaks"

export type ScreenMode = "normal" | "black" | "white"

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  width: number
  height: number
}

export interface AudienceState {
  /** False once the user closes the audience window (it can be reopened). */
  open: boolean
  displayId: number | null
  fullscreen: boolean
}

export interface TweaksState {
  schema: TweakSchema
  values: TweakValues
}

export type AppState =
  | { phase: "idle" }
  | { phase: "loading"; title: string }
  | { phase: "error"; message: string }
  | { phase: "picking"; archiveName: string; candidates: DeckCandidate[] }
  | {
      phase: "presenting"
      deck: DeckManifest
      index: number
      screen: ScreenMode
      tweaks: TweaksState | null
      audience: AudienceState
      displays: DisplayInfo[]
    }

export type NavCommand = { type: "goTo"; index: number } | { type: "step"; dir: 1 | -1 }

/** Where the presenter is hovering on the slide, mirrored to the audience as a marker. */
export interface MarkerPoint {
  x: number
  y: number
}

/** Thumbnails are keyed by slide index, or by candidate id in the picker. */
export interface ThumbnailEvent {
  scope: "slide" | "candidate"
  key: string
  dataUrl: string
}

/** renderer → main, fire-and-forget. */
export interface CommandMap {
  "app:open": void
  "picker:choose": string
  nav: NavCommand
  screen: ScreenMode
  marker: MarkerPoint | null
  "stage:input": StageInput
  "tweaks:set": TweakValues
  "tweaks:reset": void
  "audience:set": Partial<AudienceState>
  /** Drag the sender's window by its content (QuickTime-style); main tracks the cursor. */
  "window:drag": "start" | "move" | "end"
  /** Show/hide the window controls (macOS traffic lights) while the pointer is active. */
  "window:controls": boolean
  /** The sender's frame receiver is installed; start streaming to it. */
  "frames:ready": void
}

/** renderer → main, request/response. */
export interface InvokeMap {
  "state:get": { args: void; result: AppState }
  "thumbnails:get": { args: void; result: ThumbnailEvent[] }
}

/** main → renderer. */
export interface EventMap {
  state: AppState
  thumbnail: ThumbnailEvent
  marker: MarkerPoint | null
  /** CSS cursor for the slide surface, mirrored from the slide page. */
  cursor: string
  /** CPU fallback frame (JPEG) when GPU shared textures are unavailable. */
  "frame:bitmap": Uint8Array
}

export const IPC_PREFIX = "webdeck:"

/** The API the app preload exposes on `window.webdeck`. */
export interface WebdeckApi {
  platform: string
  send<K extends keyof CommandMap>(
    channel: K,
    ...payload: CommandMap[K] extends void ? [] : [CommandMap[K]]
  ): void
  invoke<K extends keyof InvokeMap>(channel: K): Promise<InvokeMap[K]["result"]>
  on<K extends keyof EventMap>(channel: K, cb: (payload: EventMap[K]) => void): () => void
  /**
   * Receive GPU frames of the live slide. The callback owns the frame and
   * must `close()` it. Resolves once main is told to start streaming.
   */
  onFrame(cb: (frame: VideoFrame) => void | Promise<void>): () => void
}
