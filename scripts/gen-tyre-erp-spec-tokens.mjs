#!/usr/bin/env node
/**
 * Generates the SQL copy of the ERP wheel spellings the shared tyre map defines.
 *
 *   docs/document-specs/tyre-layouts.json  ->  the GENERATED block of
 *   supabase/migrations/20261126181000_tyre_position_erp_spec_aliases.sql
 *                                             (public.tyre_layout_spec_erp_tokens)
 *
 * Same derivation as erpSpecTokens() in src/lib/tyreLayoutSpec.js: for every
 * layout the map gives a display-scope code override or recorded aliases, one
 * row per (slot, spelling): rank 1 = the map's code, rank 2 = an alias. Tokens
 * are upper case with spaces, hyphens and underscores removed (LHR1-O -> LHR1O).
 * src/test/tyreErpSpecTokens.test.js fails when the SQL and the JS disagree.
 *
 *   node scripts/gen-tyre-erp-spec-tokens.mjs           rewrite the block
 *   node scripts/gen-tyre-erp-spec-tokens.mjs --check   exit 1 when stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPEC_PATH = resolve(root, 'docs/document-specs/tyre-layouts.json')
export const MIGRATION = resolve(root, 'supabase/migrations/20261126181000_tyre_position_erp_spec_aliases.sql')
const BEGIN = '-- BEGIN GENERATED SPEC ERP TOKENS'
const END = '-- END GENERATED SPEC ERP TOKENS'

const up = (s) => String(s ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '')

export function specTokenRows(spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))) {
  const overrides = spec.positionCodes.overrides
  const codeFor = (key, slot) => {
    const k = key.toLowerCase()
    for (const o of overrides) if (o.match.some((m) => k.includes(m)) && o.codes[slot]) return o.codes[slot]
    return spec.positionCodes.base[slot] || slot
  }
  const rows = []
  for (const [key, layout] of Object.entries(spec.layouts)) {
    const display = overrides.some((o) => o.scope === 'display' && o.match.some((m) => key.toLowerCase().includes(m)))
    if (!spec.positionAliases[key] && !display) continue
    for (const [slot] of layout.slots) {
      rows.push([key, slot, up(codeFor(key, slot)), 1])
      for (const a of (spec.positionAliases[key] || {})[slot] || []) rows.push([key, slot, up(a), 2])
    }
  }
  return rows
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`
export function renderBlock(rows = specTokenRows()) {
  return [BEGIN, rows.map((r, i) => `    (${q(r[0])}, ${q(r[1])}, ${q(r[2])}, ${r[3]})${i < rows.length - 1 ? ',' : ''}`).join('\n'), END].join('\n')
}

function main() {
  const src = readFileSync(MIGRATION, 'utf8')
  const a = src.indexOf(BEGIN); const b = src.indexOf(END)
  if (a < 0 || b < a) throw new Error('generated markers not found in the migration')
  const next = src.slice(0, a) + renderBlock() + src.slice(b + END.length)
  if (process.argv.includes('--check')) {
    if (next !== src) { console.error('stale: run node scripts/gen-tyre-erp-spec-tokens.mjs'); process.exit(1) }
    console.log('up to date')
    return
  }
  writeFileSync(MIGRATION, next)
  console.log(`wrote ${specTokenRows().length} rows`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
