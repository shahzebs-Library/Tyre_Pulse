/**
 * AccessManager.jsx - the EASY, one-screen access-control editor.
 *
 * A single tree (nav group -> module -> sub-module) with a plain ON/OFF access
 * (view) toggle on every row and an "Advanced" disclosure for the finer
 * capabilities (create/edit/delete/export/approve). It edits access for a whole
 * ROLE or for one specific USER, with presets, group bulk-apply, search and a
 * live effective-access preview beside the toggles.
 *
 * REUSE, do NOT reinvent:
 *   - Registry/tree           -> src/lib/moduleCatalog.js (MODULE_GROUPS, SUBMODULES, FULL_REGISTRY)
 *   - Role defaults + caps     -> src/lib/permissionMatrix.js (defaultViewAccess, CAPABILITIES, resolveCapability)
 *   - Role view persistence    -> src/lib/api/modulePermissions.js (listGlobalPermissions, saveModulePermissions)
 *   - Role non-view caps store  -> src/lib/permissionMatrix.js (get/savePermissionOverrides) [app_settings]
 *   - Per-user grants           -> src/lib/api/accessGrants.js (list/set/revokeUserAccessGrant)
 *   - User directory            -> src/lib/api/users.js (listProfiles)
 *
 * HONESTY (labelled throughout): only the `view` capability on the 37 BASE
 * modules is enforced by the app today (AuthContext.hasPermission + ModuleRoute).
 * Sub-module keys ('parent:child') and the non-view capabilities are STORED for
 * progressive enforcement and gate nothing yet; the UI says "(stored only)".
 * Role sub-module view is persisted as a module_permissions row on the composite
 * key (free text, harmlessly ignored by base-module enforcement); role non-view
 * caps live in the existing app_settings overrides (base modules only); every
 * per-user override (any capability, base or sub) is a user_access_grants row.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, Search, ChevronRight, ChevronDown, ChevronsDownUp,
  ChevronsUpDown, Crown, Save, Loader2, Check, X, RotateCcw, Info,
  AlertTriangle, SlidersHorizontal, UserCog, Eye, Ban, RefreshCw,
  FolderTree, Zap, Monitor, Smartphone, Layers, ShieldCheck, KeyRound,
} from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  MODULE_GROUPS, SUBMODULES, ACCESS_ROLES, REGISTRY_LABEL, isSubmoduleKey,
} from '../../../lib/moduleCatalog'
import {
  CAPABILITIES, defaultViewAccess, resolveCapability,
  getPermissionOverrides, savePermissionOverrides,
} from '../../../lib/permissionMatrix'
import { listGlobalPermissions, saveModulePermissions } from '../../../lib/api/modulePermissions'
import { listProfiles } from '../../../lib/api/users'
import { listCustomRoles } from '../../../lib/api/customRoles'
import MobileAccessPanel from './MobileAccessPanel'
import {
  listUserGrants, revokeUserAccessGrant,
  setUserAccessGrantScoped, mobileGrantKey, parseGrantScope,
  grantKeysForScope, computeRoleViewChanges,
} from '../../../lib/api/accessGrants'
import { toUserMessage } from '../../../lib/safeError'

// Capabilities beyond `view` (the Advanced row). view is the big ON/OFF toggle.
const EXTRA_CAPS = CAPABILITIES.filter((c) => c.key !== 'view')
const CAP_KEYS = CAPABILITIES.map((c) => c.key)

// Surface scope for a per-user override: which app(s) the grant reaches. Web =
// the plain module_key row, Mobile = the `mobile:`-prefixed row, Both = both.
const SCOPES = [
  { key: 'web', label: 'Web', icon: Monitor },
  { key: 'mobile', label: 'Mobile', icon: Smartphone },
  { key: 'both', label: 'Both', icon: Layers },
]
const DEFAULT_SCOPE = 'web'

const ROLE_TINT = {
  Admin: 'text-purple-300', Manager: 'text-blue-300', Director: 'text-indigo-300',
  Reporter: 'text-cyan-300', Inspector: 'text-green-300', 'Tyre Man': 'text-amber-300',
  Driver: 'text-[var(--text-secondary)]',
}

// Access presets (the easy ladder). Each lists which capabilities it turns on.
const PRESETS = [
  { key: 'none',    label: 'No access', caps: [] },
  { key: 'viewer',  label: 'Viewer',    caps: ['view'] },
  { key: 'editor',  label: 'Editor',    caps: ['view', 'create', 'edit'] },
  { key: 'manager', label: 'Manager',   caps: ['view', 'create', 'edit', 'delete', 'export'] },
  { key: 'full',    label: 'Full',      caps: ['view', 'create', 'edit', 'delete', 'export', 'approve'] },
]
const presetCapMap = (preset) => Object.fromEntries(CAP_KEYS.map((c) => [c, preset.caps.includes(c)]))

function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

// ── Pure state builders (kept simple + local) ────────────────────────────────

/** Does this role have ANY explicit global module_permissions rows? */
function roleHasDbRows(viewMap, role) {
  const rows = viewMap?.[role]
  return !!rows && typeof rows === 'object' && Object.keys(rows).length > 0
}

/**
 * Resolve one ROLE node's ON/OFF view AND its surface scope from a single role's
 * module_permissions map. A module can carry a plain (web) row and/or a `mobile:`
 * (mobile) row; the toggle is ON when EITHER present surface is enabled, and the
 * scope is derived from the stored VALUES (not mere presence) so it round-trips a
 * save: after web-only writes plain=true + mobile=false the state reads back as
 * 'web'; after mobile-only writes plain=false + mobile=true it reads back as
 * 'mobile'; both true = 'both'. A module with no explicit row on a surface
 * defaults that surface's scope contribution to the primary (web) surface, so an
 * unconfigured module shows the conservative 'web' scope until narrowed.
 *
 * @param {Record<string,boolean>|undefined} roleRows  the role's { key: enabled }
 * @param {string}  key          plain module/sub-module key
 * @param {boolean} isAdmin      Admin is always fully allowed
 * @param {boolean} hasRows      role has ANY explicit rows (sparse-matrix guard)
 * @param {boolean} [inheritView] sub-module fallback = parent's view
 * @param {string}  role         role name (for defaultViewAccess)
 * @returns {{ view: boolean, scope: ('web'|'mobile'|'both') }}
 */
function roleKeyState(roleRows, key, isAdmin, hasRows, inheritView, role) {
  if (isAdmin) return { view: true, scope: 'both' }
  const mobKey = mobileGrantKey(key)
  const hasPlain = !!roleRows && Object.prototype.hasOwnProperty.call(roleRows, key)
  const hasMobile = !!roleRows && Object.prototype.hasOwnProperty.call(roleRows, mobKey)
  const webVal = hasPlain ? roleRows[key] === true : null
  const mobVal = hasMobile ? roleRows[mobKey] === true : null

  // Overall ON when any explicitly-enabled surface exists; else inherit/default.
  let view
  if (webVal === true || mobVal === true) {
    view = true
  } else if (hasPlain || hasMobile) {
    view = false // present but all explicit surfaces are false
  } else if (typeof inheritView === 'boolean') {
    view = inheritView
  } else {
    view = hasRows ? false : defaultViewAccess(role, key)
  }

  // Scope from explicit surface VALUES (round-trips web/mobile/both).
  let scope
  if (hasPlain && hasMobile) {
    scope = webVal && mobVal ? 'both' : mobVal ? 'mobile' : webVal ? 'web' : DEFAULT_SCOPE
  } else if (hasMobile) {
    scope = mobVal ? 'mobile' : DEFAULT_SCOPE
  } else {
    scope = DEFAULT_SCOPE // web-only or unconfigured
  }
  return { view, scope }
}

/**
 * Effective per-node access for a ROLE, mirroring getEffectiveMatrix semantics:
 *  - base module view: DB rows win when present, else the hardcoded default.
 *  - base module caps: override wins, else defaults to the module's view default.
 *  - sub-module view: explicit composite row wins, else inherits the parent.
 *  - per-node surface scope: web / mobile / both, from which rows exist.
 *  - Admin is always fully allowed.
 * @returns {{ view: Record<string,boolean>, caps: Record<string,Record<string,boolean>>, scope: Record<string,string> }}
 */
function buildRoleState(role, viewMap, overrides) {
  const isAdmin = role === 'Admin'
  const roleRows = viewMap?.[role]
  const hasRows = roleHasDbRows(viewMap, role)
  const view = {}
  const caps = {}
  const scope = {}
  for (const g of MODULE_GROUPS) {
    for (const m of g.modules) {
      const st = roleKeyState(roleRows, m.key, isAdmin, hasRows, undefined, role)
      const baseView = st.view
      view[m.key] = baseView
      scope[m.key] = st.scope
      const ov = overrides?.[role]?.[m.key] || {}
      caps[m.key] = {}
      for (const c of EXTRA_CAPS) {
        caps[m.key][c.key] = isAdmin ? true : c.key in ov ? ov[c.key] === true : baseView
      }
      for (const s of SUBMODULES[m.key] || []) {
        const sst = roleKeyState(roleRows, s.key, isAdmin, hasRows, baseView, role)
        view[s.key] = sst.view
        scope[s.key] = sst.scope
        // Sub-module non-view caps are not stored for roles; mirror sub view.
        caps[s.key] = Object.fromEntries(EXTRA_CAPS.map((c) => [c.key, view[s.key]]))
      }
    }
  }
  return { view, caps, scope }
}

/** Index grant rows: key -> capability -> effect -> grantId. Includes both plain
 * (web) and `mobile:`-prefixed (mobile) module_key rows as stored. */
function indexGrants(rows) {
  const idx = {}
  for (const r of rows || []) {
    const cap = r.capability || 'view'
    ;((idx[r.module_key] ||= {})[cap] ||= {})[r.effect] = r.id
  }
  return idx
}

/**
 * Resolve the surface scope of a user's EXISTING override on a module key from
 * whether any capability carries a plain (web) and/or a `mobile:` (mobile) row.
 * Returns 'web' | 'mobile' | 'both', defaulting to DEFAULT_SCOPE when there is
 * no override at all (so the selector shows a sensible default).
 */
function rowScope(idx, key) {
  const hasPlain = !!idx?.[key] && Object.keys(idx[key]).length > 0
  const mKey = mobileGrantKey(key)
  const hasMobile = !!idx?.[mKey] && Object.keys(idx[mKey]).length > 0
  return parseGrantScope(hasPlain ? 'grant' : null, hasMobile ? 'grant' : null) || DEFAULT_SCOPE
}

/** Build the per-key scope baseline map for a user's current grants. */
function buildScopeMap(roleState, grantIdx) {
  const m = {}
  for (const key of Object.keys(roleState.view)) m[key] = rowScope(grantIdx, key)
  return m
}

/**
 * The override effect on a capability, read from the storage key(s) that the
 * row's scope points at (plain for web, mobile: for mobile, either for both).
 * Revoke wins within a key (grantEffect handles that).
 */
function combinedGrantEffect(idx, key, cap, scope) {
  const plain = grantEffect(idx, key, cap)
  const mobile = grantEffect(idx, mobileGrantKey(key), cap)
  if (scope === 'mobile') return mobile
  if (scope === 'both') return plain || mobile
  return plain // 'web'
}

/**
 * Effective per-node access for a USER = role baseline overlaid with grants.
 * Super admins bypass everything (all true). The override for each key is read
 * from the storage key(s) its scope points at (web = plain, mobile = mobile:,
 * both = either) so the draft reflects grants written on either surface.
 */
function buildUserState(user, roleState, grantIdx, scopeMap) {
  const isSuper = user?.is_super_admin === true
  const role = user?.role
  const view = {}
  const caps = {}
  const allKeys = Object.keys(roleState.view)
  for (const key of allKeys) {
    const sub = isSubmoduleKey(key)
    const parent = sub ? key.split(':', 1)[0] : key
    const scope = scopeMap?.[key] || DEFAULT_SCOPE
    // baseline for a sub-module = its parent's role baseline (nothing enforces the sub key).
    const baseView = sub ? roleState.view[parent] : roleState.view[key]
    view[key] = isSuper
      ? true
      : resolveCapability({ role, isSuperAdmin: isSuper, roleAllows: baseView, override: combinedGrantEffect(grantIdx, key, 'view', scope) })
    caps[key] = {}
    for (const c of EXTRA_CAPS) {
      const baseCap = sub ? roleState.caps[parent]?.[c.key] : roleState.caps[key]?.[c.key]
      caps[key][c.key] = isSuper
        ? true
        : resolveCapability({ role, isSuperAdmin: isSuper, roleAllows: baseCap === true, override: combinedGrantEffect(grantIdx, key, c.key, scope) })
    }
  }
  return { view, caps }
}

function grantEffect(idx, key, cap) {
  const e = idx?.[key]?.[cap]
  if (!e) return undefined
  if (e.revoke) return 'revoke' // revoke wins
  if (e.grant) return 'grant'
  return undefined
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AccessManager() {
  const { profile, isSuperAdmin } = useAuth()
  const isAdmin = profile?.role === 'Admin' || isSuperAdmin === true
  const canWriteRole = isAdmin // set_module_permissions: Admin or super
  const canWriteUser = isSuperAdmin === true // set_user_access_grant: super only

  const [mode, setMode] = useState('role') // 'role' | 'user'
  const [selectedRole, setSelectedRole] = useState('Manager')
  const [selectedUserId, setSelectedUserId] = useState(null)

  // Custom roles (custom_roles table) get first-class chips beside the built-ins.
  // Their access already lives in the SAME module_permissions rows keyed by the
  // role name string, so selecting one edits it exactly like a built-in role.
  const [customRoles, setCustomRoles] = useState([])
  const [customRolesLoaded, setCustomRolesLoaded] = useState(false)

  // Loaded globals (shared by both modes)
  const [viewMap, setViewMap] = useState(null)
  const [overrides, setOverrides] = useState(null)
  const [users, setUsers] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  // Per-user grants for the selected user
  const [grantIdx, setGrantIdx] = useState({})
  const [grantsLoading, setGrantsLoading] = useState(false)

  // Draft + baseline
  const [baseline, setBaseline] = useState(null) // loaded effective state
  const [draft, setDraft] = useState(null)        // edited state
  const [roleBaseline, setRoleBaseline] = useState(null) // user mode: role-only baseline for reset/diff

  // Per-key surface scope (user mode): which app(s) an override reaches.
  const [scopeBaseline, setScopeBaseline] = useState({})
  const [scopeDraft, setScopeDraft] = useState({})

  // UI
  const [search, setSearch] = useState('')
  const [uSearch, setUSearch] = useState('')
  const [uRoleFilter, setURoleFilter] = useState('all')
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  const [openAdvanced, setOpenAdvanced] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // Role-wide surface control (role mode): 'permodule' shows the per-module
  // Web/Mobile/Both selectors; 'web'/'mobile' means the whole role is uniform on
  // that one surface (per-module selectors hidden).
  const [roleSurfaceView, setRoleSurfaceView] = useState('permodule')

  const flashTimer = useRef(null)
  const flash = useCallback((msg, isError = false) => {
    if (isError) { setErrorMsg(msg); setNotice('') } else { setNotice(msg); setErrorMsg('') }
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => { setNotice(''); setErrorMsg('') }, 6000)
  }, [])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  // ── Load globals ────────────────────────────────────────────────────────────
  const loadGlobals = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const [vm, ov, us] = await Promise.all([
        listGlobalPermissions(),
        getPermissionOverrides(),
        listProfiles(),
      ])
      setViewMap(vm || {})
      setOverrides(ov || {})
      setUsers(Array.isArray(us) ? us : [])
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load access data.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadGlobals() }, [loadGlobals])

  // ── Custom roles: load on mount + refresh on tab focus/visibility, so a role
  // created moments ago in the Custom Roles tab (or another tab) appears here
  // without a full reload. Fail-open: on error keep the last good list ([] at
  // first) and never block the editor.
  const loadCustomRoles = useCallback(async () => {
    try {
      const rows = await listCustomRoles()
      setCustomRoles(Array.isArray(rows) ? rows : [])
    } catch {
      // fail-open: keep whatever we already have (initially [])
    } finally {
      setCustomRolesLoaded(true)
    }
  }, [])

  useEffect(() => {
    loadCustomRoles()
    const onFocus = () => loadCustomRoles()
    const onVisibility = () => { if (!document.hidden) loadCustomRoles() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadCustomRoles])

  // If the selected CUSTOM role disappears (deleted in the Custom Roles tab),
  // fall back to Manager instead of editing a ghost role. Built-ins never fall.
  const isCustomSelected = !ACCESS_ROLES.includes(selectedRole)
  useEffect(() => {
    if (mode !== 'role' || !customRolesLoaded) return
    if (ACCESS_ROLES.includes(selectedRole)) return
    if (!customRoles.some((r) => r.name === selectedRole)) setSelectedRole('Manager')
  }, [mode, selectedRole, customRoles, customRolesLoaded])

  const selectedUser = useMemo(
    () => (users || []).find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId],
  )

  // ── Build baseline/draft when selection changes ───────────────────────────────
  const buildRole = useCallback(() => {
    if (!viewMap || !overrides) return
    const state = buildRoleState(selectedRole, viewMap, overrides)
    setBaseline(state)
    setRoleBaseline(null)
    setDraft(structuredClone(state))
    // Role mode also carries a per-node surface scope (web / mobile / both).
    setScopeBaseline({ ...(state.scope || {}) })
    setScopeDraft({ ...(state.scope || {}) })
    // Reflect the role-wide surface control: if EVERY enabled base module shares
    // one surface (all web or all mobile), show that; otherwise per-module.
    const baseKeys = MODULE_GROUPS.flatMap((g) => g.modules.map((m) => m.key))
    const enabledScopes = baseKeys.filter((k) => state.view[k]).map((k) => state.scope[k] || DEFAULT_SCOPE)
    const uniform = enabledScopes.length > 0 && enabledScopes.every((s) => s === enabledScopes[0])
      ? enabledScopes[0] : null
    setRoleSurfaceView(uniform === 'web' || uniform === 'mobile' ? uniform : 'permodule')
  }, [selectedRole, viewMap, overrides])

  const buildUser = useCallback(async (user) => {
    if (!user || !viewMap || !overrides) { setBaseline(null); setDraft(null); return }
    setGrantsLoading(true)
    try {
      const rows = await listUserGrants(user.id)
      const idx = indexGrants(rows)
      setGrantIdx(idx)
      const rState = buildRoleState(user.role, viewMap, overrides)
      setRoleBaseline(rState)
      const scopeMap = buildScopeMap(rState, idx)
      setScopeBaseline(scopeMap)
      setScopeDraft({ ...scopeMap })
      const uState = buildUserState(user, rState, idx, scopeMap)
      setBaseline(uState)
      setDraft(structuredClone(uState))
    } catch (err) {
      flash(toUserMessage(err, 'Could not load grants for this user.'), true)
      setBaseline(null); setDraft(null)
    } finally {
      setGrantsLoading(false)
    }
  }, [viewMap, overrides, flash])

  useEffect(() => {
    if (loading) return
    if (mode === 'role') buildRole()
    else buildUser(selectedUser)
  }, [loading, mode, selectedRole, selectedUser, buildRole, buildUser])

  // Does this row carry an override (draft differs from the ROLE baseline)?
  // Only then does its surface scope matter (a non-override scope change writes
  // nothing on save, so it must not count as an unsaved change).
  const rowHasOverride = useCallback((key) => {
    if (!draft || !roleBaseline) return false
    const sub = isSubmoduleKey(key)
    const parent = sub ? key.split(':', 1)[0] : key
    const bView = sub ? roleBaseline.view[parent] : roleBaseline.view[key]
    if ((draft.view[key] === true) !== (bView === true)) return true
    for (const c of EXTRA_CAPS) {
      const bc = sub ? roleBaseline.caps[parent]?.[c.key] : roleBaseline.caps[key]?.[c.key]
      if ((draft.caps[key]?.[c.key] === true) !== (bc === true)) return true
    }
    return false
  }, [draft, roleBaseline])

  // ── Dirty detection ────────────────────────────────────────────────────────
  const dirtyKeys = useMemo(() => {
    const s = new Set()
    if (!baseline || !draft) return s
    if (mode === 'role') {
      const roleRows = viewMap?.[selectedRole] || {}
      // caps changed (base-module non-view caps -> app_settings overrides)
      for (const key of Object.keys(draft.view)) {
        const dc = draft.caps[key] || {}, bc = baseline.caps[key] || {}
        for (const c of EXTRA_CAPS) if (dc[c.key] !== bc[c.key]) { s.add(key); break }
      }
      // view/scope changes that produce an actual module_permissions row write
      const planned = computeRoleViewChanges({
        role: selectedRole, draftView: draft.view, scopeDraft,
        baselineView: baseline.view, scopeBaseline, roleRows,
      })
      for (const ch of planned) s.add(ch.nodeKey)
      return s
    }
    for (const key of Object.keys(draft.view)) {
      if (draft.view[key] !== baseline.view[key]) { s.add(key); continue }
      const dc = draft.caps[key] || {}, bc = baseline.caps[key] || {}
      let capChanged = false
      for (const c of EXTRA_CAPS) if (dc[c.key] !== bc[c.key]) { capChanged = true; break }
      if (capChanged) { s.add(key); continue }
      // scope-only change: only meaningful when the row actually carries an override
      if (mode === 'user' &&
        (scopeDraft[key] || DEFAULT_SCOPE) !== (scopeBaseline[key] || DEFAULT_SCOPE) &&
        rowHasOverride(key)) {
        s.add(key)
      }
    }
    return s
  }, [baseline, draft, mode, scopeDraft, scopeBaseline, rowHasOverride, viewMap, selectedRole])
  const dirtyCount = dirtyKeys.size

  // ── Mutators ─────────────────────────────────────────────────────────────────
  const capEditable = useCallback((key) => {
    // Non-view caps are editable for base modules always, and for sub-modules
    // only in USER mode (grants store any capability; roles have no sub-cap store).
    if (mode === 'user') return true
    return !isSubmoduleKey(key)
  }, [mode])

  function setNode(key, patch) {
    setDraft((d) => {
      if (!d) return d
      const next = { view: { ...d.view }, caps: { ...d.caps } }
      if ('view' in patch) next.view[key] = patch.view
      if (patch.caps) next.caps[key] = { ...(d.caps[key] || {}), ...patch.caps }
      return next
    })
  }

  function toggleView(key) {
    if (!draft) return
    const nextOn = !draft.view[key]
    setNode(key, { view: nextOn })
    // In a uniform role surface (Web only / Mobile only), a newly enabled module
    // inherits that surface so it never sneaks onto the wrong app.
    if (nextOn && mode === 'role' && (roleSurfaceView === 'web' || roleSurfaceView === 'mobile')) {
      setScope(key, roleSurfaceView)
    }
  }

  function toggleCap(key, cap) {
    if (!draft || !capEditable(key)) return
    setNode(key, { caps: { [cap]: !(draft.caps[key]?.[cap] === true) } })
  }

  function setScope(key, scope) {
    setScopeDraft((s) => ({ ...s, [key]: scope }))
  }

  const applyPresetToKeys = useCallback((preset, keys) => {
    const capMap = presetCapMap(preset)
    setDraft((d) => {
      if (!d) return d
      const next = { view: { ...d.view }, caps: { ...d.caps } }
      for (const key of keys) {
        next.view[key] = capMap.view
        if (capEditable(key)) {
          next.caps[key] = Object.fromEntries(EXTRA_CAPS.map((c) => [c.key, capMap[c.key]]))
        } else {
          // sub-module in role mode: caps mirror view (non-editable)
          next.caps[key] = Object.fromEntries(EXTRA_CAPS.map((c) => [c.key, capMap.view]))
        }
      }
      return next
    })
    setNotice(''); setErrorMsg('')
  }, [capEditable])

  function resetRowToRole(key) {
    // USER mode only: revert this node to the role baseline (Save deletes grants).
    if (!roleBaseline) return
    const sub = isSubmoduleKey(key)
    const parent = sub ? key.split(':', 1)[0] : key
    const bView = sub ? roleBaseline.view[parent] : roleBaseline.view[key]
    const bCaps = {}
    for (const c of EXTRA_CAPS) bCaps[c.key] = (sub ? roleBaseline.caps[parent]?.[c.key] : roleBaseline.caps[key]?.[c.key]) === true
    setNode(key, { view: bView, caps: bCaps })
  }

  function discard() {
    setDraft(baseline ? structuredClone(baseline) : null)
    setScopeDraft({ ...scopeBaseline })
    setNotice(''); setErrorMsg('')
  }

  // ── Tree (filtered) ──────────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return MODULE_GROUPS.map((g) => {
      const modules = g.modules
        .map((m) => {
          const subs = (SUBMODULES[m.key] || []).filter(
            (s) => !q || s.label.toLowerCase().includes(q) || s.key.includes(q),
          )
          const selfMatch = !q || m.label.toLowerCase().includes(q) || m.key.includes(q)
          if (selfMatch) return { ...m, subs: SUBMODULES[m.key] || [] }
          if (subs.length) return { ...m, subs }
          return null
        })
        .filter(Boolean)
      return modules.length ? { ...g, modules } : null
    }).filter(Boolean)
  }, [search])

  const visibleKeys = useMemo(() => {
    const keys = []
    for (const g of filteredGroups) {
      for (const m of g.modules) {
        keys.push(m.key)
        for (const s of m.subs) keys.push(s.key)
      }
    }
    return keys
  }, [filteredGroups])

  function toggleGroup(name) {
    setCollapsedGroups((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })
  }
  function toggleAdvanced(key) {
    setOpenAdvanced((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  const expandAll = () => setCollapsedGroups(new Set())
  const collapseAll = () => setCollapsedGroups(new Set(MODULE_GROUPS.map((g) => g.group)))

  // ── Effective preview (live, from draft) ──────────────────────────────────────
  const effective = useMemo(() => {
    if (!draft) return { viewable: [], overrides: 0, total: 0 }
    const baseNodes = MODULE_GROUPS.flatMap((g) => g.modules)
    const viewable = baseNodes.filter((m) => draft.view[m.key])
    let ovCount = 0
    if (mode === 'user' && roleBaseline) {
      for (const key of Object.keys(draft.view)) {
        const sub = isSubmoduleKey(key)
        const parent = sub ? key.split(':', 1)[0] : key
        const bView = sub ? roleBaseline.view[parent] : roleBaseline.view[key]
        if (draft.view[key] !== bView) ovCount += 1
      }
    }
    return { viewable, overrides: ovCount, total: baseNodes.length }
  }, [draft, mode, roleBaseline])

  // ── Saved-access summary (role mode) ─────────────────────────────────────────
  // What is ACTUALLY stored for this role right now, straight from the persisted
  // baseline (rebuilt from listGlobalPermissions after every save) - NOT the draft.
  // Each enabled base module is shown with its saved Web / Mobile / Both surface so
  // the operator can trust that what they saved is really there.
  const savedSummary = useMemo(() => {
    if (mode !== 'role' || !baseline) return { items: [], counts: { web: 0, mobile: 0, both: 0 } }
    const counts = { web: 0, mobile: 0, both: 0 }
    const items = []
    for (const g of MODULE_GROUPS) {
      for (const m of g.modules) {
        if (baseline.view[m.key] !== true) continue
        const surface = selectedRole === 'Admin' ? 'both' : (baseline.scope[m.key] || DEFAULT_SCOPE)
        counts[surface] = (counts[surface] || 0) + 1
        items.push({ key: m.key, label: m.label, surface })
      }
    }
    return { items, counts }
  }, [mode, baseline, selectedRole])

  // ── Save ─────────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!draft || !baseline || dirtyCount === 0 || saving) return
    setSaving(true); setErrorMsg(''); setNotice('')
    try {
      if (mode === 'role') {
        if (!canWriteRole) throw new Error('Only an Admin can change role access.')
        // 1) view + surface-scope changes (base + sub) via the enforced
        // module_permissions path. Each write targets the plain (web) and/or
        // `mobile:` (mobile) module_key per the row's chosen scope.
        const roleRows = viewMap?.[selectedRole] || {}
        const planned = computeRoleViewChanges({
          role: selectedRole, draftView: draft.view, scopeDraft,
          baselineView: baseline.view, scopeBaseline, roleRows,
        })
        const viewChanges = planned.map(({ role, module_key, enabled }) => ({ role, module_key, enabled }))
        if (viewChanges.length) await saveModulePermissions(viewChanges)

        // 2) base-module non-view caps -> app_settings overrides (merge, keep other roles)
        const roleOverride = {}
        for (const g of MODULE_GROUPS) {
          for (const m of g.modules) {
            const def = defaultViewAccess(selectedRole, m.key)
            const cell = {}
            for (const c of EXTRA_CAPS) {
              const val = draft.caps[m.key]?.[c.key] === true
              if (val !== def) cell[c.key] = val
            }
            if (Object.keys(cell).length) roleOverride[m.key] = cell
          }
        }
        const nextOverrides = { ...(overrides || {}) }
        if (Object.keys(roleOverride).length) nextOverrides[selectedRole] = roleOverride
        else delete nextOverrides[selectedRole]
        await savePermissionOverrides(nextOverrides)

        // refresh globals so baseline reflects the DB
        const [vm, ov] = await Promise.all([listGlobalPermissions(), getPermissionOverrides()])
        setViewMap(vm || {}); setOverrides(ov || {})
        const fresh = buildRoleState(selectedRole, vm || {}, ov || {})
        setBaseline(fresh); setDraft(structuredClone(fresh))
        setScopeBaseline({ ...(fresh.scope || {}) }); setScopeDraft({ ...(fresh.scope || {}) })
        flash(
          viewChanges.length
            ? `Saved. ${viewChanges.length} access change${viewChanges.length !== 1 ? 's' : ''} written across web and mobile; they apply on each user's next load. Other capabilities and sub-modules are stored for progressive enforcement.`
            : 'Saved. Capability changes are stored for progressive enforcement.',
        )
      } else {
        if (!canWriteUser) throw new Error('Only a Super Admin can change per-user access.')
        if (!selectedUser || !roleBaseline) throw new Error('Select a user first.')
        // Reconcile each changed node/capability into user_access_grants, routing
        // the override to the chosen surface(s): web = plain module_key row,
        // mobile = mobile: prefixed row, both = both rows. Rows on a surface that
        // is no longer targeted (or when the value matches the role default) are
        // cleared, so switching Web -> Mobile drops the web row and vice versa.
        let writes = 0, deletes = 0
        for (const key of dirtyKeys) {
          const sub = isSubmoduleKey(key)
          const parent = sub ? key.split(':', 1)[0] : key
          const scope = scopeDraft[key] || DEFAULT_SCOPE
          const plainKey = key
          const mobKey = mobileGrantKey(key)
          const targetKeys = grantKeysForScope(key, scope) // where an override should live
          for (const cap of CAP_KEYS) {
            const desired = cap === 'view' ? draft.view[key] === true : draft.caps[key]?.[cap] === true
            const base = cap === 'view'
              ? (sub ? roleBaseline.view[parent] === true : roleBaseline.view[key] === true)
              : (sub ? roleBaseline.caps[parent]?.[cap] === true : roleBaseline.caps[key]?.[cap] === true)
            const isOverride = desired !== base
            const want = desired ? 'grant' : 'revoke'
            const opp = desired ? 'revoke' : 'grant'
            // Cleanup pass: on each surface drop rows that must not exist there.
            for (const sk of [plainKey, mobKey]) {
              const ex = grantIdx?.[sk]?.[cap] || {}
              const keepHere = isOverride && targetKeys.includes(sk)
              if (!keepHere) {
                if (ex.grant) { await revokeUserAccessGrant(ex.grant); deletes += 1 }
                if (ex.revoke) { await revokeUserAccessGrant(ex.revoke); deletes += 1 }
              } else if (ex[opp]) {
                await revokeUserAccessGrant(ex[opp]); deletes += 1
              }
            }
            // Write pass: ensure the wanted effect exists on target surfaces that lack it.
            if (isOverride) {
              const missing = targetKeys.filter((sk) => !(grantIdx?.[sk]?.[cap]?.[want]))
              if (missing.length) {
                const needPlain = missing.includes(plainKey)
                const needMobile = missing.includes(mobKey)
                const writeScope = needPlain && needMobile ? 'both' : needMobile ? 'mobile' : 'web'
                await setUserAccessGrantScoped(selectedUser.id, key, { capability: cap, effect: want, scope: writeScope })
                writes += missing.length
              }
            }
          }
        }
        // reload grants -> rebuild baseline/draft + scope
        const rows = await listUserGrants(selectedUser.id)
        const idx = indexGrants(rows)
        setGrantIdx(idx)
        const scopeMap = buildScopeMap(roleBaseline, idx)
        setScopeBaseline(scopeMap); setScopeDraft({ ...scopeMap })
        const uState = buildUserState(selectedUser, roleBaseline, idx, scopeMap)
        setBaseline(uState); setDraft(structuredClone(uState))
        flash(`Saved. ${writes} override${writes !== 1 ? 's' : ''} set, ${deletes} reset. Web and Mobile access are stored separately; only View on base modules is enforced today.`)
      }
    } catch (err) {
      flash(toUserMessage(err, 'Could not save access changes. Your edits are still here, try again.'), true)
    } finally {
      setSaving(false)
    }
  }, [draft, baseline, dirtyCount, dirtyKeys, saving, mode, canWriteRole, canWriteUser, selectedRole, selectedUser, overrides, roleBaseline, grantIdx, scopeDraft, scopeBaseline, flash])

  // ── Role-wide surface control (role mode) ─────────────────────────────────────
  // One click to make a whole role Web-only or Mobile-only: set every enabled
  // module to that surface and persist authoritatively in ONE save (the other
  // surface is turned off for each). 'permodule' just reveals the per-module
  // Web/Mobile/Both selectors and performs no save.
  const applyRoleSurface = useCallback(async (surface) => {
    if (surface === 'permodule') { setRoleSurfaceView('permodule'); return }
    if (!draft || !baseline || saving) return
    if (!canWriteRole) { flash('Only an Admin can change role access.', true); return }
    if (selectedRole === 'Admin') { flash('Admin always has full access, so surface changes do not apply.', true); return }
    const label = surface === 'mobile' ? 'Mobile only' : 'Web only'
    const other = surface === 'mobile' ? 'web' : 'mobile'
    const baseKeys = MODULE_GROUPS.flatMap((g) => g.modules.map((m) => m.key))
    const enabledKeys = Object.keys(draft.view).filter((k) => draft.view[k] === true)
    const enabledBase = baseKeys.filter((k) => draft.view[k] === true)
    if (!enabledBase.length) { flash('This role has no enabled modules to set.', true); return }
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm &&
      !window.confirm(`Set every enabled module for ${selectedRole} to ${label}? The ${other} surface is turned off for those modules.`)) {
      return
    }
    const target = { ...scopeDraft }
    for (const k of enabledKeys) target[k] = surface // also cover sub-nodes for consistency
    setSaving(true); setErrorMsg(''); setNotice('')
    try {
      const roleRows = viewMap?.[selectedRole] || {}
      const planned = computeRoleViewChanges({
        role: selectedRole, draftView: draft.view, scopeDraft: target,
        baselineView: baseline.view, scopeBaseline, roleRows,
      })
      const viewChanges = planned.map(({ role, module_key, enabled }) => ({ role, module_key, enabled }))
      if (viewChanges.length) await saveModulePermissions(viewChanges)
      const changedModules = new Set(planned.map((c) => c.nodeKey).filter((k) => baseKeys.includes(k)))
      // refresh from DB so baseline/draft reflect the persisted, authoritative state
      const vm = await listGlobalPermissions()
      setViewMap(vm || {})
      const fresh = buildRoleState(selectedRole, vm || {}, overrides || {})
      setBaseline(fresh); setDraft(structuredClone(fresh))
      setScopeBaseline({ ...(fresh.scope || {}) }); setScopeDraft({ ...(fresh.scope || {}) })
      setRoleSurfaceView(surface)
      const n = changedModules.size
      flash(
        n > 0
          ? `Set ${n} module${n !== 1 ? 's' : ''} for ${selectedRole} to ${label}. The ${other} surface is now off for them; changes apply on each user's next load.`
          : `Every enabled module for ${selectedRole} was already ${label}.`,
      )
    } catch (err) {
      flash(toUserMessage(err, 'Could not update the role surface. Try again.'), true)
    } finally {
      setSaving(false)
    }
  }, [draft, baseline, saving, canWriteRole, selectedRole, scopeDraft, scopeBaseline, viewMap, overrides, flash])

  // ── User directory (user mode) ────────────────────────────────────────────────
  const roleOptions = useMemo(() => {
    const set = new Set()
    for (const u of users || []) if (u.role) set.add(u.role)
    return Array.from(set).sort()
  }, [users])

  const filteredUsers = useMemo(() => {
    const q = uSearch.trim().toLowerCase()
    return (users || []).filter((u) => {
      if (uRoleFilter !== 'all' && u.role !== uRoleFilter) return false
      if (!q) return true
      return displayName(u).toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.username || '').toLowerCase().includes(q)
    })
  }, [users, uSearch, uRoleFilter])

  const readOnly = mode === 'role' ? !canWriteRole : !canWriteUser
  // Per-module surface selector shows in user mode, and in role mode only when the
  // role-wide control is set to "Both (per module)" (a uniform role hides them).
  const showRowScope = mode === 'user' || roleSurfaceView === 'permodule'

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-24">
      {/* Intro */}
      <div className="flex items-start gap-2">
        <Info size={15} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-muted)] max-w-3xl">
          Turn access on or off for every module and the tabs inside it, for a whole role or for one
          person. Use a preset to set a sensible level in one click, then Save. Only View on the base
          modules is enforced today; sub-modules and the create, edit, delete, export and approve
          capabilities are stored for progressive enforcement and are labelled "stored only".
        </p>
      </div>

      {/* Mode + subject selector */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('role')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                mode === 'role' ? 'bg-[var(--surface-3)] text-[var(--brand-bright)]' : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
              }`}
            ><UserCog size={15} /> Edit a role</button>
            <button
              type="button"
              onClick={() => setMode('user')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--input-border)] ${
                mode === 'user' ? 'bg-[var(--surface-3)] text-[var(--brand-bright)]' : 'text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
              }`}
            ><Users size={15} /> Edit a user</button>
          </div>

          {mode === 'role' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {ACCESS_ROLES.map((r) => {
                const on = r === selectedRole
                const locked = r === 'Admin'
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSelectedRole(r)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      on
                        ? 'bg-[var(--surface-3)] border-[var(--border-bright)] text-[var(--brand-bright)]'
                        : `bg-[var(--input-bg)] border-[var(--input-border)] hover:text-[var(--text-primary)] ${ROLE_TINT[r] || 'text-[var(--text-secondary)]'}`
                    }`}
                    title={locked ? 'Admin always has full access' : `Edit ${r} access`}
                  >
                    {r}{locked && ' (full)'}
                  </button>
                )
              })}
              {customRoles.length > 0 && (
                <>
                  <span className="pl-2.5 ml-1 border-l border-[var(--input-border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold select-none">
                    Custom roles
                  </span>
                  {customRoles.map((cr) => {
                    const on = cr.name === selectedRole
                    const inactive = cr.active === false
                    return (
                      <button
                        key={cr.id}
                        type="button"
                        onClick={() => setSelectedRole(cr.name)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-dashed transition-colors ${
                          on
                            ? 'bg-[var(--surface-3)] border-[var(--border-bright)] text-[var(--brand-bright)]'
                            : `bg-[var(--input-bg)] border-[var(--input-border)] hover:text-[var(--text-primary)] ${inactive ? 'text-[var(--text-muted)]' : 'text-teal-300'}`
                        }`}
                        title={`Edit ${cr.name} access (custom role)${cr.description ? `: ${cr.description}` : ''}${inactive ? '. This role is inactive.' : ''}`}
                      >
                        <KeyRound size={11} className="shrink-0" />
                        {cr.name}
                        {inactive && <span className="opacity-70">(inactive)</span>}
                        <span className="text-[8px] uppercase tracking-wide opacity-60">custom</span>
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          ) : (
            <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
              <ChevronRight size={13} /> Pick a person below, then edit their access on the right.
            </span>
          )}

          {readOnly && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-900/20 border border-amber-800/50 rounded-full px-2.5 py-1">
              <AlertTriangle size={12} /> Read only: {mode === 'role' ? 'saving role access needs Admin.' : 'saving per-user access needs Super Admin.'}
            </span>
          )}
        </div>

        {mode === 'role' && selectedRole === 'Admin' && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-900/15 border border-amber-800/40 text-xs text-amber-200">
            <Crown size={13} className="mt-0.5 shrink-0" /> Admin always has full access to every module and capability. Edits here are ignored for Admin.
          </div>
        )}

        {mode === 'role' && isCustomSelected && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-xs text-[var(--text-secondary)]">
            <KeyRound size={13} className="mt-0.5 shrink-0 text-teal-300" />
            <span>
              <span className="font-semibold text-[var(--text-primary)]">{selectedRole}</span> is a custom role: it has no built-in defaults, so every module stays off until you turn it on here. Your toggles below are the whole story for this role.
              {customRoles.find((r) => r.name === selectedRole)?.active === false && (
                <span className="text-amber-300"> This role is currently inactive; access is stored but the role is not offered for assignment.</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Load / error states */}
      {loading ? (
        <div className="card flex items-center justify-center py-16 text-[var(--text-muted)]">
          <Loader2 size={20} className="animate-spin mr-2 text-[var(--brand-bright)]" /> Loading access data...
        </div>
      ) : loadError ? (
        <div className="card flex flex-col items-center justify-center py-14 text-center gap-3">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm text-red-300">{loadError}</p>
          <button onClick={loadGlobals} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw size={14} /> Retry</button>
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${mode === 'user' ? 'xl:grid-cols-[minmax(0,300px)_1fr_minmax(0,260px)]' : 'xl:grid-cols-[1fr_minmax(0,280px)]'}`}>
          {/* User directory (user mode only) */}
          {mode === 'user' && (
            <div className="card !p-0 overflow-hidden flex flex-col max-h-[78vh] order-2 xl:order-1">
              <div className="p-3 border-b border-[var(--input-border)] space-y-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                  <Users size={15} className="text-[var(--brand-bright)]" /> Users
                  {Array.isArray(users) && <span className="text-[var(--text-muted)] font-normal">({filteredUsers.length})</span>}
                </h3>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input className="input pl-8 py-1.5 text-sm w-full" placeholder="Search name or email..." value={uSearch} onChange={(e) => setUSearch(e.target.value)} />
                </div>
                <select className="input py-1.5 text-sm w-full" value={uRoleFilter} onChange={(e) => setURoleFilter(e.target.value)}>
                  <option value="all">All roles</option>
                  {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="overflow-y-auto flex-1">
                {filteredUsers.length === 0 ? (
                  <div className="p-8 text-center text-[var(--text-muted)]">
                    <Users size={22} className="mx-auto mb-2 opacity-60" />
                    <p className="text-sm">No users match.</p>
                  </div>
                ) : (
                  <ul>
                    {filteredUsers.map((u) => {
                      const on = u.id === selectedUserId
                      return (
                        <li key={u.id}>
                          <button
                            onClick={() => setSelectedUserId(u.id)}
                            className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--input-border)]/50 transition-colors ${on ? 'bg-[var(--brand-subtle,rgba(34,197,94,0.12))]' : 'hover:bg-[var(--input-bg)]/50'}`}
                          >
                            <div className="w-8 h-8 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                              {displayName(u).slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">
                                {displayName(u)}
                                {u.is_super_admin && <Crown size={12} className="text-amber-400 shrink-0" />}
                              </p>
                              <p className="text-xs text-[var(--text-muted)] truncate">{u.email || u.username || 'No email'}</p>
                            </div>
                            <span className={`text-[11px] font-medium shrink-0 ${ROLE_TINT[u.role] || 'text-[var(--text-secondary)]'}`}>{u.role || 'No role'}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Tree editor */}
          <div className="min-w-0 order-1 xl:order-2">
            {mode === 'user' && !selectedUser ? (
              <div className="card flex flex-col items-center justify-center text-center py-16">
                <UserCog size={30} className="text-[var(--text-muted)] opacity-70 mb-3" />
                <p className="text-[var(--text-primary)] font-medium">Select a user</p>
                <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">Choose someone from the list to edit exactly what they can reach, on top of their role.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Role-wide surface control (role mode only) */}
                {mode === 'role' && selectedRole !== 'Admin' && (
                  <div className="card !py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold inline-flex items-center gap-1.5 mr-1">
                        <Layers size={12} /> Surface for this role
                      </span>
                      {[
                        { key: 'web', label: 'Web only', icon: Monitor },
                        { key: 'mobile', label: 'Mobile only', icon: Smartphone },
                        { key: 'permodule', label: 'Both (per module)', icon: Layers },
                      ].map((opt) => {
                        const on = roleSurfaceView === opt.key
                        const Icon = opt.icon
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            disabled={readOnly || saving}
                            onClick={() => applyRoleSurface(opt.key)}
                            aria-pressed={on}
                            title={
                              opt.key === 'permodule'
                                ? 'Choose Web, Mobile or Both for each module'
                                : `Set every enabled module for ${selectedRole} to ${opt.label} in one save`
                            }
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 ${
                              on
                                ? 'bg-[var(--surface-3)] border-[var(--border-bright)] text-[var(--brand-bright)]'
                                : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]'
                            }`}
                          >
                            <Icon size={13} /> {opt.label}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] inline-flex items-start gap-1.5">
                      <Info size={12} className="mt-0.5 shrink-0" />
                      Web only or Mobile only applies to every enabled module at once and turns the other surface off. Both (per module) reveals a Web, Mobile or Both choice on each row.
                    </p>
                  </div>
                )}

                {/* Toolbar */}
                <div className="card !py-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input className="input pl-8 py-1.5 text-sm w-full" placeholder="Find a module or tab..." value={search} onChange={(e) => setSearch(e.target.value)} />
                      {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={13} /></button>}
                    </div>
                    <button onClick={expandAll} className="btn-secondary text-xs inline-flex items-center gap-1.5" title="Expand all groups"><ChevronsUpDown size={13} /> Expand</button>
                    <button onClick={collapseAll} className="btn-secondary text-xs inline-flex items-center gap-1.5" title="Collapse all groups"><ChevronsDownUp size={13} /> Collapse</button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold inline-flex items-center gap-1.5 mr-1"><Zap size={12} /> Apply preset to all shown</span>
                    {PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        disabled={readOnly}
                        onClick={() => applyPresetToKeys(p, visibleKeys)}
                        title={p.caps.length ? `Grant: ${p.caps.join(', ')}` : 'Remove all access'}
                        className="px-2.5 py-1 rounded-lg text-xs border bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--brand-bright)] hover:border-[var(--border-bright)] disabled:opacity-40 transition-colors"
                      >{p.label}</button>
                    ))}
                  </div>
                </div>

                {/* Tree */}
                <div className="card !p-0 overflow-hidden">
                  {filteredGroups.length === 0 ? (
                    <div className="p-10 text-center text-[var(--text-muted)]">
                      <FolderTree size={24} className="mx-auto mb-2 opacity-60" />
                      <p className="text-sm">No modules match "{search}".</p>
                    </div>
                  ) : filteredGroups.map((g) => {
                    const collapsed = collapsedGroups.has(g.group)
                    const groupKeys = g.modules.flatMap((m) => [m.key, ...m.subs.map((s) => s.key)])
                    return (
                      <div key={g.group} className="border-b border-[var(--input-border)] last:border-b-0">
                        {/* Group header */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--surface-1)]">
                          <button onClick={() => toggleGroup(g.group)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {g.group}
                          </button>
                          <div className="ml-auto flex items-center gap-1">
                            {PRESETS.map((p) => (
                              <button
                                key={p.key}
                                type="button"
                                disabled={readOnly}
                                onClick={() => applyPresetToKeys(p, groupKeys)}
                                className="px-1.5 py-0.5 rounded text-[10px] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--brand-bright)] disabled:opacity-40"
                                title={`Set this group to ${p.label}`}
                              >{p.label}</button>
                            ))}
                          </div>
                        </div>

                        {!collapsed && g.modules.map((m) => (
                          <div key={m.key}>
                            <NodeRow
                              node={{ key: m.key, label: m.label, level: 0 }}
                              draft={draft} dirty={dirtyKeys.has(m.key)}
                              readOnly={readOnly} mode={mode}
                              capEditable={capEditable(m.key)}
                              advancedOpen={openAdvanced.has(m.key)}
                              scope={scopeDraft[m.key] || DEFAULT_SCOPE}
                              onSetScope={showRowScope ? (v) => setScope(m.key, v) : null}
                              onToggleView={() => toggleView(m.key)}
                              onToggleCap={(c) => toggleCap(m.key, c)}
                              onToggleAdvanced={() => toggleAdvanced(m.key)}
                              onResetRow={mode === 'user' ? () => resetRowToRole(m.key) : null}
                            />
                            {m.subs.map((s) => (
                              <NodeRow
                                key={s.key}
                                node={{ key: s.key, label: s.label, level: 1 }}
                                draft={draft} dirty={dirtyKeys.has(s.key)}
                                readOnly={readOnly} mode={mode}
                                capEditable={capEditable(s.key)}
                                advancedOpen={openAdvanced.has(s.key)}
                                scope={scopeDraft[s.key] || DEFAULT_SCOPE}
                                onSetScope={showRowScope ? (v) => setScope(s.key, v) : null}
                                onToggleView={() => toggleView(s.key)}
                                onToggleCap={(c) => toggleCap(s.key, c)}
                                onToggleAdvanced={() => toggleAdvanced(s.key)}
                                onResetRow={mode === 'user' ? () => resetRowToRole(s.key) : null}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>

                <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                  <Info size={12} /> A row indented under a module is a tab inside it. Sub-module and non-view toggles are stored for progressive enforcement (labelled "stored only").
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)] px-1">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-secondary)]">Access surface:</span>
                  <span className="inline-flex items-center gap-1.5"><Monitor size={12} className="text-[var(--brand-bright)]" /> Web applies to the web app only.</span>
                  <span className="inline-flex items-center gap-1.5"><Smartphone size={12} className="text-[var(--brand-bright)]" /> Mobile applies to the inspector app only.</span>
                  <span className="inline-flex items-center gap-1.5"><Layers size={12} className="text-[var(--brand-bright)]" /> Both applies to web and mobile.</span>
                  {mode === 'role' && (
                    <span className="inline-flex items-center gap-1.5">Picking Web or Mobile now turns the other surface off for you, so the saved state always matches what is shown.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Effective preview */}
          {(mode === 'role' || selectedUser) && (
            <div className="order-3">
              <div className="card sticky top-4 space-y-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                  <Eye size={15} className="text-[var(--brand-bright)]" /> Effective access
                </h3>
                {mode === 'role' ? (
                  <p className="text-xs text-[var(--text-muted)]">What <span className={`font-semibold ${ROLE_TINT[selectedRole] || ''}`}>{selectedRole}</span> can view after your edits.</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[var(--input-bg)] flex items-center justify-center shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                      {displayName(selectedUser).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">{displayName(selectedUser)}{selectedUser.is_super_admin && <Crown size={12} className="text-amber-400" />}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{selectedUser.role || 'No role'}</p>
                    </div>
                  </div>
                )}

                {mode === 'user' && selectedUser?.is_super_admin && (
                  <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-900/15 border border-amber-800/40 text-[11px] text-amber-200">
                    <Crown size={12} className="mt-0.5 shrink-0" /> Super admin bypasses all gates. Overrides are stored but do not restrict this user.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Modules viewable" value={`${effective.viewable.length}/${effective.total}`} tint="text-green-300" />
                  <Stat label={mode === 'user' ? 'Overrides vs role' : 'Unsaved changes'} value={mode === 'user' ? effective.overrides : dirtyCount} tint={mode === 'user' ? 'text-amber-300' : 'text-[var(--text-primary)]'} />
                </div>

                <div className="max-h-[42vh] overflow-y-auto pr-1 space-y-1">
                  {effective.viewable.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] py-3 text-center">No modules viewable.</p>
                  ) : effective.viewable.map((m) => (
                    <div key={m.key} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <Check size={12} className="text-green-400 shrink-0" /> <span className="truncate">{m.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--text-muted)]">Preview reflects View access. Only base-module View is enforced today.</p>
              </div>

              {/* Saved access summary (role mode): what is really stored right now */}
              {mode === 'role' && (
                <div className="card mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                      <ShieldCheck size={15} className="text-[var(--brand-bright)]" /> Saved for this role
                    </h3>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">In database</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    The surface actually stored for {selectedRole} now (not your unsaved edits).
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]"><Monitor size={12} className="text-[var(--brand-bright)]" /> Web {savedSummary.counts.web}</span>
                    <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]"><Smartphone size={12} className="text-[var(--brand-bright)]" /> Mobile {savedSummary.counts.mobile}</span>
                    <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]"><Layers size={12} className="text-[var(--brand-bright)]" /> Both {savedSummary.counts.both}</span>
                  </div>
                  <div className="max-h-[36vh] overflow-y-auto pr-1 space-y-1">
                    {savedSummary.items.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)] py-3 text-center">No modules enabled for this role.</p>
                    ) : savedSummary.items.map((it) => (
                      <div key={it.key} className="flex items-center gap-2 text-xs">
                        <Check size={12} className="text-green-400 shrink-0" />
                        <span className="truncate flex-1 text-[var(--text-secondary)]">{it.label}</span>
                        <SurfaceBadge surface={it.surface} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mobile app access - the REAL mobile module keys (src/lib/mobileModules.js),
          separate from the web tree above (which is keyed on the web catalog). This
          is how a mobile module is actually closed for a role or a user: writes land
          on `mobile:<mobileKey>` rows the phone app enforces. Self-contained load/save. */}
      {!loading && !loadError && (mode === 'role' || selectedUser) && (
        <div className="pt-2">
          <MobileAccessPanel
            mode={mode}
            role={selectedRole}
            user={selectedUser}
            canWriteRole={canWriteRole}
            canWriteUser={canWriteUser}
          />
        </div>
      )}

      {/* Save bar */}
      {dirtyCount > 0 && !readOnly && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl px-5 py-3 shadow-lg bg-[var(--surface-3)]" style={{ border: '1px solid var(--border-bright)' }}>
          <span className="text-sm text-[var(--text-secondary)]"><span className="font-semibold text-[var(--text-primary)]">{dirtyCount}</span> unsaved change{dirtyCount !== 1 ? 's' : ''}</span>
          <button onClick={discard} disabled={saving} className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40"><RotateCcw size={13} /> Discard</button>
          <button onClick={save} disabled={saving} className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      )}

      {/* Notice / error */}
      {(notice || errorMsg) && (
        <div className={`fixed bottom-4 right-4 z-40 max-w-sm rounded-xl px-4 py-2.5 text-sm flex items-start gap-2 ${errorMsg ? 'text-red-300 bg-red-900/20 border border-red-800/50' : 'text-green-300 bg-green-900/20 border border-green-800/50'}`}>
          {errorMsg ? <AlertTriangle size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />} {errorMsg || notice}
        </div>
      )}

      {grantsLoading && (
        <div className="fixed bottom-4 left-4 z-40 text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading grants...</div>
      )}
    </div>
  )
}

// ── Scope selector (user mode) ───────────────────────────────────────────────
function ScopeSelect({ scope, onSetScope, readOnly }) {
  return (
    <div className="inline-flex rounded-md border border-[var(--input-border)] overflow-hidden shrink-0" role="group" aria-label="Access surface">
      {SCOPES.map((s) => {
        const on = scope === s.key
        const Icon = s.icon
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSetScope?.(s.key)}
            disabled={readOnly}
            aria-pressed={on}
            title={`Apply this override to ${s.label}`}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium border-l first:border-l-0 border-[var(--input-border)] transition-colors disabled:opacity-40 ${
              on ? 'bg-[var(--surface-3)] text-[var(--brand-bright)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon size={11} /> {s.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────
function NodeRow({ node, draft, dirty, readOnly, mode, capEditable, advancedOpen, scope, onSetScope, onToggleView, onToggleCap, onToggleAdvanced, onResetRow }) {
  const sub = node.level === 1
  const on = draft?.view?.[node.key] === true
  const caps = draft?.caps?.[node.key] || {}
  const activeExtra = EXTRA_CAPS.filter((c) => caps[c.key]).length

  return (
    <div className={`${dirty ? 'bg-amber-500/5' : ''}`} style={{ borderBottom: '1px solid var(--table-cell-border)' }}>
      <div className={`flex items-center gap-2 px-3 py-2 ${sub ? 'pl-9' : ''}`}>
        {sub && <span className="text-[var(--text-muted)] shrink-0"><ChevronRight size={12} /></span>}
        <div className="min-w-0 flex-1">
          <span className={`text-sm ${sub ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)] font-medium'}`}>{node.label}</span>
          {sub && <span className="ml-2 text-[9px] uppercase tracking-wide text-[var(--text-muted)] opacity-70">stored only</span>}
          {dirty && <span className="ml-2 text-[9px] uppercase tracking-wide text-amber-300">changed</span>}
        </div>

        {/* Surface scope (web / mobile / both) - role and user mode */}
        {onSetScope && (
          <ScopeSelect scope={scope || DEFAULT_SCOPE} onSetScope={onSetScope} readOnly={readOnly} />
        )}

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={onToggleAdvanced}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors ${advancedOpen ? 'border-[var(--border-bright)] text-[var(--brand-bright)] bg-[var(--surface-3)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          title="Show create, edit, delete, export and approve"
        >
          <SlidersHorizontal size={11} /> Advanced{activeExtra > 0 && <span className="text-[var(--brand-bright)]">({activeExtra})</span>}
        </button>

        {/* Reset to role (user mode) */}
        {mode === 'user' && onResetRow && (
          <button type="button" onClick={onResetRow} disabled={readOnly} className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30" title="Reset this row to the role default">
            <RotateCcw size={13} />
          </button>
        )}

        {/* ON/OFF view toggle */}
        <button
          type="button"
          onClick={onToggleView}
          disabled={readOnly}
          role="switch"
          aria-checked={on}
          aria-label={`${node.label} access`}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${on ? 'bg-green-500/80' : 'bg-[var(--input-bg)] border border-[var(--input-border)]'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {/* Advanced capabilities */}
      {advancedOpen && (
        <div className={`px-3 pb-2.5 ${sub ? 'pl-9' : ''}`}>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--input-bg)]/50 border border-[var(--input-border)] p-2">
            {!capEditable ? (
              <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1.5">
                <Ban size={11} /> Fine capabilities for a tab are set per user (choose "Edit a user").
              </span>
            ) : EXTRA_CAPS.map((c) => {
              const cOn = caps[c.key] === true
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onToggleCap(c.key)}
                  disabled={readOnly}
                  title={`${c.description} (stored, not yet enforced)`}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-40 ${cOn ? 'text-green-300 bg-green-900/20 border-green-800/50' : 'text-[var(--text-muted)] bg-[var(--btn-2-bg)] border-[var(--btn-2-border)] hover:text-[var(--text-secondary)]'}`}
                >
                  {cOn ? <Check size={10} /> : <X size={10} />} {c.label}<span className="text-[8px] uppercase tracking-wide opacity-60">stored</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tint }) {
  return (
    <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-tight">{label}</p>
      <p className={`text-base font-bold ${tint}`}>{value}</p>
    </div>
  )
}

// Small Web / Mobile / Both surface badge (saved-access summary).
function SurfaceBadge({ surface }) {
  const meta = surface === 'mobile'
    ? { Icon: Smartphone, label: 'Mobile' }
    : surface === 'both'
      ? { Icon: Layers, label: 'Both' }
      : { Icon: Monitor, label: 'Web' }
  const { Icon, label } = meta
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-[var(--input-border)] bg-[var(--input-bg)]/60 text-[var(--text-secondary)] shrink-0">
      <Icon size={10} className="text-[var(--brand-bright)]" /> {label}
    </span>
  )
}
