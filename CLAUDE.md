# camsys

System-level tooling for the CAM ecosystem. **Four faces from one
repo, all backed by one on-disk registry** at `~/.cam/run/`. Every
other CAM app (cam, audit, docskit, term) imports camsys.

This file is the maintainer + AI-agent contract. For consumer-side
"how do I use it" docs see [README.md](README.md); for architectural
overview (C4 levels + Mermaid diagrams), see the
[architecture](docs/architecture/) docs.

## Architecture

The architecture docs follow canonical C4 organization (per
[c4model.com](https://c4model.com)): one context diagram for the
system, one container diagram covering all four faces, one
component diagram per non-trivial container — all three component
diagrams live as `##` sections in a single `03-components.md` (the
same shape cam uses). The CLI binary has no section because it's
a thin dispatcher whose substance lives in the library module's
modules — covered inline in
[02-containers.md](docs/architecture/02-containers.md).

@architecture.json
@docs/architecture/01-context.md
@docs/architecture/02-containers.md
@docs/architecture/03-components.md

## The four faces

```
camsys/
├── src/
│   ├── cli.ts          → CLI entry (the `camsys` binary)
│   ├── commands.ts     →   subcommand implementations
│   ├── spawn.ts        →   `run({...})` — programmatic spawn-and-track
│   ├── registry.ts     →   ~/.cam/run/ read+write+watch primitives
│   ├── ports.ts        →   kernel-picked free ports
│   ├── host.ts         →   `startHost()` — HTTP shell for launched apps
│   ├── rebuild.ts      →   `rebuild()` — native-module ABI flipper
│   └── index.ts        → library face (re-exports everything)
├── ui/                 → React subpath (`camsys/ui`)
│   ├── ServicesPanel.tsx
│   ├── BackToCam.tsx
│   ├── styles.css
│   └── index.ts
├── app/                → standalone Electron app (uses src/ + ui/)
│   ├── main/index.ts
│   └── renderer/main.tsx
└── tests/              → vitest specs per src/* module
```

| Face | Public surface | Consumers |
|---|---|---|
| **CLI** | `camsys run / list / port / kill / cleanup / rebuild` | every CAM app's package.json scripts |
| **Library** (`camsys`) | `run`, `listEntries`, `readEntry`, `updateEntryMeta`, `focusService`, `killService`, `pickFreePort`, `pickFreePorts`, `startHost`, `rebuild`, `Entry`, `RunOptions`, `HostConfig`, `HostHandle`, `HostWindow`, `RequestHandler`, `readJsonBody`, `jsonResponse` | cam (main), audit (main), docskit (main), term (main) |
| **UI** (`camsys/ui`) | `ServicesPanel`, `BackToCam`, `CAM_DAEMON_PORT`, `CAM_DAEMON_URL` | cam (renderer), audit (renderer), docskit (renderer), term (renderer), camsys's own app |
| **Standalone Electron app** | the "running services" window | launched via `cam.scripts.runDetached` or `camsys run camsys:app -- electron .` |

The CLI is what every CAM ecosystem repo uses to launch services. The
library face is for cam itself + any other Node consumer that wants
the spawn-and-register lifecycle (or `startHost`, or `rebuild`).
The UI subpath is React components that consumers can render in their
own renderer process. The standalone app is camsys's own dogfood — the
window you open from cam to see what's running.

## What lives where (architectural intent)

`src/registry.ts` is the **only** module that touches
`~/.cam/run/*.json`. Reads, writes, atomicity, sweeping stale entries
— all here. Other modules that need the registry import the
primitives; they never read the directory themselves.

`src/spawn.ts` is the **only** module that spawns child processes via
camsys-run semantics. The CLI's `run` subcommand and the library's
`run()` export both flow through this single implementation. Process
group setup, signal forwarding, port injection, registry-write-then-
cleanup all live here.

`src/host.ts` (added in 0.2.0) is the **canonical HTTP shell** for
CAM-launched Electron apps. Every CAM-launched app's main process
calls `startHost({...})` instead of hand-rolling its own server. See
[`docs/launched-apps.md`](docs/launched-apps.md) for the full
launched-app contract that `startHost` implements (the spec lives
here in camsys; cam's `docs/architecture/launched-apps.md` documents
the host-side flow that uses the contract).

`src/rebuild.ts` (added in 0.3.0) is the **only place
`@electron/rebuild` is imported in the CAM ecosystem**. cam + audit +
term all delegate their native-module ABI flips here. When N-API
matures or `node:sqlite` ships in Electron, the implementation swap
happens here — every consumer inherits the fix.

`ui/BackToCam.tsx` (added in 0.4.0) is the **canonical chip** every
CAM-launched renderer mounts to surface a "← Back to cam" link when
the renderer was loaded by cam's BrowserWindow navigating to its
daemon URL (mobile mode). Detection is `document.referrer.port ===
CAM_DAEMON_PORT`. Style is overridable for inline-in-header vs
floating use cases.

## Architectural rules

- **Registry contract is sacred.** The shape of
  `~/.cam/run/<name>.json` is consumed by N apps. Adding a top-level
  field is breaking unless every consumer survives unknown keys.
  Extensions go in the optional `meta` field, which all consumers
  ignore-by-default.

- **CLI subcommands and library exports must stay in sync.** The
  CLI's `run` is the library's `run()`; the CLI's `list` is
  `listEntries()`; the CLI's `kill` is `killService()`. Don't add a
  CLI subcommand without a matching library export (and vice versa)
  unless there's a deliberate reason (e.g., the CLI-only `cleanup`
  sweep is a maintenance verb the library doesn't surface).

- **Library face has no Electron dep at runtime.** camsys is consumed
  by Node-only contexts (cam-plugins's MCP shell, scripts, CI).
  `src/host.ts` imports `ws` (allowed — it's a Node dep) and
  `src/rebuild.ts` dynamic-imports `@electron/rebuild` (so the dep
  doesn't load when consumers don't call rebuild). The UI subpath
  declares React as an OPTIONAL peer; CLI-only consumers never
  resolve React.

- **No reverse imports.** camsys does not depend on any other CAM
  ecosystem repo — not cam, not audit, not docskit, not term, not
  blueprint, not cam-plugins. Everything flows INTO camsys; nothing
  flows out except via the published surface above. If you find
  yourself wanting to `import { ... } from 'cam'` in camsys, stop —
  the design is wrong.

- **Backwards compatibility matters for the library face.** Every CAM
  repo pins camsys by git SHA via the lockfile (per cam's ADR-001).
  Breaking changes propagate transitively. Bump the minor version
  when adding a new public export; bump major only when removing or
  changing an existing one.

## Test layout

Per-face vitest specs in `tests/`:

| Spec file | Tests | npm script |
|---|---|---|
| `tests/ports.test.ts`    | `pickFreePort()` / `pickFreePorts()` | `npm run data:test` |
| `tests/registry.test.ts` | atomicity, sweep, stale-PID detection, file I/O | `npm run data:test` |
| `tests/spawn.test.ts`    | child process group setup, signal forwarding, detach mode | `npm run application:test` |
| `tests/host.test.ts`     | startHost end-to-end (real sockets) — SPA fallback, MIME, /cam-host/window-state, SSE, WebSocket upgrade | (part of `npm test`) |
| `tests/ui.test.ts`       | ServicesPanel rendering via happy-dom | `npm run presentation:test` |

Tests run on plain Node (vitest). No native-module ABI flip needed —
camsys itself has no native deps in its runtime; better-sqlite3 only
appears in *consumers'* dependency trees (cam, audit, blueprint).

## When adding a new public surface to camsys

Follow the precedent of `startHost` (0.2.0), `rebuild` (0.3.0),
`BackToCam` (0.4.0). The lens to apply:

> **Consumer fanout = N AND content = mechanical/spec-bound → extract
> to camsys. Consumer fanout = 1 OR content = app-specific design
> choice → keep in-repo.**

The three current extractions all met both criteria:
- `startHost`: 5 apps, the `/cam-host/window-state` endpoint is a
  *spec* in [`docs/launched-apps.md`](docs/launched-apps.md)
- `rebuild`: 3 apps, mechanical ABI flipping with one obvious correct
  implementation
- `BackToCam`: 4 apps, the `document.referrer.port === '5200'` rule
  is a *spec* (cam's daemon port)

Counter-examples (don't extract):
- Per-app operation dispatch (cam's WS-RPC vs audit's auto-iteration
  vs docskit's hand-routes) — different design choices per app
- Per-app UI chrome (PackageTile, FindBar, etc.) — context-specific
  visual choices

## Native module ABI

camsys itself has **no native modules at runtime**. The library
face is pure TS/JS; the standalone app uses no native deps. So
camsys's own dev/test loop has no rebuild dance — `npm test` and
`npm run app:dev` just work.

The `camsys rebuild` CLI command + `rebuild()` library function are
camsys's contribution to OTHER repos' ABI dance — see
`src/rebuild.ts`. The `@electron/rebuild` dep is loaded
dynamic-import so it doesn't hit camsys's own startup path.

## Related

- [README.md](README.md) — consumer-facing usage
- [MIGRATION.md](MIGRATION.md) — historical migration notes
- cam roadmap entries: "Camsys 0.2.0 — startHost extraction",
  "Native module rebuilds via camsys rebuild", "Post-arc cleanup
  sweep" (BackToCam extraction)
- [`docs/launched-apps.md`](docs/launched-apps.md) — the launched-app
  contract that `startHost` implements; cam's
  `docs/architecture/launched-apps.md` documents the host-side flow
