// @vitest-environment node
/**
 * The cache key rule, in JavaScript. The SAME fixture is replayed against the SQL
 * functions by supabase/tests/report_pdf_cache_key.test.mjs, so the two cannot drift.
 * Regenerate the expected values with:  UPDATE_PDF_FIXTURE=1 npx vitest run src/test/pdfCacheKey.test.js
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson, canonicalNumber, sha256Hex, sha256HexOfBytes, composeCacheKey, sourceHash,
  inspectionProjection, observationProjection, brandingRevision, clientRevision, INSPECTION_FIELDS,
} from '../lib/pdfCache/cacheKey'
import { observationClientDoc } from '../lib/pdfCache/reportRequests'

const FIXTURE = fileURLToPath(new URL('./fixtures/pdfCacheKeyCases.json', import.meta.url))

// Inputs only. `json` is raw JSON TEXT so that number spellings such as 32.50 reach Postgres as written.
const JSON_CASES = [
  ['null', 'null'], ['true', 'true'], ['empty object', '{}'], ['empty array', '[]'],
  ['key order', '{"b":1,"a":2,"B":3,"aa":4,"_":5}'],
  ['nested', '{"z":{"y":[3,2,1,{"b":null,"a":false}]},"a":"x"}'],
  ['trailing zeros', '{"pressure_psi":32.50,"odometer_km":120000.0,"tread":7.25}'],
  ['integers and negatives', '[0,-1,42,-3.5,1000000]'],
  ['big and small', '[1e21,1.5e-7,123456789012,0.000001]'],
  ['strings', '{"s":"He said \\"go\\"","path":"a/b\\\\c","tab":"a\\tb","nl":"line1\\nline2","ctl":"\\u0001x"}'],
  ['unicode', '{"ar":"\\u0625\\u0637\\u0627\\u0631","emoji":"\\ud83d\\ude9a","mixed":"TM400 \\u2013 ok"}'],
  ['tyre conditions', '{"LHF1":{"checked":true,"position":"LHF1","condition":"Good","pressure_psi":108,"photo_url":"tp-storage://tyre-photos/o/a/lhf1.jpg"},"RHR1":{"condition":"Damaged","pressure_psi":95.0,"tread_mm":null}}'],
]
const ORG = '00000000-0000-0000-0000-0000000000AA'
const SRC = '11111111-2222-4333-8444-5555555555FF'
const KEY_CASES = [
  { id: 'base', type: 'tyre_inspection', sourceHash: 'a'.repeat(64), evidenceRev: 'b'.repeat(64), template: 'ins-2026.11.1', branding: 'b-0123456789abcdef01234567', clientRev: '' },
  { id: 'observation', type: 'tyre_observation', sourceHash: 'a'.repeat(64), evidenceRev: 'b'.repeat(64), template: 'obs-1.0', branding: 'b-0123456789abcdef01234567', clientRev: 'c-0123456789abcdef01234567' },
  { id: 'template bump', type: 'tyre_inspection', sourceHash: 'a'.repeat(64), evidenceRev: 'b'.repeat(64), template: 'ins-2026.12.1', branding: 'b-0123456789abcdef01234567', clientRev: '' },
  { id: 'branding change', type: 'tyre_inspection', sourceHash: 'a'.repeat(64), evidenceRev: 'b'.repeat(64), template: 'ins-2026.11.1', branding: 'b-ffffffffffffffffffffffff', clientRev: '' },
  { id: 'evidence change', type: 'tyre_inspection', sourceHash: 'a'.repeat(64), evidenceRev: 'c'.repeat(64), template: 'ins-2026.11.1', branding: 'b-0123456789abcdef01234567', clientRev: '' },
  { id: 'no evidence', type: 'tyre_inspection', sourceHash: 'a'.repeat(64), evidenceRev: '', template: 'ins-2026.11.1', branding: 'b-0123456789abcdef01234567', clientRev: '' },
]

async function build() {
  const json = []
  for (const [id, text] of JSON_CASES) {
    const canonical = canonicalJson(JSON.parse(text))
    json.push({ id, json: text, canonical, sha256: await sha256Hex(canonical) })
  }
  const keys = []
  for (const c of KEY_CASES) keys.push({ ...c, org: ORG, sourceId: SRC, key: await composeCacheKey({ ...c, org: ORG, sourceId: SRC }) })
  return { note: 'Shared by src/test/pdfCacheKey.test.js (JS) and supabase/tests/report_pdf_cache_key.test.mjs (SQL). Synthetic values only.', json, keys }
}

describe('pdf cache key', () => {
  it('matches the shared fixture (regenerate with UPDATE_PDF_FIXTURE=1)', async () => {
    const built = await build()
    if (process.env.UPDATE_PDF_FIXTURE) writeFileSync(FIXTURE, JSON.stringify(built, null, 2) + '\n')
    expect(built).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')))
  })

  it('sha256 is the standard one', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256HexOfBytes(new TextEncoder().encode('abc'))).toBe(await sha256Hex('abc'))
  })

  it('canonical JSON ignores key order, whitespace and number spelling', () => {
    expect(canonicalJson(JSON.parse('{"b":1.0,"a":[2 , 3]}'))).toBe(canonicalJson({ a: [2, 3], b: 1 }))
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}')
    expect(canonicalNumber(1e21)).toBe('1000000000000000000000')
    expect(canonicalNumber(1.5e-7)).toBe('0.00000015')
    expect(canonicalNumber(-0)).toBe('0')
    expect(canonicalNumber(NaN)).toBe('null')
  })

  it('array order is content: reordering changes the hash', async () => {
    expect(await sourceHash({ a: [1, 2] })).not.toBe(await sourceHash({ a: [2, 1] }))
  })

  const row = {
    id: SRC, asset_no: 'TM400', site: 'ALPHA EAST PLANT', country: 'KSA', vehicle_type: 'TR-MIXER', status: 'Done',
    approval_status: 'pending_approval', inspection_date: '2026-11-10', notes: 'ok',
    tyre_conditions: { LHF1: { condition: 'Worn', pressure_psi: 101 } },
    gps_lat: 24.7, locked: false, organisation_id: ORG, some_future_column: 'x',
  }

  it('the inspection key covers every printed field and nothing else', async () => {
    const base = await sourceHash(inspectionProjection(row))
    expect(Object.keys(inspectionProjection(row)).sort()).toEqual([...INSPECTION_FIELDS].sort())
    // not printed: changing them must not invalidate a stored PDF
    expect(await sourceHash(inspectionProjection({ ...row, gps_lat: 1, locked: true, some_future_column: 'y' }))).toBe(base)
    // printed: each one changes the revision
    for (const patch of [{ notes: 'changed' }, { approval_status: 'approved' }, { odometer_km: 5 }, { approver_signature: '<svg/>' },
      { tyre_conditions: { LHF1: { condition: 'Worn', pressure_psi: 102 } } },
      { tyre_conditions: { LHF1: { condition: 'Worn', pressure_psi: 101, photo_url: 'tp-storage://tyre-photos/a.jpg' } } }]) {
      expect(await sourceHash(inspectionProjection({ ...row, ...patch }))).not.toBe(base)
    }
  })

  it('ERP confirmation changes the observation key only', async () => {
    const actions = [{ id: 'a2', status: 'Open', source_detail: 'damage:LHF1' }, { id: 'a1', status: 'Open', source_detail: 'general' }]
    const ins0 = await sourceHash(inspectionProjection(row))
    const obs0 = await sourceHash(observationProjection(row, { actions }))
    const erpLinks = [{ action_id: 'a2', source_job_card: 'SYN/JC/1', reviewed_at: '2026-11-12T08:00:00+00:00', reviewed_by: 'u1',
      work_order_snapshot: { status: 'Completed' }, decision_note: 'matches the job card' }]
    const obs1 = await sourceHash(observationProjection(row, { actions, erpLinks }))
    expect(obs1).not.toBe(obs0)
    expect(await sourceHash(inspectionProjection(row))).toBe(ins0)          // the inspection projection has no ERP input at all
    expect(inspectionProjection.length).toBe(1)
    // action order as read from the database does not matter
    expect(await sourceHash(observationProjection(row, { actions: [...actions].reverse() }))).toBe(obs0)
    // an action changing status is an observation change
    expect(await sourceHash(observationProjection(row, { actions: [{ ...actions[0], status: 'Closed' }, actions[1]] }))).not.toBe(obs0)
  })

  it('a file name is never part of the key; every key input is', async () => {
    const base = { org: ORG, type: 'tyre_inspection', sourceId: SRC, sourceHash: 'h', evidenceRev: 'e', template: 't', branding: 'b', clientRev: '' }
    const k = await composeCacheKey(base)
    expect(await composeCacheKey({ ...base, fileName: 'Tyre Insp TM400.pdf' })).toBe(k)
    expect(await composeCacheKey({ ...base, org: ORG.toLowerCase(), sourceId: SRC.toLowerCase() })).toBe(k)   // uuid case is not content
    for (const patch of [{ org: '00000000-0000-0000-0000-0000000000ab' }, { type: 'tyre_observation' }, { sourceId: SRC.replace('F', 'E') },
      { sourceHash: 'h2' }, { evidenceRev: 'e2' }, { template: 't2' }, { branding: 'b2' }, { clientRev: 'c' }]) {
      expect(await composeCacheKey({ ...base, ...patch })).not.toBe(k)
    }
  })

  it('branding revision: stable across re-signed logo links, changes with the logo, colour or diagram background', async () => {
    const b = { logo_url: 'https://x.example/storage/v1/object/sign/logos/acme.png?token=AAA', accent_color: '#16a34a' }
    const rev = await brandingRevision({ branding: b, company: 'Acme', diagramBg: '#000000' })
    expect(rev).toMatch(/^b-[0-9a-f]{24}$/)
    expect(await brandingRevision({ branding: { ...b, logo_url: b.logo_url.replace('AAA', 'BBB') }, company: 'Acme', diagramBg: '#000000' })).toBe(rev)
    expect(await brandingRevision({ branding: { ...b, logo_url: b.logo_url.replace('acme', 'other') }, company: 'Acme', diagramBg: '#000000' })).not.toBe(rev)
    expect(await brandingRevision({ branding: { ...b, accent_color: '#000' }, company: 'Acme', diagramBg: '#000000' })).not.toBe(rev)
    expect(await brandingRevision({ branding: b, company: 'Acme', diagramBg: '#ffffff' })).not.toBe(rev)
    expect(await brandingRevision({})).toMatch(/^b-/)
  })

  it('client revision: tyre replaced since the inspection is a new observation revision', async () => {
    const f = [{ key: 'k1', kind: 'tyre', position: 'LHF1', text: 'Worn', severity: 'High', tone: 'bad', tyreNow: { state: 'on_vehicle' } }]
    const a = await clientRevision(observationClientDoc(f))
    expect(a).toMatch(/^c-[0-9a-f]{24}$/)
    expect(await clientRevision(observationClientDoc([{ ...f[0], tyreNow: { state: 'replaced' } }]))).not.toBe(a)
    expect(await clientRevision(observationClientDoc([{ ...f[0], row: { anything: 1 }, inspector: 'x' }]))).toBe(a)   // not printed per finding
    expect(await clientRevision('')).toBe('')
  })
})
