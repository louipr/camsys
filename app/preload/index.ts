/**
 * camsys app — preload.
 *
 * Exposes the same IPC surface cam wires up for its embedded panel,
 * so the renderer can build a single ServicesIO that's identical in
 * shape regardless of host. The renderer-facing API:
 *
 *   window.camsysAPI.list()           → Promise<Entry[]>
 *   window.camsysAPI.kill(name)       → Promise<void>
 *
 * No fs / path / Node APIs exposed — the main process handlers are
 * the only privileged surface. Mirrors docskit/cam contextIsolation
 * conventions.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { Entry } from '../../src/registry.js'

export interface CamsysAPI {
  list(): Promise<Entry[]>
  kill(name: string): Promise<void>
}

const api: CamsysAPI = {
  list: () => ipcRenderer.invoke('camsys:list') as Promise<Entry[]>,
  kill: (name) => ipcRenderer.invoke('camsys:kill', name) as Promise<void>,
}

contextBridge.exposeInMainWorld('camsysAPI', api)
