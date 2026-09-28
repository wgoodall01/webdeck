import { app, Menu, protocol, session } from "electron"

import { AppController } from "./app-controller"
import { APP_SCHEME } from "./paths"
import { registerAppProtocol } from "./protocol/app-protocol"
import { DECK_SCHEME, DeckMounts } from "./protocol/deck-protocol"
import { STAGE_PARTITION } from "./stage/stage-host"

const privileges = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
  codeCache: true,
}
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges },
  { scheme: DECK_SCHEME, privileges },
])

// Offscreen slide rendering needs the GPU; make sure it isn't blocklisted.
app.commandLine.appendSwitch("ignore-gpu-blocklist")

if (!app.requestSingleInstanceLock()) app.quit()

const mounts = new DeckMounts()
let controller: AppController | null = null
/** Files handed to us (Finder "Open With", argv) before we were ready. */
let pendingPath: string | null = process.argv.slice(1).find((a) => /\.(zip|pdf)$/i.test(a)) ?? null

app.on("open-file", (e, path) => {
  e.preventDefault()
  if (controller) void controller.openPath(path)
  else pendingPath = path
})

app.on("second-instance", (_e, argv) => {
  const path = argv.slice(1).find((a) => /\.(zip|pdf)$/i.test(a))
  if (path) void controller?.openPath(path)
})

function buildMenu(c: AppController): void {
  const mac = process.platform === "darwin"
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => void c.promptOpen() },
          { type: "separator" },
          mac ? { role: "close" } : { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
        ],
      },
      { role: "windowMenu" },
    ]),
  )
}

void app.whenReady().then(() => {
  for (const ses of [session.defaultSession, session.fromPartition(STAGE_PARTITION)]) {
    registerAppProtocol(ses)
    mounts.register(ses)
  }
  controller = new AppController(mounts)
  buildMenu(controller)
  if (pendingPath) void controller.openPath(pendingPath)
  else void controller.promptOpen()
  const smokeDir = process.env.WEBDECK_SMOKE
  if (smokeDir) void import("./smoke").then((m) => controller && m.runSmoke(controller, smokeDir))
})

// Stateless: the app lives exactly as long as its presenter window.
app.on("window-all-closed", () => app.quit())
app.on("before-quit", () => controller?.shutdown())
