# camsys

System-level tooling for the CAM ecosystem. One small CLI that solves
three coupled problems:

1. **Port collisions** — every wrapped service gets kernel-assigned
   free ports (no hardcoded `5100`, `5173`, `9222`); the kernel
   guarantees they're distinct.
2. **Service visibility** — every running service writes an entry to
   a shared registry at `~/.cam/run/<name>.json`; any consumer (a sibling
   app, an agent, cam's UI) can read who's running and where.
3. **Orphan cleanup** — children are spawned in their own process
   group; on the wrapper's exit (clean or signal), `kill(-pgid)` takes
   the whole subtree down. No more zombie Electron + Vite processes.

## CLI

```bash
camsys run <name> -- <cmd> <args...>   # wrap a service
camsys list                            # show registered services
camsys port <name> [vite|cdp]          # print a registered port
camsys kill <name>                     # SIGTERM the service's process group
camsys cleanup                         # drop stale registry entries
camsys --help
```

The double-dash separates camsys's own flags from the child command.
Everything after `--` is passed verbatim to the child.

## How a wrapped service receives its ports

`camsys run` allocates two free ports via the kernel and injects them
into the child's environment:

```
CAM_VITE_PORT       free port for the Vite dev server
CAM_CDP_PORT        free port for Chrome DevTools Protocol
CAM_SERVICE_NAME    the registered <name>
```

The child reads them and binds:

```ts
// electron-vite.config.ts
renderer: {
  server: {
    port: Number(process.env.CAM_VITE_PORT) || 0,
    strictPort: false,
  },
}

// main/index.ts
const cdpPort = process.env.CAM_CDP_PORT ?? '0'
app.commandLine.appendSwitch('remote-debugging-port', cdpPort)
```

If a service only needs one port (e.g., a Node CLI with no renderer),
just ignore the env vars you don't need — the wrapper's surface stays
uniform.

## Integration recipe

In each CAM ecosystem repo's `package.json`:

```jsonc
{
  "devDependencies": {
    "camsys": "github:louipr/camsys"
  },
  "scripts": {
    "dev":   "camsys run $npm_package_name -- electron-vite dev",
    "smoke": "camsys run smoke-$npm_package_name -- node scripts/smoke.mjs"
  }
}
```

`$npm_package_name` is provided automatically by npm — no per-repo
hardcoded name needed. The smoke harness then reads `CAM_CDP_PORT` from
its env instead of hardcoding 9222.

## Registry format

One JSON file per running service at `~/.cam/run/<name>.json`:

```json
{
  "name": "docskit",
  "pid": 84321,
  "pgid": 84321,
  "vitePort": 51234,
  "cdpPort": 51235,
  "cmd": "electron-vite dev",
  "cwd": "/Users/lpabon/projects/docskit",
  "started": 1747663200123,
  "meta": {}
}
```

Atomic-write via tmp + rename, so concurrent readers never see partial
JSON. The `meta` field is the extension slot — readers ignore unknown
keys, so schema additions don't break older consumers.

## Library face

Two opt-in subpaths beyond the CLI:

### `camsys` — data face (vanilla TS, no UI deps)

Read the registry programmatically:

```ts
import { listEntries, readEntry, sweepStale } from 'camsys'

const running = listEntries()
// → [{ name: 'docskit', pid: 84321, vitePort: 51234, ... }, ...]
```

Zero runtime deps. Safe for CLI / Node / SSR / any non-browser host.

### `camsys/ui` — React component (opt-in)

A live `ServicesPanel` that polls the registry and renders the table
with a Kill button per row. React-and-react-dom are **optional peer
dependencies** — only hosts that import this subpath need them.

```tsx
import { ServicesPanel, type ServicesIO } from 'camsys/ui'

const io: ServicesIO = {
  list: () => window.electronAPI.invoke('camsys:list'),    // host IPC
  kill: (name) => window.electronAPI.invoke('camsys:kill', name),
}

<ServicesPanel
  io={io}
  refreshIntervalMs={2000}
  onOpenService={(name) => routeToPackageDetail(name)}
/>
```

The component is host-IO-agnostic — it knows nothing about Electron,
filesystem, or kill semantics. The host implements `list` / `kill`,
typically by:
- `list` → reading `~/.cam/run/*.json` (use `listEntries` from `camsys`)
- `kill` → shelling `camsys kill <name>` or calling `process.kill(-pgid, 'SIGTERM')`

Same inverted-IO pattern docskit's `createEditor` uses. Same component
renders unchanged in Electron-renderer / Tauri / web-over-localhost-HTTP
hosts.

**Class names for styling** (no inline styles, no CSS-in-JS):
`.camsys-panel`, `.camsys-empty`, `.camsys-error`, `.camsys-table`,
`.camsys-row`, `.camsys-row-link`, `.camsys-mono`, `.camsys-col-name`,
`.camsys-col-pid`, `.camsys-col-port`, `.camsys-col-age`,
`.camsys-col-action`, `.camsys-kill`.

## What camsys doesn't try to do

- **Restart on crash** — CAM dev runs are interactive; auto-restart is
  rarely what you want. Use pm2 if you need a daemon supervisor.
- **Multi-service orchestration** — for "bring up the whole stack at
  once" use overmind / foreman against a Procfile. camsys handles one
  service per invocation.
- **Production hosting** — strictly a development + test wrapper. The
  packaged Electron apps don't need or use camsys.

## What's NOT cleaned by the wrapper

- If `camsys` itself is `SIGKILL`'d (uncatchable), the signal-forward
  step is skipped. The child stays alive as an orphan; the registry
  entry stays stale. Mitigation: `camsys cleanup` sweeps stale entries
  on next run; a periodic janitor (e.g., the launchd agent CAM users
  already have) handles the orphan process by matching process group.
- Children that explicitly `setsid()` escape the process group. None
  of the current CAM apps do this.

## Install

Consumed via Git URL per ADR-001 (no npm publish):

```jsonc
"devDependencies": {
  "camsys": "github:louipr/camsys"
}
```

`npm install` runs the `prepare` script which compiles TypeScript →
`dist/`. Consumers get a ready-to-run binary.

## Tests

```bash
npm test
```

Covers: free-port allocation, registry round-trip, name-sanitization,
stale-PID sweep, end-to-end spawn (env injection + exit-code
propagation + entry cleanup).
