import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, Info, Activity, Users, Clock, ListFilter, Plus, Trash2, MessageSquare,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Code, Modal, Segmented,
} from '../components/ui'
import { sortRows, useTableSort } from '../../lib/consoleTable'
import { TrendChart, ShareChart, BarsChart } from '../components/ui/charts'
import { dailySeries, topShare } from '../../lib/consoleCharts'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  AUDIT_SOURCES, listDataAudit, listAccessAudit, listConsoleAudit, countAccessReasons,
} from '../../lib/api/auditTrail'
import {
  QUERY_FIELDS, QUERY_OPS, parseQuery, toQueryString, filterByQuery, reasonCoverageText,
} from '../../lib/auditQuery'
import { toUserMessage } from '../../lib/safeError'
import ExportButtons from './shared/ExportButtons'
import { PageHeader, TabBar, useUrlTab, usePaged, Pager, SideDrawer, Field } from './shared/pageKit'

// Read-only unified audit viewer (Module 6). Reads three independently-owned
// audit tables (data changes, access control, console actions) through the
// auditTrail service, which normalises every row to one common shape. No writes.
//
// The action dropdown used to be built from the rows currently loaded, so once
// an action was picked the list shrank to that one action and the only way to
// pick another was to clear the filter first. Actions seen for a source are now
// remembered for the session, so the list stays whole while filtering.
//
// Layout: the source is the page tab (?tab=), and each source has two views
// (?view=): Entries (searchable, sortable, paged, Excel/PDF export; a row opens
// a side drawer with the full entry and, for data changes, before and after)
// and Insights (events per day, events by action, most active actors).

const PAGE_LIMIT = 200
const SINCE_OPTIONS = [
  { key: '24h', label: 'Last 24 hours', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
]

// Per-source list function + plain-English help shown under the header.
const SOURCE_META = {
  audit_log_v2: {
    list: listDataAudit,
    help: 'Row level changes to operational records: who edited, created or deleted a row, and the before and after values.',
  },
  access_audit: {
    list: listAccessAudit,
    help: 'Access control history: role changes, permission grants and other privileged account changes.',
  },
  console_sessions: {
    list: listConsoleAudit,
    help: 'Console administrator actions such as sign in, account lock and configuration changes.',
  },
}

function sinceIso(key) {
  const opt = SINCE_OPTIONS.find((o) => o.key === key)
  if (!opt || opt.days == null) return undefined
  return new Date(Date.now() - opt.days * 86400000).toISOString()
}

const SOURCE_KEYS = Object.keys(SOURCE_META)
const EXPORT_COLUMNS = [
  { key: 'when', header: 'Time', value: (r) => fmtWhen(r.when) },
  { key: 'actor', header: 'Actor' },
  { key: 'action', header: 'Action' },
  { key: 'target', header: 'Target' },
  { key: 'detail', header: 'Detail' },
  { key: 'source', header: 'Source' },
]

function fmtWhen(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

/** Pretty JSON block or an honest empty note. */
function JsonBlock({ label, value }) {
  const empty = value == null || (typeof value === 'object' && Object.keys(value).length === 0)
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      {empty ? (
        <p className="text-xs text-gray-400 italic">No values</p>
      ) : (
        <pre className="text-[11px] text-gray-300 bg-gray-900 border border-gray-800 rounded-lg p-2.5 overflow-x-auto max-h-56">
          {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}

/**
 * AND / OR condition builder for people who do not type search syntax. It
 * writes the same query string the search box parses (one parser), so the box
 * always shows exactly what is being searched.
 */
function ConditionBuilder({ open, initial, onApply, onClose }) {
  const start = () => {
    const parsed = parseQuery(initial)
    const rows = parsed.conditions.map((c, i) => ({ id: i, field: c.field || 'detail', op: c.op, value: c.value }))
    return { join: parsed.join, rows: rows.length ? rows : [{ id: 0, field: 'actor', op: 'contains', value: '' }] }
  }
  const [draft, setDraft] = useState(start)
  useEffect(() => { if (open) setDraft(start()) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const setRow = (id, patch) => setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  const addRow = () => setDraft((d) => ({ ...d, rows: [...d.rows, { id: Date.now(), field: 'action', op: 'contains', value: '' }] }))
  const removeRow = (id) => setDraft((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== id) }))
  const preview = toQueryString(draft.rows, draft.join)
  return (
    <Modal open={open} onClose={onClose} title="Build a search" subtitle="Add conditions. The search box shows the same search as text."
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={() => { onApply(preview); onClose() }}>Apply search</Btn>
      </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span>Match</span>
          <Segmented ariaLabel="Match all or any" value={draft.join} onChange={(join) => setDraft((d) => ({ ...d, join }))}
            options={[{ key: 'and', label: 'All conditions (AND)' }, { key: 'or', label: 'Any condition (OR)' }]} />
        </div>
        <ul className="space-y-2">
          {draft.rows.map((r, i) => (
            <li key={r.id} className="grid grid-cols-1 sm:grid-cols-[8rem_10rem_1fr_auto] gap-2 items-center">
              <Select ariaLabel={`Condition ${i + 1} field`} value={r.field} onChange={(field) => setRow(r.id, { field })}
                options={QUERY_FIELDS.map((f) => ({ value: f.key, label: f.label }))} />
              <Select ariaLabel={`Condition ${i + 1} test`} value={r.op} onChange={(op) => setRow(r.id, { op })}
                options={QUERY_OPS.map((o) => ({ value: o.key, label: o.label }))} />
              <input value={r.value} onChange={(e) => setRow(r.id, { value: e.target.value })} aria-label={`Condition ${i + 1} value`}
                placeholder="Value"
                className="w-full px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
              <Btn size="xs" icon={Trash2} ariaLabel={`Remove condition ${i + 1}`} disabled={draft.rows.length === 1} onClick={() => removeRow(r.id)} />
            </li>
          ))}
        </ul>
        <Btn size="xs" icon={Plus} onClick={addRow}>Add condition</Btn>
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-2.5">
          <p className="text-[10px] text-gray-500 mb-1">Search text</p>
          <p className="font-mono text-xs text-gray-200 break-all">{preview || 'Nothing yet'}</p>
        </div>
        <p className="text-[11px] text-gray-500">"Does not contain" always applies, whichever match mode you pick.</p>
      </div>
    </Modal>
  )
}

export default function ConsoleAuditTrail() {
  useConsoleAuth() // gate: rendered only inside the super-admin console shell

  const [sourceKey, setSourceKey] = useUrlTab(SOURCE_KEYS, 'audit_log_v2')
  const [view, setView] = useUrlTab(['entries', 'insights'], 'entries', 'view')
  const [readAt, setReadAt] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [since, setSince] = useState('7d')
  const [expanded, setExpanded] = useState(null)
  const [seenActions, setSeenActions] = useState({})
  const [builderOpen, setBuilderOpen] = useState(false)
  const [reasons, setReasons] = useState({ total: null, withReason: null, days: 30, loading: true })
  useEffect(() => {
    let live = true
    countAccessReasons(30)
      .then((r) => { if (live) setReasons({ ...r, loading: false }) })
      .catch(() => { if (live) setReasons({ total: null, withReason: null, days: 30, loading: false }) })
    return () => { live = false }
  }, [])

  const meta = SOURCE_META[sourceKey] || SOURCE_META.audit_log_v2

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setExpanded(null)
    try {
      const data = await meta.list({
        action: actionFilter || undefined,
        since: sinceIso(since),
        limit: PAGE_LIMIT,
      })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      setReadAt(Date.now())
      setSeenActions((prev) => {
        const cur = new Set(prev[sourceKey] || [])
        list.forEach((r) => { if (r.action) cur.add(r.action) })
        return { ...prev, [sourceKey]: [...cur].sort() }
      })
    } catch (err) {
      setRows([])
      setError(toUserMessage(err, 'Could not load audit entries. Please try again.'))
    } finally {
      setLoading(false)
    }
    // meta is derived from sourceKey; depend on the primitive instead.
  }, [sourceKey, actionFilter, since]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // Reset action filter + expansion when switching source (actions differ).
  function switchSource(key) {
    if (key === sourceKey) return
    setSourceKey(key)
    setActionFilter('')
    setExpanded(null)
  }

  // Distinct actions in the loaded set drive the action dropdown.
  const actionOptions = useMemo(() => {
    const set = new Set(seenActions[sourceKey] || [])
    rows.forEach((r) => { if (r.action) set.add(r.action) })
    if (actionFilter) set.add(actionFilter)
    return [...set].sort()
  }, [rows, seenActions, sourceKey, actionFilter])

  // Free-text search across actor / action / target / detail.
  const { sort, onSort } = useTableSort(null)
  // One parser for typed qualifiers and the AND / OR builder (lib/auditQuery).
  const filtered = useMemo(() => sortRows(filterByQuery(rows, search), sort), [rows, search, sort])

  const canDiff = sourceKey === 'audit_log_v2'
  const hasFilters = !!(search || actionFilter || since !== '7d')

  const paged = usePaged(filtered)
  const openRow = useMemo(() => (expanded ? filtered.find((r, i) => `${r.source}-${r.id ?? i}` === expanded) || null : null), [expanded, filtered])
  const topActors = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      if (!r.actor) continue
      m.set(r.actor, (m.get(r.actor) || 0) + 1)
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [filtered])

  const capped = rows.length >= PAGE_LIMIT
  const sinceOpt = SINCE_OPTIONS.find((o) => o.key === since)
  const trendDays = sinceOpt?.days == null ? 30 : Math.max(7, Math.min(90, sinceOpt.days))
  const trend = useMemo(() => dailySeries(filtered, (r) => r.when, trendDays), [filtered, trendDays])
  const actionShare = useMemo(
    () => topShare(filtered, (r) => (r.action ? r.action.replace(/_/g, ' ') : 'N/A'), 5),
    [filtered],
  )
  const actorCount = useMemo(() => new Set(filtered.map((r) => r.actor).filter(Boolean)).size, [filtered])
  const scopeNote = capped
    ? `Covers the latest ${PAGE_LIMIT} entries loaded, not every entry in the period`
    : `Covers all ${rows.length} entries in the period`
  const sourceLabel = AUDIT_SOURCES.find((s) => s.key === sourceKey)?.label || 'Audit'

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={ShieldCheck} title="Audit Trail"
        purpose="Read only history across data changes, access control and console actions."
        refreshedAt={readAt} onRefresh={load} refreshing={loading}
        actions={<ExportButtons rows={filtered} columns={EXPORT_COLUMNS} title={`Audit Trail ${sourceLabel}`} onError={setError} />} />

      <TabBar tabs={AUDIT_SOURCES.map((s) => ({ key: s.key, label: s.label }))} value={sourceKey} onChange={switchSource} label="Audit source" />

      <Note icon={Info}>{meta.help}</Note>

      {capped && !loading && !error && (
        <Note icon={Info} tone="warning">
          Showing the latest {PAGE_LIMIT} entries for this source and period. Narrow the period or pick an action to see older entries.
        </Note>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Entries shown" value={loading || error ? 'N/A' : filtered.length.toLocaleString()}
          sub={capped ? `Latest ${PAGE_LIMIT} loaded` : `${sinceOpt?.label || 'Period'}`} icon={ShieldCheck}
          onClick={() => setView('entries')} active={view === 'entries'} />
        <StatTile label="Distinct actors" value={loading || error ? 'N/A' : actorCount} icon={Users}
          sub="See who is most active" onClick={() => setView('insights')} active={view === 'insights'} />
        <StatTile label="Distinct actions" value={loading || error ? 'N/A' : new Set(filtered.map((r) => r.action).filter(Boolean)).size} icon={Activity} />
        <StatTile label="Most recent" value={loading || error || !filtered.length ? 'N/A' : fmtWhen(filtered[0]?.when)} icon={Clock} />
      </div>

      <Panel>
        <div className="flex flex-wrap items-start gap-3">
          <MessageSquare size={16} className="text-orange-400 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-gray-500">Access changes with a written reason, last {reasons.days} days</p>
            <p className="text-lg font-semibold text-gray-100 tabular-nums">{reasons.loading ? 'Loading' : reasonCoverageText(reasons)}</p>
            <p className="text-[11px] text-gray-500 max-w-3xl">
              {reasons.loading ? 'Counting.' : reasons.total === null
                ? 'N/A: the count could not be read.'
                : 'Measured from the access log. Access changes made from 30 Sep 2026 carry the reason typed in the console; older rows were written before reasons were recorded and show Not recorded. Data changes do not carry a reason field yet.'}
            </p>
          </div>
          <Btn size="xs" onClick={() => { switchSource('access_audit'); setView('entries') }} disabled={reasons.loading}>See access changes</Btn>
        </div>
      </Panel>

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search, or actor:anum action:update OR -action:login" className="flex-1 min-w-48" />
        <Btn icon={ListFilter} onClick={() => setBuilderOpen(true)}>AND / OR builder</Btn>
        <Select value={actionFilter} onChange={setActionFilter} placeholder="All actions" className="w-52"
          options={actionOptions.map((a) => ({ value: a, label: a.replace(/_/g, ' ') }))} />
        <Select value={since} onChange={setSince} className="w-40"
          options={SINCE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
        {hasFilters && (
          <Btn variant="quiet" onClick={() => { setSearch(''); setActionFilter(''); setSince('7d') }}>Clear</Btn>
        )}
        <div className="ml-auto">
          <SegmentedView value={view} onChange={setView} />
        </div>
      </Toolbar>

      <p className="text-[11px] text-gray-500 -mt-2">
        Qualifiers: {QUERY_FIELDS.map((f) => `${f.key}:`).join(' ')} Put a minus in front to exclude, and OR between terms to match any.
      </p>
      <ConditionBuilder open={builderOpen} initial={search} onApply={setSearch} onClose={() => setBuilderOpen(false)} />

      {view === 'insights' && (
        error ? <ErrorState message={error} onRetry={load} /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-2">
            <PanelHeader icon={Activity} title="Events per day" subtitle={`${sourceLabel}, last ${trendDays} days. ${scopeNote}.`} />
            {loading ? <LoadingState rows={3} /> : (
              <TrendChart labels={trend.labels} series={[{ label: 'Events', values: trend.values }]} height={190}
                summary={`${trend.total} ${sourceLabel} events in the last ${trendDays} days`}
                emptyText="No audit events in this window." />
            )}
          </Panel>
          <Panel>
            <PanelHeader icon={Activity} title="Events by action" subtitle={scopeNote} />
            {loading ? <LoadingState rows={3} /> : (
              <ShareChart parts={actionShare} height={150}
                summary={actionShare.map((p) => `${p.label} ${p.value}`).join(', ')}
                emptyText="No audit events to break down." center={{ value: filtered.length, label: 'Events' }} />
            )}
          </Panel>
          <Panel className="lg:col-span-3">
            <PanelHeader icon={Users} title="Most active actors" subtitle={`Entries per actor in the current filters. ${scopeNote}.`} />
            {loading ? <LoadingState rows={3} /> : (
              <BarsChart bars={topActors} summary={topActors.map((b) => `${b.label} ${b.value}`).join(', ')}
                emptyText="No actor recorded on these entries." />
            )}
          </Panel>
        </div>
        )
      )}

      {view === 'entries' && (<>

      {loading ? (
        <LoadingState label="Loading audit entries" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState icon={ShieldCheck} title="No audit entries for these filters"
            reason={rows.length ? 'Entries exist for this period, but none match the search.' : 'Nothing was recorded in this source for the chosen period and action.'} />
        </Panel>
      ) : (
        <Panel flush>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <p className="text-[11px] text-gray-500">{filtered.length.toLocaleString()} entries{capped ? ` (latest ${PAGE_LIMIT} loaded)` : ''}</p>
            <p className="text-[11px] text-gray-400">{canDiff ? 'Select a row to see before and after values' : 'Select a row for the full entry'}</p>
          </div>
          <Table className="border-0 rounded-none">
            <THead>
              <Th sortKey="when" sort={sort} onSort={onSort}>Time</Th>
              <Th sortKey="actor" sort={sort} onSort={onSort}>Actor</Th>
              <Th sortKey="action" sort={sort} onSort={onSort}>Action</Th>
              <Th sortKey="target" sort={sort} onSort={onSort}>Target</Th>
              <Th sortKey="detail" sort={sort} onSort={onSort}>Detail</Th>
            </THead>
            <tbody>
              {paged.rows.map((row, i) => {
                const key = `${row.source}-${row.id ?? (paged.from - 1 + i)}`
                return (
                  <Tr key={key} onClick={() => setExpanded(key)} ariaLabel={`Open audit entry ${(row.action || '').replace(/_/g, ' ')}`}>
                    <Td nowrap className="text-gray-500 tabular-nums">{fmtWhen(row.when)}</Td>
                    <Td className="text-gray-300 max-w-[220px] truncate">
                      <span title={row.actor || ''}>{row.actor || 'N/A'}</span>
                      {row.role && <span className="ml-1.5 text-[10px] text-gray-400">({row.role})</span>}
                    </Td>
                    <Td><Badge>{(row.action || 'N/A').replace(/_/g, ' ')}</Badge></Td>
                    <Td className="text-gray-400 max-w-[220px] truncate"><span title={row.target || ''}>{row.target || 'N/A'}</span></Td>
                    <Td className="text-gray-500 max-w-xs truncate"><span title={row.detail || ''}>{row.detail || 'N/A'}</span></Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
          <div className="px-4 pb-4"><Pager paged={paged} label="entries" /></div>
        </Panel>
      )}
      </>)}

      <SideDrawer open={!!openRow} onClose={() => setExpanded(null)} width="max-w-2xl"
        title={openRow ? (openRow.action || 'Entry').replace(/_/g, ' ') : 'Entry'} subtitle={sourceLabel}>
        {openRow && (
          <>
            <dl>
              <Field label="Time">{fmtWhen(openRow.when)}</Field>
              <Field label="Actor">{openRow.actor || 'N/A'}{openRow.role ? ` (${openRow.role})` : ''}</Field>
              <Field label="Target">{openRow.target || 'N/A'}</Field>
              <Field label="Detail">{openRow.detail || 'N/A'}</Field>
              {openRow.source === 'access_audit' && <Field label="Reason">{openRow.reason || 'Not recorded'}</Field>}
              {openRow.id != null && <Field label="Entry ID"><Code>{String(openRow.id)}</Code></Field>}
            </dl>
            {canDiff && (
              <div className="flex flex-col gap-4">
                <JsonBlock label="Before" value={openRow.old} />
                <JsonBlock label="After" value={openRow.new} />
              </div>
            )}
          </>
        )}
      </SideDrawer>
    </div>
  )
}

function SegmentedView({ value, onChange }) {
  return (
    <div role="group" aria-label="Audit view" className="inline-flex gap-1 p-1 rounded-lg bg-gray-900/70 border border-gray-800">
      {[['entries', 'Entries'], ['insights', 'Insights']].map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={`rounded-md px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
            value === k ? 'bg-orange-500/20 text-orange-200 border border-orange-600/50' : 'border border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}
