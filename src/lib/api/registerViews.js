/**
 * Register views service — persistence for the operator-grade register layouts.
 *
 * The RULES live in the pure engine `src/lib/registerViews.js`; this module only
 * reads and writes the blob. Every function here DEGRADES GRACEFULLY:
 *
 *   - The `user_view_prefs` table ships behind an UNAPPLIED migration
 *     (supabase/migrations/20260921090000_user_view_prefs.sql). Until the owner
 *     applies it, PostgREST answers "relation does not exist" for every call.
 *     A register must still work perfectly in that state — it simply forgets
 *     the layout between sessions. So a missing relation resolves to an empty
 *     result, never an error banner.
 *
 *   - A save that cannot reach the server must NOT block the operator. Column
 *     preferences are a convenience, not data. Failures resolve to
 *     `{ ok:false, reason }` and the caller keeps the layout in memory.
 *
 * Nothing here is allowed to throw into a render path.
 */
import { supabase, isMissingRelation } from './_client'
import { normalizeView, emptyView } from '../registerViews'

const TABLE = 'user_view_prefs'
const COLS = 'id, module_key, name, is_default, view, updated_at'

/**
 * Remember, for this browser session, that the table is not there.
 *
 * Every register asks for its saved view on mount. While the table is not
 * provisioned each of those requests is a 404 in the network log and a wasted
 * round trip, on every page, for every user. After the FIRST definite "no such
 * table" answer no further request is sent until the page is reloaded.
 *
 * Only a definite answer by CODE counts (42P01 from Postgres, PGRST205 from the
 * API schema cache). A permission or network failure does not set it, so a
 * transient fault never switches saved views off for the session.
 */
let tableMissing = false
const isTableMissing = (error) => {
  const code = String(error?.code || error?.cause?.code || '')
  return code === '42P01' || code === 'PGRST205'
}
const noteMissing = (error) => { if (isTableMissing(error)) tableMissing = true }

/** True once this session has learned the saved-views table is not provisioned. */
export function savedViewsUnavailable() { return tableMissing }

/** Test seam: forget the remembered state. */
export function resetSavedViewsAvailability() { tableMissing = false }

/** The unnamed "current arrangement" every operator gets without naming anything. */
export const CURRENT_VIEW_NAME = ''

/**
 * listSavedViews — every view this person saved for one module.
 * Resolves to `[]` when the feature is not provisioned; never rejects.
 */
export async function listSavedViews(moduleKey) {
  if (!moduleKey) return []
  if (tableMissing) return []
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(COLS)
      .eq('module_key', moduleKey)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true })
    if (error) {
      // Not provisioned yet is a normal state, not a fault.
      noteMissing(error)
      return []
    }
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * loadView — the arrangement to open a register with: the person's default if
 * they set one, else their unnamed current arrangement, else a fresh view.
 * `catalog` is the page's live column catalog, so a stored blob is reconciled
 * (new columns appended, retired columns dropped) before it reaches the table.
 */
export async function loadView(moduleKey, catalog) {
  const rows = await listSavedViews(moduleKey)
  const chosen =
    rows.find((r) => r.is_default) ||
    rows.find((r) => r.name === CURRENT_VIEW_NAME) ||
    null
  const raw = chosen ? { ...(chosen.view || {}), moduleKey, name: chosen.name } : emptyView(moduleKey)
  return {
    view: normalizeView(raw, catalog),
    id: chosen ? chosen.id : null,
    provisioned: rows.length > 0,
  }
}

/**
 * saveView — upsert one named view. Returns `{ ok, reason }` and NEVER throws,
 * because a failed layout save must not interrupt what the operator was doing.
 */
export async function saveView(moduleKey, view, { name = CURRENT_VIEW_NAME, isDefault = false } = {}) {
  if (!moduleKey) return { ok: false, reason: 'no-module' }
  if (tableMissing) return { ok: false, reason: 'not-provisioned' }
  try {
    const payload = {
      module_key: moduleKey,
      name: String(name || '').slice(0, 60),
      is_default: !!isDefault,
      // Persist only the arrangement. moduleKey/name live in their own columns.
      view: { ...view, moduleKey: undefined, name: undefined },
    }
    const { error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: 'user_id,module_key,name' })
    if (error) {
      noteMissing(error)
      if (isMissingRelation(error)) return { ok: false, reason: 'not-provisioned' }
      return { ok: false, reason: 'save-failed' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'save-failed' }
  }
}

/** deleteView — remove one saved view by id. Same non-throwing contract. */
export async function deleteView(id) {
  if (!id) return { ok: false, reason: 'no-id' }
  if (tableMissing) return { ok: false, reason: 'not-provisioned' }
  try {
    const { error } = await supabase.from(TABLE).delete().eq('id', id)
    if (error) return { ok: false, reason: isMissingRelation(error) ? 'not-provisioned' : 'delete-failed' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'delete-failed' }
  }
}

/**
 * setDefaultView — promote one saved view to this person's default for the
 * module. Clears the previous default first: the table carries a partial unique
 * index allowing exactly one default per (user, module), so writing a second
 * one without clearing would raise 23505.
 */
export async function setDefaultView(moduleKey, id) {
  if (!moduleKey || !id) return { ok: false, reason: 'no-id' }
  if (tableMissing) return { ok: false, reason: 'not-provisioned' }
  try {
    const cleared = await supabase
      .from(TABLE)
      .update({ is_default: false })
      .eq('module_key', moduleKey)
      .eq('is_default', true)
    if (cleared.error) noteMissing(cleared.error)
    if (cleared.error && isMissingRelation(cleared.error)) return { ok: false, reason: 'not-provisioned' }

    const { error } = await supabase.from(TABLE).update({ is_default: true }).eq('id', id)
    if (error) return { ok: false, reason: 'save-failed' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'save-failed' }
  }
}
