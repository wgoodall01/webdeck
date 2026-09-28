/**
 * Preload for the app's own windows (presenter, audience). Exposes the typed
 * IPC contract as `window.webdeck`, plus a receiver for GPU slide frames.
 */

import { contextBridge, ipcRenderer, sharedTexture } from "electron"

import { IPC_PREFIX, type WebdeckApi } from "@shared/ipc"

type FrameCallback = (frame: VideoFrame) => void | Promise<void>
let frameCallback: FrameCallback | null = null

// Frames arrive as imported shared textures. Hand the consumer a VideoFrame
// backed by the same GPU memory, then drop our reference.
sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }) => {
  try {
    const cb = frameCallback
    if (cb) await cb(importedSharedTexture.getVideoFrame())
  } catch (err) {
    console.error("[webdeck] frame receiver:", err)
  } finally {
    importedSharedTexture.release()
  }
})

const api: WebdeckApi = {
  platform: process.platform,
  send: (channel, ...payload) => ipcRenderer.send(IPC_PREFIX + channel, ...payload),
  invoke: (channel) => ipcRenderer.invoke(IPC_PREFIX + channel),
  on: (channel, cb) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload as never)
    ipcRenderer.on(IPC_PREFIX + channel, listener)
    return () => ipcRenderer.removeListener(IPC_PREFIX + channel, listener)
  },
  onFrame: (cb) => {
    frameCallback = cb
    ipcRenderer.send(IPC_PREFIX + "frames:ready")
    return () => {
      if (frameCallback === cb) frameCallback = null
    }
  },
}

contextBridge.exposeInMainWorld("webdeck", api)
