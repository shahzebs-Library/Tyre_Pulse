/**
 * The COMPLETE access-controlled module list for every access surface in the console.
 *
 * MODULE_GROUPS in moduleCatalog.js is a curated 37-module base whose keys must never
 * be renamed. On its own it hid every other page from Access Control: Tyre Passport,
 * Rotation, Vehicle 360 and ~120 more were routed behind a moduleKey (so the server
 * and ModuleRoute already enforce them) but could not be granted or revoked, because
 * no access screen listed them.
 *
 * This file merges the live sidebar (Layout.NAV_CATALOG) onto that base through the
 * existing buildNavModuleCatalog(), the same merge Module Control already uses, so the
 * two can never disagree. It lives in its own file because Layout imports
 * moduleCatalog: importing Layout from there would be a cycle.
 *
 * Shape matches MODULE_GROUPS / ALL_MODULES / MODULE_LABEL so consumers swap imports.
 */
import { NAV_CATALOG } from '../components/Layout'
import { buildNavModuleCatalog, MODULE_GROUPS } from './moduleCatalog'

const flat = buildNavModuleCatalog(NAV_CATALOG)

/** Group order: curated groups first (stable), then sidebar groups in sidebar order. */
function groupModules(rows) {
  const order = []
  const byGroup = new Map()
  for (const r of rows) {
    const g = r.category || 'Other'
    if (!byGroup.has(g)) {
      byGroup.set(g, [])
      order.push(g)
    }
    byGroup.get(g).push({ key: r.module_id, label: r.name })
  }
  return order.map((group) => ({ group, modules: byGroup.get(group) }))
}

/** @type {{ group: string, modules: { key: string, label: string }[] }[]} */
export const ACCESS_MODULE_GROUPS = groupModules(flat)

export const ACCESS_MODULES = ACCESS_MODULE_GROUPS.flatMap((g) =>
  g.modules.map((m) => ({ ...m, group: g.group })),
)

export const ACCESS_MODULE_LABEL = Object.fromEntries(ACCESS_MODULES.map((m) => [m.key, m.label]))

/** Curated base keys, kept so callers can tell a stable key from a sidebar-derived one. */
export const CURATED_MODULE_KEYS = new Set(MODULE_GROUPS.flatMap((g) => g.modules.map((m) => m.key)))
