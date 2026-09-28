import { basename } from "node:path"

import { app, BrowserWindow, dialog, screen } from "electron"

import type { AppState, CommandMap, EventMap, ThumbnailEvent } from "@shared/ipc"

import { openDeckSource, type OpenedArchive } from "./deck/open-deck"
import { bindIpc, sendEvent, type CommandHandlers } from "./ipc"
import type { DeckMounts } from "./protocol/deck-protocol"
import { PresentationSession } from "./session"
import { renderCover } from "./stage/thumbnailer"
import { listDisplays } from "./windows/audience-window"
import { createPresenterWindow } from "./windows/presenter-window"
import { handleWindowDrag } from "./windows/window-drag"

/**
 * Top of the app: the open flow, the picker, and the lifetime of the
 * presenter window and the current session. Holds no persistent state —
 * every launch starts at the Open dialog.
 */
export class AppController {
  private presenter: BrowserWindow | null = null
  private archive: OpenedArchive | null = null
  private session: PresentationSession | null = null
  private phase: AppState = { phase: "idle" }
  private covers = new Map<string, string>()
  private openGeneration = 0
  private dialogOpen = false

  private commands: CommandHandlers

  constructor(private mounts: DeckMounts) {
    this.commands = {
      "app:open": () => void this.promptOpen(),
      "picker:choose": (id) => void this.choose(id),
      nav: (cmd) => this.session?.nav(cmd),
      screen: (mode) => this.session?.setScreen(mode),
      marker: (p) => this.session?.marker(p),
      "stage:input": (input) => this.session?.input(input),
      "tweaks:set": (values) => this.session?.setTweaks(values),
      "tweaks:reset": () => this.session?.resetTweaks(),
      "audience:set": (patch) => this.session?.setAudience(patch),
      "window:drag": (msg, sender) => handleWindowDrag(sender, msg),
      "window:controls": (visible, sender) => {
        const win = BrowserWindow.fromWebContents(sender)
        if (win && !win.isDestroyed() && process.platform === "darwin") {
          win.setWindowButtonVisibility(visible || win.isFullScreen())
        }
      },
      "frames:ready": (_, sender) => this.session?.addSink(sender),
    }
    bindIpc(this.commands, {
      "state:get": () => this.state(),
      "thumbnails:get": () => this.thumbnails(),
    })
    const displaysChanged = () => this.session?.refresh()
    screen.on("display-added", displaysChanged)
    screen.on("display-removed", displaysChanged)
    screen.on("display-metrics-changed", displaysChanged)
  }

  /**
   * Tear down the session while every window still exists. Called on
   * `before-quit`, before Electron starts destroying windows.
   */
  shutdown(): void {
    this.openGeneration++
    this.endSession()
  }

  /** Run a command as if the presenter sent it (menus, smoke tests). */
  command<K extends Exclude<keyof CommandMap, "frames:ready" | `window:${string}`>>(
    channel: K,
    payload: CommandMap[K],
  ): void {
    const wc = this.presenter?.webContents
    if (wc)
      (this.commands[channel] as (p: CommandMap[K], s: Electron.WebContents) => void)(payload, wc)
  }

  state(): AppState {
    return this.session?.state() ?? this.phase
  }

  /** Show the Open dialog. Quits if the user cancels with nothing open. */
  async promptOpen(): Promise<void> {
    if (this.dialogOpen) return
    this.dialogOpen = true
    const parent = this.presenter ?? undefined
    const options: Electron.OpenDialogOptions = {
      title: "Open a deck",
      buttonLabel: "Present",
      properties: ["openFile"],
      filters: [
        { name: "Decks", extensions: ["zip", "pdf"] },
        { name: "Claude Design export", extensions: ["zip"] },
        { name: "PDF", extensions: ["pdf"] },
      ],
    }
    const res = await (parent
      ? dialog.showOpenDialog(parent, options)
      : dialog.showOpenDialog(options))
    this.dialogOpen = false
    const path = res.filePaths[0]
    if (res.canceled || !path) {
      if (!this.presenter && !this.session) app.quit()
      return
    }
    await this.openPath(path)
  }

  async openPath(path: string): Promise<void> {
    const gen = ++this.openGeneration
    this.endSession()
    this.setPhase({ phase: "loading", title: basename(path) })
    this.ensurePresenter()
    try {
      const archive = await openDeckSource(path)
      if (gen !== this.openGeneration) return archive.files.close()
      this.archive = archive
      const [only] = archive.candidates
      if (archive.candidates.length === 1 && only) await this.present(only.id)
      else {
        this.setPhase({
          phase: "picking",
          archiveName: archive.files.name,
          candidates: archive.candidates,
        })
        void this.renderCovers(gen)
      }
    } catch (err) {
      if (gen !== this.openGeneration) return
      this.fail(err)
    }
  }

  private async choose(id: string): Promise<void> {
    if (this.phase.phase !== "picking") return
    await this.present(id)
  }

  private async present(candidateId: string): Promise<void> {
    const archive = this.archive
    const candidate = archive?.candidates.find((c) => c.id === candidateId)
    if (!archive || !candidate) return
    const gen = this.openGeneration
    this.setPhase({ phase: "loading", title: candidate.title })
    const session = new PresentationSession(archive.files, this.mounts, candidate, {
      changed: () => this.broadcastState(),
      toPresenter: (channel, payload) => this.toPresenter(channel, payload),
      displays: listDisplays,
    })
    this.session = session
    try {
      await session.start()
      if (gen !== this.openGeneration) return
      this.presenter?.setTitle(`${candidate.title} — Webdeck`)
      this.broadcastState()
    } catch (err) {
      if (this.session === session) this.session = null
      session.dispose()
      if (gen === this.openGeneration) this.fail(err)
    }
  }

  private async renderCovers(gen: number): Promise<void> {
    const archive = this.archive
    if (!archive) return
    for (const c of archive.candidates) {
      if (gen !== this.openGeneration || this.session) return
      const id = this.mounts.mount(archive.files)
      try {
        const dataUrl = await renderCover({
          kind: c.kind,
          url: this.mounts.url(id, c.path),
          title: c.title,
        })
        this.covers.set(c.id, dataUrl)
        this.toPresenter("thumbnail", { scope: "candidate", key: c.id, dataUrl })
      } catch (err) {
        console.warn(`[picker] cover for ${c.path}:`, err)
      } finally {
        this.mounts.unmount(id)
      }
    }
  }

  private thumbnails(): ThumbnailEvent[] {
    if (this.session) return this.session.thumbnails()
    return [...this.covers].map(([key, dataUrl]) => ({ scope: "candidate", key, dataUrl }))
  }

  private ensurePresenter(): void {
    if (this.presenter && !this.presenter.isDestroyed()) return
    const win = createPresenterWindow()
    this.presenter = win
    // The presenter is the app: closing it ends everything.
    win.once("closed", () => {
      this.presenter = null
      this.shutdown()
      app.quit()
    })
  }

  private endSession(): void {
    this.session?.dispose()
    this.session = null
    this.covers.clear()
    if (this.archive) {
      this.archive.files.close()
      this.archive = null
    }
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[open]", err)
    this.endSession()
    this.setPhase({ phase: "error", message })
  }

  private setPhase(phase: AppState): void {
    this.phase = phase
    this.broadcastState()
  }

  private toPresenter<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void {
    sendEvent(this.presenter?.webContents, channel, payload)
  }

  private broadcastState(): void {
    const state = this.state()
    this.toPresenter("state", state)
    sendEvent(this.session?.audienceContents, "state", state)
  }
}
