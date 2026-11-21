import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import en from '../locales/en/inventory.json'
import ar from '../locales/ar/inventory.json'
import {
  CONDITIONS, OWNERSHIPS, CLASSIFICATIONS, CODE_TYPES, PHOTO_ROLES, PHOTO_PURPOSES, CORRECTABLE_FIELDS, CORRECTION_ACTIONS,
  normRef, guessCodeType, parseLocationLabel, groupVariants, sumAvailability, transferSources, buildCapturePayload,
  correctionDiff, dashboardTiles, identificationProgress, dashboardExportRows, photoPath, newClientUuid, topicForField,
} from '../lib/inventory/physicalInventory'

const SQL = readFileSync(resolve('supabase/migrations/20261122100000_inv_physical_inventory_master.sql'), 'utf8')

describe('physical inventory rules mirror the draft migration', () => {
  it('normalises references exactly like material_ref_norm()', () => {
    expect(normRef('abc-123 / x')).toBe('ABC123X')
    expect(normRef('  ')).toBeNull()
    expect(SQL).toMatch(/regexp_replace\(coalesce\(p, ''\), '\[\^A-Za-z0-9\]', '', 'g'\)/)
  })
  it('vocabularies match the CHECK constraints', () => {
    for (const c of CONDITIONS) expect(SQL).toContain(`'${c}'`)
    for (const o of OWNERSHIPS) expect(SQL).toContain(`'${o}'`)
    expect(SQL).toContain("part_classification in ('genuine','oes','aftermarket','unknown')")
    expect(CLASSIFICATIONS).toEqual(['genuine', 'oes', 'aftermarket', 'unknown'])
    for (const k of CODE_TYPES) expect(SQL).toContain(`'${k}'`)
    for (const f of CORRECTABLE_FIELDS.canonical) expect(SQL).toContain(`'${f}'`)
    for (const f of CORRECTABLE_FIELDS.variant) expect(SQL).toContain(`'${f}'`)
  })
  it('guesses a code type without deciding anything', () => {
    expect(guessCodeType('6291041500213')).toBe('barcode')
    expect(guessCodeType('GC-FLT-001')).toBe('company_sku')
    expect(guessCodeType('ABC-123/X')).toBe('oem')
    expect(guessCodeType('grey pump seal kit')).toBe('description')
    expect(guessCodeType('TP:LOC:11111111-2222-4333-8444-555555555555')).toBe('label')
    expect(parseLocationLabel('tp:loc:11111111-2222-4333-8444-555555555555')).toBe('11111111-2222-4333-8444-555555555555')
    expect(guessCodeType('')).toBeNull()
  })
})

describe('capture payload', () => {
  const base = { quantity: '3', refs: {}, condition: 'used', ownership: 'owned' }
  it('requires a session and a non-negative quantity; zero is a valid count', () => {
    expect(buildCapturePayload(base, {}).error).toBe('session')
    expect(buildCapturePayload({ ...base, quantity: '' }, { sessionId: 's' }).error).toBe('quantity')
    expect(buildCapturePayload({ ...base, quantity: '-1' }, { sessionId: 's' }).error).toBe('quantity')
    expect(buildCapturePayload({ ...base, quantity: '0' }, { sessionId: 's' }).payload.quantity).toBe(0)
    expect(buildCapturePayload({ ...base, quantity: '2,5' }, { sessionId: 's' }).payload.quantity).toBe(2.5)
  })
  it('kind follows what was entered: picked -> identified, described -> proposed_new, nothing -> unidentified', () => {
    expect(buildCapturePayload({ ...base, picked: { canonical_id: 'c', variant_id: 'v' } }, { sessionId: 's' }).payload.kind).toBe('identified')
    expect(buildCapturePayload({ ...base, refs: { description: 'seal kit' } }, { sessionId: 's' }).payload.kind).toBe('proposed_new')
    const u = buildCapturePayload(base, { sessionId: 's', clientUuid: 'u1' }).payload
    expect(u.kind).toBe('unidentified')
    expect(u.client_uuid).toBe('u1')
    expect(u.refs).toEqual({})
  })
  it('falls back to safe vocabularies', () => {
    const p = buildCapturePayload({ ...base, condition: 'weird', ownership: 'x' }, { sessionId: 's' }).payload
    expect(p.condition).toBe('unknown')
    expect(p.ownership).toBe('owned')
  })
})

describe('search results', () => {
  const result = {
    variants: [
      { variant_id: 'a', classification: 'aftermarket', availability: [{ site: 'S2', available: 2, reserved: 1, in_transit: 0, damaged: 0, quarantined: 0 }] },
      { variant_id: 'g', classification: 'genuine', availability: [{ site: 'S1', available: 6, reserved: 0, in_transit: 0, damaged: 1, quarantined: 0 }] },
      { variant_id: 'x', classification: 'bogus', availability: [] },
    ],
    availability_unassigned: [{ site: 'S3', available: 0 }],
  }
  it('keeps genuine and aftermarket apart', () => {
    const g = groupVariants(result)
    expect(g.genuine.map((v) => v.variant_id)).toEqual(['g'])
    expect(g.aftermarket.map((v) => v.variant_id)).toEqual(['a'])
    expect(g.unknown.map((v) => v.variant_id)).toEqual(['x'])
  })
  it('availability sums are null (not zero) when nothing is visible', () => {
    expect(sumAvailability([])).toBeNull()
    expect(sumAvailability(result.variants[0].availability)).toMatchObject({ available: 2, reserved: 1 })
  })
  it('suggests other stores with available stock before re-purchasing', () => {
    expect(transferSources(result, 'S2')).toEqual([{ site: 'S1', available: 6 }])
    expect(transferSources(result, 'S1')).toEqual([{ site: 'S2', available: 2 }])
  })
})

describe('corrections and dashboard', () => {
  it('diffs old against new, field by field', () => {
    const d = correctionDiff({ company_sku: 'A', brand: 'X' }, { company_sku: 'B', brand: 'X' })
    expect(d).toEqual([{ field: 'company_sku', before: 'A', after: 'B', changed: true }, { field: 'brand', before: 'X', after: 'X', changed: false }])
    expect(topicForField('base_uom')).toBe('uom')
    expect(topicForField('part_classification')).toBe('classification')
  })
  it('tiles keep missing figures null and progress is null without captures', () => {
    expect(dashboardTiles(null)).toEqual([])
    const tiles = dashboardTiles({ captures: 4, identified: 3, pending_review: 1 })
    expect(tiles.find((x) => x.key === 'missing_oem').value).toBeNull()
    expect(tiles.find((x) => x.key === 'pending_review').tone).toBe('warn')
    expect(identificationProgress({ captures: 0 })).toBeNull()
    expect(identificationProgress({ captures: 4, identified: 3 })).toBe(75)
    const rows = dashboardExportRows({ captures: 1, classification: { genuine: 1 }, by_employee: [{ user_id: 'u', full_name: 'Ali', captures: 1, identified: 1 }] })
    expect(rows.some((r) => r.section === 'employee' && r.name === 'Ali')).toBe(true)
  })
  it('photo paths stay inside the company folder', () => {
    expect(photoPath('org', 'sess', 'uuid')).toBe('physical_inventory/org/sess/uuid.jpg')
    expect(photoPath('org', null, 'uuid', 'exe')).toBe('physical_inventory/org/material/uuid.jpg')
    expect(photoPath(null, 's', 'u')).toBeNull()
    expect(newClientUuid()).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('locale coverage for the dynamic key families', () => {
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o)
  const families = {
    'pi.cond': CONDITIONS, 'pi.own': OWNERSHIPS, 'pi.cls': [...CLASSIFICATIONS, 'not_identified'], 'pi.codeType': CODE_TYPES,
    'pi.photoRole': PHOTO_ROLES, 'pi.purpose': PHOTO_PURPOSES, 'pi.corr.action': CORRECTION_ACTIONS,
    'pi.field': [...CORRECTABLE_FIELDS.canonical, ...CORRECTABLE_FIELDS.variant],
    'pi.status': ['identified', 'pending_review', 'mapped', 'rejected', 'all', 'proposed', 'active', 'obsolete', 'retired'],
    'pi.tabs': ['capture', 'review', 'materials', 'corrections', 'search', 'dashboard'],
    'pi.dash': dashboardTiles({ captures: 1 }).map((x) => x.key),
    'pi.batch': ['not_prepared', 'draft', 'submitted', 'approved', 'rejected', 'cancelled'],
    'pi.val': ['promoted', 'unvalued', 'not_promoted'],
    'pi.topic': ['company_sku', 'oem', 'aftermarket', 'description', 'brand', 'manufacturer', 'classification', 'uom', 'category', 'specs', 'country_of_manufacture', 'part_number', 'duplicate', 'reference'],
  }
  it('every key exists in English and Arabic', () => {
    for (const [prefix, keys] of Object.entries(families)) {
      for (const k of keys) {
        expect(typeof get(en, `${prefix}.${k}`), `en ${prefix}.${k}`).toBe('string')
        expect(typeof get(ar, `${prefix}.${k}`), `ar ${prefix}.${k}`).toBe('string')
      }
    }
  })
})

describe('retry freezes the payload (Codex P2)', () => {
  it('a retry sends exactly the first payload, including captured_at', async () => {
    const { captureAttempt } = await import('../lib/inventory/physicalInventory')
    const form = { quantity: '3', refs: {}, condition: 'new', ownership: 'owned' }
    const first = captureAttempt(null, form, { sessionId: 's', clientUuid: 'u1', capturedAt: '2026-11-21T08:00:00.000Z' })
    const retry = captureAttempt(first.frozen, { ...form, quantity: '9' }, { sessionId: 's', clientUuid: 'u1', capturedAt: '2026-11-21T09:00:00.000Z' })
    expect(retry.payload).toBe(first.payload)
    expect(retry.payload.captured_at).toBe('2026-11-21T08:00:00.000Z')
    expect(retry.payload.quantity).toBe(3)
    expect(captureAttempt(null, { ...form, quantity: '' }, { sessionId: 's' }).error).toBe('quantity')
  })
})
