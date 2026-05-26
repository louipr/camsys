# Launched-app contract

**Status:** shipped + maintained. Every CAM-ecosystem Electron app
(cam, audit, docskit, term, camsys's own app) conforms to this
contract. New launched apps adopt it by composing `startHost` +
`updateEntryMeta`.

This document is the protocol spec. The cam-side host implementation
(navigate-vs-focus dispatch, iOS-dock idempotency, the `launchService`
wrapper) lives in [cam's `launched-apps.md`](../../cam/docs/architecture/launched-apps.md).
Cam uses this contract; camsys defines it.

## The problem

cam launches managed apps (docskit, term, audit-desktop, camsys's
own services panel) as **detached** OS processes. Originally each
got a new window floating outside cam's column; cam had no way to
focus / minimize / close it from inside. In mobile mode (440-locked)
the floating window broke the "everything in one phone column" model.

We want **one mental model** for "I launched a thing from cam":
- the same affordances regardless of which app
- bounded by the cam column in mobile mode
- detached but reachable in desktop mode

## Decision: navigate-away, not embed

cam does **not** iframe launched apps. Instead:

1. The launched app runs its own HTTP daemon (built on
   `camsys.startHost`). The renderer it serves is identical
   whether reached via the launched-app's own BrowserWindow or
   via cam's BrowserWindow navigating to the same URL.
2. **Mobile mode**: cam navigates its column (`window.location.href`)
   to the launched app's daemon URL. The launched app's BrowserWindow
   stays headless (per `CAM_HOST_MODE=mobile`). Single visible
   window — cam's, now rendering the launched app.
3. **Desktop mode**: the launched app materializes its own
   BrowserWindow. cam focuses it via
   `POST /cam-host/window-state { action: 'focus' }`.

## The contract

To be a CAM-ecosystem launched app, a process must:

### 1. Run an HTTP daemon via `startHost`

```ts
import { startHost } from 'camsys'

const host = await startHost({
  renderer: { mode: 'dev'|'prod', /* … */ },
  win: lazyWindow,            // for /cam-host/window-state focus/minimize
  onRequest: appSpecificRoutes,
  webSocket: optionalWsConfig,
})
```

`startHost` owns: HTTP server lifecycle, static-bundle serve with
SPA fallback, MIME, vite dev proxy, the `/cam-host/window-state`
spec endpoint, optional SSE + optional WebSocket upgrade. App-specific
routes hook in via `onRequest`.

### 2. Respond to `POST /cam-host/window-state { action }`

`startHost` handles this when you pass a `win` config — for `focus`
it covers `isMinimized + restore + show + focus`; for `minimize` it
calls `win.minimize()`. The `win` you pass implements the
`HostWindow` interface (typically your `BrowserWindow` or a lazy
wrapper that materializes on demand).

### 3. Be launched via `camsys run`

Either via the CLI (`camsys run <name> -- <cmd>`) inside a package's
`dev` script, OR programmatically via `camsysRun({...})` from
cam's main process. The wrapper writes the registry entry at
`~/.cam/run/<CAM_SERVICE_NAME>.json` on spawn and deletes it on
exit.

### 4. Call `updateEntryMeta(name, { url })` after the daemon binds

```ts
import { updateEntryMeta } from 'camsys'

const host = await startHost({...})
updateEntryMeta(process.env.CAM_SERVICE_NAME!, { url: host.url })
```

cam's launchers `waitForEntry` for `meta.url` to appear before
invoking `openLaunchedApp` — without this, the mobile-mode navigate
would race the daemon's bind.

### 5. Respect `CAM_HOST_MODE`

When `env.CAM_HOST_MODE === 'mobile'`, stay headless — don't
materialize your own BrowserWindow. cam's BrowserWindow will
navigate to your daemon URL.

The `HostWindow` interface accepts a lazy implementation: create
the window on first `focus()` call rather than at startup. cam in
mobile mode keeps you headless; if the user flips to desktop,
cam POSTs `/cam-host/window-state { action: 'focus' }` and your
lazy window materializes for the first time.

### 6. (Optional) Render `BackToCam` chip

```tsx
import { BackToCam } from 'camsys/ui'

<BackToCam />              // default: fixed top-right floating chip
<BackToCam style={{ position: 'static' }} />  // inline-in-header
```

Detects `document.referrer.port === '5200'` (cam's daemon port)
and renders an `<a href={CAM_DAEMON_URL}>` link back. All 5 apps
in the ecosystem today render this; the helper is part of
`camsys/ui` (extracted in camsys 0.4.0).

### 7. Quit on `window-all-closed` (macOS)

```ts
app.on('window-all-closed', () => app.quit())
```

NOT Electron's default `if (process.platform !== 'darwin') app.quit()`.
A camsys-launched app is ephemeral tooling, not a user-installed
macOS app — keeping the process alive in the dock with no window
strands the registry entry and breaks iOS-dock idempotency on the
next launch click.

## Registry entry shape

```json
{
  "name": "docs:cam",
  "pid": 84321,
  "pgid": 84321,
  "vitePort": 51234,
  "cdpPort": 51235,
  "cmd": "electron-vite dev",
  "cwd": "/Users/lpabon/projects/docskit",
  "started": 1747663200123,
  "meta": {
    "url": "http://localhost:54321/"
  }
}
```

Schema is intentionally tiny; extensions go in optional `meta`.
Atomic writes via `writeFileSync(tmp) + renameSync` — concurrent
readers never see partial JSON. Every consumer ignores unknown
keys → additions in `meta` don't break older readers.

## Reference implementations

| App | Repo | Role |
|---|---|---|
| cam | `cam` | The host (launches everything else). Conforms to (3,4,5,7); is the *target* of (1,2) only at the daemon-WS level (ADR-010), not the launched-app contract — cam is the launcher, not a launchee. |
| camsys's own app | `camsys/app/` | Reference dogfood. The thinnest possible launched-app — header + `ServicesPanel` + `BackToCam`. |
| docskit | `docskit/app/main/` | Wiki renderer pointed at a project's `docs.json`. |
| audit | `audit/controller/main/` | Findings viewer. Plain-fetch `ServicesIO`-style transport. |
| term | `term/app/main/` | Named-PTY-runner. Wraps an arbitrary command in xterm.js. |

## Related

- [`startHost` source](../src/host.ts) — the shared HTTP shell
- [`registry.ts`](../src/registry.ts) — the registry contract (`Entry` + `updateEntryMeta`)
- [cam's `launched-apps.md`](../../cam/docs/architecture/launched-apps.md) — the host-side implementation (launchers, iOS-dock idempotency, mobile/desktop dispatch)
- camsys 0.2.0 — `startHost` extraction (5 apps × ~100 LOC of mechanical scaffolding → one shared shell)
- camsys 0.4.0 — `BackToCam` extraction (4 apps × per-repo copies → one `camsys/ui` export)
