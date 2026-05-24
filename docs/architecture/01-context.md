# Context (Level 1)

camsys is **system-level tooling for the CAM ecosystem** — a CLI +
library + React components + standalone Electron app, all backed by
one on-disk registry. It solves three problems other CAM apps would
otherwise each solve differently: port collisions, service visibility,
and orphan process cleanup. Every other CAM app (cam, audit, docskit,
term) imports camsys.

It's an **infrastructure dependency, not a user-facing product**. The
standalone Electron app exists for developers + cam itself to see
"what's running," but it's a thin window over the registry — the real
value is the CLI + library that every other CAM app composes against.

## External actors

```mermaid
flowchart TB
  Dev([Developer]):::person
  CAMApp([CAM apps<br/><i>cam, audit, docskit,<br/>term, cam-plugins</i>]):::person

  subgraph CamsysSys[" "]
    Camsys[camsys<br/><i>CLI + library + UI + standalone app</i>]:::system
  end

  OSPM[OS process model<br/><i>child_process.spawn,<br/>process groups, SIGTERM</i>]:::ext
  Kernel[Kernel<br/><i>free port allocation<br/>via bind&#40;0&#41;</i>]:::ext
  FS[Local filesystem<br/><i>~/.cam/run/&lt;name&gt;.json<br/>atomic tmp+rename</i>]:::ext
  ElectronRebuild[&#64;electron/rebuild<br/><i>native module ABI flipper<br/>downloads prebuilts</i>]:::ext
  Children([Wrapped child processes<br/><i>cam, audit, docskit, term,<br/>vitest, electron-vite, etc.</i>]):::person

  Dev -->|CLI: camsys run/list/kill/rebuild| Camsys
  CAMApp -->|library: import { run, startHost, listEntries, ... }| Camsys
  CAMApp -->|UI: import { ServicesPanel, BackToCam } from 'camsys/ui'| Camsys
  Camsys -->|spawn detached + setsid| OSPM
  Camsys -->|bind&#40;0&#41; → read port → release| Kernel
  Camsys -->|atomic writes for entries| FS
  Camsys -->|rebuild --target=electron| ElectronRebuild
  Camsys -->|launch + monitor + signal-forward| Children
  Children -->|optional: updateEntryMeta&#40;name, &#123;url&#125;&#41;| FS

  classDef person fill:#1f3b5c,stroke:#4a7ab0,color:#fff
  classDef system fill:#2a5293,stroke:#7aa4d4,color:#fff,stroke-width:2px
  classDef ext fill:#333,stroke:#888,color:#ddd
```

## What each external actor does for camsys

| Actor | camsys interacts with it to… |
|---|---|
| **Developer** | Wrap a service (`camsys run`), inspect what's running (`camsys list`), kill stuck processes (`camsys kill`), flip native-module ABI (`camsys rebuild`). |
| **CAM apps** | Import the library face — programmatic spawn via `run({...})`, registry reads via `listEntries()`, HTTP-shell setup via `startHost({...})`, native-rebuild via `rebuild({...})`. Import the UI face — `ServicesPanel` (cam embeds this), `BackToCam` (every launched app's renderer mounts this). |
| **OS process model** | Spawn children in their own process group (`setsid` / `detached: true`); on the wrapper's exit, `kill(-pgid, SIGTERM)` takes the whole subtree down — no zombie Electron + Vite + worker chains. |
| **Kernel** | Ask for ephemeral ports via `bind(0)` so two simultaneously-launched services never collide on port 5100 / 5173 / 9222. |
| **Local filesystem** | One JSON file per running service at `~/.cam/run/<name>.json`. Atomic tmp+rename so concurrent readers never see partial JSON. The registry is the cross-app source of truth — anyone can read it without going through camsys. |
| **`@electron/rebuild`** | Dynamic-imported only by `camsys rebuild --target=electron` (so CLI/library consumers that don't rebuild never load it). camsys is the only place this dep is referenced in the CAM ecosystem — all consumer repos delegate. |
| **Wrapped children** | The actual long-running processes (cam, audit, docskit, term, electron-vite dev, vitest, MCP-inspector, etc.). camsys launches them, injects port env vars, monitors exit, and registers/cleans up entries. Children may opt in to advertise their daemon URL via `updateEntryMeta(name, { url })` — cam reads `meta.url` to navigate-away in mobile mode. |

## What camsys is *not*

- **Not a service mesh.** No routing, no discovery beyond the registry list, no health checks beyond "is the PID alive."
- **Not a process supervisor.** camsys doesn't restart crashed children, doesn't backoff, doesn't manage a fleet. One spawn = one supervised lifetime.
- **Not a build tool.** `camsys rebuild` is one CLI verb that wraps `@electron/rebuild` for cross-repo consistency — it doesn't replace electron-builder, electron-vite, or vitest's own runners.
- **Not the CAM ecosystem's main process or shared kernel.** It's an infrastructure dep that every CAM app imports; it doesn't host them or know about their domain logic.
- **Not multi-user / multi-machine.** Registry is `~/.cam/run/` on one machine for one user, same as cam itself.

## Why one repo for four faces

The CLI, library, UI, and standalone app **all back the same registry**.
Splitting them across repos would mean:
- duplicated registry-format definition (drift risk on the shared
  contract every CAM app depends on)
- duplicated port-pick / atomic-write helpers
- N-1 trips through Git-URL dep updates for any cross-cutting change

One repo, one source of truth, multiple consumption shapes. Tests
exercise each face independently (`tests/{ports,registry,spawn,host,ui}.test.ts`).

## Where to go next

- [`02-containers.md`](02-containers.md) — inside camsys: the four faces (CLI binary, library module, UI subpath, standalone Electron app), how they share `src/registry.ts`, what each one exposes.
- [`03-components.md`](03-components.md) — module-level view: per-file responsibilities + cross-module call graph + the extraction lens that put `startHost`/`rebuild`/`BackToCam` in camsys.
- [README.md](../../README.md) — consumer-facing usage (CLI commands, integration recipe, registry format).
- [CLAUDE.md](../../CLAUDE.md) — maintainer + AI-agent contract (architectural rules, what NOT to do).
