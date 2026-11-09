/**
 * LifetimeCpkPanel - PHYSICAL TYRE LIFETIME CPK (CPK Intelligence tab "Tyre lifetime").
 *
 * A different measurement from the "Fleet CPK" tab, and labelled as such:
 *   Fleet CPK tab    -> tyre expense from the expense grid / km (fleet expense view)
 *   this tab         -> each physical tyre's purchase price counted ONCE / the km of
 *                       ALL its fitments (refits and transfers included), weighted.
 * Final (tyre no longer fitted) and provisional (still fitted: life so far) are never
 * mixed. Coverage, cost status and the estimated share of the cost are always shown,
 * so a partial figure never reads as complete.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCcw, FileSpreadsheet, Info, AlertTriangle } from 'lucide-react'
import { getTyreLifetimeCpk, estimatedShare } from '../../lib/api/tyreLifetimeCpk'
import { COUNTRY_CURRENCY } from '../../lib/api/assetMaster'
import { CPK_KIND_LABEL } from '../../lib/tyreLifetime'
import { exportSheetsToExcel, reportFileName, reportDateLabel } from '../../lib/exportUtils'
import CpkDataTable from './CpkDataTable'

const fmtInt = (v) => (v == null ? 'N/A' : Math.round(v).toLocaleString())
const fmtRate = (v) => (v == null ? 'N/A' : Number(v).toFixed(4))
const fmtPct = (v) => (v == null ? 'N/A' : `${Math.round(v * 100)}%`)
const fmtMoney = (cur, v) => (v == null ? 'N/A' : `${cur} ${Math.round(v).toLocaleString()}`)

const DIMS = [
  { key: 'byBrand', label: 'Brand' },
  { key: 'bySize', label: 'Size' },
  { key: 'byVehicleType', label: 'Vehicle type' },
]

function Stat({ label, value, hint }) {
  return (
    <div className="card p-3" title={hint || undefined}>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}

function Block({ title, block, currency, provisional }) {
  if (!block) {
    return (
      <div className="card p-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        {title}: no tyres in this period.
      </div>
    )
  }
  const est = estimatedShare(block)
  return (
    <div className="space-y-2">
      <h4 className="font-semibold">
        {title}
        {provisional && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>(provisional: life so far, not final)</span>}
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Purchase-only lifetime CPK" value={fmtRate(block.cpkPurchase)} hint="Purchase price once per tyre / validated km of all its fitments" />
        <Stat label="Full lifetime CPK" value={fmtRate(block.cpkFull)} hint="(Purchase + linked repairs + linked retreads - issued warranty credit) / validated km" />
        <Stat label="Measurable tyres" value={`${fmtInt(block.measurable)} of ${fmtInt(block.tyres)}`} hint="A tyre is measurable when it has a purchase price and validated km" />
        <Stat label="Validated tyre-km" value={fmtInt(block.km)} />
        <Stat label="Purchase cost in CPK" value={fmtMoney(currency, block.purchaseCost)} />
        <Stat label="Estimated share of that cost" value={fmtPct(est)} hint="Cost filled by the comparable-price estimate, not a paid price" />
        <Stat label="Refitted tyres" value={fmtInt(block.refittedTyres)} hint="Physical tyres with more than one fitment" />
        <Stat label="Tyres with an overlapping stint" value={fmtInt(block.tyresWithOverlap)} hint="A stint that starts before an earlier one ended is excluded, so km is never counted twice" />
      </div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        km coverage: complete {fmtInt(block.coverage.complete)}, partial {fmtInt(block.coverage.partial)}, none {fmtInt(block.coverage.none)}.
        Cost status: actual {fmtInt(block.costStatus.ACTUAL)}, estimated {fmtInt(block.costStatus.ESTIMATED)},
        confirmed zero {fmtInt(block.costStatus.CONFIRMED_ZERO)}, disputed {fmtInt(block.costStatus.DISPUTED)}, missing {fmtInt(block.costStatus.MISSING)}.
        Linked repairs {fmtMoney(currency, block.repairCost)}, retreads {fmtMoney(currency, block.retreadCost)}, recoveries {fmtMoney(currency, block.recovery)}.
      </div>
    </div>
  )
}

export default function LifetimeCpkPanel({ country, from, to, site }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [dim, setDim] = useState('byBrand')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    const res = await getTyreLifetimeCpk({ country, from, to, site })
    setState(res.ok ? { loading: false, data: res, error: null } : { loading: false, data: null, error: res.error })
  }, [country, from, to, site])

  useEffect(() => { load() }, [load])

  const countries = useMemo(() => state.data?.countries || [], [state.data])

  const exportExcel = () => {
    const sheets = []
    for (const c of countries) {
      const cur = COUNTRY_CURRENCY[c.country] || ''
      for (const [label, b] of [['Final', c.final], ['Provisional', c.provisional]]) {
        if (!b) continue
        sheets.push({ country: c.country, kind: label, currency: cur, tyres: b.tyres, measurable: b.measurable, km: b.km,
          purchase_cost: b.purchaseCost, full_cost: b.fullCost, cpk_purchase: b.cpkPurchase, cpk_full: b.cpkFull,
          estimated_share: estimatedShare(b), km_complete: b.coverage.complete, km_partial: b.coverage.partial, km_none: b.coverage.none,
          actual: b.costStatus.ACTUAL, estimated: b.costStatus.ESTIMATED, disputed: b.costStatus.DISPUTED, missing: b.costStatus.MISSING })
      }
    }
    const groups = countries.flatMap((c) => DIMS.flatMap((d) => c[d.key].map((g) => ({ country: c.country, dimension: d.label, ...g }))))
    const cols = (rows) => (rows.length ? Object.keys(rows[0]) : ['note'])
    exportSheetsToExcel([
      { name: 'Summary', rows: sheets, columns: cols(sheets), headers: cols(sheets) },
      { name: 'Breakdown', rows: groups, columns: cols(groups), headers: cols(groups) },
    ], reportFileName('Tyre Lifetime CPK', country || 'All', reportDateLabel()), {
      title: CPK_KIND_LABEL.tyre_lifetime,
      notes: ['Purchase price counted once per physical tyre; km summed over all non-overlapping fitments; weighted; final and still-fitted tyres kept apart.'],
    }).catch(() => {})
  }

  if (state.loading) return <div className="card p-6 text-sm">Loading tyre lifetime CPK...</div>
  if (state.error) {
    return (
      <div className="card p-4 flex items-center gap-3">
        <AlertTriangle size={16} /> <span className="text-sm">{state.error}</span>
        <button type="button" className="btn btn-sm" onClick={load}><RefreshCcw size={14} /> Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card p-3 text-sm flex gap-2 items-start">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          <b>{CPK_KIND_LABEL.tyre_lifetime}</b>, aggregated as <b>{CPK_KIND_LABEL.fleet_aggregate}</b>.
          Each physical tyre counts its purchase price once and the km of every fitment, across vehicles.
          This is not the Fleet CPK tab, which divides tyre expense from the expense lines by km.
          Site is the site of the tyre&apos;s latest fitment.
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-sm" onClick={load}><RefreshCcw size={14} /> Refresh</button>
        <button type="button" className="btn btn-sm" onClick={exportExcel} disabled={!countries.length}><FileSpreadsheet size={14} /> Excel</button>
      </div>
      {!countries.length && <div className="card p-6 text-sm">No tyres for this country and period.</div>}
      {countries.map((c) => {
        const currency = COUNTRY_CURRENCY[c.country] || ''
        const rows = c[dim]
        return (
          <section key={c.country} className="card p-4 space-y-4">
            <h3 className="text-base font-semibold">{c.country} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({currency} per tyre-km)</span></h3>
            <Block title="Final: tyres no longer fitted" block={c.final} currency={currency} />
            <Block title="Still fitted" block={c.provisional} currency={currency} provisional />
            {c.unlinkedRepairLines.lines > 0 && (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {fmtInt(c.unlinkedRepairLines.lines)} tyre repair or retread expense lines ({fmtMoney(currency, c.unlinkedRepairLines.amount)})
                carry no tyre serial, so they are not added to any tyre&apos;s full lifetime CPK. They are listed for review.
              </div>
            )}
            <div className="flex gap-2" role="group" aria-label="Breakdown">
              {DIMS.map((d) => (
                <button key={d.key} type="button" className={`btn btn-sm ${dim === d.key ? 'btn-primary' : ''}`} onClick={() => setDim(d.key)}>{d.label}</button>
              ))}
            </div>
            <CpkDataTable
              rows={rows}
              searchKeys={['key']}
              initialSort={{ key: 'km', dir: 'desc' }}
              emptyText="No measurable final tyres in this period."
              columns={[
                { key: 'key', header: DIMS.find((d) => d.key === dim)?.label || 'Group', align: 'left', kind: 'text' },
                { key: 'tyres', header: 'Tyres', align: 'right', kind: 'int' },
                { key: 'km', header: 'Tyre-km', align: 'right', kind: 'int' },
                { key: 'cpkPurchase', header: 'Purchase CPK', align: 'right', kind: 'cpk' },
                { key: 'cpkFull', header: 'Full CPK', align: 'right', kind: 'cpk' },
              ]}
            />
          </section>
        )
      })}
    </div>
  )
}
