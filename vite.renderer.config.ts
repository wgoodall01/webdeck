import { resolve } from "node:path"

import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * The renderer is a TanStack Start app in SPA mode. electron-vite serves it in
 * dev, but its production build only runs a single Vite environment, so the
 * full Start build (client + prerendered shell) runs through `vite build`
 * with this config instead.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, "src/renderer"),
  base: "/",
  resolve: {
    alias: {
      "@shared": resolve(import.meta.dirname, "src/shared"),
      "@": resolve(import.meta.dirname, "src/renderer"),
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: ".",
      spa: { enabled: true, prerender: { outputPath: "/index.html", crawlLinks: false } },
    }),
    viteReact(),
  ],
  build: { outDir: resolve(import.meta.dirname, "out/renderer"), emptyOutDir: true },
})
