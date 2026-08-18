/**
 * Resumable checklists - the web half.
 *
 * A part-filled sheet must survive a closed tab, a refresh, a crashed browser
 * or a flat battery. When the person comes back the sheet is waiting and they
 * choose: Continue, or Start new. Resuming is never forced and discarding is
 * never silent.
 *
 * WHY THE DRAFT IS NOT A ROW IN checklist_submissions, and do not "improve"
 * this later:
 * V594 put `stamp_checklist_document_no` on BEFORE INSERT so the document
 * number (WDC-TM514-2026-0001) is minted when the sheet is really created.
 * That was deliberate - it means an abandoned fill never burns a number. A
 * server-side draft row would burn one every time somebody opened a sheet and
 * walked away, and permanently gap a numbered document register. A register
 * with holes in it is worse than no resume feature, so the draft stays local.
 *
 * The cost of that choice, stated rather than hidden: a draft does not follow
 * the person to another browser or another machine. `draftScope()` exists so a
 * surface can say so honestly instead of implying the work is safe everywhere.
 *
 * MIRROR: mobile/lib/checklistDraft.ts. Change both together.
 */

/** Bump when the stored shape changes so an old draft is ignored, not misread. */
export const DRAFT_VERSION = 1

const PREFIX = 'tp.checklistDraft.v1'

/** Where a draft survives. Local to this browser profile - never the account. */
export const DRAFT_SCOPE = 'device'

export function draftScope() {
  return DRAFT_SCOPE
}

/**
 * One draft per person per template per asset, so filling a second vehicle
 * never overwrites the first one's half-finished sheet.
 *
 * A blank asset is its own slot ('-'), which is correct: a sheet started before
 * the asset was picked is still one sheet, and it upgrades to the asset's slot
 * the moment the asset is chosen (see promoteDraftKey).
 */
export function draftKey({ userId, templateId, assetNo }) {
  const u = String(userId || '').trim()
  const t = String(templateId || '').trim()
  if (!u || !t) return null
  const a = String(assetNo || '').trim().toUpperCase() || '-'
  return `${PREFIX}:${u}:${t}:${a}`
}

/** True when a value carries something a person actually entered. */
function hasContent(v) {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  // 0 and false are REAL answers. A meter reading of zero is a reading, and
  // "No" is an answer - treating either as blank is the defect this guards.
  return true
}

/**
 * Is there anything worth keeping? An untouched sheet must not create a draft,
 * or every template anyone merely opened would come back offering to resume
 * nothing.
 */
export function isWorthSaving(state) {
  if (!state) return false
  const { answers, notes, photos, signatures, primarySignature, header } = state
  if (primarySignature) return true
  for (const bag of [answers, notes, photos, signatures]) {
    if (bag && Object.values(bag).some(hasContent)) return true
  }
  // A header the person typed counts, but one auto-filled from the register
  // does not - that is the system's work, not theirs, and it would make every
  // opened sheet look half-done.
  if (header && hasContent(header.title)) return true
  return false
}

/** Shape written to storage. Photos are stored as their references, not blobs. */
export function buildDraft(state, now) {
  return {
    v: DRAFT_VERSION,
    userId: String(state.userId || ''),
    templateId: String(state.templateId || ''),
    templateName: state.templateName || '',
    assetNo: state.header?.asset_no || '',
    site: state.header?.site || '',
    header: state.header || { title: '', asset_no: '', site: '' },
    answers: state.answers || {},
    notes: state.notes || {},
    photos: state.photos || {},
    signatures: state.signatures || {},
    primarySignature: state.primarySignature || null,
    lang: state.lang || null,
    savedAt: now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString(),
  }
}

/**
 * A stored draft is only usable when it is THIS person's, THIS template's, and
 * a shape this build understands. Anything else is ignored rather than guessed
 * at - a misread draft would silently put one person's answers on another
 * person's sheet.
 */
export function isUsableDraft(draft, { userId, templateId }) {
  if (!draft || typeof draft !== 'object') return false
  if (draft.v !== DRAFT_VERSION) return false
  if (!draft.userId || draft.userId !== String(userId || '')) return false
  if (!draft.templateId || draft.templateId !== String(templateId || '')) return false
  return true
}

/** Human summary for the resume prompt. Never invents a time it does not have. */
export function draftSummary(draft) {
  if (!draft) return null
  const answered = Object.values(draft.answers || {}).filter(hasContent).length
  return {
    assetNo: draft.assetNo || '',
    answered,
    savedAt: draft.savedAt || null,
  }
}

/* ── storage ──────────────────────────────────────────────────────────────
 * Every call is guarded. Private browsing, a full quota and a disabled
 * localStorage all THROW, and none of them is a reason to lose the sheet the
 * person is filling - so a storage failure degrades to "no draft" and never
 * propagates into the form.
 */

function store() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function saveDraft(key, draft) {
  const s = store()
  if (!s || !key) return false
  try {
    s.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

/**
 * Reading reports WHY it came back empty, because "there is no draft" and "we
 * could not read it" are opposite statements. A caller must never overwrite on
 * `unreadable` - that is how a half-finished sheet gets destroyed by the very
 * feature meant to protect it.
 */
export function readDraft(key) {
  const s = store()
  if (!s || !key) return { status: 'unreadable', draft: null }
  let raw
  try {
    raw = s.getItem(key)
  } catch {
    return { status: 'unreadable', draft: null }
  }
  if (raw === null || raw === undefined) return { status: 'absent', draft: null }
  try {
    const draft = JSON.parse(raw)
    if (!draft || typeof draft !== 'object') return { status: 'torn', draft: null }
    return { status: 'ok', draft }
  } catch {
    return { status: 'torn', draft: null }
  }
}

export function clearDraft(key) {
  const s = store()
  if (!s || !key) return false
  try {
    s.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * Moving a sheet from the no-asset slot to the asset's slot once the asset is
 * picked. Copies rather than merges: the destination is only written when it is
 * genuinely empty, so choosing an asset can never clobber a sheet already part
 * filled for that vehicle.
 */
export function promoteDraftKey(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return false
  const existing = readDraft(toKey)
  if (existing.status !== 'absent') return false
  const src = readDraft(fromKey)
  if (src.status !== 'ok' || !src.draft) return false
  if (!saveDraft(toKey, src.draft)) return false
  clearDraft(fromKey)
  return true
}

/** Every draft this person has, newest first - the "continue your own work" list. */
export function listDrafts(userId) {
  const s = store()
  if (!s) return []
  const uid = String(userId || '').trim()
  if (!uid) return []
  const out = []
  let n = 0
  try {
    n = s.length
  } catch {
    return []
  }
  for (let i = 0; i < n; i += 1) {
    let key
    try {
      key = s.key(i)
    } catch {
      continue
    }
    if (!key || !key.startsWith(`${PREFIX}:${uid}:`)) continue
    const { status, draft } = readDraft(key)
    if (status !== 'ok' || !draft || draft.v !== DRAFT_VERSION) continue
    if (draft.userId !== uid) continue
    out.push({ key, ...draft })
  }
  return out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
}
