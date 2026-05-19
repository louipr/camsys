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
} from './registry.js'
