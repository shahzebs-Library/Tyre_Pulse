import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapPin, AlertTriangle, Info, RefreshCw } from 'lucide-react'
import { getSiteOperatingCostMulti, storeVsOperating } from '../../lib/api/siteOperatingCost'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import { compareValues, isBlank } from '../../lib/consoleTable'
import EnterpriseTable from '../ui/EnterpriseTable'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (isBlank(v) ? undefined : v)
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? undefined : Number(v))
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const EXPORT_KEYS = ['site', 'country', 'currency', 'total', 'tyre', 'spare', 'oil', 'lines', 'assets']
const EXPORT_HEADS = ['Site', 'Country', 'Currency', 'Total', 'Tyres', 'Spare parts', 'Oil', 'Lines', 'Assets']

/**
 * What each site costs to RUN, as opposed to which store issued the parts.
 *
 * The two are not the same and the difference is large. The -ST names are spare
 * parts stores, so an expense line's own site says where stock was drawn from.
 * Diriyah's store issued SAR 729,121 while only SAR 2,335 of work happened at a
 * site called DIRIYAH - the machines are at DIRIYAH-G1 and G2 and draw from the
 * one store that serves them.
 *
 * This reads cost through the asset instead, which is the only way to answer
 * "what does this gate cost me". It publishes its own coverage: a per-site total
 * that quietly omits unmatched lines is a figure nobody can reconcile.
 */
export default function SiteOperatingCostPanel({ country, from, to, money }) {
  const [state, setState] = useState({ loading: true, ok: false, error: '' })
  const [showStores, setShowStores] = useState(false)

  // A single country only. Each country reports in its own currency, so a
  // combined site table would add SAR, AED and EGP and mean nothing.
  const isAll = !country || country === 'All'

  // Read through the scope-aware aggregate even for one country (V544). The
  // single-country function it wraps has no country ABAC guard - asked for a
  // country the caller may not see it answers anyway - so going through the
  // guarded wrapper means this panel can never render a country the reader is
  // not entitled to, whatever it is handed. `strict` makes a failed read throw
  // so it can be shown as a failure instead of vanishing like "no data".
  const load = useCallback(async () => {
    if (isAll) { setState({ loading: false, ok: false, error: '' }); return }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await getSiteOperatingCostMulti({ countries: [country], from, to, strict: true })
      const block = res.blocks[0]
      setState(block
        ? { loading: false, ok: true, error: '', coverage: block.coverage, bySite: block.bySite, byStore: block.byStore, currency: block.currency }
        : { loading: false, ok: false, error: '' })
    } catch (e) {
      setState({ loading: false, ok: false, error: toUserMessage(e, 'Could not load the cost per site.') })
    }
  }, [country, from, to, isAll])

  useEffect(() => { load() }, [load])

  const gaps = useMemo(
    () => storeVsOperating(state.bySite, state.byStore).filter((g) => g.gap == null || Math.abs(g.gap) > 1000),
    [state.bySite, state.byStore],
  )
  const rows = useMemo(() => (state.bySite || []).filter((r) => !isAll || r.resolved), [state.bySite, isAll])
  const kpis = useMemo(() => {
    const resolved = rows.filter((r) => r.resolved)
    const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0)
    const top = resolved.slice().sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))[0] || null
    return { sites: resolved.length, total: rows.length ? total : null, top }
  }, [rows])

  const siteColumns = useMemo(() => [
    {
      id: 'site', header: 'Site', accessorFn: (r) => blank(r.site), ...sortable,
      cell: ({ row: { original: r } }) => (
        <span style={{ color: r.resolved ? 'var(--text-primary)' : 'var(--text-dim)' }}>
          {r.site}
          {!r.resolved && <span className="ml-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>no asset on the job card</span>}
        </span>
      ),
    },
    ...[['total', 'Total'], ['tyre', 'Tyres'], ['spare', 'Spare parts'], ['oil', 'Oil']].map(([key, header]) => ({
      id: key, header, accessorFn: (r) => num(r[key]), ...sortable,
      meta: { align: 'right', exportValue: (r) => num(r[key]) ?? 'N/A' },
      cell: ({ row: { original: r } }) => <span className="tabular-nums">{money(r[key])}</span>,
    })),
    {
      id: 'assets', header: 'Assets', accessorFn: (r) => (r.assets ? Number(r.assets) : undefined), ...sortable,
      meta: { align: 'right', exportValue: (r) => (r.assets ? r.assets : 'N/A') },
      cell: ({ row: { original: r } }) => <span className="tabular-nums">{r.assets ? Number(r.assets).toLocaleString() : 'N/A'}</span>,
    },
  ], [money])

  const storeColumns = useMemo(() => [
    { id: 'name', header: 'Store', accessorFn: (g) => blank(g.name), ...sortable },
    {
      id: 'issued', header: 'Issued from here', accessorFn: (g) => num(g.issued), ...sortable,
      meta: { align: 'right' }, cell: ({ row: { original: g } }) => <span className="tabular-nums">{money(g.issued)}</span>,
    },
    {
      id: 'worked', header: 'Work done here', accessorFn: (g) => num(g.worked), ...sortable,
      meta: { align: 'right', exportValue: (g) => (g.worked == null ? 'Serves other sites' : g.worked) },
      // Null is not zero: no asset is registered at a site of this name at all,
      // so it serves other sites entirely.
      cell: ({ row: { original: g } }) => (g.worked == null
        ? <span style={{ color: 'var(--text-dim)' }}>serves other sites</span>
        : <span className="tabular-nums">{money(g.worked)}</span>),
    },
  ], [money])

  const heading = (
    <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
      <MapPin size={15} aria-hidden="true" /> What each site costs to run
    </h2>
  )

  if (isAll) {
    return (
      <section className="space-y-3">
        {heading}
        <p className="card text-xs flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
          Pick a single country. Each country reports in its own currency, so one
          combined column would add SAR, AED and EGP together.
        </p>
      </section>
    )
  }

  if (state.loading) {
    return (
      <section className="card" aria-busy="true">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Working out what each site costs...</p>
      </section>
    )
  }

  if (state.error) {
    return (
      <section className="space-y-3">
        {heading}
        <div role="alert" className="card flex flex-wrap items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <AlertTriangle size={15} className="shrink-0 text-red-500" aria-hidden="true" />
          <span className="flex-1 min-w-[12rem]">{state.error} The cost per site is not known, which is not the same as zero.</span>
          <button type="button" onClick={load} className="btn-secondary text-xs min-h-[44px] inline-flex items-center gap-1.5">
            <RefreshCw size={13} aria-hidden="true" /> Retry
          </button>
        </div>
      </section>
    )
  }

  // Silently absent rather than broken when the backend predates V512.
  if (!state.ok) return null

  const cov = state.coverage
  const cur = state.currency || ''
  const fileBase = reportFileName('Cost per site', country)
  const exportRows = () => rows.map((r) => ({
    site: r.site, country: r.country, currency: r.currency || cur,
    total: num(r.total) ?? 'N/A', tyre: num(r.tyre) ?? 'N/A', spare: num(r.spare) ?? 'N/A', oil: num(r.oil) ?? 'N/A',
    lines: num(r.lines) ?? 'N/A', assets: r.assets ? r.assets : 'N/A',
  }))
  const downloadExcel = () => exportToExcel(exportRows(), EXPORT_KEYS, EXPORT_HEADS, fileBase)
  const downloadPdf = () => exportToPdf(exportRows(), EXPORT_KEYS.map((k, i) => ({ key: k, header: EXPORT_HEADS[i] })),
    `What each site costs to run (${country})`, fileBase, 'landscape')

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {heading}
        <div className="flex gap-2">
          <button type="button" onClick={downloadExcel} disabled={!rows.length} className="btn-secondary text-xs min-h-[44px]">Excel</button>
          <button type="button" onClick={downloadPdf} disabled={!rows.length} className="btn-secondary text-xs min-h-[44px]">PDF</button>
        </div>
      </div>

      <div className="card space-y-3">
        <p className="text-xs flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          Cost is counted against the site the machine works at, found through its job card.
          The store on an expense line is where the parts were issued from, which is a different
          question - a store can serve several sites.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[
            ['Sites with traced cost', kpis.sites.toLocaleString()],
            [`Total${cur ? ` (${cur})` : ''}`, kpis.total == null ? 'N/A' : money(kpis.total)],
            ['Highest cost site', kpis.top ? kpis.top.site : 'N/A'],
            ['Lines traced to an asset', cov?.pct == null ? 'N/A' : `${cov.pct}%`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg p-3" style={{ background: 'var(--surface-raised)' }}>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</p>
              <p className="text-base font-semibold tabular-nums truncate" style={{ color: 'var(--text-primary)' }} title={String(value)}>{value}</p>
            </div>
          ))}
        </div>

        {cov?.pct != null && (
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {Number(cov.resolved).toLocaleString()} of {Number(cov.lines).toLocaleString()} expense lines
            ({cov.pct}%) could be traced to an asset.
            {cov.unresolved > 0
              ? ` ${Number(cov.unresolved).toLocaleString()} could not and are listed separately below.`
              : ''}
          </p>
        )}

        <EnterpriseTable columns={siteColumns} data={rows} getRowId={(r) => `${r.country}-${r.site}`}
          searchPlaceholder="Search site..." enableColumnFilters={false} enableExport={false}
          emptyMessage="No expense lines in this period." />

        {gaps.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowStores((v) => !v)} aria-expanded={showStores}
              className="btn-secondary text-xs min-h-[44px]">
              {showStores ? 'Hide' : 'Show'} which store served which site
            </button>
            {showStores && (
              <div className="mt-3">
                <EnterpriseTable columns={storeColumns} data={gaps} getRowId={(g) => String(g.name)}
                  searchPlaceholder="Search store..." enableColumnFilters={false}
                  exportFileName={reportFileName('Store versus site cost', country)} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
