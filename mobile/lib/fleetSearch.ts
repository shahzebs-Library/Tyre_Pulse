/**
 * Finding an asset on the phone.
 *
 * THE DEFECT THIS REPLACES. The Assets screen read vehicle_fleet directly with
 * .limit(2000), which does not do what it looks like: PostgREST enforces a
 * server side max-rows (1000 here) and a larger .limit() is ignored. KSA has
 * 1,022 assets, so the phone showed 1,000 of them ordered by asset number and
 * the last 22 did not exist as far as the app was concerned - while the web,
 * which pages its reads, showed all of them. Measured: WL044 and WTP02 were
 * among the assets no phone could reach.
 *
 * Raising the limit again cannot fix a ceiling enforced on the server, and
 * holding 1,000+ rows on a 2GB handset was the wrong shape regardless - it made
 * this the slowest screen in the app. So the search runs in the database and
 * the phone takes one page at a time: every asset is reachable however large
 * the fleet grows, and memory stays bounded on the oldest device.
 *
 * Row level security is unchanged - the function is SECURITY INVOKER, so a
 * country scoped user still searches only their own country.
 */
import { supabase } from './supabase'

export interface FleetAsset {
  id: string
  asset_no: string | null
  fleet_number: string | null
  make: string | null
  model: string | null
  vehicle_type: string | null
  site: string | null
  status: string | null
  operator_name: string | null
  tyre_size: string | null
  current_km: number | null
  country: string | null
  department: string | null
  region: string | null
  registration_no: string | null
  year: number | null
}

export interface FleetPage {
  rows: FleetAsset[]
  total: number
  hasMore: boolean
  /** True when the page could not be read. Callers show an error, not an empty fleet. */
  failed: boolean
}

/** How many assets to fetch at a time. Small enough to stay smooth on a slow phone. */
export const FLEET_PAGE_SIZE = 40

const EMPTY: FleetPage = { rows: [], total: 0, hasMore: false, failed: false }

/**
 * EVERY asset the user can see, for the pickers that search a list they hold
 * locally (filing an accident, starting an inspection).
 *
 * Those screens used .limit(2000) and .limit(3000) with a comment saying the
 * bound sat above any per-country fleet. It does not - the server stops at
 * 1000 whatever the client asks for, so the tail of the fleet was missing from
 * the very forms where a crew has to find their own vehicle. This pages until
 * the server says there is no more, so the list is complete by construction
 * rather than by a number someone hopes is big enough.
 *
 * Lean columns only, and a hard stop so a runaway can never spin forever.
 *
 * @param country the user's country, or null for everything they can see
 */
export async function loadAllFleetAssets(
  country: string | null,
  hardStop = 20000,
): Promise<{ rows: FleetAsset[], failed: boolean, truncated: boolean }> {
  const out: FleetAsset[] = []
  let offset = 0
  for (;;) {
    const page = await searchFleetAssets(null, country, offset)
    if (page.failed) return { rows: out, failed: out.length === 0, truncated: false }
    out.push(...page.rows)
    if (!page.hasMore || page.rows.length === 0) return { rows: out, failed: false, truncated: false }
    offset += FLEET_PAGE_SIZE
    if (out.length >= hardStop) return { rows: out, failed: false, truncated: true }
  }
}

/**
 * One page of assets, searched in the database.
 *
 * @param query   free text - asset number, fleet number, make, model, type,
 *                plate, operator or site. Blank lists everything.
 * @param country the user's country, or null/'All' for every country they can see
 * @param offset  how many rows to skip; use page * FLEET_PAGE_SIZE
 */
export async function searchFleetAssets(
  query: string | null,
  country: string | null,
  offset = 0,
  site: string | null = null,
): Promise<FleetPage> {
  try {
    const { data, error } = await supabase.rpc('search_fleet_assets', {
      p_query: query && query.trim() ? query.trim() : null,
      p_country: country && country !== 'All' ? country : null,
      p_site: site || null,
      p_limit: FLEET_PAGE_SIZE,
      p_offset: Math.max(0, offset),
    })
    if (error) throw error
    if (!data || data.ok !== true) return EMPTY
    return {
      rows: Array.isArray(data.rows) ? (data.rows as FleetAsset[]) : [],
      total: Number(data.total) || 0,
      hasMore: data.has_more === true,
      failed: false,
    }
  } catch (err) {
    if (__DEV__) console.warn('[fleetSearch] failed:', err)
    // Distinguish "could not read" from "no assets" - showing an empty fleet
    // for a network failure is how someone concludes their data is gone.
    return { ...EMPTY, failed: true }
  }
}
