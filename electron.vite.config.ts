/**
 * electron-vite config for the camsys standalone app.
 *
 * Two targets — no preload. The renderer talks to the main process
 * over HTTP (main runs an HTTP server on a free port; renderer
 * `loadURL`s into it). Same daemon-WS pattern documented in
 * cam/docs/architecture/launched-apps.md.
 *   app/main     → out/main/index.js       (Electron main + HTTP daemon)
 *   app/renderer → out/renderer/           (React renderer, Vite-bundled)
 *
 * Renderer dev-server port is dynamic — reads CAM_VITE_PORT (set when
 * camsys spawns itself via `camsys run`) or falls back to kernel-picked
 * (port 0). Never hardcoded.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      lib: { entry: resolve(__dirname, 'app/main/index.ts') },
      outDir: resolve(__dirname, 'out/main'),
    },
  },
  renderer: {
    root: resolve(__dirname, 'app/renderer'),
    plugins: [react()],
    server: {
      port: Number(process.env.CAM_VITE_PORT) || 0,
      strictPort: false,
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'app/renderer/index.html'),
      },
    },
  },
})
