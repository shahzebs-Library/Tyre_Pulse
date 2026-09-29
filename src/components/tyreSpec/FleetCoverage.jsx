/**
 * Fleet coverage: which brand + size combinations the fleet actually runs
 * (tyre_records, via RPC get_tyre_brand_size_mix) and whether the shared
 * catalogue (tyre_spec_catalog) holds an approved spec for each. A row opens a
 * side drawer with every matching catalogue spec and its published source.
 *
 * The coverage join is pure (coverageRows in src/lib/tyreSpecView.js); this
 * component only loads, filters, pages and exports it. A failed read shows an
 * error with Retry, never an empty table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Layers, CheckCircle2, Clock3, AlertTriangle, Percent, ExternalLink, FileSpreadsheet } from 'lucide-react'
import { Card, CardState, KitTable, Kpi, Pager, fmtInt } from '../commandCenter/kit'
import SideDrawer from '../ui/SideDrawer'
import { listFleetBrandSizeMix } from '../../lib/api/tyreSpecCatalog'
import {
  coverageRows, coverageKpis, filterCoverage, EMPTY_COVERAGE_FILTERS, COVERAGE_META,
  clampPage, pageSlice, catalogLoadLabel, catalogSpeedLabel, catalogTypeLabel, approvalMeta,
} from '../../lib/tyreSpecView'
import { safeHref } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

const PAGE_SIZES = [10, 25, 50, 100]
const NA = <span className="cc-na">N/A</span>

function CoveragePill({ status }) {
  const m = COVERAGE_META[status] || COVERAGE_META.none
  return <span className={`cc-pill ${m.tone}`}>{m.label}</span>
}

function SourceLink({ url }) {
  const href = safeHref(url)
  if (!href) return <span className="cc-na">Not recorded</span>
  let host = href
  try { host = new URL(href).hostname.replace(/^www\./, '') } catch { /* keep raw */ }
  return (
    <a className="cc-link ts-source" href={href} target="_blank" rel="noopener noreferrer">
      {host} <ExternalLink size={12} aria-hidden="true" />
    </a>
  )
}

export default function FleetCoverage({ country, catalog, catalogError, onOpenSpec }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const [filters, setFilters] = useState(EMPTY_COVERAGE_FILTERS)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    listFleetBrandSizeMix({ country })
      .then((d) => { if (live) setState({ loading: false, data: d, error: null }) })
      .catch((e) => { if (live) setState({ loading: false, data: null, error: toUserMessage(e, 'Could not load the fleet brand and size mix.') }) })
    return () => { live = false }
  }, [country, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const rows = useMemo(() => (state.data ? coverageRows(state.data, catalog) : []), [state.data, catalog])
  const kpis = useMemo(() => coverageKpis(rows), [rows])
  const filtered = useMemo(() => filterCoverage(rows, filters), [rows, filters])
  const countries = useMemo(() => [...new Set(rows.map((r) => r.country).filter(Boolean))].sort(), [rows])
  const safePage = clampPage(page, filtered.length, pageSize)
  const pageRows = useMemo(() => pageSlice(filtered, safePage, pageSize), [filtered, safePage, pageSize])
  const open = openId ? rows.find((r) => r.id === openId) : null

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0) }
  const pickStatus = (s) => setFilter('status', filters.status === s ? '' : s)

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const out = filtered.map((r) => ({
      Country: r.country || '',
      Brand: r.brand,
      Size: r.size,
      'Tyre records': r.tyres,
      'Active tyres': r.active ?? '',
      'Last fitted': r.lastFitted || '',
      Coverage: COVERAGE_META[r.status].label,
      'Catalogue patterns': r.patterns.join(', '),
      'Source URLs': r.specs.map((s) => s.source_url).filter(Boolean).join(' '),
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      Report: 'Tyre specification coverage of the fleet',
      Scope: country || 'All countries',
      'Combinations included': filtered.length,
      'Tyres covered by an approved spec (%)': kpis.tyreSharePct == null ? 'N/A' : kpis.tyreSharePct.toFixed(1),
    }]), 'Report Scope')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), 'Coverage')
    XLSX.writeFile(wb, 'TyrePulse_Tyre_Spec_Coverage.xlsx')
  }

  const columns = [
    { key: 'country', header: 'Country', cell: (r) => r.country || NA },
    { key: 'brand', header: 'Brand', cell: (r) => <span className="ts-strong">{r.brand}</span> },
    { key: 'size', header: 'Size', cell: (r) => r.size },
    { key: 'tyres', header: 'Tyre records', align: 'right', cell: (r) => fmtInt(r.tyres) },
    { key: 'patterns', header: 'Catalogue patterns', cell: (r) => (r.patterns.length ? r.patterns.join(', ') : NA) },
    { key: 'status', header: 'Coverage', cell: (r) => <CoveragePill status={r.status} /> },
  ]

  return (
    <div className="ts-main">
      <div className="cc-kpis ts-cov-kpis">
        <Kpi icon={Layers} tone="t-blue" value={kpis.combos} label="Brand and size combinations in the fleet" loading={state.loading && !state.data} onClick={() => setFilter('status', '')} />
        <Kpi icon={CheckCircle2} tone="t-green" value={kpis.approved} label="Covered by an approved spec" loading={state.loading && !state.data} onClick={() => pickStatus('approved')} />
        <Kpi icon={Clock3} tone="t-orange" value={kpis.pending} label="Spec awaiting approval" loading={state.loading && !state.data} onClick={() => pickStatus('pending')} />
        <Kpi icon={AlertTriangle} tone="t-red" value={kpis.none} label="No spec in catalogue" loading={state.loading && !state.data} onClick={() => pickStatus('none')} />
        <Kpi icon={Percent} tone="t-green" display={kpis.tyreSharePct == null ? 'N/A' : `${kpis.tyreSharePct.toFixed(1)}%`} label="Tyres covered by an approved spec" loading={state.loading && !state.data} />
      </div>

      <Card
        title="Fleet coverage"
        sub="Every brand and size the fleet runs, checked against the shared specification catalogue. Click a row for the specs and their sources."
        action={(
          <button type="button" className="cc-btn-ghost" onClick={exportExcel} disabled={!filtered.length}>
            <FileSpreadsheet size={14} aria-hidden="true" /> Export Excel
          </button>
        )}
      >
        {catalogError && <p className="ts-err" role="alert">The catalogue could not be read, so coverage is shown as unknown until it loads. {catalogError}</p>}
        <div className="cc-filters">
          <label className="cc-field"><span>Country</span>
            <select className="cc-select" value={filters.country} onChange={(e) => setFilter('country', e.target.value)}>
              <option value="">All countries</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="cc-field"><span>Coverage</span>
            <select className="cc-select" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All</option>
              {Object.values(COVERAGE_META).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <div className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input value={filters.search} onChange={(e) => setFilter('search', e.target.value)}
              placeholder="Search brand, size, pattern..." aria-label="Search coverage" />
          </div>
        </div>
        <CardState
          state={{ ...state, retry }}
          lines={5}
          empty={!state.loading && !state.error && state.data && filtered.length === 0
            ? (rows.length ? 'No combinations match the current filters.' : 'No tyre records with both a brand and a size are recorded in this scope.')
            : null}
        >
          <div className="ts-scroll-x">
            <KitTable className="ts-table" manualPagination showPagination={false} enableSorting={false}
              pageIndex={0} pageSize={pageSize} pageCount={1} totalRows={pageRows.length}
              getRowId={(r) => r.id} onRowClick={(r) => r && setOpenId(r.id)}
              rows={pageRows} columns={columns} />
          </div>
          <Pager page={safePage} pageSize={pageSize} total={filtered.length} noun="combinations"
            onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0) }} sizes={PAGE_SIZES} />
        </CardState>
        <p className="ts-note">
          Brand spelling is folded (DOUBLE COIN and DOUBLECOIN match) but a different spelling such as ERICLE is not merged with ERACLE. A catalogue row for another country does not count as coverage.
        </p>
      </Card>

      <SideDrawer open={Boolean(open)} onClose={() => setOpenId(null)} size="lg"
        title={open ? `${open.brand} ${open.size}` : ''}
        subtitle={open ? `${open.country || 'All countries'} | ${fmtInt(open.tyres)} tyre records` : ''}>
        {open && (
          <div className="ts-stack">
            <div><CoveragePill status={open.status} /></div>
            <dl className="ts-details">
              <div><dt>Tyre records</dt><dd>{fmtInt(open.tyres)}</dd></div>
              <div><dt>Active tyres</dt><dd>{open.active == null ? 'N/A' : fmtInt(open.active)}</dd></div>
              <div><dt>Last fitted</dt><dd>{open.lastFitted ? new Date(open.lastFitted).toLocaleDateString() : 'N/A'}</dd></div>
            </dl>
            {open.specs.length === 0 ? (
              <div className="cc-empty">No catalogue specification describes this brand and size yet. Add one on the Catalogue tab so every page can use it.</div>
            ) : open.specs.map((s) => (
              <Card key={s.id}
                title={<span>{s.pattern} <span className="ts-muted">{s.country || 'All countries'}</span></span>}
                sub={<span className={`cc-pill ${approvalMeta(s.approval_status).tone}`}>{approvalMeta(s.approval_status).label}</span>}
                action={onOpenSpec && (
                  <button type="button" className="cc-btn-ghost" onClick={() => { setOpenId(null); onOpenSpec(s.id) }}>Open in catalogue</button>
                )}
              >
                <dl className="ts-details">
                  <div><dt>Type</dt><dd>{catalogTypeLabel(s.tyre_type) || 'Not recorded'}</dd></div>
                  <div><dt>Load index</dt><dd>{catalogLoadLabel(s)}</dd></div>
                  <div><dt>Speed</dt><dd>{catalogSpeedLabel(s)}</dd></div>
                  <div><dt>Ply rating</dt><dd>{s.ply_rating || 'Not recorded'}</dd></div>
                  <div><dt>Tread depth (new)</dt><dd>{s.tread_depth_new_mm == null ? 'Not recorded' : `${s.tread_depth_new_mm} mm`}</dd></div>
                  <div><dt>Max load single/dual</dt><dd>{s.max_load_single_kg == null ? 'Not recorded' : `${fmtInt(s.max_load_single_kg)}${s.max_load_dual_kg == null ? '' : ` / ${fmtInt(s.max_load_dual_kg)}`} kg`}</dd></div>
                  <div className="ts-wide"><dt>Source</dt><dd><SourceLink url={s.source_url} /></dd></div>
                  {s.source_note && <div className="ts-wide"><dt>Source note</dt><dd>{s.source_note}</dd></div>}
                </dl>
              </Card>
            ))}
          </div>
        )}
      </SideDrawer>
    </div>
  )
}
