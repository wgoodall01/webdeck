import { resolve } from "node:path"

import { defineConfig, mergeConfig } from "electron-vite"

import renderer from "./vite.renderer.config"

const alias = { "@shared": resolve(import.meta.dirname, "src/shared") }

export default defineConfig(({ command }) => ({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/main/index.ts") },
        external: ["electron"],
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandboxed preloads must be single-file CommonJS: they can only
      // require("electron"), never sibling chunks.
      rollupOptions: {
        external: ["electron"],
        input: {
          app: resolve(import.meta.dirname, "src/preload/app.ts"),
          stage: resolve(import.meta.dirname, "src/preload/stage.ts"),
        },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  // Dev only: Start's dev middleware serves the shell, so the input here just
  // satisfies electron-vite's config check. Production renderer builds go
  // through `vite build -c vite.renderer.config.ts` (see that file).
  renderer:
    command === "serve"
      ? mergeConfig(renderer, {
          build: {
            rollupOptions: { input: resolve(import.meta.dirname, "src/renderer/router.tsx") },
          },
        })
      : undefined,
}))
