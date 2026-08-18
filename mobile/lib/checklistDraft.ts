/**
 * checklistDraft - a part-filled checklist that survives the app being killed.
 *
 * THE PROBLEM. A workshop sheet is 49 fields, filled standing next to a machine
 * with gloves on. The app is backgrounded to answer a call, the phone runs flat,
 * Android reclaims the process, the operator walks out of signal - and every
 * answer, remark, photo and signature recorded so far existed only in React
 * state. It was gone, silently, with nothing to show the operator had ever
 * started. This module is the memory that survives that.
 *
 * ----------------------------------------------------------------------------
 * WHY A DRAFT IS NOT A ROW IN `checklist_submissions`. THIS IS LOAD-BEARING.
 *
 * V594 put `stamp_checklist_document_no` on BEFORE INSERT, so the document
 * number (WDC-TM514-2026-0001) is minted from a per (org, prefix, asset, year)
 * counter the moment a row is inserted. That was deliberate: minting on INSERT
 * rather than at fill time is what stops an abandoned fill from burning a
 * number. A server-side draft row would burn one on every started-and-abandoned
 * sheet and leave permanent holes in a numbered document register - which is
 * worse than having no resume feature at all.
 *
 * So a draft lives ON THE DEVICE and never touches the server. Nothing here
 * inserts, updates or reserves anything. The FIRST time this sheet reaches the
 * database is still the submit, and it still gets exactly one number.
 * ----------------------------------------------------------------------------
 *
 * WHERE IT LIVES, AND WHY.
 *
 * Metadata (answers, notes, signatures, the picked asset) goes into
 * `secureStorage` under one key, the same chunked adapter that already holds
 * both offline queues. It is the only store in this app whose writes are STAGED
 * (a new chunk generation, with the metadata write as the single commit point)
 * and whose reads report WHY they came back empty. Both properties are exactly
 * what a resume feature needs, and neither exists on AsyncStorage.
 *
 * PHOTOS GO IN THEIR OWN DOCUMENT FOLDER AND MUST NOT GO IN THE QUEUE'S.
 * The camera hands back a path in the OS CACHE directory, which Android may
 * purge at any moment - so a draft that merely remembered that path would come
 * back holding dead URIs. The obvious fix, `persistPhotoForQueue`, is WRONG
 * here: it writes into `queued-photos/`, and `sweepOrphanQueuedPhotos` (which
 * runs after EVERY sync) deletes every file in that folder that no live QUEUE
 * entry references. A draft is not a queue entry, so the next sync would delete
 * the operator's photos - turning a likely loss into a certain one. That is the
 * same trap a previous attempt at this fell into and had to be reverted.
 * Draft photos therefore get their OWN folder with their OWN lifecycle, keyed
 * to live drafts. On submit the queue makes its own copy (a draft path is not
 * `isDurablePhotoPath`, so `persistPayloadPhotos` copies it into `queued-photos/`
 * exactly as it would a cache path) and only then is the draft copy deleted.
 * The two folders never share ownership of a file.
 *
 * A RESTORE NEVER LIES ABOUT A PHOTO. Every restored `file://` is checked
 * against the filesystem; one that is genuinely gone is DROPPED and counted, so
 * the screen can say two photos could not be restored instead of carrying a
 * dead path all the way into the database and reporting success.
 *
 * THE READ RULE, INHERITED FROM THE OFFLINE QUEUES.
 * `readItem` answers ok / absent / unreadable / torn. "The Keystore refused" and
 * "there is nothing stored" are DIFFERENT answers, and treating the first as
 * the second is how a half-finished sheet gets overwritten with an empty one.
 * Every read-modify-write here goes through `loadForWrite`, which THROWS on a
 * failed read rather than saving over what it could not see. The trade is
 * deliberate and matches the queues: risk failing to save ONE autosave tick
 * rather than silently destroying the whole sheet.
 */
import { Directory, File, Paths } from 'expo-file-system'
import { secureStorage, readItem } from './secureStorage'

const KEY = 'tp_checklist_drafts_v1'

/** Document-dir subfolder holding a draft's photo copies. Deliberately NOT the
 *  queue's `queued-photos/` - see the header note on the orphan sweep. */
const DRAFT_DIR_NAME = 'checklist-drafts'

/**
 * Hard ceiling on stored drafts per device. SecureStore writes the whole blob
 * as chunks, so unbounded growth is a real durability cost on the very path
 * that must stay reliable. 25 unfinished sheets is already far past plausible;
 * beyond it the OLDEST are pruned. Nothing is pruned by AGE - a sheet abandoned
 * for two months is still the operator's work, and it is listed with its age so
 * a person decides, rather than the app deleting it quietly.
 */
export const MAX_DRAFTS = 25

// ─────────────────────────────────────────────────────────────────────────────
// Pure engine. No I/O, no native modules - this half is what the tests drive.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChecklistDraft {
  /** Stable identity: user + template + asset. See `draftKey`. */
  key: string
  /** The signed-in user this work belongs to. A draft is NEVER offered to
   *  anyone else, so a shared handset cannot hand one worker another's sheet. */
  userId: string
  templateId: string
  templateName: string
  /** Normalised asset code, or '' when the operator has not picked one yet. */
  assetNo: string
  assignmentId: string | null
  site: string
  title: string
  /** Reading language chosen on the sheet, so a resumed sheet reads the same. */
  readLang: string
  answers: Record<string, any>
  photos: Record<string, string[]>
  notes: Record<string, string>
  signatures: Record<string, string>
  primarySignature: string | null
  printedName: string
  /** Progress as the FILL SCREEN counted it - the screen owns the template and
   *  already has `isFieldAnswered`, so this module never re-derives it. */
  filled: number
  total: number
  createdAt: string
  updatedAt: string
}

/** What a caller hands in; the store supplies key/createdAt/updatedAt. */
export type DraftInput = Omit<ChecklistDraft, 'key' | 'createdAt' | 'updatedAt'>

/** An asset code is the same machine however it was typed. */
export function normaliseAsset(asset: string | null | undefined): string {
  return String(asset ?? '').trim().toUpperCase()
}

/**
 * A draft belongs to ONE (user, template, asset). Two vehicles filled against
 * the same template are two separate sheets and must never overwrite each
 * other; a sheet started before an asset was picked gets its own slot until one
 * is chosen.
 */
export function draftKey(userId: string, templateId: string, assetNo: string | null | undefined): string {
  return `${String(userId ?? '')}|${String(templateId ?? '')}|${normaliseAsset(assetNo)}`
}

function isFilledValue(v: any): boolean {
  if (v == null) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim() !== ''
  return true
}

/**
 * Is there anything here worth coming back to?
 *
 * Deliberately strict. The fill screen SEEDS auto fields (today's date, the
 * inspector's own name) the instant a template opens, so a draft judged by
 * "are any answers non-blank" would be written for every template anybody
 * merely looked at, and the operator's "unfinished work" list would fill with
 * sheets nobody ever started. Progress is counted by the screen against the
 * fields a person can actually record, so `filled > 0` is the honest test;
 * photos, remarks and signatures each count on their own because a sheet whose
 * only content so far is a photograph of a fault is still real work.
 */
export function hasDraftContent(d: Pick<ChecklistDraft,
  'filled' | 'photos' | 'notes' | 'signatures' | 'primarySignature'>): boolean {
  if ((d.filled ?? 0) > 0) return true
  if (d.primarySignature) return true
  if (Object.keys(d.signatures ?? {}).length > 0) return true
  for (const list of Object.values(d.photos ?? {})) if ((list?.length ?? 0) > 0) return true
  for (const text of Object.values(d.notes ?? {})) if (String(text ?? '').trim()) return true
  return false
}

/** Reject anything that is not a usable draft record, so one corrupt entry can
 *  never take the whole store (and with it every other unfinished sheet) down. */
export function isDraftRecord(v: any): v is ChecklistDraft {
  return !!v
    && typeof v === 'object'
    && typeof v.key === 'string' && v.key !== ''
    && typeof v.userId === 'string'
    && typeof v.templateId === 'string' && v.templateId !== ''
    && typeof v.updatedAt === 'string'
}

export function parseDrafts(raw: string | null | undefined): ChecklistDraft[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDraftRecord)
  } catch {
    return []
  }
}

/** Newest first - the sheet somebody was on a minute ago belongs at the top. */
export function sortDrafts(list: ChecklistDraft[]): ChecklistDraft[] {
  return [...list].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0))
}

/**
 * Insert or replace one draft, then bound the store.
 *
 * The pruned entries are RETURNED rather than merely dropped, so the caller can
 * delete their photo files too; a pruned draft that left its images behind
 * would grow the folder forever.
 */
export function upsertDraft(
  list: ChecklistDraft[],
  draft: ChecklistDraft,
  max: number = MAX_DRAFTS,
): { drafts: ChecklistDraft[]; pruned: ChecklistDraft[] } {
  const rest = list.filter(d => d.key !== draft.key)
  const merged = sortDrafts([draft, ...rest])
  if (merged.length <= max) return { drafts: merged, pruned: [] }
  return { drafts: merged.slice(0, max), pruned: merged.slice(max) }
}

/** Only ever this user's own work. */
export function draftsForUser(list: ChecklistDraft[], userId: string): ChecklistDraft[] {
  const uid = String(userId ?? '')
  if (!uid) return []
  return sortDrafts(list.filter(d => d.userId === uid))
}

/**
 * The drafts worth offering when a template is opened.
 *
 * With an asset already known (a scan, a link, an assignment) only that
 * machine's sheet is relevant - offering another vehicle's would invite
 * finishing the wrong one. With no asset yet, every unfinished sheet for this
 * template is a candidate, because picking the machine is exactly what the
 * operator is about to do.
 */
export function resumeCandidates(
  list: ChecklistDraft[],
  opts: { userId: string; templateId: string; assetNo?: string | null },
): ChecklistDraft[] {
  const mine = draftsForUser(list, opts.userId).filter(d => d.templateId === opts.templateId)
  const asset = normaliseAsset(opts.assetNo)
  if (!asset) return mine
  return mine.filter(d => d.assetNo === asset)
}

/** Whole minutes/hours/days since a draft was last touched, for the "left off"
 *  line. Returns null for an unparseable timestamp rather than inventing 0. */
export function draftAgeMinutes(d: Pick<ChecklistDraft, 'updatedAt'>, now: number = Date.now()): number | null {
  const t = Date.parse(d?.updatedAt ?? '')
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now - t) / 60000))
}

/**
 * The age of a draft, as a unit + a value, so each screen can render it in its
 * own language.
 *
 * It is returned STRUCTURED rather than as a formatted string because `t()` on
 * mobile takes no interpolation variables - a "{{count}} minutes ago" template
 * renders the placeholder literally - so wording has to be composed by
 * concatenation at the call site. `unknown` is its own answer: a timestamp we
 * cannot parse must not read as "just now".
 */
export type DraftAge =
  | { unit: 'unknown' }
  | { unit: 'now' }
  | { unit: 'minutes'; value: number }
  | { unit: 'hours'; value: number }
  | { unit: 'days'; value: number }

export function draftAge(d: Pick<ChecklistDraft, 'updatedAt'>, now: number = Date.now()): DraftAge {
  const mins = draftAgeMinutes(d, now)
  if (mins == null) return { unit: 'unknown' }
  if (mins < 1) return { unit: 'now' }
  if (mins < 60) return { unit: 'minutes', value: mins }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { unit: 'hours', value: hours }
  return { unit: 'days', value: Math.floor(hours / 24) }
}

/** Every photo string a draft holds, flattened. Used to work out which files
 *  are still referenced and which are orphans. */
export function draftPhotoPaths(d: Pick<ChecklistDraft, 'photos'>): string[] {
  const out: string[] = []
  for (const list of Object.values(d?.photos ?? {})) {
    if (!Array.isArray(list)) continue
    for (const p of list) if (typeof p === 'string' && p) out.push(p)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo files. Own folder, own lifecycle - never the queue's.
// ─────────────────────────────────────────────────────────────────────────────

function basenameOf(uri: string): string {
  return String(uri ?? '').split('/').pop() || ''
}

function draftDir(): Directory {
  return new Directory(Paths.document, DRAFT_DIR_NAME)
}

function ensureDraftDir(): Directory {
  const dir = draftDir()
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}

/** True when a path is a copy this module made (vs a cache uri or an upload ref). */
export function isDraftPhotoPath(uri: string | null | undefined): boolean {
  return !!uri && String(uri).includes(`/${DRAFT_DIR_NAME}/`)
}

/**
 * Copy a captured photo out of the OS cache into the draft folder so it is
 * still there tomorrow. An already-copied path is returned untouched (an
 * autosave runs on every keystroke's worth of change - re-copying would write
 * the same image dozens of times). An upload ref or any non-file value passes
 * straight through. Returns null when the copy genuinely failed, and the caller
 * drops that one photo rather than storing a path that leads nowhere.
 */
export function persistDraftPhoto(uri: string): string | null {
  try {
    if (typeof uri !== 'string' || !uri) return null
    if (!uri.startsWith('file://')) return uri            // already a permanent ref
    if (isDraftPhotoPath(uri)) return uri                 // already ours
    const source = new File(uri)
    if (!source.exists) return null
    const dir = ensureDraftDir()
    const ext = (basenameOf(uri).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const dest = new File(dir, `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`)
    source.copy(dest)
    return dest.uri
  } catch {
    return null
  }
}

/**
 * Resolve a stored draft photo to a path that is valid RIGHT NOW, or null when
 * the file is genuinely gone.
 *
 * iOS rewrites the document container path between launches, so an absolute
 * path stored yesterday can be stale while the file itself is fine; the same
 * basename inside the current folder is the healed path. A null answer here is
 * a real loss and the caller reports it.
 */
export function resolveDraftPhoto(stored: string): string | null {
  try {
    if (typeof stored !== 'string' || !stored) return null
    if (!stored.startsWith('file://')) return stored      // upload ref - nothing to check
    const direct = new File(stored)
    if (direct.exists) return direct.uri
    if (!isDraftPhotoPath(stored)) return null            // a cache path the OS purged
    const name = basenameOf(stored)
    if (!name) return null
    const healed = new File(draftDir(), name)
    return healed.exists ? healed.uri : null
  } catch {
    return null
  }
}

function deleteDraftPhoto(uri: string | null | undefined): void {
  try {
    if (!isDraftPhotoPath(uri)) return                    // never delete a cache file we did not create
    const f = new File(String(uri))
    if (f.exists) f.delete()
  } catch { /* a leftover file costs space, never data */ }
}

/**
 * Delete every file in the draft folder that no LIVE draft references.
 *
 * Compared by basename so an iOS container change cannot make every file look
 * like an orphan. This is the counterpart of the queue's sweep and it reads a
 * different folder and a different list, which is precisely the point.
 */
function sweepDraftPhotos(live: ChecklistDraft[]): void {
  try {
    const dir = draftDir()
    if (!dir.exists) return
    const keep = new Set<string>()
    for (const d of live) {
      for (const p of draftPhotoPaths(d)) {
        const n = basenameOf(p)
        if (n) keep.add(n)
      }
    }
    for (const entry of dir.list()) {
      if (entry instanceof File && !keep.has(basenameOf(entry.uri))) entry.delete()
    }
  } catch { /* best effort */ }
}

/** Copy every local photo in a draft's map into the draft folder. Non-file
 *  entries (upload refs) pass through; an un-copyable one is dropped. */
export function persistDraftPhotoMap(
  photos: Record<string, string[]> | null | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [fieldId, list] of Object.entries(photos ?? {})) {
    if (!Array.isArray(list) || !list.length) continue
    const kept: string[] = []
    for (const p of list) {
      const stored = persistDraftPhoto(p)
      if (stored) kept.push(stored)
    }
    if (kept.length) out[fieldId] = kept
  }
  return out
}

/**
 * Rebuild a restored photo map against the filesystem, reporting what could not
 * be restored. A dropped photo is a fact the operator has to be told, not a gap
 * to paper over: carried on silently it would be submitted as a dead path and
 * the sheet would report success with unreachable evidence.
 */
export function restoreDraftPhotoMap(
  photos: Record<string, string[]> | null | undefined,
): { photos: Record<string, string[]>; dropped: number } {
  const out: Record<string, string[]> = {}
  let dropped = 0
  for (const [fieldId, list] of Object.entries(photos ?? {})) {
    if (!Array.isArray(list) || !list.length) continue
    const kept: string[] = []
    for (const p of list) {
      const healed = resolveDraftPhoto(p)
      if (healed) kept.push(healed)
      else dropped++
    }
    if (kept.length) out[fieldId] = kept
  }
  return { photos: out, dropped }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store. Every read-modify-write refuses to run on a read it could not trust.
// ─────────────────────────────────────────────────────────────────────────────

/** @see the read rule in the header. Thrown, never swallowed inside this
 *  module, so no caller can accidentally save over a store it could not read. */
export class DraftStoreUnreadableError extends Error {
  readonly status: string
  constructor(status: string) {
    super('Saved checklists could not be read, so nothing was changed.')
    this.name = 'DraftStoreUnreadableError'
    this.status = status
  }
}

export type DraftLoad =
  | { ok: true; drafts: ChecklistDraft[] }
  | { ok: false; status: string; drafts: ChecklistDraft[] }

/**
 * Read for DISPLAY. Never throws: a list that cannot be read shows as "could
 * not check", which is a different statement from "you have no unfinished
 * work" and the caller renders it as such.
 */
export async function loadDrafts(): Promise<DraftLoad> {
  const read = await readItem(KEY)
  if (read.status === 'unreadable' || read.status === 'torn') {
    return { ok: false, status: read.status, drafts: [] }
  }
  return { ok: true, drafts: sortDrafts(parseDrafts(read.value)) }
}

/** Read for MUTATION. Throws on a read that failed, so the caller cannot write
 *  an empty list over a store that is actually full. */
async function loadForWrite(): Promise<ChecklistDraft[]> {
  const read = await readItem(KEY)
  if (read.status === 'unreadable' || read.status === 'torn') {
    throw new DraftStoreUnreadableError(read.status)
  }
  return parseDrafts(read.value)
}

/**
 * Writes are serialised.
 *
 * The autosave timer and the backgrounding flush can fire within milliseconds
 * of each other, and each is a read-modify-write over one shared blob. Run
 * concurrently, the slower one writes a list assembled before the faster one's
 * change existed and silently reverts it. Chaining costs nothing at this rate.
 */
let writeChain: Promise<any> = Promise.resolve()
function serialise<T>(job: () => Promise<T>): Promise<T> {
  const next = writeChain.then(job, job)
  writeChain = next.catch(() => {})
  return next
}

async function persist(drafts: ChecklistDraft[]): Promise<void> {
  await secureStorage.setItem(KEY, JSON.stringify(drafts))
}

/**
 * Write one draft.
 *
 * A draft with nothing in it is REMOVED rather than stored, so a sheet the
 * operator emptied out again does not linger in their unfinished list claiming
 * work that no longer exists.
 */
export async function saveDraft(input: DraftInput): Promise<ChecklistDraft | null> {
  return serialise(async () => {
    const key = draftKey(input.userId, input.templateId, input.assetNo)
    const nowIso = new Date().toISOString()
    const list = await loadForWrite()
    const previous = list.find(d => d.key === key)

    if (!hasDraftContent(input)) {
      if (!previous) return null
      const remaining = list.filter(d => d.key !== key)
      await persist(remaining)
      sweepDraftPhotos(remaining)
      return null
    }

    const draft: ChecklistDraft = {
      ...input,
      key,
      assetNo: normaliseAsset(input.assetNo),
      // Photos are copied out of the OS cache on the way in, so what is stored
      // is always a path that will still be there tomorrow.
      photos: persistDraftPhotoMap(input.photos),
      createdAt: previous?.createdAt ?? nowIso,
      updatedAt: nowIso,
    }
    const { drafts, pruned } = upsertDraft(list, draft)
    await persist(drafts)
    // Files belonging to a pruned draft, and to any photo this save removed
    // from the sheet, are no longer referenced by anything.
    if (pruned.length || previous) sweepDraftPhotos(drafts)
    return draft
  })
}

/** Read ONE draft, restoring its photos against the filesystem. */
export async function getDraft(key: string): Promise<{ draft: ChecklistDraft; droppedPhotos: number } | null> {
  const load = await loadDrafts()
  const found = load.drafts.find(d => d.key === key)
  if (!found) return null
  const { photos, dropped } = restoreDraftPhotoMap(found.photos)
  return { draft: { ...found, photos }, droppedPhotos: dropped }
}

/**
 * Delete a draft and its photo files.
 *
 * Called when the sheet is genuinely submitted - INCLUDING a submit that went
 * into the offline queue, because that work now belongs to the queue (which
 * took its own durable copy of every photo at enqueue) and a draft left behind
 * could be filled in and submitted a second time.
 */
export async function discardDraft(key: string): Promise<void> {
  return serialise(async () => {
    const list = await loadForWrite()
    const target = list.find(d => d.key === key)
    if (!target) return
    const remaining = list.filter(d => d.key !== key)
    await persist(remaining)
    for (const p of draftPhotoPaths(target)) deleteDraftPhoto(p)
    sweepDraftPhotos(remaining)
  })
}

/** This user's unfinished sheets, newest first, for the checklists hub. */
export async function listUserDrafts(userId: string): Promise<DraftLoad> {
  const load = await loadDrafts()
  if (!load.ok) return load
  return { ok: true, drafts: draftsForUser(load.drafts, userId) }
}
