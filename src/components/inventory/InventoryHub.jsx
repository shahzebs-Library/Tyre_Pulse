/**
 * Inventory Control Center shell. Follows the app's own page design: the
 * shared PageHeader (the current section's name), the scope (country from the
 * working context + a site filter) and the lazily loaded section. The section
 * links live in the app sidebar; the section is in `?section=` so a link
 * survives refresh.
 *
 * Existing stock screens are not duplicated: the Stock register section is
 * the original register (rendered by StockManagement.jsx), and Procurement,
 * Goods Receipt, Material Issue, Replenishment and Suppliers are linked from
 * their sections rather than rebuilt.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Box, Warehouse } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { listSites } from '../../lib/api/sites'
import { visibleGroups, makeCan, SECTION_KEYS } from '../../lib/inventory/hubSections'
import PageHeader from '../ui/PageHeader'
import InventoryKpiRow from './InventoryKpiRow'
import { Denied } from './InvUi'
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
  // A known section the user may not see (e.g. Valuation without view_value)
  // says so, instead of silently showing Overview. No section -> Overview.
  const denied = SECTION_KEYS.includes(section) && !visible.has(section) ? section : null
  const current = visible.has(section) ? section : 'overview'
  const headingKey = denied || current
  const scope = useMemo(() => ({ country: activeCountry && activeCountry !== 'All' ? activeCountry : null, site }), [activeCountry, site])
  const Comp = SECTION_COMPONENTS[current]
  const sectionProps = { scope, can, userId, onNavigate: onSection, tab, onTab }

  return (
    <div className="cc inv-hub inv-pmv">
      <PageHeader title={t(`inventory.sections.${headingKey}`)} subtitle={t('inventory.lead')} icon={Warehouse} emojiPath={`/stock?section=${headingKey}`} />

      {denied ? <Denied capLabel={t(`inventory.sections.${denied}`)} /> : (
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
      )}
    </div>
  )
}
