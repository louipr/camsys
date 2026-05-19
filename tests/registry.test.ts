/**
 * Registry round-trip + stale-sweep behavior. REGISTRY_DIR resolves to
 * `~/.cam/run` at call time via the lazy `registryDir()` getter, so each
 * test overrides HOME to point at a tmpdir.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeEntry,
  readEntry,
  deleteEntry,
  listEntries,
  sweepStale,
} from '../src/registry.js'

let originalHome: string | undefined
let tmpHome: string

beforeEach(() => {
  originalHome = process.env.HOME
  tmpHome = mkdtempSync(join(tmpdir(), 'camsys-test-'))
  process.env.HOME = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('registry round-trip', () => {
  it('write → read → delete', () => {
    const entry = {
      name: 'demo',
      pid: 12345,
      pgid: 12345,
      vitePort: 51234,
      cdpPort: 51235,
      cmd: 'echo hi',
      cwd: '/tmp',
      started: Date.now(),
    }
    writeEntry(entry)
    const read = readEntry('demo')
    expect(read).not.toBeNull()
    expect(read!.pid).toBe(12345)
    expect(read!.vitePort).toBe(51234)
    deleteEntry('demo')
    expect(readEntry('demo')).toBeNull()
  })

  it('listEntries enumerates current registry contents in start-time order', () => {
    writeEntry({ name: 'a', pid: 1, pgid: 1, cmd: 'a', cwd: '/', started: 1000 })
    writeEntry({ name: 'b', pid: 2, pgid: 2, cmd: 'b', cwd: '/', started: 2000 })
    const entries = listEntries()
    expect(entries.map((e) => e.name)).toEqual(['a', 'b'])
  })

  it('rejects names containing path separators or dot-traversal', () => {
    expect(() =>
      writeEntry({ name: '../escape', pid: 1, pgid: 1, cmd: 'x', cwd: '/', started: 0 }),
    ).toThrow(/invalid service name/)
    expect(() =>
      writeEntry({ name: 'a/b', pid: 1, pgid: 1, cmd: 'x', cwd: '/', started: 0 }),
    ).toThrow(/invalid service name/)
  })

  it('sweepStale removes entries with dead PIDs', () => {
    writeEntry({ name: 'ghost', pid: 999999, pgid: 999999, cmd: 'x', cwd: '/', started: 0 })
    writeEntry({ name: 'self',  pid: process.pid, pgid: process.pid, cmd: 'x', cwd: '/', started: 0 })
    const swept = sweepStale()
    expect(swept).toContain('ghost')
    expect(swept).not.toContain('self')
    expect(readEntry('ghost')).toBeNull()
    expect(readEntry('self')).not.toBeNull()
  })
})
