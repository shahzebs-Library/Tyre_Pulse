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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Globe, MapPin, Search, Check, Clock, Building2 } from 'lucide-react'
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
  const { t } = useLanguage()
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
  const popRef = useRef(null)
  const searchRef = useRef(null)
  const { triggerRef, coords } = useAnchoredPopover(open, { width: 320, height: 460, align: 'right' })

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
    const id = setTimeout(() => searchRef.current?.focus(), 30)
    return () => clearTimeout(id)
    // Only on open: re-running on every context change would fight the user's
    // own expand/collapse while the menu is sitting there open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
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

  const label = contextLabel(ctx)
  const short = contextShortLabel(ctx)
  // The country only earns a second line when the headline is something else.
  const subtitle = ctx.site || ctx.region ? ctx.country : null
  const titleText = `${tx(t, 'shell.workingContext', 'Working location')}: ${label}`

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
        <span className="min-w-0 text-left">
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

      {open && coords && createPortal(
        <div
          ref={popRef}
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
                  className="absolute left-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-dim)' }}
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tx(t, 'shell.findSite', 'Find a site or region')}
                  aria-label={tx(t, 'shell.findSite', 'Find a site or region')}
                  className="w-full h-7 pl-7 pr-2 rounded-lg text-[12px] outline-none"
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

                {allowed.map((country) => {
                  const regions = regionsOf(country)
                  const loose = looseSitesOf(country)
                  const hasChildren = regions.length > 0 || loose.length > 0
                  const isOpen = expanded.has(country.country)
                  const countryCtx = { country: country.country, region: null, site: null }
                  const totalSites = allSitesOf(country).length
                  return (
                    <div key={country.country}>
                      <div className="flex items-stretch gap-0.5">
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => toggleBranch(country.country)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? tx(t, 'common.collapse', 'Collapse') : tx(t, 'common.expand', 'Expand')} ${country.country}`}
                            className="w-6 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--input-bg)]"
                            style={{ color: 'var(--text-dim)' }}
                          >
                            {isOpen
                              ? <ChevronDown size={13} aria-hidden="true" />
                              : <ChevronRight size={13} aria-hidden="true" />}
                          </button>
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
                        />
                      </div>

                      {isOpen && (
                        <div className="ml-6">
                          {/* A country with no regions goes straight to its sites.
                              No placeholder region level is invented. */}
                          {regions.map((region) => {
                            const rKey = `${country.country}||${region.region}`
                            const rOpen = expanded.has(rKey)
                            const sites = sitesOf(region)
                            const regionCtx = { country: country.country, region: region.region, site: null }
                            return (
                              <div key={rKey}>
                                <div className="flex items-stretch gap-0.5">
                                  {sites.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleBranch(rKey)}
                                      aria-expanded={rOpen}
                                      aria-label={`${rOpen ? tx(t, 'common.collapse', 'Collapse') : tx(t, 'common.expand', 'Expand')} ${region.region}`}
                                      className="w-6 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--input-bg)]"
                                      style={{ color: 'var(--text-dim)' }}
                                    >
                                      {rOpen
                                        ? <ChevronDown size={13} aria-hidden="true" />
                                        : <ChevronRight size={13} aria-hidden="true" />}
                                    </button>
                                  ) : (
                                    <span className="w-6" aria-hidden="true" />
                                  )}
                                  <ContextRow
                                    icon={Building2}
                                    label={region.region}
                                    hint={sites.length > 0 ? `${sites.length} ${siteWord(sites.length)}` : null}
                                    selected={sameContext(regionCtx, ctx)}
                                    onClick={() => select(regionCtx)}
                                  />
                                </div>
                                {rOpen && (
                                  <div className="ml-6">
                                    {sites.map((s) => {
                                      const siteCtx = { country: country.country, region: region.region, site: s }
                                      return (
                                        <ContextRow
                                          key={`${rKey}||${s}`}
                                          icon={MapPin}
                                          label={s}
                                          selected={sameContext(siteCtx, ctx)}
                                          onClick={() => select(siteCtx)}
                                        />
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}

                          {loose.map((s) => {
                            const siteCtx = { country: country.country, region: null, site: s }
                            return (
                              <ContextRow
                                key={`${country.country}||loose||${s}`}
                                icon={MapPin}
                                label={s}
                                selected={sameContext(siteCtx, ctx)}
                                onClick={() => select(siteCtx)}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
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

function ContextRow({ icon: Icon, label, hint, onClick, selected = false, strong = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className="flex-1 min-w-0 w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--input-bg)]"
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
