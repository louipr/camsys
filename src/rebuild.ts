/**
 * camsys rebuild — native-module ABI flipper.
 *
 * Wraps the standard Electron-rebuild dance into one CLI command
 * every CAM consumer can call without depending on
 * `@electron/rebuild` directly. Single source of truth: when the
 * ecosystem moves (N-API matures, `node:sqlite` in Electron ships,
 * etc.) we swap implementations here and every consumer inherits
 * the fix.
 *
 * Two targets:
 *   - `--target=electron`: rebuild for Electron's bundled Node ABI.
 *     Default after every npm install (consumers wire this as a
 *     `postinstall` script). Uses `@electron/rebuild` which prefers
 *     prebuilt binaries over source compilation (~3s download vs.
 *     ~30s compile).
 *   - `--target=node`: rebuild for system Node ABI. Consumers wire
 *     this as `pretest` when their tests load native modules in
 *     vitest. Uses bare `npm rebuild` since vitest runs under the
 *     same Node version that's invoking npm.
 *
 * Optional positional args restrict to specific modules (matches
 * `electron-rebuild -w` semantics). Without args, rebuilds every
 * native module in node_modules — overshoot is safe and matches
 * what npm install would do anyway.
 *
 * Why this lives in camsys and not as a dep in each repo: cam,
 * audit, and term all had divergent versions of the same dance
 * (some had postinstall, some didn't; cam used predev; audit
 * added pretest later; nothing was DRY across consumers). One
 * shared command keeps every CAM repo's package.json identical:
 *
 *   "postinstall": "camsys rebuild --target=electron",
 *   "predev":      "camsys rebuild --target=electron",
 *   "pretest":     "camsys rebuild --target=node"
 */

import { spawnSync } from 'node:child_process'

export interface RebuildOptions {
  target: 'electron' | 'node'
  modules?: string[]
  /** Working directory containing node_modules. Defaults to cwd. */
  cwd?: string
}

export async function rebuild(opts: RebuildOptions): Promise<number> {
  const cwd = opts.cwd ?? process.cwd()
  if (opts.target === 'electron') {
    return await rebuildForElectron(cwd, opts.modules)
  }
  if (opts.target === 'node') {
    return rebuildForNode(cwd, opts.modules)
  }
  console.error(`camsys rebuild: unknown target '${opts.target as string}' (expected electron|node)`)
  return 2
}

async function rebuildForElectron(cwd: string, modules?: string[]): Promise<number> {
  // Dynamic import so the dep isn't loaded for `--target=node` paths
  // (or for camsys CLI users who never call rebuild). Slight startup
  // perf win + isolates the @electron/rebuild dep to the one code
  // path that needs it.
  const { rebuild: doRebuild } = await import('@electron/rebuild')
  const electronVersion = await resolveElectronVersion(cwd)
  if (!electronVersion) {
    console.error(
      'camsys rebuild --target=electron: could not locate electron in node_modules. ' +
        'Install electron as a devDependency in this project.',
    )
    return 1
  }
  console.log(`[camsys rebuild] target=electron version=${electronVersion}` +
    (modules?.length ? ` modules=${modules.join(',')}` : ' (all native modules)'))
  try {
    await doRebuild({
      buildPath: cwd,
      electronVersion,
      onlyModules: modules?.length ? modules : undefined,
    })
    console.log('[camsys rebuild] ✓ done')
    return 0
  } catch (err) {
    console.error(`[camsys rebuild] failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

function rebuildForNode(cwd: string, modules?: string[]): number {
  // `npm rebuild` runs against whatever Node is currently invoking
  // npm — for our use case, that's the system Node vitest will use.
  const args = ['rebuild', ...(modules ?? [])]
  console.log(`[camsys rebuild] target=node` +
    (modules?.length ? ` modules=${modules.join(',')}` : ' (all native modules)'))
  const result = spawnSync('npm', args, { cwd, stdio: 'inherit' })
  if (result.status === 0) console.log('[camsys rebuild] ✓ done')
  return result.status ?? 1
}

/** Read electron's installed version from node_modules. Returns
 *  null if electron isn't in this project (camsys rebuild only
 *  makes sense for projects that depend on electron). */
async function resolveElectronVersion(cwd: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const pkgPath = join(cwd, 'node_modules', 'electron', 'package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}
