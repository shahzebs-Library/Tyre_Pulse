/**
 * ConsoleMetricCatalogue.jsx - the governed metric registry.
 *
 * Every KPI in the product has exactly one definition here: one owner, one
 * source table, one versioned formula. Dashboards reference these rows rather
 * than each re-deriving a number, which is how two screens stop disagreeing
 * about "cost per km". This page is the read-only window onto that registry:
 * find a metric, see its full definition, and read its formula history.
 *
 * Navy/orange console kit only (gray-* / orange-* class families) so it stays
 * dark for light-mode users. ASCII only. Honest empty/error states - a metric
 * with no versions is not the same as a registry we could not read.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ruler, RefreshCw, ChevronRight, Database, GitBranch } from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Btn, Table, THead, Th, Tr, Td,
  SearchInput, Toolbar, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { listMetrics, getMetric } from '../../lib/api/metricRegistry'
import { fmtList } from '../../lib/metricExplain'
import { toUserMessage } from '../../lib/safeError'

const na = (v) => (v === null || v === undefined || v === '' ? 'N/A' : String(v))

/* A registry row exposes snake_case columns; read them tolerantly so a schema
   tweak does not blank the whole table. */
const field = (row, ...keys) => {
  for (const k of keys) {
    const val = row?.[k]
    if (val !== null && val !== undefined && val !== '') return val
  }
  return null
}

const dashCount = (row) => {
  const d = field(row, 'dashboards')
  return Array.isArray(d) ? d.length : (d ? 1 : 0)
}

/* One labelled fact in the detail panel. */
function Detail({ label, value, mono = false, full = false }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500 mb-0.5">{label}</dt>
      <dd className={`text-sm text-gray-200 break-words ${mono ? 'font-mono text-xs' : ''}`}>
        {na(value)}
      </dd>
    </div>
  )
}

export default function ConsoleMetricCatalogue() {
  const [state, setState] = useState({ loading: true, error: null, rows: [] })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null) // metric id
  const [detail, setDetail] = useState({ loading: false, error: null, data: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const rows = await listMetrics()
      setState({ loading: false, error: null, rows: Array.isArray(rows) ? rows : [] })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), rows: [] })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openDetail = useCallback(async (id) => {
    if (!id) return
    setSelected(id)
    setDetail({ loading: true, error: null, data: null })
    try {
      const data = await getMetric(id)
      setDetail({ loading: false, error: null, data })
    } catch (e) {
      setDetail({ loading: false, error: toUserMessage(e), data: null })
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = state.rows
    if (!q) return rows
    return rows.filter((r) => {
      const hay = [
        field(r, 'name'),
        field(r, 'metric_id', 'id'),
        field(r, 'business_owner', 'owner'),
        field(r, 'source_table'),
        field(r, 'source_module'),
        field(r, 'unit'),
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [state.rows, query])

  const metric = detail.data?.metric || null
  const versions = Array.isArray(detail.data?.versions) ? detail.data.versions : []

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={Ruler}
          title="Metric Catalogue"
          subtitle="Every KPI has one governed, versioned definition. All dashboards reference these."
          actions={<Btn icon={RefreshCw} onClick={load} busy={state.loading}>Refresh</Btn>}
        />

        <div className="px-4 pb-4 space-y-3">
          <Toolbar>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search by name, id, owner or source table"
              className="w-full sm:w-96"
            />
            {!state.loading && !state.error && (
              <span className="text-xs text-gray-500">
                {filtered.length} of {state.rows.length} metrics
              </span>
            )}
          </Toolbar>

          {state.loading && <LoadingState label="Reading the metric registry" rows={6} />}
          {!state.loading && state.error && <ErrorState message={state.error} onRetry={load} />}

          {!state.loading && !state.error && (
            state.rows.length === 0 ? (
              <EmptyState
                icon={Ruler}
                title="No metrics registered yet"
                reason="The governed metric registry is empty, or this database does not carry it yet."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Ruler}
                title="No metrics match your search"
                reason="No metric name, id, owner or source table contains that text."
              />
            ) : (
              <Table>
                <THead>
                  <Th>Metric</Th>
                  <Th>ID</Th>
                  <Th>Owner</Th>
                  <Th>Unit</Th>
                  <Th>Source table</Th>
                  <Th>Refresh SLA</Th>
                  <Th align="right">Dashboards</Th>
                  <Th align="right"></Th>
                </THead>
                <tbody>
                  {filtered.map((r) => {
                    const id = field(r, 'metric_id', 'id')
                    const on = id === selected
                    return (
                      <Tr key={id || field(r, 'name')} onClick={() => openDetail(id)} className={on ? 'bg-orange-950/20' : ''}>
                        <Td><span className="font-medium text-gray-100">{na(field(r, 'name'))}</span></Td>
                        <Td nowrap><span className="font-mono text-[11px] text-gray-400">{na(id)}</span></Td>
                        <Td>{na(field(r, 'business_owner', 'owner'))}</Td>
                        <Td>{na(field(r, 'unit'))}</Td>
                        <Td nowrap><span className="font-mono text-[11px] text-gray-400">{na(field(r, 'source_table'))}</span></Td>
                        <Td>{na(field(r, 'refresh_sla'))}</Td>
                        <Td align="right"><span className="tabular-nums text-gray-300">{dashCount(r)}</span></Td>
                        <Td align="right"><ChevronRight size={14} className="text-gray-600 inline" /></Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            )
          )}
        </div>
      </Panel>

      {/* ── detail ────────────────────────────────────────────────────────── */}
      {selected && (
        <Panel>
          <PanelHeader
            icon={Database}
            title={metric ? na(field(metric, 'name')) : 'Metric definition'}
            subtitle={metric ? na(field(metric, 'metric_id', 'id')) : selected}
            actions={<Btn onClick={() => { setSelected(null); setDetail({ loading: false, error: null, data: null }) }}>Close</Btn>}
          />

          <div className="px-4 pb-4 space-y-4">
            {detail.loading && <LoadingState label="Reading the metric definition" rows={4} />}
            {!detail.loading && detail.error && <ErrorState message={detail.error} onRetry={() => openDetail(selected)} />}

            {!detail.loading && !detail.error && metric && (
              <>
                {field(metric, 'description') && (
                  <Note>{field(metric, 'description')}</Note>
                )}

                {/* definition + source */}
                <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                  <h4 className="text-xs font-semibold text-gray-300 mb-2.5">Definition &amp; source</h4>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                    <Detail label="Business owner" value={field(metric, 'business_owner', 'owner')} />
                    <Detail label="Unit" value={field(metric, 'unit')} />
                    <Detail label="Source module" value={field(metric, 'source_module')} />
                    <Detail label="Source table" value={field(metric, 'source_table')} mono />
                    <Detail label="Source columns" value={fmtList(field(metric, 'source_columns'))} mono full />
                    <Detail label="Date field" value={field(metric, 'date_field')} mono />
                    <Detail label="Date logic" value={field(metric, 'date_logic')} />
                    <Detail label="Currency handling" value={field(metric, 'currency_handling')} full />
                    <Detail label="Null handling" value={field(metric, 'null_handling')} full />
                    <Detail label="Duplicate handling" value={field(metric, 'duplicate_handling')} full />
                    <Detail label="Included statuses" value={fmtList(field(metric, 'included_statuses'))} full />
                    <Detail label="Excluded statuses" value={fmtList(field(metric, 'excluded_statuses'))} full />
                    <Detail label="Joins" value={field(metric, 'joins')} full />
                    <Detail label="Transformations" value={field(metric, 'transformations')} full />
                    <Detail label="Refresh SLA" value={field(metric, 'refresh_sla')} />
                    <Detail label="Calc reference" value={field(metric, 'calc_ref')} mono />
                    <Detail label="Dashboards" value={fmtList(field(metric, 'dashboards'))} full />
                  </dl>
                </div>

                {/* versions */}
                <div>
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 mb-2">
                    <GitBranch size={13} className="text-orange-400" />
                    Formula history
                  </h4>
                  {versions.length === 0 ? (
                    <EmptyState
                      icon={GitBranch}
                      title="No formula versions recorded"
                      reason="This metric has a definition but no approved formula version yet."
                    />
                  ) : (
                    <Table>
                      <THead>
                        <Th align="right">Ver</Th>
                        <Th>Formula</Th>
                        <Th>Effective from</Th>
                        <Th>Owner</Th>
                        <Th>Approver</Th>
                        <Th>Change note</Th>
                      </THead>
                      <tbody>
                        {versions.map((v, i) => (
                          <Tr key={field(v, 'version', 'id') ?? i}>
                            <Td align="right"><span className="tabular-nums text-gray-300">{na(field(v, 'version'))}</span></Td>
                            <Td><span className="font-mono text-[11px] text-gray-300">{na(field(v, 'formula'))}</span></Td>
                            <Td nowrap>{na(field(v, 'effective_from'))}</Td>
                            <Td>{na(field(v, 'owner'))}</Td>
                            <Td>
                              {field(v, 'approver')
                                ? <Badge tone="good">{field(v, 'approver')}</Badge>
                                : <span className="text-gray-500">N/A</span>}
                            </Td>
                            <Td>{na(field(v, 'change_note'))}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </div>
              </>
            )}
          </div>
        </Panel>
      )}
    </div>
  )
}
