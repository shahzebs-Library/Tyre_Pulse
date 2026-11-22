/**
 * Inventory Control Center shell (owner-approved look): a brand bar with a
 * company-wide material search, the alerts bell and the signed-in user, the
 * main inventory tabs with icons, a left sub-navigation, the scope (country
 * from the working context + a site filter) and the lazily loaded section.
 * The section lives in `?section=` so a link survives refresh.
 *
 * Existing stock screens are not duplicated: the Stock register section is
 * the original register (rendered by StockManagement.jsx), and Procurement,
 * Goods Receipt, Material Issue, Replenishment and Suppliers are linked from
 * their sections rather than rebuilt.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell, Search, LayoutDashboard, Package, ScanLine, ClipboardCheck, AlertTriangle, FileWarning, FileBarChart,
  ArrowLeftRight, Truck, BookOpen, Database, Settings, Boxes, ChevronDown, Box,
} from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { listSites } from '../../lib/api/sites'
import { visibleGroups, makeCan } from '../../lib/inventory/hubSections'
import InventoryKpiRow from './InventoryKpiRow'
import '../commandCenter/commandCenter.css'
import './inventory.css'
import './inventoryPmv.css'

const Store3DPanel = lazy(() => import('./Store3DPanel'))

const SECTION_COMPONENTS = {
  overview: lazy(() => import('./OverviewSection')),
  locations: lazy(() => import('./LocationsSection')),
  materials: lazy(() => import('./MaterialMasterSection')),
  physical: lazy(() => import('./PhysicalInventorySection')),
  movements: lazy(() => import('./MovementsSection')),
  audits: lazy(() => import('./AuditsSection')),
  discrepancies: lazy(() => import('./DiscrepanciesSection')),
  corrections: lazy(() => import('./CorrectionsSection')),
  controls: lazy(() => import('./ControlsSection')),
  procurement: lazy(() => import('./SupplySections').then((m) => ({ default: m.ProcurementSection }))),
  receiving: lazy(() => import('./SupplySections').then((m) => ({ default: m.ReceivingSection }))),
  supplier: lazy(() => import('./SupplySections').then((m) => ({ default: m.SupplierSection }))),
  tyres: lazy(() => import('./TyreInventorySection')),
  identification: lazy(() => import('./IdentificationSection')),
  valuation: lazy(() => import('./ValuationPanels')),
  kpis: lazy(() => import('./KpiCatalogueSection')),
  classification: lazy(() => import('./ClassificationSection')),
  planning: lazy(() => import('./InsightSections').then((m) => ({ default: m.PlanningSection }))),
  reports: lazy(() => import('./ReportsSection')),
}

/** The main inventory tabs (top bar). Label keys live under inventory.ui.tabs. */
export const TOP_TABS = [
  { key: 'overview', icon: LayoutDashboard },
  { key: 'materials', icon: Package },
  { key: 'physical', icon: ScanLine },
  { key: 'audits', icon: ClipboardCheck },
  { key: 'discrepancies', icon: AlertTriangle },
  { key: 'corrections', icon: FileWarning },
  { key: 'reports', icon: FileBarChart },
]

/** Sections that show the four inventory headline tiles above them. */
const KPI_SECTIONS = new Set(['materials', 'physical', 'audits', 'discrepancies', 'corrections'])

/** Left sub-navigation. `tab` opens a named tab inside the section. */
const SIDE_NAV = [
  { id: 'dashboard', section: 'overview', icon: LayoutDashboard },
  { id: 'inventory', icon: Boxes, children: ['overview', 'materials', 'physical', 'audits', 'discrepancies', 'corrections', 'reports', 'register'] },
  { id: 'transactions', section: 'movements', tab: null, icon: ArrowLeftRight },
  { id: 'transfers', section: 'movements', tab: 'transfers', icon: Truck },
  { id: 'catalog', section: 'identification', icon: BookOpen },
  { id: 'masterData', section: 'locations', icon: Database },
  { id: 'admin', section: 'controls', icon: Settings },
]
const IN_SIDE = new Set(['overview', 'materials', 'physical', 'audits', 'discrepancies', 'corrections', 'reports', 'register', 'movements', 'identification', 'locations', 'controls'])

function SectionLoading() {
  return <div style={{ display: 'grid', gap: 10 }} aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 44 }} />)}</div>
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export default function InventoryHub({ section, tab = null, onSection, onTab, renderRegister }) {
  const { t } = useLanguage()
  const { activeCountry } = useSettings()
  const { profile, user, hasCapability, canExport } = useAuth()
  const can = useMemo(() => makeCan({ hasCapability, canExport }), [hasCapability, canExport])
  const userId = profile?.id || user?.id || null
  const [site, setSite] = useState('all')
  const [sites, setSites] = useState([])
  const [term, setTerm] = useState('')
  const [seedQuery, setSeedQuery] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [show3d, setShow3d] = useState(false)

  useEffect(() => {
    let live = true
    listSites({ country: activeCountry, activeOnly: true })
      .then((rows) => { if (live) setSites(rows.map((r) => r.name).filter(Boolean)) })
      .catch(() => { if (live) setSites([]) })
    setSite('all')
    return () => { live = false }
  }, [activeCountry])

  const groups = useMemo(() => visibleGroups(can), [can])
  const visible = useMemo(() => new Set(groups.flatMap((g) => g.sections.map((s) => s.key))), [groups])
  const current = visible.has(section) ? section : 'overview'
  const scope = useMemo(() => ({ country: activeCountry && activeCountry !== 'All' ? activeCountry : null, site }), [activeCountry, site])
  const Comp = SECTION_COMPONENTS[current]
  const sectionProps = { scope, can, userId, onNavigate: onSection, tab, onTab, seedQuery }
  const moreSections = groups.flatMap((g) => g.sections.map((s) => s.key)).filter((k) => !IN_SIDE.has(k))
  const displayName = profile?.full_name || profile?.username || user?.email || t('inventory.ui.user')
  const roleName = profile?.role || null

  const go = (key, linkTab = null) => onSection(key, linkTab)
  const submitSearch = (e) => {
    e.preventDefault()
    const q = term.trim()
    if (!q) return
    setSeedQuery(q)
    go('materials')
  }
  const isCurrent = (item) => (item.section === current && (item.tab === undefined || (tab || null) === (item.tab || null)))

  return (
    <div className="cc inv-hub inv-pmv">
      <header className="inv-bar">
        <h1 className="inv-brand">
          <span className="inv-brand-mark" aria-hidden="true">Tyre Pulse <span className="inv-brand-dot">·</span> </span>
          {t('inventory.title')}
        </h1>
        <form className="inv-bar-search" role="search" onSubmit={submitSearch}>
          <Search size={16} aria-hidden="true" />
          <input type="search" value={term} onChange={(e) => setTerm(e.target.value)}
            placeholder={t('inventory.ui.globalSearch')} aria-label={t('inventory.ui.globalSearch')} />
        </form>
        <div className="inv-bar-end">
          <Link to="/alerts" className="inv-bell" aria-label={t('inventory.ui.alerts')} title={t('inventory.ui.alerts')}>
            <Bell size={18} aria-hidden="true" />
          </Link>
          <span className="inv-user" title={displayName}>
            <span className="inv-avatar" aria-hidden="true">{initials(displayName)}</span>
            <span className="inv-user-text">
              <b>{displayName}</b>
              {roleName && <small>{roleName}</small>}
            </span>
          </span>
        </div>
      </header>
      <p className="inv-lead">{t('inventory.lead')}</p>

      <div className="inv-toptabs" role="tablist" aria-label={t('inventory.navLabel')}>
        {TOP_TABS.filter((x) => visible.has(x.key)).map(({ key, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={current === key} className="inv-toptab" onClick={() => go(key)}>
            <Icon size={16} aria-hidden="true" />
            <span>{t(`inventory.ui.tabs.${key}`)}</span>
          </button>
        ))}
      </div>

      <div className="inv-shell">
        <nav className="inv-side" aria-label={t('inventory.ui.sideNav')}>
          <ul>
            {SIDE_NAV.map((item) => {
              const Icon = item.icon
              if (item.children) {
                const kids = item.children.filter((k) => visible.has(k))
                if (!kids.length) return null
                return (
                  <li key={item.id}>
                    <span className="inv-side-head"><Icon size={15} aria-hidden="true" /> {t(`inventory.ui.side.${item.id}`)}</span>
                    <ul className="inv-side-sub">
                      {kids.map((k) => (
                        <li key={k}>
                          <button type="button" className="inv-side-link" aria-current={current === k ? 'page' : undefined} onClick={() => go(k)}>
                            {t(k === 'register' ? 'inventory.sections.register' : `inventory.ui.tabs.${k}`)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              }
              if (!visible.has(item.section)) return null
              return (
                <li key={item.id}>
                  <button type="button" className="inv-side-link inv-side-top" aria-current={isCurrent(item) ? 'page' : undefined}
                    onClick={() => go(item.section, item.tab || null)}>
                    <Icon size={15} aria-hidden="true" /> {t(`inventory.ui.side.${item.id}`)}
                  </button>
                </li>
              )
            })}
            {moreSections.length > 0 && (
              <li>
                <button type="button" className="inv-side-link inv-side-top" aria-expanded={moreOpen || moreSections.includes(current)}
                  onClick={() => setMoreOpen((v) => !v)}>
                  <ChevronDown size={15} aria-hidden="true" /> {t('inventory.ui.side.more')}
                </button>
                {(moreOpen || moreSections.includes(current)) && (
                  <ul className="inv-side-sub">
                    {moreSections.map((k) => (
                      <li key={k}>
                        <button type="button" className="inv-side-link" aria-current={current === k ? 'page' : undefined} onClick={() => go(k)}>
                          {t(`inventory.sections.${k}`)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </nav>

        <div className="inv-main">
          <div className="inv-scope">
            <span className="cc-pill info" title={t('inventory.scope.countryHint')}>
              {t('inventory.scope.country')}: {scope.country || t('inventory.scope.allCountries')}
            </span>
            {current !== 'register' && (
              <label className="cc-field">
                <span>{t('inventory.scope.site')}</span>
                <select className="cc-select" value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="all">{t('inventory.scope.allSites')}</option>
                  {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}
            {current !== 'locations' && (
              <button type="button" className="cc-btn-ghost" aria-pressed={show3d} onClick={() => setShow3d((v) => !v)}>
                <Box size={14} aria-hidden="true" /> {t('inventory.store3d.toggle')}
              </button>
            )}
          </div>

          {show3d && current !== 'locations' && (
            <Suspense fallback={<SectionLoading />}>
              <Store3DPanel scope={scope} />
            </Suspense>
          )}

          {KPI_SECTIONS.has(current) && <InventoryKpiRow scope={scope} onNavigate={onSection} />}

          <section aria-label={t(`inventory.sections.${current}`)}>
            {current === 'register'
              ? renderRegister()
              : (
                <Suspense fallback={<SectionLoading />}>
                  {Comp ? <Comp {...sectionProps} /> : null}
                </Suspense>
              )}
          </section>
        </div>
      </div>
    </div>
  )
}
