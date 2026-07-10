/**
 * featureFlags.js — org-level feature flags (Roadmap #5).
 *
 * Flags let an admin enable/disable whole product capabilities for their
 * organisation without a deploy (e.g. Company A: AI on; Company B: no
 * accident module). Persisted in `app_settings` under the `feature_flags`
 * key as a small JSON blob — the exact same pattern (and RLS assumptions:
 * everyone authenticated can read, admins can write) as `erp_connection`
 * in src/lib/api/erp.js.
 *
 * Pure helpers (unit-tested in src/test/featureFlags.test.js):
 *   - isEnabled(flags, key)  — missing key falls back to the FLAG_DEFS default
 *   - mergeFlags(raw)        — sanitize a stored blob onto the defaults
 *
 * Wrappers (used by useFeatureFlags / FeatureFlagsPanel):
 *   - fetchFlags({ force })  — read with a short in-module TTL cache
 *   - saveFlags(flags)       — validated upsert + notify subscribers
 *   - subscribe(cb)          — re-render consumers when flags change
 */

import { supabase } from './supabase'

export const FEATURE_FLAGS_SETTINGS_KEY = 'feature_flags'

/** Short TTL: flags rarely change, but a save must propagate quickly. */
export const FLAGS_CACHE_TTL_MS = 30_000

// ── Registry ─────────────────────────────────────────────────────────────────
// Every flag maps to a real app capability. Defaults are ALL ON so existing
// organisations see zero behaviour change until an admin turns something off.
export const FLAG_DEFS = [
  {
    key: 'ai_tools',
    label: 'AI Tools',
    description: 'Smart Analytics, AI Command Center, Knowledge Base and AI cost monitoring.',
    default: true,
    category: 'Intelligence',
  },
  {
    key: 'vehicle_360',
    label: 'Vehicle 360',
    description: 'Vehicle 360 profile view with full tyre, cost and inspection history.',
    default: true,
    category: 'Intelligence',
  },
  {
    key: 'accidents_module',
    label: 'Accidents & Insurance',
    description: 'Accident records, warranty and insurance workflows.',
    default: true,
    category: 'Modules',
  },
  {
    key: 'data_intake',
    label: 'Data Intake Center',
    description: 'Excel/CSV intake, validation and commit pipeline.',
    default: true,
    category: 'Modules',
  },
  {
    key: 'erp_sync',
    label: 'ERP Sync',
    description: 'ERP connection panel and scheduled ERP data synchronisation.',
    default: true,
    category: 'Modules',
  },
  {
    key: 'tv_display',
    label: 'TV Display Board',
    description: 'The /display wallboard for workshop and control-room screens.',
    default: true,
    category: 'Modules',
  },
  {
    key: 'report_scheduling',
    label: 'Report Scheduling',
    description: 'Scheduled report creation and automated email delivery.',
    default: true,
    category: 'Modules',
  },
  {
    key: 'command_palette',
    label: 'Command Palette',
    description: 'Ctrl/Cmd+K quick navigation and universal record search.',
    default: true,
    category: 'Workspace',
  },
  {
    key: 'notifications_center',
    label: 'Notification Center',
    description: 'Realtime alert bell and notification dropdown in the header.',
    default: true,
    category: 'Workspace',
  },
  {
    key: 'billing',
    label: 'Billing & Subscription',
    description:
      'Subscription plans, usage-vs-limit metering and invoice history. ' +
      'Requires migration V105 (subscription_plans / org_subscriptions / invoices) ' +
      'to be applied to the database.',
    default: true,
    category: 'Commercial',
  },
  {
    key: 'automation_platform',
    label: 'Automation Platform',
    description:
      'Event Stream, Approval Workflows, Automation Rules, and API & Webhooks. ' +
      'Requires migrations V96–V103 + the automation edge functions to be applied ' +
      'to the database first (see docs/AUTOMATION_PLATFORM_DEPLOYMENT.md).',
    // V96–V103 + edge functions are applied to the live DB and the backing
    // feature_flags row is TRUE, so this defaults ON to match the deployed state.
    default: true,
    category: 'Automation',
  },
]

/** Fast lookup: key -> definition. */
const DEF_BY_KEY = Object.freeze(
  Object.fromEntries(FLAG_DEFS.map((d) => [d.key, d])),
)

/** Frozen default map: key -> boolean default. */
export const DEFAULT_FLAGS = Object.freeze(
  Object.fromEntries(FLAG_DEFS.map((d) => [d.key, d.default])),
)

/** FLAG_DEFS grouped by category, preserving registry order. */
export function flagsByCategory() {
  const groups = []
  const index = new Map()
  for (const def of FLAG_DEFS) {
    if (!index.has(def.category)) {
      index.set(def.category, groups.length)
      groups.push({ category: def.category, flags: [] })
    }
    groups[index.get(def.category)].flags.push(def)
  }
  return groups
}

// ── Pure logic ───────────────────────────────────────────────────────────────

/**
 * Is a feature enabled? Missing/non-boolean values fall back to the FLAG_DEFS
 * default; unknown keys fail OPEN (true) so a stale bundle never hides a
 * feature the registry no longer tracks.
 */
export function isEnabled(flags, key) {
  const def = DEF_BY_KEY[key]
  if (!def) return true
  const value = flags ? flags[key] : undefined
  return typeof value === 'boolean' ? value : def.default
}

/**
 * Merge a raw stored blob (object or JSON string, possibly stale or partial)
 * onto the defaults. Only known keys with real booleans survive; anything
 * malformed degrades to the defaults instead of throwing.
 */
export function mergeFlags(raw) {
  let source = raw
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { source = null }
  }
  const merged = { ...DEFAULT_FLAGS }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const key of Object.keys(DEF_BY_KEY)) {
      if (typeof source[key] === 'boolean') merged[key] = source[key]
    }
  }
  return merged
}

// ── Cache + subscriptions ────────────────────────────────────────────────────

let cache = null            // { flags, at }
let inflight = null         // de-dupe concurrent fetches
const subscribers = new Set()

function notify(flags) {
  for (const cb of subscribers) {
    try { cb(flags) } catch { /* never let one consumer break the rest */ }
  }
}

/**
 * Subscribe to flag changes (fires after every successful save/fetch update).
 * Returns an unsubscribe function.
 */
export function subscribe(cb) {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

/** Test/logout helper: drop the cache so the next fetch hits the database. */
export function clearFlagsCache() {
  cache = null
  inflight = null
}

// ── Persistence (same app_settings pattern as erp.js) ────────────────────────

/**
 * Read the org's feature flags. Serves from the in-module cache within the
 * TTL; pass `{ force: true }` to bypass it. Any read failure returns the
 * defaults (fail open — features never disappear because of a network blip).
 */
export async function fetchFlags({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < FLAGS_CACHE_TTL_MS) {
    return cache.flags
  }
  if (!force && inflight) return inflight

  inflight = (async () => {
    try {
      // NB: `.limit(1)` (not `.maybeSingle()`) — if the table ever holds more
      // than one feature_flags row, maybeSingle() throws and we would silently
      // fall back to DEFAULT_FLAGS, where several capabilities (e.g.
      // automation_platform) default OFF. That would hide those features and
      // redirect their routes to the dashboard. Taking the first row keeps the
      // real flags even in a benign duplicate/legacy state.
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', FEATURE_FLAGS_SETTINGS_KEY)
        .limit(1)
      const flags = error ? { ...DEFAULT_FLAGS } : mergeFlags(data?.[0]?.value)
      cache = { flags, at: Date.now() }
      return flags
    } catch {
      return cache?.flags ?? { ...DEFAULT_FLAGS }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Save the org's feature flags (admins only — enforced by app_settings RLS,
 * exactly like erp_connection). Sanitizes to known keys, upserts, refreshes
 * the cache and notifies subscribers so open pages re-render immediately.
 */
export async function saveFlags(flags) {
  const clean = mergeFlags(flags)
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: FEATURE_FLAGS_SETTINGS_KEY,
      value: JSON.stringify({ ...clean, updated_at: new Date().toISOString() }),
    },
    { onConflict: 'key' },
  )
  if (error) throw new Error(error.message || 'Could not save feature flags.')
  cache = { flags: clean, at: Date.now() }
  notify(clean)
  return clean
}
