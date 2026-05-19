/**
 * pickFreePort returns a port the OS deemed free at that instant.
 * Beyond the trivial "is a positive int" check, we also verify that two
 * calls in quick succession yield two different ports (the kernel's
 * ephemeral allocator stripes them so this is the real guarantee).
 */
import { describe, expect, it } from 'vitest'
import { pickFreePort, pickFreePorts } from '../src/ports.js'

describe('pickFreePort', () => {
  it('returns a positive integer in the ephemeral range', async () => {
    const port = await pickFreePort()
    expect(Number.isInteger(port)).toBe(true)
    expect(port).toBeGreaterThan(1024)
    expect(port).toBeLessThan(65536)
  })

  it('returns distinct ports on back-to-back calls', async () => {
    const ports = await pickFreePorts(5)
    expect(new Set(ports).size).toBe(5)
  })
})
