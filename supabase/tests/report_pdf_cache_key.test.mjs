import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

// SQL mirror of src/lib/pdfCache/cacheKey.js, replayed over the SAME fixture the JS test
// reads (src/test/fixtures/pdfCacheKeyCases.json). The JS test proves the fixture is what
// the JS produces; this proves the SQL produces the same text and the same key.
// Only the pure functions of the draft are loaded (the block between the two markers); the
// draft is NOT applied anywhere.

const draft = readFileSync(new URL('../pending_migrations/20261117090000_report_pdf_cache.sql', import.meta.url), 'utf8')
const a = draft.indexOf('-- >>> PURE FUNCTIONS BEGIN'), b = draft.indexOf('-- <<< PURE FUNCTIONS END')
assert.ok(a > 0 && b > a, 'pure function markers present in the draft')
const PURE = draft.slice(a, b)
const fixture = JSON.parse(readFileSync(new URL('../../src/test/fixtures/pdfCacheKeyCases.json', import.meta.url), 'utf8'))

test('canonical JSON and sha256 match the JS for every fixture value', async () => {
  const db = new PGlite()
  await db.exec(PURE)
  for (const c of fixture.json) {
    const r = (await db.query('select public.pdf_canonical_json($1::jsonb) as canonical, public.pdf_sha256_hex(public.pdf_canonical_json($1::jsonb)) as sha', [c.json])).rows[0]
    assert.equal(r.canonical, c.canonical, `canonical: ${c.id}`)
    assert.equal(r.sha, c.sha256, `sha256: ${c.id}`)
  }
  assert.ok(fixture.json.length >= 10)
  await db.close()
})

test('the composed key matches the JS for every fixture case', async () => {
  const db = new PGlite()
  await db.exec(PURE)
  for (const c of fixture.keys) {
    const r = (await db.query('select public.pdf_cache_compose_key($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8) as key',
      [c.org, c.type, c.sourceId, c.sourceHash, c.evidenceRev, c.template, c.branding, c.clientRev])).rows[0]
    assert.equal(r.key, c.key, `key: ${c.id}`)
  }
  assert.equal(new Set(fixture.keys.map((c) => c.key)).size, fixture.keys.length, 'every fixture case has its own key')
  await db.close()
})

test('a jsonb row projection hashes the same whatever order the keys were written in', async () => {
  const db = new PGlite()
  await db.exec(PURE)
  const r = (await db.query(`select public.pdf_sha256_hex(public.pdf_canonical_json('{"b":1,"a":{"y":2.0,"x":[1,2]}}'::jsonb)) as h1,
                                    public.pdf_sha256_hex(public.pdf_canonical_json('{"a":{"x":[1,2],"y":2},"b":1.00}'::jsonb)) as h2,
                                    public.pdf_sha256_hex(public.pdf_canonical_json('{"a":{"x":[2,1],"y":2},"b":1}'::jsonb)) as h3`)).rows[0]
  assert.equal(r.h1, r.h2)
  assert.notEqual(r.h1, r.h3)
  await db.close()
})
