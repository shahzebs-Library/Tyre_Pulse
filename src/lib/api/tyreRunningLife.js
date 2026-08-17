/**
 * tyreRunningLife service - loads the V488 get_tyre_running_life aggregate
 * (per active tyre: km/hours run vs current meters + projected remaining km).
 * Degrades to { ok: false } so the section renders an honest error state.
 */
import { supabase, applyCountry } from './_client'
import { toUserMessage } from '../safeError'

/**
 * In-flight and recent results, keyed by country AND by the server-side filter.
 *
 * This RPC is expensive: measured live, get_tyre_running_life('KSA') takes
 * ~814 ms of server time and returns 3,595 rows / 2.2 MB, which the browser was
 * dropping outright - hence the paged read below. Most callers never wanted the
 * whole set: the Inspections page keeps only the 465 rows that are overdue or
 * due soon, and its PDF export keeps ONE asset's 12. V526 added `p_due_only`
 * and `p_asset` so the server sends only those (285 kB and 7.6 kB).
 *
 * THE CACHE KEY MUST CARRY THE FILTER. Keyed on country alone, a due-only or
 * per-asset payload would be handed to a caller that asked for everything, and
 * the missing rows would look like data that does not exist - silently wrong,
 * which is worse than slow.
 *
 * Deduping the in-flight promise is always correct - it is the same request,
 * already on its way. The short result cache is opt-in per caller, because a
 * screen with its own refresh control must be able to insist on a fresh read.
 */
const _cache = new Map()

/**
 * @param {{country?:string, maxAgeMs?:number, asset?:string, dueOnly?:boolean}} [opts]
 *   `asset` returns only that asset's tyres; `dueOnly` returns only rows that
 *   are overdue or due soon (the server mirrors bandFor - see V526). `maxAgeMs`
 *   lets a caller reuse a recent payload; omitting it is the default AND the way
 *   to insist on a fresh read, so a screen with its own refresh control needs
 *   nothing extra.
 */
export async function getTyreRunningLife({ country, maxAgeMs = 0, asset = null, dueOnly = false } = {}) {
  const p_country = country && country !== 'All' ? country : null
  const p_asset = asset ? String(asset).trim() || null : null
  const p_due_only = dueOnly === true
  const key = `${p_country || '__all__'}|${p_asset || '__any__'}|${p_due_only ? 'due' : 'all'}`
  const hit = _cache.get(key)
  if (hit) {
    // A request already on the wire is shared regardless of maxAgeMs: waiting
    // for it is strictly better than starting a second identical 832 ms read.
    if (hit.promise) return hit.promise
    if (maxAgeMs > 0 && Date.now() - hit.at < maxAgeMs) return hit.value
  }

  // Every failure used to collapse to a bare { ok: false }, so the page rendered
  // an empty table whether the read was denied, the network dropped, or there
  // genuinely are no tyres. "We could not look" and "there is nothing" are
  // opposite statements; the reason is carried so the page can say which.
  const promise = (async () => {
    try {
      // Paged. The whole payload is 3,595 rows / 2.2 MB for KSA in ONE response,
      // and the browser was dropping it - the screen showed "Network error"
      // while the server had answered in 814 ms. Each page is about 600 kB.
      // The rows are ordered server-side inside the slice, so page 2 is the
      // next rows and not an arbitrary set.
      //
      // THE PAGES ARE FETCHED CONCURRENTLY, and that is the point. Paging fixed
      // the dropped payload and made the WALL CLOCK four times worse, because
      // this RPC costs the same for one row as for a thousand - measured flat at
      // ~7.5 s for limit 1 and limit 1000 alike, since the expensive part is the
      // fleet baseline it builds before slicing. V576 then V577 took one call
      // from ~7.5 s to ~1.1 s, but the cost is still per CALL and not per row,
      // so four sequential calls would still be four times the cost of one for
      // no benefit; past a gateway timeout that is not slow, it is an error.
      //
      // Page 0 goes first ALONE, because its `total` is what says how many more
      // there are - guessing would either miss rows or fire requests for pages
      // that do not exist. The rest go in one bounded batch, and the results are
      // reassembled BY OFFSET so the server's ordering survives regardless of
      // which response lands first.
      const PAGE = 1000
      const MAX_ROWS = 8000 // a stop, not an expectation: KSA is 3,595
      const MAX_CONCURRENT = 4 // matches fetchAllPages; a bound, not a target

      const fetchPage = async (offset) => {
        const { data, error } = await supabase.rpc('get_tyre_running_life', {
          p_country, p_limit: PAGE, p_offset: offset, p_asset, p_due_only,
        })
        if (error) return { err: toUserMessage(error) }
        if (!data) return { err: 'The running-life service returned nothing.' }
        if (data.ok === false) {
          return { err: data.reason || 'The running-life service could not build this view.' }
        }
        return { data, rows: Array.isArray(data.rows) ? data.rows : [] }
      }

      const first = await fetchPage(0)
      if (first.err) return { ok: false, reason: first.err }
      const out = { ...first.data, rows: first.rows }

      const total = Number(first.data.total)
      // Without a server count, fall back to the old rule: a short page is the
      // last one. That path stays sequential because there is nothing to predict.
      if (!Number.isFinite(total)) {
        if (first.rows.length === PAGE) {
          for (let offset = PAGE; offset < MAX_ROWS; offset += PAGE) {
            // eslint-disable-next-line no-await-in-loop
            const p = await fetchPage(offset)
            if (p.err) return { ok: false, reason: p.err }
            out.rows = out.rows.concat(p.rows)
            if (p.rows.length < PAGE) break
          }
        }
        return out
      }

      const offsets = []
      for (let offset = PAGE; offset < Math.min(total, MAX_ROWS); offset += PAGE) offsets.push(offset)

      for (let i = 0; i < offsets.length; i += MAX_CONCURRENT) {
        const window = offsets.slice(i, i + MAX_CONCURRENT)
        const settled = await Promise.all(window.map((o) => fetchPage(o)))
        const failed = settled.find((p) => p.err)
        // One bad page invalidates the set: a partial list rendered as a whole
        // one is silently wrong, which is worse than an honest failure.
        if (failed) return { ok: false, reason: failed.err }
        for (const p of settled) out.rows = out.rows.concat(p.rows)
      }
      return out
    } catch (e) {
      return { ok: false, reason: toUserMessage(e) }
    }
  })()

  _cache.set(key, { promise })
  const value = await promise
  // A failure is never cached - the next attempt must be allowed to succeed.
  if (value && value.ok !== false) _cache.set(key, { value, at: Date.now() })
  else _cache.delete(key)
  return value
}

const TARGET_COLS = 'id, country, size, vehicle_type, target_km, target_hours, note, updated_at'

/**
 * List the org's manual tyre life targets ([] on any failure).
 *
 * `country` returns only the rules that actually apply there: the ones tagged
 * with that country PLUS the country-less ones (which apply everywhere). This
 * mirrors the resolution the RPC already does (`country is null or country =
 * the tyre's country`), so the list can never claim a KSA-only target affects
 * UAE. Omit `country` (or pass 'All') to get every rule.
 */
export async function listTyreLifeTargets(country) {
  try {
    const q = applyCountry(supabase.from('tyre_life_targets').select(TARGET_COLS), country)
    const { data, error } = await q.order('size').order('vehicle_type')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

/**
 * Create or update a manual target (unique per country+size+vehicle_type).
 * A target may pin a size, a vehicle type, or BOTH - the most specific match
 * wins on every tyre (size+type > type only > size only).
 */
export async function saveTyreLifeTarget({ id, country, size, vehicle_type, target_km, target_hours, note }) {
  const km = target_km === '' || target_km == null ? null : Number(target_km)
  const hrs = target_hours === '' || target_hours == null ? null : Number(target_hours)
  const row = {
    country: country && country !== 'All' ? country : null,
    size: String(size || '').trim() || null,
    vehicle_type: vehicle_type ? String(vehicle_type).trim() : null,
    target_km: Number.isFinite(km) ? km : null,
    target_hours: Number.isFinite(hrs) ? hrs : null,
    note: note || null,
  }
  if (!row.size && !row.vehicle_type) throw new Error('Pick a tyre size or a vehicle type (or both).')
  if (row.target_km == null && row.target_hours == null) throw new Error('Set a target in km, in hours, or both.')
  if (id) {
    const { data, error } = await supabase.from('tyre_life_targets')
      .update({ ...row, updated_at: new Date().toISOString() }).eq('id', id).select(TARGET_COLS).single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('tyre_life_targets')
    .insert([row]).select(TARGET_COLS).single()
  if (error) throw error
  return data
}

export async function deleteTyreLifeTarget(id) {
  const { error } = await supabase.from('tyre_life_targets').delete().eq('id', id)
  if (error) throw error
}
