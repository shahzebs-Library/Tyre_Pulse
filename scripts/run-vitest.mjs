import { spawnSync } from 'node:child_process'

// Node 26 exposes an experimental global localStorage unless explicitly
// disabled. jsdom supplies the correct per-window implementation; passing the
// flag through NODE_OPTIONS ensures Vitest's worker processes disable Node's
// shadowing global too (a flag on only the parent process is insufficient).
const disableNodeWebStorage = '--no-experimental-webstorage'
const inheritedOptions = process.env.NODE_OPTIONS?.trim() || ''
const nodeOptions = inheritedOptions.includes(disableNodeWebStorage)
  ? inheritedOptions
  : `${inheritedOptions} ${disableNodeWebStorage}`.trim()

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
