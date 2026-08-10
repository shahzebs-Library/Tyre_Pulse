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
import { RefreshCcw, FileSpreadsheet, FileText, Layers, ClipboardCheck, Copy } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import ExplainThisNumber from '../components/trust/ExplainThisNumber'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { getCostPerM3, getCostPerM3Trend, getProductionRejections } from '../lib/api/costPerM3'
import { CPK_PERIODS, DEFAULT_PERIOD, periodBounds, periodLabel } from '../lib/cpkModule'
import { fmtMoney, fmtM3, fmtCostPerM3 } from '../lib/costPerM3'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import PresentationStudio from '../components/present/PresentationStudio'
import StudioBoundary from '../components/present/StudioBoundary'

/**
 * Site-manager review: honest, data-derived issues to flag for the period. Sent
 * weekly so a site manager sees their cost and production by region and the
 * problems worth acting on. Pure; every line is grounded in the passed data.
 */
export function buildSiteManagerReview({ regions = [], total = null, rejections = null, currency = '', label = '' } = {}) {
  const m = (v) => fmtMoney(v, currency)
  const withProd = regions.filter((r) => (Number(r.production_m3) || 0) > 0)
  const lines = []
  const issues = []

  if (total && (Number(total.grand_total) || Number(total.production_m3))) {
    const cpm = total.cost_per_m3 != null ? Number(total.cost_per_m3)
      : (Number(total.production_m3) > 0 ? (Number(total.grand_total) || 0) / Number(total.production_m3) : null)
    lines.push(`Total cost ${m(total.grand_total)} over ${Math.round(Number(total.production_m3) || 0).toLocaleString('en-US')} m3${cpm != null ? ` = ${m(cpm)} per m3` : ''} for ${label}.`)
    // Largest cost source.
    const sources = [
      ['Internal', Number(total.internal_cost) || 0], ['Tyres', Number(total.tyre_cost) || 0],
      ['SCO', Number(total.sco_cost) || 0], ['SANY', Number(total.sany_cost) || 0],
    ].sort((a, b) => b[1] - a[1])
    const grand = Number(total.grand_total) || sources.reduce((s, x) => s + x[1], 0)
    if (sources[0] && sources[0][1] > 0 && grand > 0) {
      lines.push(`Largest cost is ${sources[0][0]} at ${m(sources[0][1])} (${Math.round((sources[0][1] / grand) * 100)}% of total).`)
    }
  } else {
    lines.push(`No cost or approved production was recorded for ${label}.`)
  }

  // Cost/m3 outliers vs the period average.
  if (withProd.length >= 2) {
    const cpmOf = (r) => (r.cost_per_m3 != null ? Number(r.cost_per_m3) : (Number(r.production_m3) > 0 ? (Number(r.grand_total) || 0) / Number(r.production_m3) : null))
    const avg = withProd.reduce((s, r) => s + (cpmOf(r) || 0), 0) / withProd.length
    withProd.forEach((r) => {
      const c = cpmOf(r)
      if (c != null && avg > 0 && c > avg * 1.15) {
        issues.push(`${r.region} cost/m3 is ${m(c)}, ${Math.round(((c - avg) / avg) * 100)}% above the ${label} average of ${m(avg)}.`)
      }
    })
  }
  // Cost recorded with no approved production (a data / production-entry gap).
  regions.forEach((r) => {
    if ((Number(r.grand_total) || 0) > 0 && (Number(r.production_m3) || 0) === 0) {
      issues.push(`${r.region} recorded ${m(r.grand_total)} in cost but no approved production - check the production entries.`)
    }
  })
  // Rejected production.
  if (rejections && rejections.ok) {
    const rt = Number(rejections.total) || 0
    if (rt > 0) {
      const topSite = [...(rejections.by_site || [])].sort((a, b) => (Number(b.rejected_m3 ?? b.value ?? b.m3) || 0) - (Number(a.rejected_m3 ?? a.value ?? a.m3) || 0))[0]
      const topReason = [...(rejections.by_reason || [])].sort((a, b) => (Number(b.rejected_m3 ?? b.value ?? b.m3) || 0) - (Number(a.rejected_m3 ?? a.value ?? a.m3) || 0))[0]
      let s = `Rejected production this period: ${Math.round(rt).toLocaleString('en-US')} m3.`
      if (topSite) s += ` Most at ${topSite.site || topSite.region || 'a site'}.`
      if (topReason) s += ` Top reason: ${topReason.reason || 'unspecified'}.`
      issues.push(s)
    }
  }
  return { lines, issues }
}

export default function CostPerM3() {
  const { activeCountry } = useSettings()
  const initialCountry = activeCountry && activeCountry !== 'All' ? activeCountry : COUNTRIES[0]
  const [country, setCountry] = useState(initialCountry)
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD)
  // Calendar custom range (used only when periodKey === 'custom'). An incomplete
  // range falls back to the current-month bounds inside periodBounds.
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const bounds = useMemo(
    () => periodBounds(periodKey, new Date(), { from: customFrom, to: customTo }),
    [periodKey, customFrom, customTo],
  )

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // Date-wise monthly trend (last 12 months, independent of the period chip).
  const [trend, setTrend] = useState({ ok: false, months: [] })
  const [rejections, setRejections] = useState(null)
  const [reviewCopied, setReviewCopied] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      getCostPerM3({ country, from: bounds.from, to: bounds.to }).catch(() => null),
      getCostPerM3Trend({ country }).catch(() => ({ ok: false, months: [] })),
      getProductionRejections({ country, from: bounds.from, to: bounds.to }).catch(() => null),
    ]).then(([d, t, rej]) => {
      if (cancelled) return
      setData(d)
      setTrend(t || { ok: false, months: [] })
      setRejections(rej)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, bounds.from, bounds.to])

  useEffect(() => load(), [load])

  const currency = data?.currency || country
  const total = data?.total || null
  const regions = data?.regions || []

  const review = useMemo(
    () => buildSiteManagerReview({ regions, total, rejections, currency, label: periodLabel(bounds) }),
    [regions, total, rejections, currency, bounds],
  )
  async function copyReview() {
    const text = [
      `Cost per M3 review - ${country} - ${periodLabel(bounds)}`,
      ...review.lines.map((l) => `- ${l}`),
      ...(review.issues.length ? ['', 'Issues to action:', ...review.issues.map((i) => `- ${i}`)] : ['', 'No issues to flag this period.']),
    ].join('\n')
    try { await navigator.clipboard.writeText(text); setReviewCopied(true); setTimeout(() => setReviewCopied(false), 2000) } catch { /* ignore */ }
  }

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

  const months = trend?.months || []
  const maxGrand = months.reduce((m, r) => Math.max(m, Number(r.grand_total) || 0), 0)

  // Chart Builder catalog: region and monthly cost / production, presentation-ready.
  const studioCatalog = useMemo(() => {
    const out = []
    if (regions.length) {
      out.push({
        key: 'grand_region', label: 'Grand total by region', kind: 'flat', valueKind: 'money',
        rows: regions.map((r) => ({ label: r.region, value: Number(r.grand_total) || 0 })),
      })
      out.push({
        key: 'cpm3_region', label: 'Cost per M3 by region', kind: 'flat', valueKind: 'money',
        rows: regions.map((r) => ({ label: r.region, value: Number(r.cost_per_m3) || 0 })),
      })
      out.push({
        key: 'm3_region', label: 'Production M3 by region', kind: 'flat', valueKind: 'count',
        rows: regions.map((r) => ({ label: r.region, value: Number(r.production_m3) || 0 })),
      })
      out.push({
        key: 'split_region', label: 'Cost source by region (Internal/SCO/SANY)', kind: 'series', valueKind: 'money', allowTotal: true,
        labels: regions.map((r) => r.region),
        series: [
          { name: 'Internal', data: regions.map((r) => Number(r.internal_cost) || 0) },
          { name: 'SCO', data: regions.map((r) => Number(r.sco_cost) || 0) },
          { name: 'SANY', data: regions.map((r) => Number(r.sany_cost) || 0) },
        ],
      })
    }
    if (months.length) {
      out.push({
        key: 'grand_month', label: 'Grand total by month', kind: 'series', valueKind: 'money',
        labels: months.map((r) => r.month),
        series: [{ name: 'Grand total', data: months.map((r) => Number(r.grand_total) || 0) }],
      })
      out.push({
        key: 'cpm3_month', label: 'Cost per M3 by month', kind: 'series', valueKind: 'money',
        labels: months.map((r) => r.month),
        series: [{ name: 'Cost per M3', data: months.map((r) => Number(r.cost_per_m3) || 0) }],
      })
      out.push({
        key: 'm3_month', label: 'Production M3 by month', kind: 'series', valueKind: 'count',
        labels: months.map((r) => r.month),
        series: [{ name: 'Production M3', data: months.map((r) => Number(r.production_m3) || 0) }],
      })
    }
    return out
  }, [regions, months])

  function trendRows() {
    return months.map((r) => ({
      month: r.month,
      internal: Math.round(r.internal_cost || 0),
      tyre: Math.round(r.tyre_cost || 0),
      sco: Math.round(r.sco_cost || 0),
      sany: Math.round(r.sany_cost || 0),
      grand_total: Math.round(r.grand_total || 0),
      production_m3: Math.round(r.production_m3 || 0),
      cost_per_m3: r.cost_per_m3 == null ? 'N/A' : Number(r.cost_per_m3).toFixed(2),
    }))
  }

  function exportTrendExcel() {
    const rows = trendRows()
    if (!rows.length) return
    exportToExcel(rows,
      ['month', 'internal', 'tyre', 'sco', 'sany', 'grand_total', 'production_m3', 'cost_per_m3'],
      ['Month', `Internal (${currency})`, `Tyre (${currency})`, `SCO (${currency})`, `SANY (${currency})`, `Grand Total (${currency})`, 'Production M3', `Cost/M3 (${currency})`],
      `TyrePulse_CostPerM3_${country}_monthly`, 'Cost per M3 by month')
  }

  function exportTrendPdf() {
    const rows = trendRows()
    if (!rows.length) return
    exportToPdf(rows, [
      { key: 'month', header: 'Month' }, { key: 'internal', header: `Internal (${currency})` },
      { key: 'sco', header: `SCO (${currency})` }, { key: 'sany', header: `SANY (${currency})` },
      { key: 'grand_total', header: `Grand Total (${currency})` }, { key: 'production_m3', header: 'Production M3' },
      { key: 'cost_per_m3', header: `Cost/M3 (${currency})` },
    ], `${country} Cost per M3 - monthly detail`, `TyrePulse_CostPerM3_${country}_monthly`, 'landscape')
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
        {periodKey === 'custom' && (
          <>
            <DateField className="text-sm w-40" value={customFrom} onChange={setCustomFrom} placeholder="From date" ariaLabel="From date" max={customTo || undefined} />
            <DateField className="text-sm w-40" value={customTo} onChange={setCustomTo} placeholder="To date" ariaLabel="To date" min={customFrom || undefined} />
          </>
        )}
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{periodLabel(bounds)}</span>
      </div>

      {/* Headline card (matches the All-<country> summary) */}
      <div className="mb-6 rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        <div className="bg-[var(--accent)] text-white px-4 py-2.5 font-semibold flex items-center justify-between gap-2">
          <span>All {country}</span>
          <ExplainThisNumber metricId="cost_per_m3" country={country} label={`Cost per M3 - ${country}`} />
        </div>
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

      {/* Date-wise monthly detail (last 12 months) */}
      <div className="mt-6 rounded-xl border border-[var(--border-subtle)] p-4">
        <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Layers size={16} /> Monthly detail (last 12 months)</h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={exportTrendExcel} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs"><FileSpreadsheet size={12} /> Excel</button>
            <button type="button" onClick={exportTrendPdf} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs"><FileText size={12} /> PDF</button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-sm border-collapse">
            <thead style={{ background: 'var(--surface-raised, var(--bg-elevated))' }}>
              <tr>
                {['Month', 'Internal', 'SCO', 'SANY', 'Grand Total', 'Production M3', 'Cost/M3', 'Trend'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-semibold whitespace-nowrap ${i === 0 ? 'text-left' : i === 7 ? 'text-left' : 'text-right'}`} style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>Loading...</td></tr>
              ) : months.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>No monthly data for {country}.</td></tr>
              ) : months.map((r) => {
                const pct = maxGrand > 0 ? Math.round((Number(r.grand_total) || 0) / maxGrand * 100) : 0
                return (
                  <tr key={r.month} className="border-t border-[var(--border-subtle)]">
                    <td className="px-3 py-2 text-left tabular-nums">{r.month}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.internal_cost, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.sco_cost, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.sany_cost, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(r.grand_total, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round(r.production_m3 || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtCostPerM3(r.cost_per_m3, currency)}</td>
                    <td className="px-3 py-2">
                      <div className="h-2 w-24 rounded bg-[var(--border-subtle)] overflow-hidden">
                        <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Site-manager review: cost + production by region and the issues to flag.
          Follows the period chip, so pick "Last 7 days" for the weekly note. */}
      {!loading && (review.lines.length > 0 || review.issues.length > 0) && (
        <div className="mt-6 rounded-xl border border-[var(--border-subtle)] p-4">
          <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck size={16} /> Site manager review - {periodLabel(bounds)}</h3>
            <button type="button" onClick={copyReview}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs hover:bg-[var(--surface-hover)]">
              <Copy size={12} /> {reviewCopied ? 'Copied' : 'Copy for email'}
            </button>
          </div>
          {review.lines.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {review.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
          <p className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Issues to action</p>
          {review.issues.length > 0 ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-amber-300">
              {review.issues.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-emerald-300">No issues to flag this period.</p>
          )}
        </div>
      )}

      {/* Chart Builder - present cost / production as a chart or PowerPoint */}
      {!loading && studioCatalog.length > 0 && (
        <div className="mt-6">
          <StudioBoundary>
            <PresentationStudio
              catalog={studioCatalog}
              currency={currency}
              money={(v) => fmtMoney(v, currency)}
              scope={country}
              filePrefix="Cost per M3"
              showInsights
              note="Present cost per M3, cost source and production as a chart, with talking points, then copy, download a PNG, or export a PowerPoint deck."
            />
          </StudioBoundary>
        </div>
      )}
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
