/**
 * A part-filled checklist must survive the app being killed.
 *
 * These tests drive the real draft store with the two native-backed modules
 * mocked (per the note in jest.config.js): `expo-file-system`, because draft
 * photos are real files in their own document folder, and `./secureStorage`,
 * because the whole point is what happens when a read FAILS.
 *
 * The cases that matter are the honest ones:
 *
 *   - A TORN OR UNREADABLE READ NEVER DESTROYS A DRAFT. `getItem` answers null
 *     for both "nothing stored" and "the Keystore refused", and a caller that
 *     saves what it read turns the second into the first - a half-finished
 *     sheet replaced by an empty list, silently, with the only copy on that
 *     device. Every mutation here must refuse instead.
 *   - A SUBMITTED SHEET CLEARS ITS DRAFT, or the same work can be filled in and
 *     submitted twice.
 *   - ANOTHER USER'S DRAFT IS NEVER OFFERED, so a shared handset cannot hand
 *     one worker another's sheet.
 *   - A PHOTO THAT IS GONE IS REPORTED, not carried on as a dead path that gets
 *     submitted and reports success with unreachable evidence.
 */

// ── fake filesystem ──────────────────────────────────────────────────────────
// Files are a flat path -> bytes map. Enough to exercise copy / exists / delete
// / list, which is all this module asks of expo-file-system.
const files: Record<string, string> = {}
const DOC = 'file:///docs'

function joinUri(base: string, name: string): string {
  return `${base.replace(/\/+$/, '')}/${name}`
}

class FakeFile {
  uri: string
  constructor(a: any, b?: string) {
    this.uri = b === undefined ? String(a) : joinUri(a instanceof FakeDirectory ? a.uri : String(a), b)
  }
  get exists() { return this.uri in files }
  get size() { return (files[this.uri] ?? '').length }
  get md5() { return null }
  get modificationTime() { return 0 }
  copy(dest: FakeFile) {
    if (!this.exists) throw new Error('source missing')
    files[dest.uri] = files[this.uri]
  }
  delete() { delete files[this.uri] }
}

class FakeDirectory {
  uri: string
  constructor(a: any, b?: string) {
    this.uri = b === undefined ? String(a) : joinUri(String(a), b)
  }
  get exists() { return Object.keys(files).some(p => p.startsWith(`${this.uri}/`)) || createdDirs.has(this.uri) }
  create() { createdDirs.add(this.uri) }
  list() {
    return Object.keys(files)
      .filter(p => p.startsWith(`${this.uri}/`))
      .map(p => new FakeFile(p))
  }
}
const createdDirs = new Set<string>()

// The fakes are exported AS the classes, not wrapped in one: the orphan sweep
// filters `entry instanceof File`, and a wrapper class returning a FakeFile
// fails that check - the guard would look broken when only the mock was.
jest.mock('expo-file-system', () => ({
  File: FakeFile,
  Directory: FakeDirectory,
  Paths: { get document() { return DOC } },
}))

// ── secureStorage with a switchable read health ──────────────────────────────
type Status = 'ok' | 'absent' | 'unreadable' | 'torn'
const store: Record<string, string> = {}
let forcedStatus: Status | null = null

jest.mock('../lib/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => (k in store ? store[k] : null),
    setItem: async (k: string, v: string) => { store[k] = v },
    removeItem: async (k: string) => { delete store[k] },
  },
  readItem: async (k: string) => {
    if (forcedStatus === 'unreadable' || forcedStatus === 'torn') {
      return { value: null, status: forcedStatus }
    }
    return k in store ? { value: store[k], status: 'ok' } : { value: null, status: 'absent' }
  },
}))

import {
  ChecklistDraft, DraftInput, DraftStoreUnreadableError, MAX_DRAFTS,
  draftAgeMinutes, draftKey, draftPhotoPaths, draftsForUser, discardDraft,
  getDraft, hasDraftContent, isDraftPhotoPath, listUserDrafts, loadDrafts,
  normaliseAsset, parseDrafts, persistDraftPhotoMap, resolveDraftPhoto,
  restoreDraftPhotoMap, resumeCandidates, saveDraft, sortDrafts, upsertDraft,
} from '../lib/checklistDraft'

const KEY = 'tp_checklist_drafts_v1'
const DRAFT_DIR = `${DOC}/checklist-drafts`

function input(over: Partial<DraftInput> = {}): DraftInput {
  return {
    userId: 'u1',
    templateId: 'tpl-workshop',
    templateName: 'Workshop Daily Checklist',
    assetNo: 'TM514',
    assignmentId: null,
    site: 'NHC',
    title: 'Workshop Daily Checklist',
    readLang: 'en',
    answers: { f1: 'ok' },
    photos: {},
    notes: {},
    signatures: {},
    primarySignature: null,
    printedName: '',
    filled: 1,
    total: 31,
    ...over,
  }
}

function record(over: Partial<ChecklistDraft> = {}): ChecklistDraft {
  const base = input(over as Partial<DraftInput>)
  return {
    ...base,
    key: draftKey(base.userId, base.templateId, base.assetNo),
    createdAt: '2026-08-18T08:00:00.000Z',
    updatedAt: '2026-08-18T09:00:00.000Z',
    ...over,
  } as ChecklistDraft
}

function seed(list: ChecklistDraft[]) {
  store[KEY] = JSON.stringify(list)
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  for (const k of Object.keys(files)) delete files[k]
  createdDirs.clear()
  forcedStatus = null
})

// ─────────────────────────────────────────────────────────────────────────────
describe('identity', () => {
  it('treats the same machine typed differently as one sheet', () => {
    expect(draftKey('u1', 't1', ' tm514 ')).toBe(draftKey('u1', 't1', 'TM514'))
    expect(normaliseAsset(null)).toBe('')
  })

  it('keeps two vehicles on the same template apart', () => {
    expect(draftKey('u1', 't1', 'TM514')).not.toBe(draftKey('u1', 't1', 'TM515'))
  })

  it('keeps two users apart on the same sheet', () => {
    expect(draftKey('u1', 't1', 'TM514')).not.toBe(draftKey('u2', 't1', 'TM514'))
  })
})

describe('hasDraftContent', () => {
  it('does NOT treat a merely-opened sheet as work in progress', () => {
    // The fill screen seeds the date and the inspector name the moment a
    // template opens. Counting those would list a sheet nobody started.
    expect(hasDraftContent({
      filled: 0, photos: {}, notes: {}, signatures: {}, primarySignature: null,
    })).toBe(false)
  })

  it('counts a photograph on its own as real work', () => {
    expect(hasDraftContent({
      filled: 0, photos: { f9: ['file:///c/a.jpg'] }, notes: {}, signatures: {}, primarySignature: null,
    })).toBe(true)
  })

  it('counts a remark and a signature on their own', () => {
    expect(hasDraftContent({
      filled: 0, photos: {}, notes: { f2: 'brake line weeping' }, signatures: {}, primarySignature: null,
    })).toBe(true)
    expect(hasDraftContent({
      filled: 0, photos: {}, notes: {}, signatures: { sig1: '<svg/>' }, primarySignature: null,
    })).toBe(true)
  })

  it('ignores a blank remark', () => {
    expect(hasDraftContent({
      filled: 0, photos: {}, notes: { f2: '   ' }, signatures: {}, primarySignature: null,
    })).toBe(false)
  })
})

describe('store shape', () => {
  it('drops a corrupt entry instead of losing every other sheet', () => {
    const good = record()
    const raw = JSON.stringify([good, { nonsense: true }, null, 'x'])
    expect(parseDrafts(raw)).toEqual([good])
  })

  it('reads junk as no drafts rather than throwing', () => {
    expect(parseDrafts('{{{')).toEqual([])
    expect(parseDrafts(null)).toEqual([])
  })

  it('replaces by key and prunes the oldest past the cap, returning what it pruned', () => {
    const many = Array.from({ length: MAX_DRAFTS }, (_, i) => record({
      assetNo: `TM${100 + i}`,
      key: `u1|tpl-workshop|TM${100 + i}`,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }))
    const fresh = record({ assetNo: 'TM999', key: 'u1|tpl-workshop|TM999', updatedAt: '2026-12-01T00:00:00.000Z' })
    const { drafts, pruned } = upsertDraft(many, fresh)
    expect(drafts).toHaveLength(MAX_DRAFTS)
    expect(drafts[0].key).toBe('u1|tpl-workshop|TM999')
    expect(pruned).toHaveLength(1)
    expect(pruned[0].key).toBe('u1|tpl-workshop|TM100') // the oldest
  })

  it('sorts newest first', () => {
    const older = record({ key: 'a', updatedAt: '2026-01-01T00:00:00.000Z' })
    const newer = record({ key: 'b', updatedAt: '2026-06-01T00:00:00.000Z' })
    expect(sortDrafts([older, newer]).map(d => d.key)).toEqual(['b', 'a'])
  })

  it('reports an unparseable timestamp as unknown, never as "just now"', () => {
    expect(draftAgeMinutes({ updatedAt: 'not a date' })).toBeNull()
    expect(draftAgeMinutes({ updatedAt: '2026-08-18T09:00:00.000Z' }, Date.parse('2026-08-18T09:30:00.000Z'))).toBe(30)
  })
})

describe('whose draft it is', () => {
  it('never offers another user their colleague\'s sheet', async () => {
    seed([
      record({ userId: 'u1', key: 'u1|tpl-workshop|TM514' }),
      record({ userId: 'u2', key: 'u2|tpl-workshop|TM514' }),
    ])
    const mine = await listUserDrafts('u1')
    expect(mine.ok).toBe(true)
    expect(mine.drafts.map(d => d.userId)).toEqual(['u1'])
  })

  it('offers nothing at all when there is no signed-in user', () => {
    expect(draftsForUser([record()], '')).toEqual([])
  })
})

describe('resumeCandidates', () => {
  const list = [
    record({ userId: 'u1', templateId: 't1', assetNo: 'TM514', key: 'u1|t1|TM514' }),
    record({ userId: 'u1', templateId: 't1', assetNo: 'TM515', key: 'u1|t1|TM515' }),
    record({ userId: 'u1', templateId: 't2', assetNo: 'TM514', key: 'u1|t2|TM514' }),
    record({ userId: 'u2', templateId: 't1', assetNo: 'TM514', key: 'u2|t1|TM514' }),
  ]

  it('offers only THIS machine\'s sheet once an asset is known', () => {
    const got = resumeCandidates(list, { userId: 'u1', templateId: 't1', assetNo: 'tm514' })
    expect(got.map(d => d.key)).toEqual(['u1|t1|TM514'])
  })

  it('offers every unfinished sheet for the template while no asset is picked', () => {
    const got = resumeCandidates(list, { userId: 'u1', templateId: 't1' })
    expect(got.map(d => d.assetNo).sort()).toEqual(['TM514', 'TM515'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('a failed read never destroys a draft', () => {
  it('refuses to save over a store it could not read', async () => {
    const existing = record()
    seed([existing])
    forcedStatus = 'unreadable'
    await expect(saveDraft(input({ answers: { f1: 'changed' } }))).rejects.toBeInstanceOf(DraftStoreUnreadableError)
    forcedStatus = null
    // The sheet is exactly as it was - not replaced by an empty list.
    expect(JSON.parse(store[KEY])).toEqual([existing])
  })

  it('refuses to discard over a torn read', async () => {
    const existing = record()
    seed([existing])
    forcedStatus = 'torn'
    await expect(discardDraft(existing.key)).rejects.toBeInstanceOf(DraftStoreUnreadableError)
    forcedStatus = null
    expect(JSON.parse(store[KEY])).toEqual([existing])
  })

  it('shows "could not check" rather than "you have no unfinished work"', async () => {
    seed([record()])
    forcedStatus = 'unreadable'
    const load = await loadDrafts()
    expect(load.ok).toBe(false)
    expect(load.drafts).toEqual([])          // nothing to show...
    expect((load as any).status).toBe('unreadable') // ...but we know WHY
  })

  it('an absent store is a genuine empty, not a failure', async () => {
    const load = await loadDrafts()
    expect(load.ok).toBe(true)
    expect(load.drafts).toEqual([])
  })
})

describe('saving', () => {
  it('writes a draft and keeps createdAt across later saves', async () => {
    const first = await saveDraft(input())
    expect(first).not.toBeNull()
    const second = await saveDraft(input({ answers: { f1: 'ok', f2: 'ok' }, filled: 2 }))
    expect(second!.createdAt).toBe(first!.createdAt)
    expect(second!.updatedAt >= first!.updatedAt).toBe(true)
    expect(JSON.parse(store[KEY])).toHaveLength(1)
  })

  it('removes a draft the operator emptied out again', async () => {
    await saveDraft(input())
    expect(JSON.parse(store[KEY])).toHaveLength(1)
    const gone = await saveDraft(input({ answers: {}, filled: 0 }))
    expect(gone).toBeNull()
    expect(JSON.parse(store[KEY])).toEqual([])
  })

  it('never writes an empty sheet in the first place', async () => {
    const saved = await saveDraft(input({ answers: {}, filled: 0 }))
    expect(saved).toBeNull()
    expect(store[KEY]).toBeUndefined()
  })

  it('stores under a normalised key, so one machine is never two sheets', async () => {
    await saveDraft(input({ assetNo: ' tm514 ' }))
    const stored = JSON.parse(store[KEY])
    expect(stored[0].key).toBe('u1|tpl-workshop|TM514')
    expect(stored[0].assetNo).toBe('TM514')
    // The same machine typed the other way updates it rather than adding one.
    await saveDraft(input({ assetNo: 'TM514', filled: 2 }))
    expect(JSON.parse(store[KEY])).toHaveLength(1)
  })

  it('getDraft answers null for a sheet that is not there', async () => {
    seed([record()])
    expect(await getDraft('u1|nope|X')).toBeNull()
  })

  it('does not let two overlapping saves revert each other', async () => {
    // The autosave timer and the backgrounding flush can fire milliseconds
    // apart; run concurrently over one shared blob, the slower write would
    // silently undo the faster one's change.
    await Promise.all([
      saveDraft(input({ assetNo: 'TM514' })),
      saveDraft(input({ assetNo: 'TM515' })),
    ])
    expect(JSON.parse(store[KEY])).toHaveLength(2)
  })
})

describe('a submitted sheet clears its draft', () => {
  it('removes only that sheet and deletes only its photos', async () => {
    files[`${DRAFT_DIR}/d_mine.jpg`] = 'A'
    files[`${DRAFT_DIR}/d_other.jpg`] = 'B'
    const mine = record({
      key: 'u1|t1|TM514', templateId: 't1', assetNo: 'TM514',
      photos: { f9: [`${DRAFT_DIR}/d_mine.jpg`] },
    })
    const other = record({
      key: 'u1|t1|TM515', templateId: 't1', assetNo: 'TM515',
      photos: { f9: [`${DRAFT_DIR}/d_other.jpg`] },
    })
    seed([mine, other])

    await discardDraft(mine.key)

    expect(JSON.parse(store[KEY]).map((d: ChecklistDraft) => d.key)).toEqual(['u1|t1|TM515'])
    expect(files[`${DRAFT_DIR}/d_mine.jpg`]).toBeUndefined()
    expect(files[`${DRAFT_DIR}/d_other.jpg`]).toBe('B') // the other sheet is untouched
  })

  it('is a no-op for a draft that is already gone', async () => {
    seed([record()])
    await expect(discardDraft('u1|nope|X')).resolves.toBeUndefined()
    expect(JSON.parse(store[KEY])).toHaveLength(1)
  })
})

describe('photos', () => {
  it('copies a cache photo into the draft folder so an OS purge cannot take it', () => {
    files['file:///cache/shot.jpg'] = 'BYTES'
    const out = persistDraftPhotoMap({ f9: ['file:///cache/shot.jpg'] })
    const stored = out.f9[0]
    expect(isDraftPhotoPath(stored)).toBe(true)
    expect(files[stored]).toBe('BYTES')
    expect(files['file:///cache/shot.jpg']).toBe('BYTES') // the original is left alone
  })

  it('does not re-copy on every autosave', () => {
    files['file:///cache/shot.jpg'] = 'BYTES'
    const once = persistDraftPhotoMap({ f9: ['file:///cache/shot.jpg'] })
    const twice = persistDraftPhotoMap(once)
    expect(twice.f9[0]).toBe(once.f9[0])
    expect(Object.keys(files).filter(p => p.startsWith(DRAFT_DIR))).toHaveLength(1)
  })

  it('passes an already-uploaded ref straight through', () => {
    const out = persistDraftPhotoMap({ f9: ['tp-storage://checklist/abc.jpg'] })
    expect(out.f9).toEqual(['tp-storage://checklist/abc.jpg'])
  })

  it('drops a photo it cannot copy rather than storing a path to nothing', () => {
    const out = persistDraftPhotoMap({ f9: ['file:///cache/gone.jpg'] })
    expect(out.f9).toBeUndefined()
  })

  it('REPORTS a photo that is gone instead of restoring a dead path', () => {
    const alive = `${DRAFT_DIR}/d_alive.jpg`
    files[alive] = 'A'
    const { photos, dropped } = restoreDraftPhotoMap({
      f9: [alive, `${DRAFT_DIR}/d_purged.jpg`],
    })
    expect(photos.f9).toEqual([alive])
    expect(dropped).toBe(1)
  })

  it('heals a path the OS container moved, by name', () => {
    files[`${DRAFT_DIR}/d_moved.jpg`] = 'A'
    // The stored path is a stale container location; the file itself is fine.
    const healed = resolveDraftPhoto('file:///old-container/checklist-drafts/d_moved.jpg')
    expect(healed).toBe(`${DRAFT_DIR}/d_moved.jpg`)
  })

  it('getDraft restores photos and says how many could not be brought back', async () => {
    files[`${DRAFT_DIR}/d_ok.jpg`] = 'A'
    const d = record({
      key: 'u1|t1|TM514',
      photos: { f9: [`${DRAFT_DIR}/d_ok.jpg`, `${DRAFT_DIR}/d_missing.jpg`] },
    })
    seed([d])
    const got = await getDraft(d.key)
    expect(got!.droppedPhotos).toBe(1)
    expect(got!.draft.photos.f9).toEqual([`${DRAFT_DIR}/d_ok.jpg`])
  })

  it('sweeps a file no live draft references any more', async () => {
    files[`${DRAFT_DIR}/d_orphan.jpg`] = 'X'
    files['file:///cache/new.jpg'] = 'N'
    seed([record({ key: 'u1|tpl-workshop|TM514' })])
    // Saving the same sheet with a DIFFERENT photo leaves the old file unreferenced.
    await saveDraft(input({ photos: { f9: ['file:///cache/new.jpg'] } }))
    expect(files[`${DRAFT_DIR}/d_orphan.jpg`]).toBeUndefined()
  })

  it('flattens every photo a draft holds', () => {
    expect(draftPhotoPaths({ photos: { a: ['1', '2'], b: ['3'] } })).toEqual(['1', '2', '3'])
  })
})
