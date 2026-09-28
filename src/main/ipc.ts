import { ipcMain, type IpcMainEvent, type WebContents } from "electron"

import { IPC_PREFIX, type CommandMap, type EventMap, type InvokeMap } from "@shared/ipc"

export type CommandHandlers = {
  [K in keyof CommandMap]: (payload: CommandMap[K], sender: WebContents) => void
}

export type InvokeHandlers = {
  [K in keyof InvokeMap]: (
    sender: WebContents,
  ) => InvokeMap[K]["result"] | Promise<InvokeMap[K]["result"]>
}

/** Bind the typed IPC contract to handlers. Every channel must be handled. */
export function bindIpc(commands: CommandHandlers, invokes: InvokeHandlers): void {
  for (const [channel, handler] of Object.entries(commands)) {
    ipcMain.on(IPC_PREFIX + channel, (e: IpcMainEvent, payload: unknown) => {
      try {
        ;(handler as (p: unknown, s: WebContents) => void)(payload, e.sender)
      } catch (err) {
        console.error(`[ipc] ${channel}:`, err)
      }
    })
  }
  for (const [channel, handler] of Object.entries(invokes)) {
    ipcMain.handle(IPC_PREFIX + channel, (e) => (handler as (s: WebContents) => unknown)(e.sender))
  }
}

export function sendEvent<K extends keyof EventMap>(
  wc: WebContents | null | undefined,
  channel: K,
  payload: EventMap[K],
): void {
  if (wc && !wc.isDestroyed()) wc.send(IPC_PREFIX + channel, payload)
}
