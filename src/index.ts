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
