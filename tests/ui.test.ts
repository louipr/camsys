// @vitest-environment happy-dom
/**
 * Smoke test for the `camsys/ui` subpath.
 *
 * Verifies:
 *   1. The compiled dist resolves through the package's exports map.
 *      (Catches drift between the `./ui` exports entry and the actual
 *      built artifact path.)
 *   2. ServicesPanel renders, polls io.list(), and fires io.kill()
 *      via the Kill button. End-to-end of the IO contract that hosts
 *      will implement.
 *
 * Uses happy-dom + React's act() so we don't need a full Vitest React
 * preset. The component is small enough that a manual render loop is
 * cleaner than a full @testing-library setup.
 */
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, createElement } from 'react'

// React 19 act-environment opt-in (per React docs) — silences
// the "test environment not configured to support act(...)" warning.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Build is run by vitest's `prepare` hook on `npm install`; if someone
// runs the tests without building, this import will fail loudly.
import { ServicesPanel, type ServicesIO } from '../dist/ui/index.js'

describe('ServicesPanel', () => {
  it('renders the empty state when io.list returns []', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const io: ServicesIO = {
      list: vi.fn(async () => []),
      kill: vi.fn(async () => {}),
    }

    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(ServicesPanel, { io, refreshIntervalMs: 0 }))
    })

    expect(io.list).toHaveBeenCalled()
    expect(host.querySelector('.camsys-empty')).not.toBeNull()
    root.unmount()
  })

  it('renders rows with name + pid + ports + age + Kill button', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const io: ServicesIO = {
      list: vi.fn(async () => [
        {
          name: 'docskit',
          pid: 12345,
          pgid: 12345,
          vitePort: 51234,
          cdpPort: 51235,
          cmd: 'electron-vite dev',
          cwd: '/tmp',
          started: Date.now() - 3000,
        },
      ]),
      kill: vi.fn(async () => {}),
    }

    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(ServicesPanel, { io, refreshIntervalMs: 0 }))
    })

    expect(host.querySelector('.camsys-table')).not.toBeNull()
    expect(host.textContent).toContain('docskit')
    expect(host.textContent).toContain('12345')
    expect(host.textContent).toContain('51234')
    expect(host.textContent).toContain('51235')
    expect(host.querySelector('.camsys-kill')).not.toBeNull()
    root.unmount()
  })

  it('fires io.kill when the Kill button is clicked', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const entries = [
      {
        name: 'demo',
        pid: 1,
        pgid: 1,
        vitePort: 2000,
        cdpPort: 2001,
        cmd: 'x',
        cwd: '/',
        started: Date.now(),
      },
    ]
    const io: ServicesIO = {
      list: vi.fn(async () => entries),
      kill: vi.fn(async () => {}),
    }

    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(ServicesPanel, { io, refreshIntervalMs: 0 }))
    })

    const killBtn = host.querySelector<HTMLButtonElement>('.camsys-kill')
    expect(killBtn).not.toBeNull()
    await act(async () => {
      killBtn!.click()
    })
    expect(io.kill).toHaveBeenCalledWith('demo')
    root.unmount()
  })
})
