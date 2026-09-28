/**
 * Preload for the isolated slide web context (offscreen). Bridges the
 * main-world stage driver to the main process; exposes nothing else.
 */

import { contextBridge, ipcRenderer } from "electron"

import {
  STAGE_COMMAND_CHANNEL,
  STAGE_EVENT_CHANNEL,
  type StageCommand,
  type StageDriverOptions,
  type StageEvent,
} from "@shared/stage-protocol"

import { installDriver, type HostBridge } from "./stage-driver"

const options = ipcRenderer.sendSync("webdeck:stage-options") as StageDriverOptions

let handler: ((cmd: StageCommand) => void) | null = null
const queued: StageCommand[] = []

ipcRenderer.on(STAGE_COMMAND_CHANNEL, (_e, cmd: StageCommand) => {
  if (handler) handler(cmd)
  else queued.push(cmd)
})

const bridge: HostBridge = {
  emit: (event: StageEvent) => ipcRenderer.send(STAGE_EVENT_CHANNEL, event),
  onCommand: (cb) => {
    handler = cb
    for (const cmd of queued.splice(0)) cb(cmd)
  },
}

contextBridge.exposeInMainWorld("__webdeckHost", bridge)
contextBridge.executeInMainWorld({ func: installDriver, args: [options] })
