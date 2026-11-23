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
import { Search, Box } from 'lucide-react'
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

/** Sections that show the four inventory headline tiles above them. */
const KPI_SECTIONS = new Set(['materials', 'physical', 'audits', 'discrepancies', 'corrections'])

function SectionLoading() {
  return <div style={{ display: 'grid', gap: 10 }} aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 44 }} />)}</div>
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

  const go = (key, linkTab = null) => onSection(key, linkTab)
  const submitSearch = (e) => {
    e.preventDefault()
    const q = term.trim()
    if (!q) return
    setSeedQuery(q)
    go('materials')
  }

  return (
    <div className="cc inv-hub inv-pmv">
      <header className="inv-head">
        <div>
          <h1 className="inv-title">{t('inventory.title')}</h1>
          <p className="inv-lead">{t('inventory.lead')}</p>
        </div>
        <form className="inv-bar-search" role="search" onSubmit={submitSearch}>
          <Search size={16} aria-hidden="true" />
          <input type="search" value={term} onChange={(e) => setTerm(e.target.value)}
            placeholder={t('inventory.ui.globalSearch')} aria-label={t('inventory.ui.globalSearch')} />
        </form>
      </header>

      <div className="inv-shell inv-shell-full">
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
