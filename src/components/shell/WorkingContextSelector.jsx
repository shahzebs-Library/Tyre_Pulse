/**
 * WorkingContextSelector - the ONE control that answers "where am I working".
 *
 * Replaces the sidebar's flat Country pill row with the real hierarchy the fleet
 * is actually organised by: Country > Region > Site. It reads and writes the
 * single working context owned by SettingsContext, so every screen agrees on the
 * operator's location instead of each page inventing its own picker.
 *
 * THE LOAD-BEARING RULE: it only ever offers what `allowedContext` contains, and
 * when `canSwitchWorkingContext` is false (the user has exactly one place, which
 * is most of them) it renders a STATIC label with no chevron and no click target.
 * A dropdown that cannot change anything is worse than no dropdown: the user
 * opens it, finds one row, and learns the control lies. A country or site absent
 * from allowedContext is never rendered, not even greyed out, because an
 * inaccessible location on screen reads as a permission bug.
 *
 * A country with no regions (UAE and Egypt, in the live register) renders
 * Country > Site with NO region level. An "Unassigned region" placeholder would
 * be inventing structure the site register does not have.
 *
 * NOTE ON THE TREE SHAPE, which is easy to get wrong: a country node's `sites`
 * array is ALL of that country's sites, and `regions[].sites` is a SUBSET of it
 * (only the sites that carry a region). So the sites shown directly under a
 * country are the REMAINDER - all sites minus every regioned one - otherwise a
 * regioned site would be drawn twice, once under its region and once loose.
 *
 * Reporting scope (which countries a report AGGREGATES) is a different question
 * with its own control, ReportingScopeBar. This one never multi-selects: you
 * work in one place at a time.
 *
 * WHY THE PANEL IS A DIALOG AND THE HIERARCHY INSIDE IT IS A TREE: the panel
 * holds a search box, a Recents list and an All-countries row as well as the
 * hierarchy, so it is genuinely a dialog. But the hierarchy itself used to be a
 * flat pile of buttons, which is what a screen reader read out: no depth, no
 * position, no sibling count, no way to tell a country from a site. role=tree
 * with aria-level / aria-posinset / aria-setsize is what turns "button, button,
 * button" into "KSA, level 1, 1 of 3, collapsed". The flat lists stay flat
 * because they ARE flat; only the hierarchy is owned by the tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Globe, MapPin, Search, Check, Clock, Building2 } from 'lucide-react'
import useAnchoredPopover from '../ui/useAnchoredPopover'
import { useSettings } from '../../contexts/SettingsContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { contextLabel, contextShortLabel } from '../../lib/workingContext'

/**
 * Translate with an honest English fallback.
 *
 * `t(key, vars)` takes interpolation VARS as its second argument, not a
 * fallback: a key with no locale entry comes back as the raw key, which is
 * exactly how "roles.Fleet Supervisor" once leaked onto the sidebar. These shell
 * strings are new and several have no entry yet, so resolve and, if the
 * translator handed the key straight back, render real English instead.
 */
function tx(t, key, fallback) {
  const v = typeof t === 'function' ? t(key) : undefined
  return !v || v === key ? fallback : v
}

const RECENTS_KEY = 'tp_context_recents'
const MAX_RECENTS = 5
// Offer the filter box only once the list is long enough that scanning it by eye
// stops working. The live register carries 69 sites, so this fires in practice.
const SEARCH_THRESHOLD = 8

/* ── Recents: permission-checked at RENDER, never trusted because it was stored ─
   A recent entry is a cached convenience, not an authorisation. Access can be
   revoked between visits, so the stored list is filtered against the CURRENT
   allowedContext every time it is drawn. */

function readRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r) => r && typeof r === 'object' && typeof r.country === 'string' && r.country)
      .slice(0, MAX_RECENTS)
      .map((r) => ({ country: r.country, region: r.region || null, site: r.site || null }))
  } catch {
    return []
  }
}

function writeRecents(list) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS))) }
  catch { /* storage disabled or full: recents are a nicety, never a failure */ }
}

const up = (v) => String(v ?? '').trim().toUpperCase()

function sameContext(a, b) {
  return up(a?.country) === up(b?.country)
    && up(a?.region) === up(b?.region)
    && up(a?.site) === up(b?.site)
}

/* ── Tree readers over allowedContext ─────────────────────────────────────────
   Shape: [{ country, regions: [{ region, sites: [name] }], sites: [name] }]
   Every field is treated as optional so a half-loaded value cannot throw inside
   the app shell. */

function countriesOf(allowed) {
  return (Array.isArray(allowed) ? allowed : []).filter((c) => c && c.country)
}

function regionsOf(country) {
  return (Array.isArray(country?.regions) ? country.regions : [])
    .filter((r) => r && r.region)
}

function sitesOf(region) {
  return (Array.isArray(region?.sites) ? region.sites : []).filter(Boolean)
}

function allSitesOf(country) {
  return (Array.isArray(country?.sites) ? country.sites : []).filter(Boolean)
}

/** Sites with no region of their own: all sites minus every regioned site. */
function looseSitesOf(country) {
  const claimed = new Set()
  regionsOf(country).forEach((r) => sitesOf(r).forEach((s) => claimed.add(up(s))))
  return allSitesOf(country).filter((s) => !claimed.has(up(s)))
}

/** The region a site sits in, or null when it has none. */
function regionOfSite(country, site) {
  const found = regionsOf(country).find((r) => sitesOf(r).some((s) => up(s) === up(site)))
  return found ? found.region : null
}

/** Is this exact context reachable under the current permissions? */
function isAllowedContext(allowed, ctx) {
  if (!ctx?.country) return false
  const country = countriesOf(allowed).find((c) => up(c.country) === up(ctx.country))
  if (!country) return false
  if (ctx.site) return allSitesOf(country).some((s) => up(s) === up(ctx.site))
  if (ctx.region) return regionsOf(country).some((r) => up(r.region) === up(ctx.region))
  return true
}

/** Every selectable site, flattened, for the search results list. */
function flattenLeaves(allowed) {
  const out = []
  countriesOf(allowed).forEach((c) => {
    allSitesOf(c).forEach((s) => {
      out.push({ country: c.country, region: regionOfSite(c, s), site: s })
    })
  })
  return out
}

/**
 * @param {object}  props
 * @param {boolean} props.compact    mobile chip form: short label only, no country subtitle
 * @param {string}  props.className  extra classes on the trigger
 */
export default function WorkingContextSelector({ compact = false, className = '' }) {
  const settings = useSettings() || {}
  const { t, isRTL } = useLanguage()
  const { workingContext, setWorkingContext, allowedContext, canSwitchWorkingContext,
          canSelectAll } = settings

  // Defensive: these may not have resolved on the first paint, and a
  // not-yet-loaded value must never crash the whole app shell.
  const allowed = useMemo(() => countriesOf(allowedContext), [allowedContext])
  const ctx = workingContext || { country: null, region: null, site: null }

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [recents, setRecents] = useState(() => readRecents())
  const rootRef = useRef(null)
  // nav:'trap' keeps Tab inside the panel, which is what role=dialog promises:
  // without it the next Tab walks the page BEHIND an open dialog. The hook also
  // moves focus into the panel on open, which is why there is no manual focus
  // call here any more - one less thing racing the user.
  const { triggerRef, panelRef, coords } = useAnchoredPopover(open, {
    width: 320,
    height: 460,
    align: 'right',
    nav: 'trap',
  })

  const leaves = useMemo(() => flattenLeaves(allowed), [allowed])
  const showSearch = leaves.length >= SEARCH_THRESHOLD

  // Open with the branch holding the current selection already expanded, rather
  // than making the user hunt for where they already are.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setExpanded(new Set([
      ctx.country || null,
      ctx.country && ctx.region ? `${ctx.country}||${ctx.region}` : null,
    ].filter(Boolean)))
    // Only on open: re-running on every context change would fight the user's
    // own expand/collapse while the menu is sitting there open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      const inside = rootRef.current?.contains(e.target) || panelRef.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, panelRef])

  const select = useCallback((next) => {
    // A deliberate 'All countries' (no country) is a legitimate context, but only
    // for a user who may see every country. isAllowedContext rejects a blank
    // country by design, so that case is admitted here and nowhere else.
    // SettingsContext refuses it again for a scoped user, so this cannot widen.
    const wantsAll = !next?.country
    if (wantsAll ? !canSelectAll : !isAllowedContext(allowed, next)) return
    const ctxNext = {
      country: next.country || null,
      region: next.region || null,
      site: next.site || null,
    }
    setWorkingContext?.(ctxNext)
    const merged = [ctxNext, ...readRecents().filter((r) => !sameContext(r, ctxNext))].slice(0, MAX_RECENTS)
    writeRecents(merged)
    setRecents(merged)
    setOpen(false)
  }, [allowed, canSelectAll, setWorkingContext])

  const toggleBranch = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /* Explicit open/close rather than a toggle, because the arrow keys are
     directional: ArrowRight on an already-open branch must step INTO it, never
     shut the branch the user is trying to enter. */
  const setBranch = useCallback((key, wantOpen) => {
    setExpanded((prev) => {
      if (prev.has(key) === wantOpen) return prev
      const next = new Set(prev)
      if (wantOpen) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  /**
   * The keyboard model role=tree promises.
   *
   * Declaring role=tree and then answering nothing but Tab is the failure this
   * whole pass exists to stop: a screen reader announces "tree, collapsed" and
   * the key that opens every other tree the user has met does nothing. Handled
   * once on the container rather than per node, so a tree of 69 sites does not
   * carry 69 listeners.
   *
   * Collapsed children are not rendered at all, so DOM order IS the visible
   * order and no separate flattening pass can drift from what is on screen.
   */
  const treeRef = useRef(null)
  const onTreeKeyDown = useCallback((e) => {
    const tree = treeRef.current
    const el = document.activeElement
    if (!tree || !el || !tree.contains(el) || el.getAttribute?.('role') !== 'treeitem') return

    const items = Array.from(tree.querySelectorAll('[role="treeitem"]'))
    const at = items.indexOf(el)
    if (at < 0) return

    const branch = el.getAttribute('data-branch-key')
    const isExpanded = el.getAttribute('aria-expanded') === 'true'
    // A branch opens toward the reading direction, so the key that opens it
    // mirrors with the language: in Arabic the tree indents leftward and
    // ArrowRight is the way OUT, not the way in.
    const intoKey = isRTL ? 'ArrowLeft' : 'ArrowRight'
    const outKey = isRTL ? 'ArrowRight' : 'ArrowLeft'

    // Deliberately CLAMPED, not wrapped, unlike the menus next door: a tree is a
    // spatial structure and jumping from the last site back to the first country
    // reads as having lost your place.
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(at + 1, items.length - 1)].focus(); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(at - 1, 0)].focus(); return }
    if (e.key === 'Home') { e.preventDefault(); items[0].focus(); return }
    if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); return }

    if (e.key === intoKey) {
      e.preventDefault()
      if (branch && !isExpanded) setBranch(branch, true)
      else if (isExpanded) items[at + 1]?.focus()
      return
    }

    if (e.key === outKey) {
      e.preventDefault()
      if (branch && isExpanded) { setBranch(branch, false); return }
      // Step out to the parent, which is the first treeitem in the wrapper that
      // owns this node's group. A root node has no group and correctly does
      // nothing rather than jumping somewhere arbitrary.
      const group = el.closest('[role="group"]')
      group?.parentElement?.querySelector('[role="treeitem"]')?.focus()
    }
  }, [isRTL, setBranch])

  // The pure lib returns stable English ('All' / 'All countries') because it has
  // no access to t() and its output is pinned by tests. The no-country case is
  // the only one that is a WORD rather than a proper noun, so it is the only one
  // that needs translating here; a site or country name is the same in any
  // language. Without this the chip read "All" in an otherwise Arabic bar.
  const allLabel = tx(t, 'shell.allCountries', 'All countries')
  const label = ctx.country ? contextLabel(ctx) : allLabel
  const short = ctx.country ? contextShortLabel(ctx) : allLabel
  // The country only earns a second line when the headline is something else.
  const subtitle = ctx.site || ctx.region ? ctx.country : null
  const titleText = `${tx(t, 'shell.workingContext', 'Working location')}: ${label}`

  /**
   * Say the new location out loud, once.
   *
   * Switching the working context re-points every screen in the app. A sighted
   * user sees the chip change; without a live region a screen reader user gets
   * no signal that the data they are about to read is from somewhere else.
   *
   * Deliberately silent on FIRST render: announcing the starting location would
   * speak on every page load, and a region that talks unprompted is one people
   * learn to ignore. `lastAnnounced` starts null purely to mark that first pass.
   */
  const [announcement, setAnnouncement] = useState('')
  const lastAnnounced = useRef(null)
  useEffect(() => {
    if (lastAnnounced.current === null) { lastAnnounced.current = label; return }
    if (lastAnnounced.current === label) return
    lastAnnounced.current = label
    setAnnouncement(`${tx(t, 'shell.contextChanged', 'Working location changed to')} ${label}`)
  }, [label, t])

  // A collapsed branch opens toward the reading direction, so the arrow has to
  // mirror: pointing right in Arabic would point back at the parent.
  const CollapsedIcon = isRTL ? ChevronLeft : ChevronRight

  const chipStyle = { background: 'rgba(22,163,74,0.05)', border: '1px solid rgba(22,163,74,0.12)' }

  /* ── Static form: exactly one place, so there is nothing to choose ───────── */
  if (!canSwitchWorkingContext) {
    return (
      <div
        className={`inline-flex items-center gap-2 h-8 px-2.5 rounded-lg min-w-0 max-w-[220px] ${className}`}
        style={chipStyle}
        title={titleText}
      >
        <MapPin size={13} className="flex-shrink-0" style={{ color: '#16a34a' }} aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[12px] font-semibold leading-none truncate" style={{ color: 'var(--panel-ink-2)' }}>
            {short}
          </span>
          {!compact && subtitle && (
            <span
              className="block text-[9.5px] font-medium leading-none mt-0.5 truncate uppercase tracking-wide"
              style={{ color: 'var(--panel-ink-4)' }}
            >
              {subtitle}
            </span>
          )}
        </span>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const matches = q
    ? leaves.filter((l) => [l.site, l.region, l.country]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q)))
    : []
  const visibleRecents = recents.filter((r) => isAllowedContext(allowed, r) && !sameContext(r, ctx))

  const siteWord = (n) => (n === 1 ? tx(t, 'shell.site', 'site') : tx(t, 'shell.sites', 'sites'))
  const regionWord = (n) => (n === 1 ? tx(t, 'shell.region', 'region') : tx(t, 'shell.regions', 'regions'))

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${titleText}. ${tx(t, 'shell.changeLocation', 'Change location')}`}
        title={titleText}
        className={`inline-flex items-center gap-2 h-8 px-2.5 rounded-lg min-w-0 max-w-[240px] transition-colors hover:bg-green-400/10 ${className}`}
        style={chipStyle}
      >
        <MapPin size={13} className="flex-shrink-0" style={{ color: '#16a34a' }} aria-hidden="true" />
        <span className="min-w-0 text-start">
          <span className="block text-[12px] font-semibold leading-none truncate" style={{ color: 'var(--panel-ink-2)' }}>
            {short}
          </span>
          {!compact && subtitle && (
            <span
              className="block text-[9.5px] font-medium leading-none mt-0.5 truncate uppercase tracking-wide"
              style={{ color: 'var(--panel-ink-4)' }}
            >
              {subtitle}
            </span>
          )}
        </span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--panel-ink-4)' }}
        />
      </button>

      {/* Mounted with the trigger, never inside the popover: a live region that
          appears at the same moment as its text is not reliably announced, and
          this panel unmounts on select. */}
      <span aria-live="polite" className="sr-only">{announcement}</span>

      {open && coords && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={tx(t, 'shell.workingContext', 'Working location')}
          className="tp-popover w-[320px] p-0"
          style={{ top: coords.top, left: coords.left, maxHeight: coords.maxHeight }}
        >
          <div
            className="px-3 py-2 sticky top-0 z-10"
            style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-dim)' }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {tx(t, 'shell.workingContext', 'Working location')}
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
              {tx(t, 'shell.workingContextHint', 'Sets the country, region and site every screen works in.')}
            </p>
            {showSearch && (
              <div className="relative mt-2">
                <Search
                  size={12}
                  aria-hidden="true"
                  className="absolute start-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-dim)' }}
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tx(t, 'shell.findSite', 'Find a site or region')}
                  aria-label={tx(t, 'shell.findSite', 'Find a site or region')}
                  className="w-full h-7 ps-7 pe-2 rounded-lg text-[12px] outline-none"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    color: 'var(--input-text)',
                  }}
                />
              </div>
            )}
          </div>

          <div className="p-1.5">
            {allowed.length === 0 && (
              <p className="px-2.5 py-4 text-[12px] text-center" style={{ color: 'var(--text-muted)' }}>
                {tx(t, 'shell.noLocations', 'No locations are assigned to your account yet.')}
              </p>
            )}

            {/* A search replaces the tree, so the answer is one glance away. */}
            {q ? (
              matches.length === 0 ? (
                <p className="px-2.5 py-4 text-[12px] text-center" style={{ color: 'var(--text-muted)' }}>
                  {tx(t, 'shell.noMatch', 'Nothing matches that name.')}
                </p>
              ) : (
                matches.slice(0, 40).map((l) => (
                  <ContextRow
                    key={`m-${l.country}||${l.region || ''}||${l.site}`}
                    icon={MapPin}
                    label={l.site}
                    hint={[l.region, l.country].filter(Boolean).join(', ')}
                    selected={sameContext(l, ctx)}
                    onClick={() => select(l)}
                  />
                ))
              )
            ) : (
              <>
                {visibleRecents.length > 0 && (
                  <>
                    <SectionLabel icon={Clock} text={tx(t, 'shell.recent', 'Recent')} />
                    {visibleRecents.map((r) => (
                      <ContextRow
                        key={`r-${r.country}||${r.region || ''}||${r.site || ''}`}
                        icon={Clock}
                        label={contextShortLabel(r)}
                        hint={contextLabel(r)}
                        onClick={() => select(r)}
                      />
                    ))}
                    <div className="my-1.5 h-px" style={{ background: 'var(--border-dim)' }} />
                  </>
                )}

                {/* 'All countries' is only a legitimate choice for a user who may
                    see EVERY country, and the context can legitimately START there
                    (it is the default). Without this row it was a one-way door:
                    the trigger read 'All', and picking any country left no way
                    back. Hidden for a scoped user, whose 'All' would overstate
                    their coverage. */}
                {canSelectAll && (
                  <>
                    <ContextRow
                      icon={Globe}
                      label={tx(t, 'shell.allCountries', 'All countries')}
                      hint={tx(t, 'shell.allCountriesHint', 'No country filter')}
                      selected={!ctx.country}
                      onClick={() => select({ country: null, region: null, site: null })}
                    />
                    <div className="my-1.5 h-px" style={{ background: 'var(--border-dim)' }} />
                  </>
                )}

                <div
                  ref={treeRef}
                  role="tree"
                  aria-label={tx(t, 'shell.locationTree', 'Locations by country')}
                  onKeyDown={onTreeKeyDown}
                >
                  {allowed.map((country, ci) => {
                    const regions = regionsOf(country)
                    const loose = looseSitesOf(country)
                    const hasChildren = regions.length > 0 || loose.length > 0
                    const isOpen = expanded.has(country.country)
                    const countryCtx = { country: country.country, region: null, site: null }
                    const totalSites = allSitesOf(country).length
                    // Regions and loose sites are ONE run of siblings at the same
                    // level, so they share a set size and a single position
                    // sequence. Numbering them separately would tell a screen
                    // reader "1 of 2" twice under one country.
                    const childCount = regions.length + loose.length
                    return (
                      <div key={country.country} role="none">
                        <div className="flex items-stretch gap-0.5" role="none">
                          {hasChildren ? (
                            <Twisty
                              open={isOpen}
                              collapsedIcon={CollapsedIcon}
                              branchKey={country.country}
                              onToggle={() => toggleBranch(country.country)}
                            />
                          ) : (
                            <span className="w-6" aria-hidden="true" />
                          )}
                          <ContextRow
                            icon={Globe}
                            label={country.country}
                            hint={
                              regions.length > 0
                                ? `${regions.length} ${regionWord(regions.length)}, ${totalSites} ${siteWord(totalSites)}`
                                : totalSites > 0
                                  ? `${totalSites} ${siteWord(totalSites)}`
                                  : null
                            }
                            strong
                            selected={sameContext(countryCtx, ctx)}
                            onClick={() => select(countryCtx)}
                            treeItem
                            level={1}
                            posinset={ci + 1}
                            setsize={allowed.length}
                            expanded={hasChildren ? isOpen : undefined}
                            branchKey={hasChildren ? country.country : undefined}
                          />
                        </div>

                        {isOpen && (
                          <div className="ms-6" role="group">
                            {/* A country with no regions goes straight to its sites.
                                No placeholder region level is invented. */}
                            {regions.map((region, ri) => {
                              const rKey = `${country.country}||${region.region}`
                              const rOpen = expanded.has(rKey)
                              const sites = sitesOf(region)
                              const regionCtx = { country: country.country, region: region.region, site: null }
                              return (
                                <div key={rKey} role="none">
                                  <div className="flex items-stretch gap-0.5" role="none">
                                    {sites.length > 0 ? (
                                      <Twisty
                                        open={rOpen}
                                        collapsedIcon={CollapsedIcon}
                                        branchKey={rKey}
                                        onToggle={() => toggleBranch(rKey)}
                                      />
                                    ) : (
                                      <span className="w-6" aria-hidden="true" />
                                    )}
                                    <ContextRow
                                      icon={Building2}
                                      label={region.region}
                                      hint={sites.length > 0 ? `${sites.length} ${siteWord(sites.length)}` : null}
                                      selected={sameContext(regionCtx, ctx)}
                                      onClick={() => select(regionCtx)}
                                      treeItem
                                      level={2}
                                      posinset={ri + 1}
                                      setsize={childCount}
                                      expanded={sites.length > 0 ? rOpen : undefined}
                                      branchKey={sites.length > 0 ? rKey : undefined}
                                    />
                                  </div>
                                  {rOpen && (
                                    <div className="ms-6" role="group">
                                      {sites.map((s, si) => {
                                        const siteCtx = { country: country.country, region: region.region, site: s }
                                        return (
                                          <ContextRow
                                            key={`${rKey}||${s}`}
                                            icon={MapPin}
                                            label={s}
                                            selected={sameContext(siteCtx, ctx)}
                                            onClick={() => select(siteCtx)}
                                            treeItem
                                            level={3}
                                            posinset={si + 1}
                                            setsize={sites.length}
                                          />
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              )
                            })}

                            {loose.map((s, li) => {
                              const siteCtx = { country: country.country, region: null, site: s }
                              return (
                                <ContextRow
                                  key={`${country.country}||loose||${s}`}
                                  icon={MapPin}
                                  label={s}
                                  selected={sameContext(siteCtx, ctx)}
                                  onClick={() => select(siteCtx)}
                                  treeItem
                                  level={2}
                                  posinset={regions.length + li + 1}
                                  setsize={childCount}
                                />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function SectionLabel({ icon: Icon, text }) {
  return (
    <p
      className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-[9.5px] font-bold uppercase tracking-wider"
      style={{ color: 'var(--text-dim)' }}
    >
      {Icon && <Icon size={10} aria-hidden="true" />}
      {text}
    </p>
  )
}

/**
 * The expand/collapse chevron.
 *
 * DELIBERATELY NOT A BUTTON, and that is the load-bearing half of the tree fix.
 * role=tree may only own treeitem and group, so a second focusable control
 * sitting beside each node made the tree malformed: assistive tech either reads
 * the chevron out as loose furniture between nodes or prunes it. It also
 * doubled the tab stops in a panel that carries 69 sites in the live register.
 *
 * Nothing is lost by making it decorative, because the treeitem beside it now
 * carries aria-expanded and answers ArrowRight/ArrowLeft, which is how every
 * other tree a keyboard or screen-reader user has met already behaves. A span
 * with no tabindex is genuinely unfocusable, which is what makes aria-hidden
 * legal here.
 */
function Twisty({ open, collapsedIcon: Collapsed, onToggle, branchKey }) {
  return (
    <span
      aria-hidden="true"
      data-twisty={branchKey}
      onClick={onToggle}
      className="w-6 flex-shrink-0 flex items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-[var(--input-bg)]"
      style={{ color: 'var(--text-dim)' }}
    >
      {open ? <ChevronDown size={13} /> : <Collapsed size={13} />}
    </span>
  )
}

/**
 * One row. A hierarchy node when `treeItem` is set, a plain button otherwise.
 *
 * The two forms carry DIFFERENT selection attributes on purpose: aria-selected
 * is the tree's own idea of "this is the one", and it is only meaningful on a
 * role that supports it, so the flat Recents / All-countries / search rows keep
 * aria-current. Stamping aria-selected on a plain button says nothing to a
 * screen reader while looking, in review, as though it did.
 */
function ContextRow({
  icon: Icon, label, hint, onClick, selected = false, strong = false,
  treeItem = false, level, posinset, setsize, expanded, branchKey,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={treeItem ? 'treeitem' : undefined}
      aria-level={treeItem ? level : undefined}
      aria-posinset={treeItem ? posinset : undefined}
      aria-setsize={treeItem ? setsize : undefined}
      // A LEAF gets no aria-expanded at all. Reporting "collapsed" on a site
      // that has nothing under it invites the user to open an empty branch.
      aria-expanded={treeItem && expanded !== undefined ? expanded : undefined}
      aria-selected={treeItem ? selected : undefined}
      aria-current={!treeItem && selected ? 'true' : undefined}
      data-branch-key={branchKey}
      className="flex-1 min-w-0 w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-start transition-colors hover:bg-[var(--input-bg)]"
      style={selected ? { background: 'rgba(22,163,74,0.1)' } : undefined}
    >
      {Icon && (
        <Icon
          size={13}
          aria-hidden="true"
          className="flex-shrink-0"
          style={{ color: selected ? '#16a34a' : 'var(--text-dim)' }}
        />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate leading-tight ${strong ? 'text-[12.5px] font-bold' : 'text-[12px] font-medium'}`}
          style={{ color: selected ? '#16a34a' : 'var(--text-secondary)' }}
        >
          {label}
        </span>
        {hint && (
          <span className="block text-[10px] truncate leading-tight" style={{ color: 'var(--text-dim)' }}>
            {hint}
          </span>
        )}
      </span>
      {selected && <Check size={13} aria-hidden="true" className="flex-shrink-0" style={{ color: '#16a34a' }} />}
    </button>
  )
}
