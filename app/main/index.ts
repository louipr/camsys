/**
 * camsys standalone Electron app — main process.
 *
 * One window, one panel: the same ServicesPanel that cam embeds in
 * its System tab. Same docskit-precedent split — the library face
 * is the contract; this is one consumer alongside cam.
 *
 * The IPC surface mirrors what cam wires up for the embedded panel,
 * just hosted by camsys itself instead of cam:
 *   camsys:list  → registry.listEntries()
 *   camsys:kill  → process.kill(-pgid, SIGTERM) + deleteEntry
 *
 * camsys is dev tooling — no auto-launch, no system tray. Open it
 * when you want a focused view; close it when you don't.
 */
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  listEntries,
  killService,
} from '../../src/registry.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 900,
    height: 600,
    title: 'camsys — running services',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev; production loads
  // the bundled HTML from disk. Same shape as docskit's main.
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void w.loadURL(rendererUrl)
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return w
}

function registerHandlers(): void {
  ipcMain.handle('camsys:list', () => listEntries())

  ipcMain.handle('camsys:kill', async (_e: IpcMainInvokeEvent, name: string) => {
    killService(name)
  })
}

app.whenReady().then(() => {
  registerHandlers()
  if (!win) win = createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
