# Migration recipe — adopting camsys in a CAM-ecosystem repo

## 1.0.0 — public surface sweep (2026-05-24)

Removed exports that had no consumer anywhere in the CAM ecosystem
(cam / audit / docskit / term / camsys-app). All still live as
module-internal functions inside camsys's own `src/`; they're just
not part of the published library contract anymore.

**Removed from public exports:**

| Symbol | Reason |
|---|---|
| `readEntry` | Internal helper. Used by `commands.ts` + `spawn.ts`, never by external consumers. |
| `deleteEntry` | Internal helper. Used by `sweepStale` + `spawn.ts`'s cleanup. |
| `isPidAlive` | Internal helper. Used by `sweepStale`. Consumers should call `sweepStale` + `listEntries` (sweep returns live-only). |
| `registryDir` | Internal path resolver. Hardcoded layout (`~/.cam/run/`) — no consumer ever needed runtime access. |
| `REGISTRY_DIR` | Already marked `@deprecated`. Pre-1.0 back-compat alias for `registryDir()`. |
| `pickFreePort` / `pickFreePorts` | Aspirational utility — exported for "daemon-pattern apps that need a port" but every CAM app uses `startHost` which wraps these internally. No external consumer materialized. |
| `minimizeService` | Sibling of `focusService`. Never called by any consumer. Removed entirely (function + export); the underlying `signalWindowState` helper stays. |

**Kept (live exports):**

`Entry`, `listEntries`, `sweepStale`, `killService`, `updateEntryMeta`,
`focusService` (from registry), `run` + `RunOptions` (spawn), and the
host quartet `startHost` + `readJsonBody` + `jsonResponse` + types
(`HostConfig` / `HostHandle` / `HostWindow` / `RequestHandler`).

**Migration:** no consumer code changes needed — none of the removed
symbols had external callers. Bump camsys's pin (lockfile) in each
consumer and rebuild. If you were using one of the removed symbols
in an unfinished feature branch, file an issue with the use case
and we'll re-export.

---



Each per-repo adoption is small and mechanical. Three file edits plus
one optional smoke-harness edit if the repo has one. Copy-paste against
the local repo state; verify with the build + test + smoke check at the
end.

Reference: docskit's adoption ([commit `0525189`](https://github.com/louipr/docskit/commit/0525189))
shipped end-to-end and is the canonical worked example.

## 1. Add the devDep

```jsonc
// package.json
{
  "devDependencies": {
    "camsys": "github:louipr/camsys",
    // … existing entries
  }
}
```

Then `npm install` to populate `node_modules/.bin/camsys`.

## 2. Wrap dev + smoke scripts

Prefix every long-running launch with `camsys run <name> --`. Pick `<name>`
to match the package name where possible — `$npm_package_name` is
injected automatically by npm if you want zero-edit names.

```jsonc
{
  "scripts": {
    // before
    "dev":   "electron-vite dev",
    "smoke": "node scripts/smoke.mjs",

    // after
    "dev":   "camsys run $npm_package_name -- electron-vite dev",
    "smoke": "camsys run smoke-$npm_package_name -- node scripts/smoke.mjs"
  }
}
```

`app:build` / `lib:build` / unit-test scripts don't need wrapping —
they don't bind ports. Only the long-running ones.

## 3. Drop hardcoded ports from `electron.vite.config.ts`

```ts
// before
renderer: {
  // (no server config, or hardcoded port: 5173)
}

// after
renderer: {
  server: {
    port: Number(process.env.CAM_VITE_PORT) || 0,
    strictPort: false,
  },
}
```

The `|| 0` fallback means bare `electron-vite dev` (no camsys wrapper)
still works — kernel picks an ephemeral port. With the camsys wrapper,
the env var is the source of truth.

## 4. Drop hardcoded CDP port from `app/main/index.ts` (or equivalent)

```ts
// before
app.commandLine.appendSwitch('remote-debugging-port', '9222')

// after
const cdpRequested =
  process.env.CAM_CDP_PORT !== undefined ||
  process.argv.includes('--inspect')   // or your project's debug-flag name
if (cdpRequested) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env.CAM_CDP_PORT ?? '0',
  )
}
```

CDP is now opt-in (via env or argv flag) AND dynamic-port. Production /
packaged Electron never sees this — it's dev-and-test only.

## 5. (If applicable) Smoke harness reads CAM_CDP_PORT

Repos with a smoke / e2e harness that drives Electron over CDP need
to read the port that camsys injected. Pattern:

```js
// scripts/smoke.mjs — at the top, after imports
const CDP_PORT = Number(process.env.CAM_CDP_PORT)
if (!Number.isInteger(CDP_PORT) || CDP_PORT <= 0) {
  console.error(
    'CAM_CDP_PORT missing. Run via `npm run smoke` (which wraps with camsys).',
  )
  process.exit(2)
}
```

When the harness spawns Electron, forward the env so the spawned main
process sees the same port:

```js
spawn(ELECTRON_BIN, [MAIN_JS], {
  env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' },
})
```

`...process.env` is sufficient — `CAM_CDP_PORT` is inherited. **Don't
pass `--inspect-docskit`-style argv flags anymore** unless you want
both paths to work.

## 6. Optional: explicit `process.exit` at smoke harness end

If your harness leaves open handles after tests complete (a CDP client
that didn't close cleanly, a timer), the camsys wrapper waits for the
child to exit and the registry entry lingers. Force the exit on success:

```js
main().then(
  () => process.exit(process.exitCode || 0),
  (err) => {
    console.error(err)
    process.exit(process.exitCode || 1)
  },
)
```

This was a pre-existing latent issue in docskit's smoke — silent before,
visible-as-stale-registry-entry under camsys. The wrapper isn't masking
it anymore.

## 7. Verify

```bash
npm install                 # pulls camsys, binary appears in node_modules/.bin/
npm run app:build           # or your equivalent — proves config compiles
npm test                    # unit tests
npm run smoke               # if applicable — exercises the full chain
./node_modules/.bin/camsys list   # should be empty after smoke exits
```

If `camsys list` still shows your service after a successful smoke run,
revisit step 6 (open handles keeping node alive).

## What this gets you per-repo

- **No more `9222`/`5173`/`5100`** in source. Free ports, kernel-picked,
  collision-impossible.
- **Concurrent CAM sessions stop fighting** for ports — cam's
  `electron-vite dev` and your repo's smoke can run simultaneously
  without anyone hardcoding offsets.
- **Visibility**: `camsys list` shows what's running across the
  ecosystem, by name + pid + port + age.
- **Cleanup**: `camsys kill <name>` SIGTERMs the entire process group.
  `camsys cleanup` sweeps stale registry entries (the launchd janitor
  still backstops anything that escaped).

## What this does NOT change

- Production / packaged Electron — no ports involved, untouched.
- MCP servers (cam-plugins) — stdio, no ports, untouched.
- Unit tests that don't spawn processes — untouched.
- Library faces — camsys is purely a launch-time concern.
