// Render build/icon.svg to build/icon.png (1024×1024) with Electron's own
// Chromium, so no extra image tooling is needed. electron-builder derives the
// .icns and .ico from the PNG.
//
//   pnpm exec electron scripts/render-icon.cjs
const { app, BrowserWindow } = require("electron")
const { readFileSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")

const root = join(__dirname, "..")
const svg = readFileSync(join(root, "build/icon.svg"), "utf8")

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    useContentSize: true,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: { deviceScaleFactor: 1 } },
  })
  const html = `<!doctype html><style>html,body{margin:0;background:transparent}</style>${svg}`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(join(root, "build/icon.png"), img.toPNG())
  console.log("wrote build/icon.png", img.getSize())
  app.quit()
})
