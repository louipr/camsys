/**
 * camsys library face.
 *
 * Most consumers use the CLI (`camsys run ...`). The library exports
 * are for callers that want to read the registry programmatically
 * — e.g., cam's Services panel.
 */

export {
  type Entry,
  REGISTRY_DIR,
  registryDir,
  listEntries,
  readEntry,
  deleteEntry,
  isPidAlive,
  sweepStale,
  killService,
  updateEntryMeta,
  focusService,
  minimizeService,
} from './registry.js'

/**
 * Programmatic spawn-and-track. Same lifecycle as `camsys run <name> -- <cmd>`
 * (pick free ports → spawn in new process group → register at
 * ~/.cam/run/<name>.json → wait for exit → deregister) but callable
 * from any Node process — typically cam's main process spawning
 * docskit / studio / external CAM apps so they show up in the
 * Services panel without going through the CLI.
 *
 * Pass `detach: true` for fire-and-forget mode (stdio:ignore, unref,
 * no signal-forwarding). The returned promise still resolves on
 * child exit, and cleanup runs then; callers that don't care just
 * `void run({detach: true, ...})`.
 */
export { run, type RunOptions } from './spawn.js'

/**
 * Kernel-picked free port via `bind(0)`. Same primitive `camsys run`
 * uses for CAM_VITE_PORT / CAM_CDP_PORT — exported for daemon-pattern
 * apps that need a port for their HTTP server. Tiny race window
 * between release + caller bind; in practice the ephemeral range
 * makes collisions negligible.
 */
export { pickFreePort, pickFreePorts } from './ports.js'

/**
 * Reusable HTTP shell for CAM-launched apps. Every cam-launched
 * Electron app needs the same scaffolding: HTTP server, static
 * bundle serve with SPA fallback, vite dev proxy, the
 * `/cam-host/window-state` spec endpoint. Pre-extraction that was
 * ~100 lines of identical boilerplate copied across cam, audit,
 * docskit, camsys's own app, and term. `startHost` owns that
 * scaffolding; per-app routes hook in via `onRequest`. Optional
 * WebSocket upgrade + SSE event channel are first-class config.
 */
export {
  startHost,
  readJsonBody,
  jsonResponse,
  type HostConfig,
  type HostHandle,
  type HostWindow,
  type RequestHandler,
} from './host.js'
