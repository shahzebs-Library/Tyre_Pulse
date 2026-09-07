import { spawnSync } from 'node:child_process'

// Node 26 exposes an experimental global localStorage unless explicitly
// disabled. jsdom supplies the correct per-window implementation. Older Node
// releases reject this flag in NODE_OPTIONS, so add it only when supported.
const disableNodeWebStorage = '--no-experimental-webstorage'
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
const inheritedOptions = process.env.NODE_OPTIONS?.trim() || ''
const shouldDisableNodeWebStorage = nodeMajor >= 26
const nodeOptions =
  shouldDisableNodeWebStorage && !inheritedOptions.includes(disableNodeWebStorage)
    ? `${inheritedOptions} ${disableNodeWebStorage}`.trim()
    : inheritedOptions

const result = spawnSync(
  process.execPath,
  ['./node_modules/vitest/vitest.mjs', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  },
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
