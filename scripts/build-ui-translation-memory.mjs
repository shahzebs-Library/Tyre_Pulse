import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const enDir = path.join(root, 'src', 'locales', 'en')
const arDir = path.join(root, 'src', 'locales', 'ar')
const output = path.join(root, 'src', 'locales', 'legacy-ar-memory.json')
const memory = {}

function visit(en, ar) {
  if (typeof en === 'string' && typeof ar === 'string' && en.trim() && ar.trim()) {
    memory[en.trim()] = ar.trim()
    return
  }
  if (!en || !ar || typeof en !== 'object' || typeof ar !== 'object') return
  for (const key of Object.keys(en)) visit(en[key], ar[key])
}

for (const file of fs.readdirSync(enDir).filter((name) => name.endsWith('.json')).sort()) {
  const arPath = path.join(arDir, file)
  if (!fs.existsSync(arPath)) throw new Error(`Missing Arabic locale: ${file}`)
  visit(
    JSON.parse(fs.readFileSync(path.join(enDir, file), 'utf8')),
    JSON.parse(fs.readFileSync(arPath, 'utf8')),
  )
}

fs.writeFileSync(output, `${JSON.stringify(memory, null, 2)}\n`)
console.log(`Wrote ${Object.keys(memory).length} legacy translations to ${path.relative(root, output)}`)
