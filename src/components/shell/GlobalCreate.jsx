/**
 * GlobalCreate - the optional "+ Create" menu in the top bar.
 *
 * Spec section 54 calls this SECONDARY and says twice not to overcrowd the
 * header: page-level creation stays the primary path. So this is built to
 * disappear rather than to be present:
 *
 *  - it renders NOTHING below MIN_CREATE_ACTIONS entries. A one-item create
 *    menu is strictly worse than the page's own button - it costs a click, a
 *    popover and a scan of the header to reach something the destination page
 *    puts in front of you anyway.
 *  - it renders nothing on mobile. That bar already carries menu, brand,
 *    context chip, search, bell and avatar inside 360px; a seventh control is
 *    the overcrowding the spec warns about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ENTRY MUST LAND SOMEWHERE THAT EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * An entry that leads to Access Denied is worse than no entry, so three gates
 * run before anything is offered, and each closes a different hole:
 *
 *  1. ROUTE VISIBILITY - `isCommandVisible` from commandSearch.js, the SAME
 *     predicate the command palette and the sidebar use. It mirrors
 *     Layout.shouldShowNavItem and the App.jsx ModuleRoute gates, so this menu
 *     can never offer a page those two would refuse. Not a second copy of the
 *     rules: a copy would drift, and the drift would show up as a dead end.
 *  2. FEATURE FLAG - `/accidents` is wrapped in <FlagRoute flag="accidents_module">
 *     (App.jsx), which redirects home when the org has the module switched off.
 *     Route visibility knows nothing about flags, so the flag is checked here.
 *  3. AN EXPLICIT CREATE REVOKE - if an admin has revoked the `create`
 *     capability for that module on this user, the entry goes. This is a
 *     one-way filter: a revoke can only ever REMOVE an entry. It is deliberately
 *     NOT used as the positive gate, because `hasCapability(key,'create')`
 *     resolves with roleAllows:false, i.e. it is false for every non-Admin who
 *     has not been explicitly granted - and the destination pages do not gate
 *     their own New buttons that way. Using it positively would hide the menu
 *     from the Managers who create work orders all day.
 *
 * Beyond reaching the page, each destination was checked for a create
 * affordance that the arriving user can actually press:
 *
 *   New Asset goes to /fleet-master, NOT /assets. Asset Management renders its
 *   "Add Asset" button behind `profile?.role === 'Admin'`, so a Manager would
 *   arrive at a page with nothing to press. FleetMaster's "Add Vehicle" carries
 *   no such role gate, so the entry lands on a button for everyone it is
 *   offered to.
 *
 *   New Purchase Request goes to /requisitions, the page that actually raises a
 *   REQUEST. /procurement creates purchase ORDERS, which is a different document
 *   and a different (admin) gate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WORKING CONTEXT IS NOT PASSED IN THE URL, AND THAT IS DELIBERATE
 * ─────────────────────────────────────────────────────────────────────────────
 * Where you operate is a property of YOU, not of a link (the rule written up in
 * reportingScopeQuery.js). The destination pages already read it straight from
 * SettingsContext - TyreRecords, for one, seeds a new record's country from
 * `activeCountry` - so a created record inherits the current location without a
 * parameter. None of these six pages reads a create-time location parameter, so
 * none is invented here: a `?site=` that nothing consumes would look like it
 * worked and quietly do nothing.
 *
 * REPORT BUILDERS ARE NEVER OFFERED. Building a report is Admin-only
 * (reportBuilderAccess.canUseReportBuilder) and is not record creation anyway.
 * No entry points at a REPORT_BUILDER_ROUTES path, and a test pins that.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Plus, ChevronDown, ClipboardCheck, AlertTriangle, Wrench, ShoppingCart,
  Truck, CircleDot,
} from 'lucide-react'
import useAnchoredPopover from '../ui/useAnchoredPopover'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useFeatureFlags } from '../../hooks/useFeatureFlags'
import { isCommandVisible } from '../../lib/commandSearch'

/**
 * Translate with an honest English fallback. `t(key, vars)` takes interpolation
 * VARS second, not a fallback, so a key with no locale entry comes back as the
 * raw key. Same wrapper as the rest of the shell.
 */
function tx(t, key, fallback) {
  const v = typeof t === 'function' ? t(key) : undefined
  return !v || v === key ? fallback : v
}

/**
 * Below this many available entries the menu does not render at all.
 * Two is the point where a chooser starts earning the header space it costs.
 */
export const MIN_CREATE_ACTIONS = 2

/**
 * The catalogue. `access` is a command descriptor in exactly the shape
 * `isCommandVisible` expects, and each moduleKey is the SAME key the route
 * guard resolves (navAccess.NAV_MODULE_KEY), stated explicitly so the
 * custom-role branch gates on it too. `/requisitions` carries no moduleKey
 * because it has no NAV_MODULE_KEY entry - matching how the palette's own
 * Requisitions command is gated.
 */
export const CREATE_ACTIONS = Object.freeze([
  {
    id: 'create-inspection',
    labelKey: 'shell.newInspection',
    label: 'New Inspection',
    icon: ClipboardCheck,
    // Same destination as the palette's existing 'action-new-inspection'.
    path: '/inspections',
    access: { path: '/inspections', moduleKey: 'inspections' },
  },
  {
    id: 'create-accident',
    labelKey: 'shell.newAccident',
    label: 'New Accident',
    icon: AlertTriangle,
    path: '/accidents',
    access: { path: '/accidents', moduleKey: 'accidents' },
    flag: 'accidents_module',
  },
  {
    id: 'create-work-order',
    labelKey: 'shell.newWorkOrder',
    label: 'New Work Order',
    icon: Wrench,
    path: '/work-orders',
    access: { path: '/work-orders', moduleKey: 'work_orders' },
  },
  {
    id: 'create-requisition',
    labelKey: 'shell.newRequisition',
    label: 'New Purchase Request',
    icon: ShoppingCart,
    path: '/requisitions',
    access: { path: '/requisitions' },
  },
  {
    id: 'create-asset',
    labelKey: 'shell.newAsset',
    label: 'New Asset',
    icon: Truck,
    // NOT /assets - see the header note: its Add button is Admin-only.
    path: '/fleet-master',
    access: { path: '/fleet-master', moduleKey: 'fleet_master' },
  },
  {
    id: 'create-tyre',
    labelKey: 'shell.newTyre',
    label: 'New Tyre',
    icon: CircleDot,
    path: '/tyres',
    access: { path: '/tyres', moduleKey: 'tyre_records' },
  },
])

/**
 * Has an admin explicitly revoked `create` on this module for this user?
 * Only an explicit 'revoke' counts - anything else (granted, unset, no map at
 * all) leaves the decision to the route-visibility gate above.
 *
 * @param {object|null|undefined} capabilities  AuthContext.capabilities
 * @param {string|undefined} moduleKey
 */
export function createRevoked(capabilities, moduleKey) {
  if (!moduleKey || !capabilities) return false
  return capabilities?.[moduleKey]?.create === 'revoke'
}

/**
 * Resolve the entries this user may be offered. PURE - no React, no I/O - so
 * the gating can be tested directly rather than through a rendered popover.
 *
 * @param {object} ctx
 * @param {Array}  [ctx.actions]        defaults to CREATE_ACTIONS
 * @param {object} ctx.profile          AuthContext.profile
 * @param {Function} ctx.hasPermission  AuthContext.hasPermission
 * @param {Set<string>} [ctx.grantedModules]
 * @param {boolean} [ctx.isSuperAdmin]
 * @param {object} [ctx.capabilities]   AuthContext.capabilities
 * @param {(flag:string)=>boolean} [ctx.isFlagEnabled]  fails OPEN when absent,
 *   matching FlagRoute, which also renders while flags are still loading.
 */
export function availableCreateActions({
  actions = CREATE_ACTIONS,
  profile,
  hasPermission,
  grantedModules,
  isSuperAdmin,
  capabilities,
  isFlagEnabled,
} = {}) {
  return actions.filter((a) => {
    if (!isCommandVisible(a.access, profile, hasPermission, grantedModules, isSuperAdmin)) return false
    if (a.flag && typeof isFlagEnabled === 'function' && isFlagEnabled(a.flag) !== true) return false
    if (createRevoked(capabilities, a.access?.moduleKey)) return false
    return true
  })
}

/**
 * @param {object} props
 * @param {boolean} [props.isMobile]  the compact bar never renders this menu
 */
export default function GlobalCreate({ isMobile = false }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { profile, hasPermission, grantedModules, isSuperAdmin, capabilities } = useAuth() || {}
  // No `|| {}` guard here, unlike useAuth above: useFeatureFlags is a plain hook
  // that always returns an object, not a context read that can be undefined
  // outside its provider.
  const { isEnabled } = useFeatureFlags()

  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const popRef = useRef(null)

  const actions = useMemo(
    () => availableCreateActions({
      profile,
      hasPermission,
      grantedModules,
      isSuperAdmin,
      capabilities,
      isFlagEnabled: isEnabled,
    }),
    [profile, hasPermission, grantedModules, isSuperAdmin, capabilities, isEnabled],
  )

  // Sized from the real entry count so the popover never opens off-screen.
  const { triggerRef, coords } = useAnchoredPopover(open, {
    width: 232,
    height: 20 + actions.length * 38,
    align: 'right',
  })

  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = useCallback((path) => {
    setOpen(false)
    navigate(path)
  }, [navigate])

  // The two silences the spec asks for.
  if (isMobile) return null
  if (actions.length < MIN_CREATE_ACTIONS) return null

  const label = tx(t, 'common.create', 'Create')
  const menuLabel = tx(t, 'shell.createNew', 'Create new record')

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        title={menuLabel}
        className="h-8 flex items-center gap-1.5 pl-2 pr-1.5 rounded-xl text-xs font-semibold transition-colors hover:text-green-300"
        style={{
          color: 'var(--brand-bright, #4ade80)',
          background: 'rgba(22,163,74,0.10)',
          border: '1px solid rgba(22,163,74,0.24)',
        }}
      >
        <Plus size={14} aria-hidden="true" className="flex-shrink-0" />
        {/* The word is dropped on narrower desktops: the icon still reads as
            "create", and the header has to hold the context selector, four
            utility controls and the avatar beside it. */}
        <span className="hidden lg:inline">{label}</span>
        <ChevronDown size={12} aria-hidden="true" className="flex-shrink-0 opacity-70" />
      </button>

      {open && coords && createPortal(
        <div
          ref={popRef}
          role="menu"
          aria-label={menuLabel}
          className="tp-popover w-[232px] p-1.5"
          style={{ top: coords.top, left: coords.left, maxHeight: coords.maxHeight }}
        >
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              onClick={() => go(a.path)}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] text-left transition-colors hover:bg-[var(--input-bg)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <a.icon size={14} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--text-dim)' }} />
              <span className="truncate">{tx(t, a.labelKey, a.label)}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
