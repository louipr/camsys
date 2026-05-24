# Containers (Level 2)

camsys runs as **four distinct deployment shapes from one source
repo**, all sharing `src/registry.ts` as their single source of
truth for "what's running." Different consumers reach different
shapes; nothing in the layout couples them beyond the shared
registry contract.

## The four containers

```mermaid
flowchart TB
    subgraph CamsysRepo[camsys repo]
      direction LR
      CLI[CLI binary<br/><i>dist/src/cli.js<br/>shebang + main()</i>]
      Lib[Library module<br/><i>dist/src/index.js<br/>npm subpath '.'</i>]
      UI[UI subpath<br/><i>dist/ui/index.js<br/>npm subpath './ui'</i>]
      App[Standalone Electron app<br/><i>out/main + out/renderer<br/>uses src/ + ui/ directly</i>]
    end

    Reg[(Registry<br/><i>~/.cam/run/&lt;name&gt;.json</i>)]
    Children([Wrapped child processes])
    CamApps([CAM apps<br/><i>cam, audit, docskit, term, cam-plugins</i>]):::ext

    Dev([Developer]) -->|camsys run/list/etc.| CLI
    CamApps -->|import { run, startHost, ... } from 'camsys'| Lib
    CamApps -->|import { ServicesPanel, BackToCam } from 'camsys/ui'| UI
    Dev -->|electron .|App
    CamApps -.->|spawn via lib.run&#40;&#41;|App

    CLI -->|spawns + monitors| Children
    Lib -->|spawns + monitors| Children
    Children -->|read/write own entry| Reg
    CLI -->|read/write| Reg
    Lib -->|read/write| Reg
    UI -->|HTTP fetch via daemon| Reg
    App -->|HTTP fetch via daemon| Reg

    classDef ext fill:#333,stroke:#888,color:#ddd
```

The arrows show **who initiates** the interaction. Every container
ultimately ends at the registry on disk; that's the cross-app
contract.

### Why four containers, not one

| Container | Why it's separate |
|---|---|
| **CLI** | Composable in shell scripts, npm scripts, CI. Doesn't need to load React or @electron/rebuild unless the user explicitly invokes those subcommands. |
| **Library** | Programmatic spawn from CAM apps' main processes (cam.scripts.runDetached, term.launch, docs.open all flow through `run()`). No CLI parsing overhead. |
| **UI subpath** | React component consumers (cam's renderer renders `<ServicesPanel>`; every launched app's renderer renders `<BackToCam>`). React is an OPTIONAL peer dep — CLI / library consumers never resolve React. |
| **Standalone app** | The "what's running" UX surface. Launched by developers (`npm run app`) or programmatically by cam (`cam.docs.open`-style camsys-run). Renders the same ServicesPanel cam embeds, in its own window. |

If they were one container, every consumer would pay the dep cost of
all of them — react in the CLI, electron-rebuild in the renderer, etc.
The subpath split keeps each consumer's tree minimal.

## Main process (`app/main/`) — standalone app only

The standalone Electron app is itself a CAM-launched app and uses
camsys's own `startHost`:

| Module | Responsibility |
|---|---|
| `app/main/index.ts` | BrowserWindow lifecycle. Calls `startHost({...})` from `src/host.ts`. Passes a HostWindow shim so `/cam-host/window-state {focus}` can lazy-create the window when cam launched us headless. Reads `CAM_HOST_MODE` to decide whether to materialize a window on boot. |

The renderer (`app/renderer/`) is a thin React shell — header + the
shared `ServicesPanel` + `BackToCam`. No domain logic beyond fetching
`/api/services` and rendering rows. The same component cam embeds.

## Library face (`src/index.ts`)

Re-exports from the focused modules:

- From `registry.ts`: `Entry`, `REGISTRY_DIR`, `registryDir`, `listEntries`, `readEntry`, `deleteEntry`, `isPidAlive`, `sweepStale`, `killService`, `updateEntryMeta`, `focusService`, `minimizeService`
- From `spawn.ts`: `run`, `RunOptions`
- From `ports.ts`: `pickFreePort`, `pickFreePorts`
- From `host.ts`: `startHost`, `readJsonBody`, `jsonResponse`, types
- From `rebuild.ts`: nothing currently (the CLI uses it directly; library consumers haven't needed it yet — easy to expose later)

### Read/write split

| Read paths | Write paths |
|---|---|
| `listEntries()`, `readEntry()`, `isPidAlive()` | `run()` (writes own entry on spawn, deletes on exit) |
| HTTP `GET /api/services` (via standalone app's daemon) | `updateEntryMeta()` (children advertise their daemon URL) |
| `sweepStale()` (read + delete) | `deleteEntry()`, `killService()` |

Atomic-write semantics on the write side (tmp + rename) so concurrent
reads never see partial JSON. No locking — registry is one file per
service, contended writes don't happen in practice.

## UI face (`ui/`)

| Component | Consumer surface |
|---|---|
| `ServicesPanel` | cam's System tab embeds this; standalone app's renderer hosts it. Takes a `ServicesIO` (read/list/kill verbs) so consumers control transport — cam injects an IPC-backed io; the standalone app injects HTTP fetch. |
| `BackToCam` | Every launched app's renderer mounts this. Detects `document.referrer.port === '5200'` and renders a "← Back to cam" chip. Style is overridable for inline-header vs floating use cases. |

React + react-dom are **optional peer deps**. CLI / library consumers
that don't import `camsys/ui` never resolve them.

## Transport model

```
[CLI / Library consumer]                  [UI consumer]
    spawn / read registry                    fetch /api/services
        ↓                                        ↓
    src/registry.ts                          standalone app's daemon
        ↓                                        ↓
    ~/.cam/run/<name>.json   ←-- writes --   src/host.ts (startHost)
                                                 ↓
                                             src/registry.ts
```

No daemon for CLI / library consumers — they touch the filesystem
directly. The standalone app is the only camsys face that runs a
daemon (because its renderer needs HTTP to reach main).

## Data model

One JSON file per running service. Schema is **intentionally tiny**
(extensions go in optional `meta`):

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
  "meta": {
    "url": "http://localhost:54321/",
    "mobileNavigable": true
  }
}
```

Every consumer ignores unknown keys, so schema additions land in
`meta` without breaking older readers.

## Where to go next

- [`03-components.md`](03-components.md) — drill into each module:
  what `src/registry.ts` actually exposes, how `src/spawn.ts`'s
  process-group + signal flow works, why `host.ts` was extracted,
  why `rebuild.ts` lives here instead of in each consumer.
- [README.md](../../README.md) — consumer-facing CLI + library docs
  with copy-pasteable integration recipes.
- [CLAUDE.md](../../CLAUDE.md) — maintainer-facing architectural
  rules + the extraction lens.
