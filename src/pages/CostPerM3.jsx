/**
 * CostPerM3 (route /cost-per-m3) - the Cost per cubic metre dashboard.
 *
 * Grand Total = Internal (ERP expenses) + SCO cost + SANY workshop invoices,
 * split by region, divided by approved production M3 = Cost / M3. Tyre cost is
 * shown as a sub-line of Internal (the "tyre expense" view). One country + one
 * bounded period at a time (default current month) so it loads fast; money is per
 * country in its own currency (never blended); Cost/M3 is N/A when there is no
 * production denominator.
 *
 * Data: get_cost_per_m3 RPC (V450) via src/lib/api/costPerM3.js. SCO / SANY /
 * production data is entered on their own pages (/sco-costs, /sany-invoices,
 * /production-m3); Internal reuses parts_consumption (ERP intake).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Gauge, RefreshCcw, FileSpreadsheet, FileText, Layers } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { getCostPerM3 } from '../lib/api/costPerM3'
import { CPK_PERIODS, DEFAULT_PERIOD, periodBounds, periodLabel } from '../lib/cpkModule'
import { fmtMoney, fmtM3, fmtCostPerM3 } from '../lib/costPerM3'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

export default function CostPerM3() {
  const { activeCountry } = useSettings()
  const initialCountry = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initialCountry)
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD)
  const bounds = useMemo(() => periodBounds(periodKey, new Date()), [periodKey])

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    getCostPerM3({ country, from: bounds.from, to: bounds.to })
      .then((res) => { if (!cancelled) setData(res) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to])

  useEffect(() => load(), [load])

  const currency = data?.currency || country
  const total = data?.total || null
  const regions = data?.regions || []

  function exportExcel() {
    const rows = [
      ...regions.map((r) => ({
        region: r.region, internal: Math.round(r.internal_cost || 0), tyre: Math.round(r.tyre_cost || 0),
        sco: Math.round(r.sco_cost || 0), sany: Math.round(r.sany_cost || 0),
        grand_total: Math.round(r.grand_total || 0), production_m3: Math.round(r.production_m3 || 0),
        cost_per_m3: r.cost_per_m3 == null ? 'N/A' : Number(r.cost_per_m3).toFixed(2),
      })),
    ]
    if (total) rows.push({
      region: 'TOTAL', internal: Math.round(total.internal_cost || 0), tyre: Math.round(total.tyre_cost || 0),
      sco: Math.round(total.sco_cost || 0), sany: Math.round(total.sany_cost || 0),
      grand_total: Math.round(total.grand_total || 0), production_m3: Math.round(total.production_m3 || 0),
      cost_per_m3: total.cost_per_m3 == null ? 'N/A' : Number(total.cost_per_m3).toFixed(2),
    })
    if (!rows.length) return
    exportToExcel(rows,
      ['region', 'internal', 'tyre', 'sco', 'sany', 'grand_total', 'production_m3', 'cost_per_m3'],
      ['Region', `Internal (${currency})`, `Tyre (${currency})`, `SCO (${currency})`, `SANY (${currency})`, `Grand Total (${currency})`, 'Production M3', `Cost/M3 (${currency})`],
      `TyrePulse_CostPerM3_${country}`, 'Cost per M3')
  }

  function exportPdf() {
    const rows = regions.map((r) => ({
      region: r.region, internal: Math.round(r.internal_cost || 0), sco: Math.round(r.sco_cost || 0),
      sany: Math.round(r.sany_cost || 0), grand_total: Math.round(r.grand_total || 0),
      production_m3: Math.round(r.production_m3 || 0), cost_per_m3: r.cost_per_m3 == null ? 'N/A' : Number(r.cost_per_m3).toFixed(2),
    }))
    if (!rows.length) return
    exportToPdf(rows, [
      { key: 'region', header: 'Region' }, { key: 'internal', header: `Internal (${currency})` },
      { key: 'sco', header: `SCO (${currency})` }, { key: 'sany', header: `SANY (${currency})` },
      { key: 'grand_total', header: `Grand Total (${currency})` }, { key: 'production_m3', header: 'Production M3' },
      { key: 'cost_per_m3', header: `Cost/M3 (${currency})` },
    ], `${country} Cost per M3 - ${periodLabel(bounds)}`, `TyrePulse_CostPerM3_${country}`, 'landscape')
  }

  return (
    <div className="p-4 md:p-6 max-w-[1300px] mx-auto">
      <PageHeader
        title="Cost per M3"
        subtitle="Internal + SCO + SANY, divided by approved production, by region and month"
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={exportExcel} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm"><FileSpreadsheet size={14} /> Excel</button>
            <button type="button" onClick={exportPdf} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm"><FileText size={14} /> PDF</button>
            <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm"><RefreshCcw size={14} /> Refresh</button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border-subtle)] p-0.5">
          {COUNTRIES.map((c) => (
            <button key={c} type="button" onClick={() => setCountry(c)}
              className={`px-3 py-1.5 text-sm rounded-md ${country === c ? 'bg-[var(--accent)] text-white' : ''}`}
              style={country === c ? undefined : { color: 'var(--text-secondary)' }}>{c}</button>
          ))}
        </div>
        <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-sm">
          {CPK_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{periodLabel(bounds)}</span>
      </div>

      {/* Headline card (matches the All-<country> summary) */}
      <div className="mb-6 rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        <div className="bg-[var(--accent)] text-white px-4 py-2.5 font-semibold">All {country}</div>
        {loading ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading...</div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            <Line label={`Internal ${country}`} value={fmtMoney(total?.internal_cost, currency)} />
            <Line label="Tyre (of internal)" value={fmtMoney(total?.tyre_cost, currency)} sub />
            <Line label={`SCO ${country}`} value={fmtMoney(total?.sco_cost, currency)} />
            <Line label="SANY Invoice" value={fmtMoney(total?.sany_cost, currency)} />
            <Line label="Grand Total" value={fmtMoney(total?.grand_total, currency)} strong />
            <Line label="Production" value={fmtM3(total?.production_m3)} />
            <Line label="Cost / M3" value={fmtCostPerM3(total?.cost_per_m3, currency)} strong />
          </div>
        )}
      </div>

      {/* Region breakdown */}
      <div className="rounded-xl border border-[var(--border-subtle)] p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Layers size={16} /> By region</h3>
        {!loading && total?.production_m3 === 0 && (
          <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            No approved production yet for this period - Cost/M3 shows N/A until production is entered on the Production page.
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-sm border-collapse">
            <thead style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}>
              <tr>
                {['Region', 'Internal', 'SCO', 'SANY', 'Grand Total', 'Production M3', 'Cost/M3'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-semibold whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>Loading...</td></tr>
              ) : regions.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>No cost or production for {country} in this period.</td></tr>
              ) : regions.map((r) => (
                <tr key={r.region} className="border-t border-[var(--border-subtle)]">
                  <td className="px-3 py-2 text-left">{r.region}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.internal_cost, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.sco_cost, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.sany_cost, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(r.grand_total, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Math.round(r.production_m3 || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtCostPerM3(r.cost_per_m3, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          Region comes from Site Management (tag each site Central / Western). Untagged sites show as "Unassigned".
        </p>
      </div>
    </div>
  )
}

function Line({ label, value, strong, sub }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${sub ? 'pl-8' : ''}`}>
      <span className={`${strong ? 'font-semibold' : ''} ${sub ? 'text-xs' : 'text-sm'}`} style={sub ? { color: 'var(--text-secondary)' } : undefined}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-lg font-bold' : 'text-sm'}`} style={sub ? { color: 'var(--text-secondary)' } : undefined}>{value}</span>
    </div>
  )
}
