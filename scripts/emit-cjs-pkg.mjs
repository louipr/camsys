#!/usr/bin/env node
// Writes a tiny package.json into dist/cjs/ telling Node to interpret
// the .js files in that subtree as CommonJS (overriding the top-level
// "type": "module"). Standard dual-package shim — keeps file
// extensions uniform (.js) and avoids per-file .cjs renaming.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const target = join('dist', 'cjs')
mkdirSync(target, { recursive: true })
writeFileSync(
  join(target, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
)
console.log(`wrote ${target}/package.json`)
