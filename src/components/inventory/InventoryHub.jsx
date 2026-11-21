/**
 * Inventory Control Center shell: header, scope (country from the working
 * context + a site filter), grouped section navigation and the lazily loaded
 * section. The section lives in `?section=` so a link survives refresh.
 *
 * Existing stock screens are not duplicated: the Stock register section is
 * the original register (rendered by StockManagement.jsx), and Procurement,
 * Goods Receipt, Material Issue, Replenishment and Suppliers are linked from
 * their sections rather than rebuilt.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Tabs } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { useAuth } from '../../contexts/AuthContext'
import { listSites } from '../../lib/api/sites'
import { visibleGroups, sectionGroup, makeCan } from '../../lib/inventory/hubSections'
import '../commandCenter/commandCenter.css'
import './inventory.css'

const SECTION_COMPONENTS = {
  overview: lazy(() => import('./OverviewSection')),
  locations: lazy(() => import('./LocationsSection')),
  movements: lazy(() => import('./MovementsSection')),
  audits: lazy(() => import('./AuditsSection')),
  discrepancies: lazy(() => import('./DiscrepanciesSection')),
  controls: lazy(() => import('./ControlsSection')),
  procurement: lazy(() => import('./SupplySections').then((m) => ({ default: m.ProcurementSection }))),
  receiving: lazy(() => import('./SupplySections').then((m) => ({ default: m.ReceivingSection }))),
  supplier: lazy(() => import('./SupplySections').then((m) => ({ default: m.SupplierSection }))),
  tyres: lazy(() => import('./TyreInventorySection')),
  identification: lazy(() => import('./IdentificationSection')),
  valuation: lazy(() => import('./ValuationPanels')),
  planning: lazy(() => import('./InsightSections').then((m) => ({ default: m.PlanningSection }))),
  reports: lazy(() => import('./ReportsSection')),
}

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

  useEffect(() => {
    let live = true
    listSites({ country: activeCountry, activeOnly: true })
      .then((rows) => { if (live) setSites(rows.map((r) => r.name).filter(Boolean)) })
      .catch(() => { if (live) setSites([]) })
    setSite('all')
    return () => { live = false }
  }, [activeCountry])

  const groups = useMemo(() => visibleGroups(can), [can])
  const group = sectionGroup(section)
  const activeGroup = groups.find((g) => g.key === group) || groups[0]
  const allowed = activeGroup?.sections.some((s) => s.key === section)
  const current = allowed ? section : 'overview'
  const scope = useMemo(() => ({ country: activeCountry && activeCountry !== 'All' ? activeCountry : null, site }), [activeCountry, site])
  const Comp = SECTION_COMPONENTS[current]
  const sectionProps = { scope, can, userId, onNavigate: onSection, tab, onTab }

  return (
    <div className="cc inv-hub">
      <header className="inv-head">
        <div>
          <h1>{t('inventory.title')}</h1>
          <p>{t('inventory.lead')}</p>
        </div>
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
        </div>
      </header>

      <nav className="inv-nav" aria-label={t('inventory.navLabel')}>
        <div className="inv-groups">
          <Tabs label={t('inventory.groupsLabel')} value={activeGroup?.key}
            tabs={groups.map((g) => ({ key: g.key, label: t(g.labelKey) }))}
            onChange={(k) => onSection(groups.find((g) => g.key === k)?.sections[0]?.key || 'overview', null)} />
        </div>
        <div className="inv-sections">
          <Tabs variant="line" label={t('inventory.sectionsLabel')} value={current}
            tabs={(activeGroup?.sections || []).map((s) => ({ key: s.key, label: t(`inventory.sections.${s.key}`) }))}
            onChange={(k) => onSection(k, null)} />
        </div>
      </nav>

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
  )
}
