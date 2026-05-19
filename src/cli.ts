#!/usr/bin/env node
/**
 * camsys CLI entry point.
 *
 * Subcommands:
 *   camsys run <name> -- <cmd> <args...>   wrap a process with port +
 *                                          registry + group-cleanup
 *   camsys list                            print registered services
 *   camsys port <name> [vite|cdp]          print a registered port
 *   camsys kill <name>                     SIGTERM the service's process group
 *   camsys cleanup                         sweep stale registry entries
 *   camsys --help                          this message
 *
 * The double-dash (`--`) in `run` separates camsys's own args from the
 * child command. Anything after `--` is passed verbatim to the child.
 */

import { run } from './spawn.js'
import { cmdList, cmdPort, cmdKill, cmdCleanup } from './commands.js'

function printHelp(): void {
  console.log(`camsys — process + port + registry wrapper for the CAM ecosystem

Usage:
  camsys run <name> -- <cmd> <args...>     spawn a wrapped service
  camsys list                              list registered services
  camsys port <name> [vite|cdp]            print a port (default: vite)
  camsys kill <name>                       kill a service by name
  camsys cleanup                           drop stale registry entries

Spawned children receive:
  CAM_VITE_PORT          ephemeral port (kernel-assigned)
  CAM_CDP_PORT           ephemeral port (kernel-assigned)
  CAM_SERVICE_NAME       the registered <name>

Registry lives at: ~/.cam/run/<name>.json
`)
}

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (!sub || sub === '-h' || sub === '--help') {
    printHelp()
    return 0
  }

  switch (sub) {
    case 'run': {
      // Expect: <name> -- <cmd> <args...>
      const sepIdx = rest.indexOf('--')
      if (sepIdx === -1) {
        console.error('camsys run: missing "--" separator before child command')
        return 2
      }
      const name = rest[0]
      const childArgv = rest.slice(sepIdx + 1)
      if (!name || sepIdx === 0) {
        console.error('camsys run: missing service name (camsys run <name> -- <cmd>)')
        return 2
      }
      if (childArgv.length === 0) {
        console.error('camsys run: missing child command after --')
        return 2
      }
      return run({ name, argv: childArgv })
    }
    case 'list':
      return cmdList()
    case 'port': {
      const [name, kind] = rest
      if (!name) {
        console.error('camsys port: missing service name')
        return 2
      }
      if (kind && kind !== 'vite' && kind !== 'cdp') {
        console.error(`camsys port: unknown kind '${kind}' (expected vite|cdp)`)
        return 2
      }
      return cmdPort(name, (kind as 'vite' | 'cdp' | undefined) ?? 'vite')
    }
    case 'kill': {
      const [name] = rest
      if (!name) {
        console.error('camsys kill: missing service name')
        return 2
      }
      return cmdKill(name)
    }
    case 'cleanup':
      return cmdCleanup()
    default:
      console.error(`unknown subcommand: ${sub}`)
      printHelp()
      return 2
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  },
)
