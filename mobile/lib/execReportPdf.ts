/**
 * execReportPdf - build the executive report PDF from ONE server snapshot.
 *
 * This is deliberately separate from inspectionReportPdf.ts: it renders ONLY from a
 * ReportSnapshot (see lib/reportSnapshot.ts), which is the same server-computed
 * object that drives the on-screen report. Passing the identical snapshot to the
 * screen and to this builder guarantees screen == PDF == web report - one dataset,
 * one set of KPI values, one generated_at, one company / branding.
 *
 * It runs NO queries of its own. No em/en dashes in output (ASCII only), honest
 * "N/A" for values the server could not compute (e.g. cost per km with no meter data).
 */

import type { ReportSnapshot } from './reportSnapshot'

export interface ExecReportOptions {
  /** Currency label for money values (defaults to SAR to match the app). */
  currency?: string
  /** Language tag for number/date localisation of the printed figures. */
  language?: string
  /** Whether the caller is elevated (all sites) or scoped to a single site. */
  elevated?: boolean
}

function esc(v: any): string {
  return v == null
    ? 'N/A'
    : String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function fmtInt(n: number, locale: string): string {
  return Number(n || 0).toLocaleString(locale, { maximumFractionDigits: 0 })
}

function money(n: number | null | undefined, currency: string, locale: string): string {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A'
  return currency + ' ' + Number(n).toLocaleString(locale, { maximumFractionDigits: 0 })
}

function perUnit(n: number | null | undefined, currency: string, unit: string, locale: string): string {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A'
  return currency + ' ' + Number(n).toLocaleString(locale, { maximumFractionDigits: 2 }) + ' / ' + unit
}

function fmtDateTime(iso: string, locale: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return esc(iso)
  try {
    return d.toLocaleString(locale)
  } catch {
    return d.toLocaleString()
  }
}

const CSS = `
  * { font-family: -apple-system, Helvetica, Arial, sans-serif; box-sizing: border-box; }
  body { color: #0f172a; padding: 24px; font-size: 12px; margin: 0; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
  .brand img { height: 38px; max-width: 160px; object-fit: contain; }
  h1  { font-size: 20px; margin: 0; color: #0f172a; }
  h2  { font-size: 13px; color: #16a34a; border-bottom: 2px solid #dcfce7; padding-bottom: 4px; margin: 20px 0 8px; }
  .sub { color: #64748b; font-size: 11px; margin: 4px 0 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #f8fafc; padding: 6px 8px; text-align: left; font-size: 11px; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
  td.n { text-align: right; }
  .kpis { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
  .kpi  { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; min-width: 120px; }
  .kpi-v { font-size: 22px; font-weight: 800; color: #0f172a; }
  .kpi-l { font-size: 11px; color: #64748b; margin-top: 2px; }
  footer { margin-top: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 10px; }
  .note { font-size: 10px; color: #94a3b8; margin-top: 2px; }
`

function breakdownTable(title: string, rows: { label: string; value: number }[] | null, locale: string): string {
  if (!rows || rows.length === 0) {
    return `<h2>${esc(title)}</h2><p class="note">No data for the selected range.</p>`
  }
  return `<h2>${esc(title)}</h2>
    <table><tr><th>Category</th><th class="n">Count</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="n">${fmtInt(r.value, locale)}</td></tr>`).join('')}
    </table>`
}

/**
 * Build the executive report HTML entirely from the given server snapshot.
 * The SAME snapshot must be the one rendered on screen so the two never disagree.
 */
export function buildExecReportHtml(snapshot: ReportSnapshot, opts: ExecReportOptions = {}): string {
  const currency = opts.currency ?? 'SAR'
  const locale = opts.language === 'ar' ? 'ar' : opts.language === 'ur' ? 'ur' : 'en'
  const k = snapshot.kpis
  const c = snapshot.cost

  const scope = opts.elevated === false
    ? (snapshot.filters.site ? 'Site: ' + esc(snapshot.filters.site) : 'Your site')
    : 'All sites'
  const range = (snapshot.filters.from || snapshot.filters.to)
    ? `${esc(snapshot.filters.from ?? 'start')} to ${esc(snapshot.filters.to ?? 'today')}`
    : 'All dates'

  const logo = snapshot.logo && /^https?:\/\//i.test(snapshot.logo)
    ? `<img src="${esc(snapshot.logo)}" alt="logo" />`
    : ''

  // Cost trend summary (server-computed 12-month total-cost series).
  const trendTotal = c.trend.total ?? []
  const labels = snapshot.labels ?? []
  const trendRows = labels.length && trendTotal.length
    ? labels.map((lbl, i) => `<tr><td>${esc(lbl)}</td><td class="n">${money(trendTotal[i] ?? 0, currency, locale)}</td></tr>`).join('')
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"/><style>${CSS}</style></head><body>
    <div class="brand">${logo}<h1>Executive Report</h1></div>
    <p class="sub">${esc(snapshot.company)} | ${scope} | ${range}<br/>
      Server snapshot generated ${fmtDateTime(snapshot.generated_at, locale)}</p>

    <div class="kpis">
      <div class="kpi"><div class="kpi-v">${fmtInt(k.fleet, locale)}</div><div class="kpi-l">Fleet Vehicles</div></div>
      <div class="kpi"><div class="kpi-v">${fmtInt(k.tyres, locale)}</div><div class="kpi-l">Tyre Records</div></div>
      <div class="kpi"><div class="kpi-v">${money(k.tyre_spend, currency, locale)}</div><div class="kpi-l">Tyre Spend</div></div>
      <div class="kpi"><div class="kpi-v">${fmtInt(k.accidents, locale)}</div><div class="kpi-l">Accidents</div></div>
      <div class="kpi"><div class="kpi-v">${fmtInt(k.open_accidents, locale)}</div><div class="kpi-l">Open Accidents</div></div>
      <div class="kpi"><div class="kpi-v">${fmtInt(k.inspections, locale)}</div><div class="kpi-l">Inspections</div></div>
      <div class="kpi"><div class="kpi-v">${fmtInt(k.work_orders_open, locale)}</div><div class="kpi-l">Open Work Orders</div></div>
      <div class="kpi"><div class="kpi-v">${money(k.claims_recovered, currency, locale)}</div><div class="kpi-l">Claims Recovered</div></div>
    </div>

    <h2>Operating Cost (${esc(c.from ?? 'start')} to ${esc(c.to ?? 'today')})</h2>
    <table>
      <tr><th>Metric</th><th class="n">Value</th></tr>
      <tr><td>Tyre cost</td><td class="n">${money(c.tyre_cost, currency, locale)}</td></tr>
      <tr><td>Maintenance cost</td><td class="n">${money(c.maintenance_cost, currency, locale)}</td></tr>
      <tr><td>Total cost</td><td class="n"><b>${money(c.total_cost, currency, locale)}</b></td></tr>
      <tr><td>Cost per km</td><td class="n">${perUnit(c.cost_per_km, currency, 'km', locale)}</td></tr>
      <tr><td>Cost per engine hour</td><td class="n">${perUnit(c.cost_per_hour, currency, 'hr', locale)}</td></tr>
      <tr><td>Cost per m3</td><td class="n">${perUnit(c.cost_per_m3, currency, 'm3', locale)}</td></tr>
      <tr><td>Tyre CPK</td><td class="n">${perUnit(c.tyre_cpk, currency, 'km', locale)}</td></tr>
    </table>
    <p class="note">Per-unit figures show N/A when no meter or production data exists for the window (never estimated).</p>

    ${breakdownTable('Accidents by Severity', snapshot.breakdowns.severity, locale)}
    ${breakdownTable('Tyre Records by Site', snapshot.breakdowns.tyres_by_site, locale)}
    ${breakdownTable('Claims by Status', snapshot.breakdowns.claim_status, locale)}

    ${trendRows ? `<h2>Total Cost Trend (12 months)</h2>
      <table><tr><th>Month</th><th class="n">Total Cost</th></tr>${trendRows}</table>` : ''}

    <footer>${esc(snapshot.company)} | Executive Report | single server snapshot generated ${fmtDateTime(snapshot.generated_at, locale)}. Figures match the web executive report for the same filters.</footer>
  </body></html>`
}
