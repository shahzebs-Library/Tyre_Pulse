import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DRAFT_VERSION, draftKey, isWorthSaving, buildDraft, isUsableDraft, draftSummary,
  saveDraft, readDraft, clearDraft, promoteDraftKey, listDrafts, draftScope,
} from '../lib/checklist/checklistDraft'

function fakeStore() {
  const map = new Map()
  return {
    get length() { return map.size },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('window', { localStorage: fakeStore() })
})

const BASE = { userId: 'u1', templateId: 't1' }

describe('draftKey', () => {
  it('separates two assets so one sheet cannot overwrite the other', () => {
    expect(draftKey({ ...BASE, assetNo: 'TM514' })).not.toBe(draftKey({ ...BASE, assetNo: 'TM515' }))
  })
  it('folds case, because TM514 and tm514 are the same vehicle', () => {
    expect(draftKey({ ...BASE, assetNo: 'tm514' })).toBe(draftKey({ ...BASE, assetNo: 'TM514' }))
  })
  it('gives a sheet with no asset yet its own slot', () => {
    expect(draftKey({ ...BASE, assetNo: '' })).toContain(':-')
  })
  it('refuses to key without a user, so a draft can never be unowned', () => {
    expect(draftKey({ userId: '', templateId: 't1', assetNo: 'A' })).toBeNull()
  })
})

describe('isWorthSaving', () => {
  it('an untouched sheet is not a draft', () => {
    expect(isWorthSaving({ answers: {}, notes: {}, photos: {}, signatures: {} })).toBe(false)
  })
  it('zero is a real answer, not a blank', () => {
    expect(isWorthSaving({ answers: { km: 0 } })).toBe(true)
  })
  it('false is a real answer, not a blank', () => {
    expect(isWorthSaving({ answers: { brakes: false } })).toBe(true)
  })
  it('whitespace alone is not content', () => {
    expect(isWorthSaving({ answers: { a: '   ' } })).toBe(false)
  })
  it('an auto-filled asset does not make a sheet look half done', () => {
    expect(isWorthSaving({ header: { title: '', asset_no: 'TM514', site: 'NHC' } })).toBe(false)
  })
  it('a title the person typed does count', () => {
    expect(isWorthSaving({ header: { title: 'Morning round', asset_no: '', site: '' } })).toBe(true)
  })
})

describe('isUsableDraft', () => {
  const d = buildDraft({ userId: 'u1', templateId: 't1', header: {} }, new Date('2026-08-18T10:00:00Z'))
  it('accepts this person and this template', () => {
    expect(isUsableDraft(d, BASE)).toBe(true)
  })
  it('never hands one person another person’s answers', () => {
    expect(isUsableDraft(d, { userId: 'u2', templateId: 't1' })).toBe(false)
  })
  it('never puts one template’s answers on another sheet', () => {
    expect(isUsableDraft(d, { userId: 'u1', templateId: 't2' })).toBe(false)
  })
  it('ignores a shape this build does not understand', () => {
    expect(isUsableDraft({ ...d, v: DRAFT_VERSION + 1 }, BASE)).toBe(false)
  })
})

describe('reading reports why it was empty', () => {
  it('absent is not the same as unreadable', () => {
    expect(readDraft('nothing-here').status).toBe('absent')
  })
  it('torn JSON is reported as torn, never as absent', () => {
    window.localStorage.setItem('k', '{ not json')
    expect(readDraft('k').status).toBe('torn')
  })
  it('a thrown storage read degrades to unreadable instead of breaking the form', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked') } })
    expect(readDraft('k').status).toBe('unreadable')
  })
  it('a full quota fails the save without throwing at the caller', () => {
    vi.stubGlobal('window', { localStorage: { setItem() { throw new Error('quota') } } })
    expect(saveDraft('k', { v: 1 })).toBe(false)
  })
})

describe('round trip', () => {
  it('saves, reads back and clears', () => {
    const k = draftKey({ ...BASE, assetNo: 'TM514' })
    const d = buildDraft({ ...BASE, header: { title: '', asset_no: 'TM514', site: 'NHC' }, answers: { a: 'OK' } }, new Date('2026-08-18T10:00:00Z'))
    expect(saveDraft(k, d)).toBe(true)
    const back = readDraft(k)
    expect(back.status).toBe('ok')
    expect(back.draft.answers).toEqual({ a: 'OK' })
    clearDraft(k)
    expect(readDraft(k).status).toBe('absent')
  })
})

describe('promoteDraftKey', () => {
  it('moves a no-asset sheet onto the asset once it is picked', () => {
    const from = draftKey({ ...BASE, assetNo: '' })
    const to = draftKey({ ...BASE, assetNo: 'TM514' })
    saveDraft(from, buildDraft({ ...BASE, answers: { a: '1' } }, Date.now()))
    expect(promoteDraftKey(from, to)).toBe(true)
    expect(readDraft(to).draft.answers).toEqual({ a: '1' })
    expect(readDraft(from).status).toBe('absent')
  })

  it('never clobbers a sheet already part filled for that vehicle', () => {
    const from = draftKey({ ...BASE, assetNo: '' })
    const to = draftKey({ ...BASE, assetNo: 'TM514' })
    saveDraft(to, buildDraft({ ...BASE, answers: { keep: 'me' } }, Date.now()))
    saveDraft(from, buildDraft({ ...BASE, answers: { other: 'x' } }, Date.now()))
    expect(promoteDraftKey(from, to)).toBe(false)
    expect(readDraft(to).draft.answers).toEqual({ keep: 'me' })
  })
})

describe('listDrafts', () => {
  it('returns only this person’s work, newest first', () => {
    saveDraft(draftKey({ ...BASE, assetNo: 'A' }), buildDraft({ ...BASE, header: { asset_no: 'A' } }, new Date('2026-08-18T09:00:00Z')))
    saveDraft(draftKey({ ...BASE, assetNo: 'B' }), buildDraft({ ...BASE, header: { asset_no: 'B' } }, new Date('2026-08-18T11:00:00Z')))
    saveDraft(draftKey({ userId: 'u2', templateId: 't1', assetNo: 'C' }), buildDraft({ userId: 'u2', templateId: 't1', header: { asset_no: 'C' } }, Date.now()))
    const mine = listDrafts('u1')
    expect(mine.map(d => d.assetNo)).toEqual(['B', 'A'])
  })
  it('returns nothing rather than everything when there is no user', () => {
    saveDraft(draftKey({ ...BASE, assetNo: 'A' }), buildDraft({ ...BASE }, Date.now()))
    expect(listDrafts('')).toEqual([])
  })
})

describe('honesty', () => {
  it('says a draft lives on the device, so a surface cannot imply otherwise', () => {
    expect(draftScope()).toBe('device')
  })
  it('summary never invents a saved time it does not have', () => {
    expect(draftSummary({ answers: {} }).savedAt).toBeNull()
  })
})
