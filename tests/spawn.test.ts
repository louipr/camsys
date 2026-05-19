/**
 * End-to-end: `run` spawns a child, injects env vars, registers the
 * entry, propagates the exit code, cleans up the registry entry on
 * normal exit. HOME-override keeps tests off the user's real registry.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../src/spawn.js'
import { readEntry } from '../src/registry.js'

let originalHome: string | undefined
let tmpHome: string

beforeEach(() => {
  originalHome = process.env.HOME
  tmpHome = mkdtempSync(join(tmpdir(), 'camsys-spawn-test-'))
  process.env.HOME = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('camsys run', () => {
  it('injects CAM_VITE_PORT + CAM_CDP_PORT + CAM_SERVICE_NAME and exits 0', async () => {
    const code = await run({
      name: 'spawn-test-ok',
      argv: ['node', '-e', `
        if (!process.env.CAM_VITE_PORT) throw new Error('CAM_VITE_PORT missing')
        if (!process.env.CAM_CDP_PORT)  throw new Error('CAM_CDP_PORT missing')
        if (process.env.CAM_SERVICE_NAME !== 'spawn-test-ok') throw new Error('CAM_SERVICE_NAME mismatch')
        process.exit(0)
      `],
    })
    expect(code).toBe(0)
  })

  it('propagates non-zero exit code', async () => {
    const code = await run({
      name: 'spawn-test-fail',
      argv: ['node', '-e', 'process.exit(42)'],
    })
    expect(code).toBe(42)
  })

  it('removes the registry entry after child exits', async () => {
    await run({
      name: 'spawn-test-cleanup',
      argv: ['node', '-e', 'process.exit(0)'],
    })
    expect(readEntry('spawn-test-cleanup')).toBeNull()
  })
})
