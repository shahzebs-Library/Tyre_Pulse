/**
 * ConsoleIncidents.jsx - platform Incident Management and Status (/console/incidents).
 *
 * The record of incidents affecting Tyre Pulse itself (an outage or a broken
 * module), not fleet accidents. Shows the current platform status derived from
 * the open incidents, response KPIs (MTTR / MTTA over 90 days), a weekly trend,
 * the incident list with a full update timeline, and the live signals an
 * incident is usually opened from (critical system logs, open trust alerts).
 *
 * Every write goes through the super-admin RPCs admin_open_incident /
 * admin_post_incident_update, which validate the status machine server-side and
 * write a console audit row. Opening a SEV1 or SEV2 notifies every super admin.
 * An unmeasurable figure renders "N/A", never 0.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Siren, RefreshCw, FileSpreadsheet, Plus, CheckCircle2, AlertTriangle, XCircle,
  Activity, Timer, Clock, Radio, Send, Database, ListChecks, Flame,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { TrendChart, BarsChart, STATUS as CHART_STATUS, useChartTheme } from '../components/ui/charts'
import { listIncidents, openIncident, postIncidentUpdate, loadIncidentSignals } from '../../lib/api/platformIncidents'
import {
  SEVERITIES, SEVERITY_LABEL, SEVERITY_HELP, STATUS_LABEL, allowedNext, isOpen,
  mttr, mtta, openBySeverity, countSince, platformStatus, weeklyCounts, shapeTimeline,
  formatDuration, durationMinutes, sortIncidents, draftFromSignal, exportRows, EXPORT_COLUMNS, EXPORT_HEADERS,
} from '../../lib/platformIncidents'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'

const WINDOW_DAYS = 90
const SEV_TONE = { sev1: 'danger', sev2: 'warning', sev3: 'info', sev4: 'quiet' }
const STATUS_TONE = { investigating: 'danger', identified: 'warning', monitoring: 'info', resolved: 'good' }
const LEVEL_META = {
  operational: { tone: 'default', icon: CheckCircle2, color: 'text-emerald-300', ring: 'border-emerald-800/50' },
  degraded: { tone: 'warning', icon: AlertTriangle, color: 'text-amber-300', ring: 'border-amber-800/50' },
  outage: { tone: 'danger', icon: XCircle, color: 'text-red-300', ring: 'border-red-800/50' },
}

function fmtWhen(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const EMPTY_DRAFT = { title: '', severity: 'sev3', impact: '', affected_modules: '', started_at: '', message: '', source_type: 'manual', source_ref: null }

export default function ConsoleIncidents() {
  const theme = useChartTheme()
  const [incidents, setIncidents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signals, setSignals] = useState(null)
  const [view, setView] = useState('open')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [update, setUpdate] = useState({ status: '', message: '' })
  const [updError, setUpdError] = useState('')
  const [posting, setPosting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000)
      const [list, sig] = await Promise.allSettled([
        listIncidents({ since }),
        loadIncidentSignals({ days: 7 }),
      ])
      if (list.status === 'fulfilled') setIncidents(list.value)
      else setError(toUserMessage(list.reason, 'Could not load incidents.'))
      setSignals(sig.status === 'fulfilled' ? sig.value : { logs: { ok: false, rows: [] }, trust: { ok: false, rows: [] } })
      setNow(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const all = useMemo(() => incidents || [], [incidents])
  const status = useMemo(() => platformStatus(all), [all])
  const openSev = useMemo(() => openBySeverity(all), [all])
  const openCount = openSev.sev1 + openSev.sev2 + openSev.sev3 + openSev.sev4
  const mttr90 = useMemo(() => mttr(all, { days: WINDOW_DAYS, now }), [all, now])
  const mtta90 = useMemo(() => mtta(all, { days: WINDOW_DAYS, now }), [all, now])
  const count90 = useMemo(() => countSince(all, WINDOW_DAYS, now), [all, now])
  const weekly = useMemo(() => weeklyCounts(all, 12, now), [all, now])
  const sevBars = useMemo(() => {
    const pal = CHART_STATUS[theme] || CHART_STATUS.dark
    const color = { sev1: pal.critical, sev2: pal.high, sev3: pal.medium, sev4: pal.low }
    return SEVERITIES.map((s) => ({ label: SEVERITY_LABEL[s], value: openSev[s], color: color[s] }))
  }, [openSev, theme])

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sortIncidents(all).filter((i) => {
      if (view === 'open' && !isOpen(i)) return false
      if (view === 'resolved' && isOpen(i)) return false
      if (!q) return true
      return [i.title, i.impact, i.commander_name, ...(i.affected_modules || [])]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [all, view, search])

  const selected = useMemo(() => all.find((i) => i.id === selectedId) || null, [all, selectedId])
  const timeline = useMemo(() => shapeTimeline(selected), [selected])

  function openDetail(i) {
    setSelectedId(i.id)
    setUpdate({ status: i.status, message: '' })
    setUpdError('')
  }

  function startDraft(prefill) {
    setFormError('')
    setDraft(prefill
      ? { ...EMPTY_DRAFT, ...prefill, affected_modules: (prefill.affected_modules || []).join(', ') }
      : { ...EMPTY_DRAFT })
  }

  async function submitDraft() {
    setSaving(true)
    setFormError('')
    try {
      const id = await openIncident({ ...draft, started_at: draft.started_at || null })
      setDraft(null)
      await load()
      if (id) { setSelectedId(id); setUpdate({ status: 'investigating', message: '' }) }
    } catch (e) {
      setFormError(toUserMessage(e, 'Could not open the incident.'))
    } finally {
      setSaving(false)
    }
  }

  async function submitUpdate() {
    if (!selected) return
    setPosting(true)
    setUpdError('')
    try {
      await postIncidentUpdate(selected.id, update.status, update.message)
      setUpdate((u) => ({ ...u, message: '' }))
      await load()
    } catch (e) {
      setUpdError(toUserMessage(e, 'Could not post the update.'))
    } finally {
      setPosting(false)
    }
  }

  async function exportExcel() {
    setExporting(true)
    try {
      await exportToExcel(exportRows(all), EXPORT_COLUMNS, EXPORT_HEADERS, reportFileName('Platform Incidents'))
    } catch (e) {
      setError(toUserMessage(e, 'Could not export the incidents.'))
    } finally {
      setExporting(false)
    }
  }

  if (loading && !incidents && !error) {
    return <div className="space-y-5 max-w-7xl"><LoadingState label="Loading incidents" rows={6} /></div>
  }
  if (error && !incidents) {
    return <div className="space-y-5 max-w-7xl"><ErrorState message={error} onRetry={load} /></div>
  }

  const level = LEVEL_META[status.level]
  const LevelIcon = level.icon

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <Siren size={18} className="text-orange-400" /> Incidents &amp; Status
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Platform incidents, their response times and the signals they start from. Last checked {fmtWhen(now)}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn icon={FileSpreadsheet} onClick={exportExcel} busy={exporting} disabled={!all.length}>Excel</Btn>
          <Btn icon={Plus} variant="primary" onClick={() => startDraft(null)}>Open incident</Btn>
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
        </div>
      </header>

      {error && <Note icon={AlertTriangle} tone="warning">{error}</Note>}

      <section className={`rounded-xl border ${level.ring} bg-gray-900/50 p-4 flex items-center gap-4`} aria-live="polite">
        <LevelIcon size={28} className={level.color} />
        <div className="flex-1 min-w-0">
          <p className={`text-base font-semibold ${level.color}`}>{status.label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{status.detail}</p>
        </div>
        {status.open > 0 && (
          <Btn size="xs" onClick={() => setView('open')}>View open</Btn>
        )}
      </section>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label="Open incidents" value={openCount} icon={Activity}
          tone={openCount ? 'warning' : 'good'} onClick={() => setView('open')} active={view === 'open'} />
        <StatTile label="SEV1 open" value={openSev.sev1} icon={Flame} tone={openSev.sev1 ? 'danger' : 'default'} />
        <StatTile label={`MTTR ${WINDOW_DAYS}d`} value={formatDuration(mttr90)} icon={Timer}
          sub={mttr90 === null ? 'No resolved incident yet' : 'Start to resolved'} tone={mttr90 === null ? 'muted' : 'default'} />
        <StatTile label={`MTTA ${WINDOW_DAYS}d`} value={formatDuration(mtta90)} icon={Clock}
          sub={mtta90 === null ? 'Nothing acknowledged yet' : 'Start to first response'} tone={mtta90 === null ? 'muted' : 'default'} />
        <StatTile label={`Incidents ${WINDOW_DAYS}d`} value={count90} icon={ListChecks}
          onClick={() => setView('all')} active={view === 'all'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2">
          <PanelHeader icon={Activity} title="Incidents per week" subtitle="Started in each of the last 12 weeks (Monday to Sunday, UTC)." />
          <TrendChart labels={weekly.labels} series={[{ label: 'Incidents', values: weekly.values }]}
            summary={`${weekly.values.reduce((s, v) => s + v, 0)} incidents started in the last 12 weeks.`}
            emptyText="No incidents in the last 12 weeks." />
        </Panel>
        <Panel>
          <PanelHeader icon={AlertTriangle} title="Open by severity" subtitle="What is still being worked on." />
          <BarsChart bars={sevBars} summary={`${openCount} open incidents.`} emptyText="No open incidents." />
        </Panel>
      </div>

      <Panel flush>
        <div className="p-4 pb-3">
          <PanelHeader icon={ListChecks} title="Incidents"
            subtitle={`Open incidents and everything started in the last ${WINDOW_DAYS} days.`} />
          <Toolbar>
            <Segmented value={view} onChange={setView} ariaLabel="Incident view" options={[
              { key: 'open', label: 'Open', count: openCount },
              { key: 'resolved', label: 'Resolved', count: all.length - openCount },
              { key: 'all', label: 'All', count: all.length },
            ]} />
            <SearchInput value={search} onChange={setSearch} placeholder="Search title, module, commander" className="w-64" />
          </Toolbar>
        </div>
        {listed.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState icon={CheckCircle2}
              title={view === 'open' ? 'No open incidents' : 'No incidents match'}
              reason={search ? 'Nothing matches this search.' : view === 'open'
                ? 'The platform has nothing open right now.' : `No incidents recorded in the last ${WINDOW_DAYS} days.`} />
          </div>
        ) : (
          <Table>
            <THead>
              <Th>Incident</Th><Th>Severity</Th><Th>Status</Th><Th>Started</Th>
              <Th>Duration</Th><Th>Commander</Th><Th align="right">Updates</Th>
            </THead>
            <tbody>
              {listed.map((i) => (
                <Tr key={i.id} onClick={() => openDetail(i)}>
                  <Td>
                    <p className="text-gray-200 font-medium">{i.title}</p>
                    {(i.affected_modules || []).length > 0 && (
                      <p className="text-[11px] text-gray-500 mt-0.5">{i.affected_modules.join(', ')}</p>
                    )}
                  </Td>
                  <Td><Badge tone={SEV_TONE[i.severity]}>{SEVERITY_LABEL[i.severity] || i.severity}</Badge></Td>
                  <Td><Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status] || i.status}</Badge></Td>
                  <Td nowrap>{fmtWhen(i.started_at)}</Td>
                  <Td nowrap>
                    {isOpen(i)
                      ? <span className="text-amber-300">{formatDuration(durationMinutes(i.started_at, now))} so far</span>
                      : formatDuration(durationMinutes(i.started_at, i.resolved_at))}
                  </Td>
                  <Td>{i.commander_name || 'N/A'}</Td>
                  <Td align="right">{(i.updates || []).length}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <SignalsPanel signals={signals} onOpen={(kind, row) => startDraft(draftFromSignal(kind, row))} />

      <Modal open={!!selected} onClose={() => setSelectedId(null)} width="max-w-3xl"
        title={selected?.title || ''}
        subtitle={selected ? `${SEVERITY_LABEL[selected.severity]} | ${STATUS_LABEL[selected.status]} | started ${fmtWhen(selected.started_at)}` : ''}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Time to acknowledge" value={formatDuration(durationMinutes(selected.started_at, selected.acknowledged_at))} />
              <StatTile label={isOpen(selected) ? 'Open for' : 'Time to resolve'}
                value={formatDuration(durationMinutes(selected.started_at, isOpen(selected) ? now : selected.resolved_at))} />
              <StatTile label="Commander" value={selected.commander_name || 'N/A'} />
              <StatTile label="Source" value={selected.source_type ? selected.source_type.replace('_', ' ') : 'Manual'} />
            </div>
            {selected.impact && <Note icon={AlertTriangle}>{selected.impact}</Note>}
            {(selected.affected_modules || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selected.affected_modules.map((m) => <Badge key={m}>{m}</Badge>)}
              </div>
            )}

            <div>
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Timeline</h4>
              {timeline.length === 0 ? (
                <p className="text-xs text-gray-500">No updates recorded.</p>
              ) : (
                <ol className="border-l border-gray-800 ml-1.5 space-y-3">
                  {timeline.map((u) => (
                    <li key={u.id} className="pl-4 relative">
                      <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-orange-400" />
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status] || u.status}</Badge>
                        {u.opened && <span className="text-[11px] text-gray-500">Opened</span>}
                        {u.statusChanged && <span className="text-[11px] text-gray-500">Status changed</span>}
                        <span className="text-[11px] text-gray-500">{fmtWhen(u.created_at)}</span>
                        <span className="text-[11px] text-gray-600">{u.author_name || 'Unknown'}</span>
                        {u.sincePrevMin !== null && (
                          <span className="text-[11px] text-gray-600">+{formatDuration(u.sincePrevMin)}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-300 mt-1 whitespace-pre-wrap">{u.message}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="border-t border-gray-800 pt-3 space-y-2">
              <h4 className="text-xs uppercase tracking-wide text-gray-500">Post an update</h4>
              <Select value={update.status} onChange={(v) => setUpdate((u) => ({ ...u, status: v }))}
                options={allowedNext(selected.status).map((s) => ({
                  value: s, label: s === selected.status ? `${STATUS_LABEL[s]} (no change)` : STATUS_LABEL[s],
                }))} className="w-64" />
              <textarea value={update.message} onChange={(e) => setUpdate((u) => ({ ...u, message: e.target.value }))}
                rows={3} maxLength={4000} aria-label="Update message"
                placeholder="What changed, what is being done, when the next update is due"
                className="w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 p-2.5 focus:border-gray-700 focus:outline-none" />
              {updError && <Note icon={XCircle} tone="danger">{updError}</Note>}
              <div className="flex justify-end">
                <Btn icon={Send} variant={update.status === 'resolved' && selected.status !== 'resolved' ? 'good' : 'primary'}
                  onClick={submitUpdate} busy={posting} disabled={!update.message.trim() || !update.status}>
                  {update.status === 'resolved' && selected.status !== 'resolved' ? 'Resolve incident' : 'Post update'}
                </Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!draft} onClose={() => setDraft(null)} title="Open incident"
        subtitle="SEV1 and SEV2 notify every super admin straight away."
        footer={<>
          <Btn onClick={() => setDraft(null)}>Cancel</Btn>
          <Btn icon={Siren} variant="primary" onClick={submitDraft} busy={saving}
            disabled={!draft || draft.title.trim().length < 3}>Open incident</Btn>
        </>}>
        {draft && (
          <div className="space-y-3">
            <Field label="Title">
              <input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 px-2.5 py-1.5 focus:border-gray-700 focus:outline-none" />
            </Field>
            <Field label="Severity">
              <Segmented role="group" ariaLabel="Severity" value={draft.severity}
                onChange={(v) => setDraft({ ...draft, severity: v })}
                options={SEVERITIES.map((s) => ({ key: s, label: SEVERITY_LABEL[s], hint: SEVERITY_HELP[s] }))} />
              <p className="text-[11px] text-gray-500 mt-1">{SEVERITY_HELP[draft.severity]}</p>
            </Field>
            <Field label="Customer impact">
              <textarea value={draft.impact} rows={2} maxLength={4000} onChange={(e) => setDraft({ ...draft, impact: e.target.value })}
                className="w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 p-2.5 focus:border-gray-700 focus:outline-none" />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Affected modules (comma separated)">
                <input value={draft.affected_modules} onChange={(e) => setDraft({ ...draft, affected_modules: e.target.value })}
                  className="w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 px-2.5 py-1.5 focus:border-gray-700 focus:outline-none" />
              </Field>
              <Field label="Started at (blank = now)">
                <input type="datetime-local" value={draft.started_at} onChange={(e) => setDraft({ ...draft, started_at: e.target.value })}
                  className="w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 px-2.5 py-1.5 focus:border-gray-700 focus:outline-none" />
              </Field>
            </div>
            <Field label="First update (optional)">
              <textarea value={draft.message} rows={2} maxLength={4000} onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                className="w-full rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 p-2.5 focus:border-gray-700 focus:outline-none" />
            </Field>
            {draft.source_type && draft.source_type !== 'manual' && (
              <Note icon={Radio}>Opened from a {draft.source_type.replace('_', ' ')} signal. The link is kept on the incident.</Note>
            )}
            {formError && <Note icon={XCircle} tone="danger">{formError}</Note>}
          </div>
        )}
      </Modal>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

function SignalsPanel({ signals, onOpen }) {
  if (!signals) return null
  const { logs, trust } = signals
  return (
    <Panel>
      <PanelHeader icon={Radio} title="Signals"
        subtitle="Unresolved critical and error logs from the last 7 days, and open data trust alerts. Open an incident straight from one." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SignalList title="System errors" icon={AlertTriangle} ok={logs.ok} rows={logs.rows}
          emptyReason="No unresolved critical or error logs in the last 7 days."
          render={(r) => (
            <>
              <div className="flex items-center gap-2">
                <Badge tone={r.severity === 'critical' ? 'danger' : 'warning'}>{r.severity}</Badge>
                {r.module_id && <span className="text-[11px] text-gray-500">{r.module_id}</span>}
                <span className="text-[11px] text-gray-600">{fmtWhen(r.created_at)}</span>
              </div>
              <p className="text-xs text-gray-300 mt-1 break-words">{r.message}</p>
            </>
          )}
          onOpen={(r) => onOpen('system_log', r)} />
        <SignalList title="Data trust alerts" icon={Database} ok={trust.ok} rows={trust.rows}
          emptyReason="No open data trust alerts."
          render={(r) => (
            <>
              <div className="flex items-center gap-2">
                <Badge tone={['critical', 'high'].includes(String(r.severity || '').toLowerCase()) ? 'danger' : 'warning'}>{r.severity || 'N/A'}</Badge>
                <span className="text-[11px] text-gray-500">{r.source}{r.country ? ` | ${r.country}` : ''}</span>
                <span className="text-[11px] text-gray-600">{fmtWhen(r.created_at)}</span>
              </div>
              <p className="text-xs text-gray-300 mt-1 break-words">{r.message || r.ref_key}</p>
            </>
          )}
          onOpen={(r) => onOpen('trust_alert', r)} />
      </div>
    </Panel>
  )
}

function SignalList({ title, icon: Icon, ok, rows, emptyReason, render, onOpen }) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
        <Icon size={12} /> {title} <span className="text-gray-600">({rows.length})</span>
      </h4>
      {!ok ? (
        <Note icon={AlertTriangle} tone="warning">This source could not be read, so it is not known whether there are signals.</Note>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">{emptyReason}</p>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {rows.map((r) => (
            <li key={r.id} className="border border-gray-800 rounded-lg p-2.5 flex items-start gap-2">
              <div className="flex-1 min-w-0">{render(r)}</div>
              <Btn size="xs" icon={Siren} onClick={() => onOpen(r)}>Open incident from this</Btn>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
