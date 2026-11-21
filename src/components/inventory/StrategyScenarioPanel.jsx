/**
 * Investment / stocking-strategy scenario (engine: src/lib/inventory/simulation.js,
 * method: docs/inventory/22_SIMULATION_METHOD.md). The user types the inputs; every
 * typed value is an assumption and is listed as such. Results are scenarios, never
 * savings: working capital released and modelled cost difference stay separate.
 * Nothing is saved or posted; the page holds the scenario only while it is open.
 */
import { useMemo, useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { STRATEGIES, runScenarioSet } from '../../lib/inventory/simulation'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { Note, Field, StatusPill } from './InvUi'

/** Fields per strategy (percent fields are typed as % and divided by 100). */
const STRATEGY_FIELDS = {
  bulk_purchase: [['bulkQty', 'qty'], ['bulkDiscountRate', 'pct']],
  company_warehouse: [['orderQty', 'qty']],
  supplier_managed: [['servicePremiumRate', 'pct'], ['minCommitmentValue', 'money'], ['commitmentYears', 'qty'], ['exitFee', 'money'], ['onSiteBufferQty', 'qty']],
  consignment: [['consignmentPremiumRate', 'pct'], ['minCommitmentValue', 'money'], ['commitmentYears', 'qty'], ['buybackRate', 'pct'], ['onSiteQty', 'qty']],
  framework: [['frameworkDiscountRate', 'pct'], ['minCommitmentValue', 'money'], ['commitmentYears', 'qty']],
}
const BASE_FIELDS = [
  ['annualDemandQty', 'qty'], ['unitPrice', 'money'], ['years', 'qty'], ['holdingCostRate', 'pct'],
  ['obsolescenceRate', 'pct'], ['priceEscalationRate', 'pct'], ['leadTimeDays', 'qty'], ['safetyStockQty', 'qty'],
]
const RISK_TONE = { low: 'good', medium: 'warning', high: 'bad', unknown: 'muted' }

/** Typed text -> number or undefined (blank). Percent fields become a share. */
export function readScenarioField(raw, kind) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined
  const n = Number(String(raw).replace(/,/g, ''))
  if (!Number.isFinite(n)) return undefined
  return kind === 'pct' ? n / 100 : n
}

export function buildScenarioParams(fields, values) {
  const out = {}
  for (const [k, kind] of fields) {
    const v = readScenarioField(values[k], kind)
    if (v !== undefined) out[k] = v
  }
  return out
}

export default function StrategyScenarioPanel({ defaultCurrency }) {
  const { t } = useLanguage()
  const [base, setBase] = useState({ currency: defaultCurrency || '', years: '3', holdingCostRate: '12' })
  const [baseline, setBaseline] = useState({ strategy: 'bulk_purchase', values: {} })
  const [alternative, setAlternative] = useState({ strategy: 'supplier_managed', values: {} })

  const result = useMemo(() => {
    const baseParams = { ...buildScenarioParams(BASE_FIELDS, base), currency: String(base.currency || '').trim().toUpperCase() || undefined }
    return runScenarioSet(baseParams, [
      { strategy: baseline.strategy, params: buildScenarioParams(STRATEGY_FIELDS[baseline.strategy], baseline.values) },
      { strategy: alternative.strategy, params: buildScenarioParams(STRATEGY_FIELDS[alternative.strategy], alternative.values) },
    ])
  }, [base, baseline, alternative])

  const label = (k) => t(`inventory.planning.sim.fields.${k}`)
  const input = (values, set, k, kind) => (
    <Field key={k} label={`${label(k)}${kind === 'pct' ? ' (%)' : ''}`}>
      <input className="inv-input" inputMode="decimal" value={values[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
    </Field>
  )
  const side = (which, state, setState) => (
    <div className="inv-form">
      <Field label={t(`inventory.planning.sim.${which}`)}>
        <select className="cc-select" value={state.strategy} onChange={(e) => setState({ strategy: e.target.value, values: {} })}>
          {STRATEGIES.map((s) => <option key={s} value={s}>{t(`inventory.planning.sim.strategies.${s}`)}</option>)}
        </select>
      </Field>
      {STRATEGY_FIELDS[state.strategy].map(([k, kind]) => input(state.values, (key, v) => setState((s) => ({ ...s, values: { ...s.values, [key]: v } })), k, kind))}
    </div>
  )

  const [b, a] = result.runs
  const cmp = result.comparisons[0]
  const cur = cmp?.currency || b?.currency
  const missing = [...new Set([...(b?.ok ? [] : b?.missing || []), ...(a?.ok ? [] : a?.missing || [])])]

  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <Note tone="warn">{t('inventory.planning.sim.label')}</Note>
      <div className="inv-form">
        <Field label={t('inventory.planning.sim.fields.currency')}>
          <input className="inv-input" maxLength={3} value={base.currency} onChange={(e) => setBase((s) => ({ ...s, currency: e.target.value }))} />
        </Field>
        {BASE_FIELDS.map(([k, kind]) => input(base, (key, v) => setBase((s) => ({ ...s, [key]: v })), k, kind))}
      </div>
      {side('baseline', baseline, setBaseline)}
      {side('alternative', alternative, setAlternative)}

      {!cmp?.ok ? (
        <Note>{missing.length
          ? t('inventory.planning.sim.missing', { fields: missing.map((m) => label(m)).join(', ') })
          : t('inventory.planning.sim.incomplete')}</Note>
      ) : (
        <>
          <dl className="inv-dl">
            <dt>{t('inventory.planning.sim.totalCost', { s: t(`inventory.planning.sim.strategies.${b.strategy}`) })}</dt><dd className="inv-num">{formatMoney(b.totals.totalCost, cur)}</dd>
            <dt>{t('inventory.planning.sim.totalCost', { s: t(`inventory.planning.sim.strategies.${a.strategy}`) })}</dt><dd className="inv-num">{formatMoney(a.totals.totalCost, cur)}</dd>
            <dt>{t('inventory.planning.sim.costDifference')}</dt><dd className="inv-num">{formatMoney(cmp.modelledCostDifference.value, cur)}</dd>
            <dt>{t('inventory.planning.sim.workingCapital')}</dt><dd className="inv-num">{formatMoney(cmp.workingCapitalReleased.value, cur)}</dd>
            <dt>{t('inventory.planning.sim.exitExposure')}</dt><dd className="inv-num">{formatMoney(cmp.exitExposureChange, cur)}</dd>
            {[b, a].map((r) => (
              <FragmentRow key={r.strategy + (r === b ? 'b' : 'a')} term={t('inventory.planning.sim.risk', { s: t(`inventory.planning.sim.strategies.${r.strategy}`) })}>
                <StatusPill value={r.serviceLevelRisk.level} tone={RISK_TONE[r.serviceLevelRisk.level]} label={t(`inventory.planning.sim.riskLevels.${r.serviceLevelRisk.level}`)} />
                {r.serviceLevelRisk.coverDays !== undefined && <span className="cc-card-sub"> {t('inventory.planning.sim.cover', { days: formatQty(r.serviceLevelRisk.coverDays) })}</span>}
              </FragmentRow>
            ))}
          </dl>
          <p className="cc-card-sub">{t('inventory.planning.sim.notSaving')}</p>
          <p className="cc-card-sub">{t('inventory.planning.sim.assumptions', { fields: cmp.assumptionsUsed.map((m) => label(m)).join(', ') || 'N/A' })}</p>
        </>
      )}
    </div>
  )
}

function FragmentRow({ term, children }) {
  return (<><dt>{term}</dt><dd>{children}</dd></>)
}
