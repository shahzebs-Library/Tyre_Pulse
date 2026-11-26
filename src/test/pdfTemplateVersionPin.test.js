// @vitest-environment node
/**
 * A stored PDF is reused for as long as its key matches, and the generator's TEMPLATE
 * VERSION is part of the key. If someone changes how a report is drawn and forgets to
 * bump the version, every already-stored copy would keep being served with the OLD look.
 *
 * This test hashes the generator source. When it fails:
 *   1. bump the version in src/lib/pdfCache/templates.js (TEMPLATE_VERSIONS)
 *   2. put the new version and the new hash printed below into PINS
 * Whitespace-only edits do not change the hash.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { TEMPLATE_VERSIONS } from '../lib/pdfCache/templates'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const sha = (s) => createHash('sha256').update(squash(s)).digest('hex').slice(0, 16)

function inspectionGeneratorSource() {
  const src = read('../lib/exportUtils.js')
  const a = src.indexOf('function _insPill(')
  const b = src.indexOf('export async function exportAccidentCasePdf')
  if (a < 0 || b < a) throw new Error('inspection generator markers not found')
  return src.slice(a, b)
}

const PINS = {
  tyre_inspection: { version: 'ins-2026.11.3', hash: 'c894192d7f84185b' },
  tyre_observation: { version: 'obs-1.0', hash: '81cd28ea7c292bf9' },
}

describe('report generators are pinned to their template version', () => {
  it('inspection report generator', () => {
    const hash = sha(inspectionGeneratorSource())
    expect({ version: TEMPLATE_VERSIONS.tyre_inspection, hash }, `inspection generator hash is now ${hash}`).toEqual(PINS.tyre_inspection)
  })
  it('observation report generator', () => {
    const hash = sha(read('../lib/observationReportPdf.js'))
    expect({ version: TEMPLATE_VERSIONS.tyre_observation, hash }, `observation generator hash is now ${hash}`).toEqual(PINS.tyre_observation)
  })
})
