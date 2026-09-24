import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, RefreshCw, Download, ChevronRight, ChevronDown, Info, Activity, Users,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Code,
} from '../components/ui'
import { TrendChart, ShareChart } from '../components/ui/charts'
import { dailySeries, topShare } from '../../lib/consoleCharts'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  AUDIT_SOURCES, listDataAudit, listAccessAudit, listConsoleAudit,
} from '../../lib/api/auditTrail'
import { exportToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

// Read-only unified audit viewer (Module 6). Reads three independently-owned
// audit tables (data changes, access control, console actions) through the
// auditTrail service, which normalises every row to one common shape. No writes.
//
// The action dropdown used to be built from the rows currently loaded, so once
// an action was picked the list shrank to that one action and the only way to
// pick another was to clear the filter first. Actions seen for a source are now
// remembered for the session, so the list stays whole while filtering.

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
      <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{label}</p>
      {empty ? (
        <p className="text-xs text-gray-600 italic">No values</p>
      ) : (
        <pre className="text-[11px] text-gray-300 bg-gray-900 border border-gray-800 rounded-lg p-2.5 overflow-x-auto max-h-56">
          {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function ConsoleAuditTrail() {
  useConsoleAuth() // gate: rendered only inside the super-admin console shell

  const [sourceKey, setSourceKey] = useState('audit_log_v2')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [since, setSince] = useState('7d')
  const [expanded, setExpanded] = useState(null)
  const [seenActions, setSeenActions] = useState({})

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
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      (r.actor || '').toLowerCase().includes(q) ||
      (r.action || '').toLowerCase().includes(q) ||
      (r.target || '').toLowerCase().includes(q) ||
      (r.detail || '').toLowerCase().includes(q),
    )
  }, [rows, search])

  const canDiff = sourceKey === 'audit_log_v2'
  const hasFilters = !!(search || actionFilter || since !== '7d')

  async function onExport() {
    if (filtered.length === 0) return
    const cols = ['when', 'actor', 'action', 'target', 'detail', 'source']
    const headers = ['Time', 'Actor', 'Action', 'Target', 'Detail', 'Source']
    const exportRows = filtered.map((r) => ({
      when: fmtWhen(r.when),
      actor: r.actor || '',
      action: r.action || '',
      target: r.target || '',
      detail: r.detail || '',
      source: r.source || '',
    }))
    const label = AUDIT_SOURCES.find((s) => s.key === sourceKey)?.label || 'Audit'
    try {
      await exportToExcel(exportRows, cols, headers, `Audit Trail ${label}`, 'Audit')
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Please try again.'))
    }
  }

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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2"><ShieldCheck size={18} className="text-orange-400" /> Audit Trail</h1>
          <p className="text-xs text-gray-500 mt-1">Read only history across data changes, access control and console actions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Btn icon={Download} onClick={onExport} disabled={filtered.length === 0}>Export Excel</Btn>
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
        </div>
      </header>

      <Segmented size="md" value={sourceKey} onChange={switchSource}
        options={AUDIT_SOURCES.map((s) => ({ key: s.key, label: s.label }))} />

      <Note icon={Info}>{meta.help}</Note>

      {capped && !loading && !error && (
        <Note icon={Info} tone="warning">
          Showing the latest {PAGE_LIMIT} entries for this source and period. Narrow the period or pick an action to see older entries.
        </Note>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Entries shown" value={loading ? 'N/A' : filtered.length.toLocaleString()}
          sub={capped ? `Latest ${PAGE_LIMIT} loaded` : `${sinceOpt?.label || 'Period'}`} icon={ShieldCheck} />
        <StatTile label="Distinct actors" value={loading ? 'N/A' : actorCount} icon={Users} />
        <StatTile label="Distinct actions" value={loading ? 'N/A' : new Set(filtered.map((r) => r.action).filter(Boolean)).size} icon={Activity} />
        <StatTile label="Most recent" value={loading || !filtered.length ? 'N/A' : fmtWhen(filtered[0]?.when)} />
      </div>

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
      </div>

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search actor, action, target, detail" className="flex-1 min-w-48" />
        <Select value={actionFilter} onChange={setActionFilter} placeholder="All actions" className="w-52"
          options={actionOptions.map((a) => ({ value: a, label: a.replace(/_/g, ' ') }))} />
        <Select value={since} onChange={setSince} className="w-40"
          options={SINCE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
        {hasFilters && (
          <Btn variant="quiet" onClick={() => { setSearch(''); setActionFilter(''); setSince('7d') }}>Clear</Btn>
        )}
      </Toolbar>

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
            {canDiff && <p className="text-[11px] text-gray-600">Click a row to see before and after values</p>}
          </div>
          <Table className="border-0 rounded-none">
            <THead>
              {canDiff && <Th className="w-8" />}
              <Th>Time</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>Detail</Th>
            </THead>
            <tbody>
              {filtered.map((r, i) => {
                const key = `${r.source}-${r.id ?? i}`
                const isOpen = expanded === key
                return (
                  <FragmentRow
                    key={key}
                    row={r}
                    rowKey={key}
                    isOpen={isOpen}
                    canDiff={canDiff}
                    onToggle={() => setExpanded(isOpen ? null : key)}
                  />
                )
              })}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
  )
}

function FragmentRow({ row, rowKey, isOpen, canDiff, onToggle }) {
  return (
    <>
      <Tr onClick={canDiff ? onToggle : undefined}>
        {canDiff && (
          <Td className="text-gray-600">
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </Td>
        )}
        <Td nowrap className="text-gray-500 tabular-nums">{fmtWhen(row.when)}</Td>
        <Td className="text-gray-300 max-w-[220px] truncate">
          <span title={row.actor || ''}>{row.actor || 'N/A'}</span>
          {row.role && <span className="ml-1.5 text-[10px] text-gray-600">({row.role})</span>}
        </Td>
        <Td><Badge>{(row.action || 'N/A').replace(/_/g, ' ')}</Badge></Td>
        <Td className="text-gray-400 max-w-[220px] truncate"><span title={row.target || ''}>{row.target || 'N/A'}</span></Td>
        <Td className="text-gray-500 max-w-xs truncate"><span title={row.detail || ''}>{row.detail || 'N/A'}</span></Td>
      </Tr>
      {canDiff && isOpen && (
        <tr key={`${rowKey}-exp`} className="border-t border-gray-800/40 bg-gray-900/30">
          <td colSpan={6} className="px-6 py-3">
            <div className="flex flex-col sm:flex-row gap-4">
              <JsonBlock label="Before" value={row.old} />
              <JsonBlock label="After" value={row.new} />
            </div>
            {row.id != null && <p className="text-[10px] text-gray-600 mt-2">Entry ID: <Code>{String(row.id)}</Code></p>}
          </td>
        </tr>
      )}
    </>
  )
}
