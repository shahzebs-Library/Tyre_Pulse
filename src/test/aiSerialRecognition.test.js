import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { processJob, PROMPT_VERSION, parseRawObject } from '../../supabase/functions/ai-tyre-inspection/logic.ts'
import {
  sanitizeSerialReading, compareSerial, normalizeSerialText, serialIsStrong, serialFlagFrom,
  promptFor, promptVersionFor, extractSerialFromOutput, partialConsistent,
  SERIAL_PROMPT_SECTION, SERIAL_PROMPT_VERSION, SERIAL_REVIEW_OUTCOMES,
} from '../../supabase/functions/ai-tyre-inspection/serial.ts'

const cases = JSON.parse(readFileSync('src/test/fixtures/aiSerialOutcomeCases.json', 'utf8')).cases
const index = readFileSync('supabase/functions/ai-tyre-inspection/index.ts', 'utf8')
const PROMPT = index.match(/^const PROMPT = "(.*)";\s*$/m)[1]

// ---------------------------------------------------------------------------------------------
describe('serial flag OFF keeps the v4 damage path byte-identical', () => {
  it('the v4 prompt text in index.ts is unchanged (sha256 of origin/main 2026-11-16)', () => {
    expect(createHash('sha256').update(PROMPT).digest('hex'))
      .toBe('0f693c4e92abba6fc408913e5c95210ffff7641e2516f48a053d24b0c8581673')
  })
  it('promptFor/promptVersionFor return the base unchanged when off', () => {
    expect(promptFor(PROMPT, false)).toBe(PROMPT)
    expect(promptVersionFor(PROMPT_VERSION, false)).toBe('tyre-photo-v4')
    expect(promptFor(PROMPT, true)).toBe(PROMPT + SERIAL_PROMPT_SECTION)
    expect(promptVersionFor(PROMPT_VERSION, true)).toBe(SERIAL_PROMPT_VERSION)
  })
  it('the serial section is plain ASCII with no em/en dashes', () => {
    expect(/^[\x20-\x7e]+$/.test(SERIAL_PROMPT_SECTION)).toBe(true)
  })
  it('index.ts sends promptFor(PROMPT, serialEnabled) to every provider attempt', () => {
    expect(index).toMatch(/const prompt = promptFor\(PROMPT, serialEnabled\)/)
    expect(index.match(/, PROMPT, photo\)/g)).toBeNull()
    expect(index.match(/, prompt, photo\)/g)).toHaveLength(2)
  })

  const OUTPUT = JSON.stringify({ assessable: true, reason: 'clear', recommendation: 'monitor',
    defects: [{ type: 'sidewall_cut', description: 'cut', visibleEvidence: 'visible', severity: 'moderate' }],
    imageQuality: { focus: 'good', lighting: 'good', subject: 'tyre' },
    serial: { raw: 'YMA 55312', source: 'moulded', confidence: 'high', status: 'readable' } })

  function run(serialEnabled, { recordSerial, reuse } = {}) {
    const job = { id: 'j1', organisation_id: 'org-1', photo_ref: 'tp-storage://b/p.jpg', attempts: 0, status: 'processing', inspection_id: 'i1', tyre_position: 'R1Li' }
    const patches = []; const calls = { recorded: [], reusedWith: null }
    const deps = {
      config: { providerName: 'anthropic', model: 'claude-haiku-5-5', rates: { input: 0.1, output: 0.5 }, reserveUsd: 0.01, dailyLimitUsd: 1,
        ...(serialEnabled === undefined ? {} : { serialEnabled }) },
      now: () => new Date('2026-11-16T08:00:00Z'),
      updateJob: async (_id, patch, from) => { if (job.status !== from) return false; patches.push(patch); Object.assign(job, patch); return true },
      insertTokenLog: async () => {},
      reserveBudget: async () => ({ ok: true }),
      settleBudget: async () => {},
      loadPhoto: async () => ({ mediaType: 'image/jpeg', base64: 'AA==', bytes: 90000, width: 1280, height: 960, sha256: 'abc' }),
      findReusable: async (_j, _sha, pv) => { calls.reusedWith = pv; return reuse ? { id: 'src', analysis: reuse } : null },
      callProvider: async () => ({ provider: { usage: { input_tokens: 5000, output_tokens: 300 } }, output: OUTPUT }),
      ...(recordSerial ? { recordSerial: async (j, r) => { calls.recorded.push(r); return recordSerial(j, r) } } : {}),
    }
    return { job, patches, calls, done: processJob(deps, job) }
  }

  it('flag absent and flag false produce identical writes, with no serial key and v4 version', async () => {
    const a = run(undefined); await a.done
    const b = run(false, { recordSerial: async () => { throw new Error('must not be called') } }); await b.done
    expect(JSON.stringify(b.patches)).toBe(JSON.stringify(a.patches))
    const final = b.job
    expect(final.status).toBe('completed')
    expect(final.prompt_version).toBe('tyre-photo-v4')
    expect(final.analysis.serial).toBeUndefined()
    expect(final.analysis.flags.some((f) => String(f.code).startsWith('serial'))).toBe(false)
    expect(b.calls.reusedWith).toBe('tyre-photo-v4')
    expect(b.calls.recorded).toHaveLength(0)
  })

  it('flag on adds a sanitised serial and a review flag, damage fields unchanged', async () => {
    const off = run(false); await off.done
    const on = run(true, { recordSerial: async () => ({ outcome: 'mismatch', reason: 'different_serial', needsReview: true, registered: null }) })
    await on.done
    expect(on.job.prompt_version).toBe(SERIAL_PROMPT_VERSION)
    expect(on.calls.reusedWith).toBe(SERIAL_PROMPT_VERSION)
    const { serial, flags, ...damageOn } = on.job.analysis
    const { flags: flagsOff, ...damageOff } = off.job.analysis
    expect(damageOn).toEqual(damageOff)
    expect(serial).toMatchObject({ raw: 'YMA 55312', normalized: 'YMA55312', source: 'moulded', status: 'readable' })
    expect(flags.map((f) => f.code)).toContain('serial_mismatch')
    expect(flags.filter((f) => !String(f.code).startsWith('serial'))).toEqual(flagsOff)
  })

  it('a failing comparison never fails the damage analysis', async () => {
    const on = run(true, { recordSerial: async () => { throw new Error('rpc down') } }); await on.done
    expect(on.job.status).toBe('completed')
    expect(on.job.analysis.flags.map((f) => f.code)).toContain('serial_compare_unavailable')
  })

  it('a match adds no review flag', async () => {
    const on = run(true, { recordSerial: async () => ({ outcome: 'match', reason: 'same_serial', needsReview: false, registered: null }) })
    await on.done
    expect(on.job.analysis.flags.some((f) => String(f.code).startsWith('serial'))).toBe(false)
  })

  it('reused v5 analysis is compared again for the new job (no provider call)', async () => {
    const on = run(true, { reuse: { assessable: true, defects: [], serial: { raw: 'YMA55312', source: 'label', confidence: 'high', status: 'readable' } },
      recordSerial: async () => ({ outcome: 'match', reason: 'same_serial', needsReview: false, registered: null }) })
    await on.done
    expect(on.calls.recorded).toHaveLength(1)
    expect(on.calls.recorded[0].normalized).toBe('YMA55312')
    expect(on.job.cost_usd).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
describe('sanitizeSerialReading never invents characters', () => {
  it('derives the value from raw and ignores a model "normalized" that adds characters', () => {
    const r = sanitizeSerialReading({ raw: 'YMA 553?2', normalized: 'YMA55312', source: 'label', confidence: 'high', status: 'readable' })
    expect(r.normalized).toBe('YMA553?2')
    expect(r.status).toBe('partial')
    expect(r.confidence).toBe('medium')
    expect(r.issues).toEqual(expect.arrayContaining(['uncertain_characters', 'model_normalized_differs_from_raw']))
  })
  it('missing, wrong shape, empty raw or source none => unreadable with no value', () => {
    for (const input of [undefined, null, 'YMA55312', [], {}, { raw: '', source: 'label', status: 'readable', confidence: 'high' },
      { raw: 'YMA55312', source: 'none', status: 'readable', confidence: 'high' }, { raw: '????', source: 'moulded', status: 'partial', confidence: 'low' }]) {
      const r = sanitizeSerialReading(input)
      expect(r.status).toBe('unreadable')
      expect(r.normalized).toBeNull()
      expect(r.confidence).toBe('low')
    }
  })
  it('a claimed unreadable stays unreadable even with text (kept as raw evidence)', () => {
    const r = sanitizeSerialReading({ raw: 'YM', source: 'moulded', status: 'unreadable', confidence: 'low' })
    expect(r).toMatchObject({ status: 'unreadable', normalized: null, raw: 'YM' })
  })
  it('a tyre size or DOT code is never a readable serial', () => {
    expect(sanitizeSerialReading({ raw: '315/80R22.5', source: 'moulded', status: 'readable', confidence: 'high' }))
      .toMatchObject({ status: 'partial', issues: expect.arrayContaining(['not_a_strong_serial']) })
    expect(sanitizeSerialReading({ raw: 'DOT 4521', source: 'moulded', status: 'readable', confidence: 'high' }).status).toBe('partial')
  })
  it('short readings are partial; unknown enums fall to the least certain value', () => {
    expect(sanitizeSerialReading({ raw: 'A12', source: 'label', status: 'readable', confidence: 'high' }).status).toBe('partial')
    const r = sanitizeSerialReading({ raw: 'YMA55312', source: 'sticker', status: 'great', confidence: 'certain' })
    expect(r).toMatchObject({ source: 'none', status: 'unreadable', confidence: 'low' })
  })
  it('accepts a clean readable label claim as-is', () => {
    expect(sanitizeSerialReading({ raw: 'K507B403590', source: 'label', status: 'readable', confidence: 'high' }))
      .toEqual({ schema: 'serial-v1', raw: 'K507B403590', normalized: 'K507B403590', source: 'label', confidence: 'high', status: 'readable', issues: [] })
  })
  it('strips control characters and caps length', () => {
    const r = sanitizeSerialReading({ raw: 'AB' + String.fromCharCode(0) + 'C123456' + 'X'.repeat(200), source: 'label', status: 'readable', confidence: 'high' })
    expect(r.raw.length).toBeLessThanOrEqual(80)
    expect(r.raw.includes(String.fromCharCode(0))).toBe(false)
  })
  it('extractSerialFromOutput tolerates fences, prose and garbage', () => {
    const fenced = '```json\n{"assessable":true,"serial":{"raw":"YMA55312","source":"label","confidence":"high","status":"readable"}}\n```'
    expect(extractSerialFromOutput(fenced, parseRawObject).normalized).toBe('YMA55312')
    expect(extractSerialFromOutput('no json here', parseRawObject).status).toBe('unreadable')
    expect(extractSerialFromOutput('{"assessable":true}', parseRawObject).issues).toContain('missing')
  })
})

describe('helpers', () => {
  it('normalizeSerialText keeps ? and does not fold look-alikes', () => {
    expect(normalizeSerialText(' ym-a 55.31/0 ')).toBe('YMA55310')
    expect(normalizeSerialText('O0I1')).toBe('O0I1')
    expect(normalizeSerialText(5)).toBe('')
  })
  it('serialIsStrong mirrors tyre_serial_is_strong on known shapes', () => {
    for (const s of ['YMA55312', 'K507B403590', '2436326847']) expect(serialIsStrong(s)).toBe(true)
    for (const s of ['NO SERIAL', '315/80R22.5', 'DOT1234', '1.24391E+11', '111111', '123456', 'JAN-2024', '12R22.5 X', 'A,B12345']) expect(serialIsStrong(s)).toBe(false)
  })
  it('flag parsing: only exact true turns it on', () => {
    expect(serialFlagFrom([{ key: 'ai_tyre_serial_enabled', value: 'true' }])).toBe(true)
    expect(serialFlagFrom([{ key: 'ai_tyre_serial_enabled', value: '"true"' }])).toBe(true)
    expect(serialFlagFrom([{ key: 'ai_tyre_serial_enabled', value: true }])).toBe(true)
    for (const v of ['false', 'yes', '1', '', null, 'TRUEISH']) expect(serialFlagFrom([{ key: 'ai_tyre_serial_enabled', value: v }])).toBe(false)
    expect(serialFlagFrom([])).toBe(false)
    expect(serialFlagFrom(null)).toBe(false)
  })
  it('partialConsistent', () => {
    expect(partialConsistent('AB?D', 'ABCD')).toBe(true)
    expect(partialConsistent('AX?D', 'ABCD')).toBe(false)
    expect(partialConsistent('AB?', 'ABCD')).toBe(false)
  })
})

describe('compareSerial (shared fixture with the SQL mirror)', () => {
  it.each(cases)('$name', (c) => {
    const reading = { schema: 'serial-v1', raw: c.normalized ?? '', normalized: c.normalized, source: c.normalized ? 'label' : 'none',
      confidence: c.confidence, status: c.status, issues: [] }
    const r = compareSerial(reading, { positionStatus: c.position, serials: c.registered })
    expect({ outcome: r.outcome, reason: r.reason }).toEqual({ outcome: c.outcome, reason: c.reason })
    expect(r.needsReview).toBe(SERIAL_REVIEW_OUTCOMES.includes(c.outcome))
  })
  it('the fixture covers every outcome', () => {
    expect(new Set(cases.map((c) => c.outcome)).size).toBe(6)
  })
})
