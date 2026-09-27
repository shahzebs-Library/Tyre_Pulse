/**
 * ConsoleAlertRules - super-admin no-code Alert Rules builder (Admin Control
 * Module 5). A pure console page.
 *
 * The builder reads plain English:
 *   "if [metric] [operator] [value] then notify via [in-app / email]"
 * assembled entirely from dropdowns (ALERT_METRICS, ALERT_OPERATORS), a number
 * input and channel checkboxes, with an optional site / brand filter and an
 * active toggle. Existing rules list with their evaluation stats (how many times
 * they fired + when last), each editable / toggleable / deletable.
 *
 * These rules ARE alert_thresholds rows (owner-scoped by RLS). They are
 * evaluated hourly by an existing cron job; severity routing (immediate vs
 * daily digest) follows the owner's notification preferences.
 *
 * Layout: the builder lives in a dialog opened from "New rule" (or a row's
 * Edit), so the page is the rule list and not a long form. Two tabs, synced to
 * ?tab=: Rules (what needs attention, rules per metric, the paged rule table)
 * and Insights (firings per metric and the rules that fire most). A row opens
 * its detail in a side drawer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BellRing, Plus, Pencil, Trash2, AlertTriangle, Info,
  Power, Save, Clock, Mail, MonitorSmartphone, BarChart3, Flame,
} from 'lucide-react'
import { toUserMessage } from '../../lib/safeError'
import {
  ALERT_METRICS, ALERT_OPERATORS, metricLabel, operatorLabel,
  listAlertRules, createAlertRule, updateAlertRule, toggleAlertRule, deleteAlertRule,
} from '../../lib/api/alertRules'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { sortRows, searchRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { BarsChart } from '../components/ui/charts'
import { PageHeader, TabBar, useUrlTab, usePaged, Pager, SideDrawer, Field, AttentionList } from './shared/pageKit'

const TABS = ['rules', 'insights']
const hasNoChannel = (r) => r.notify_in_app === false && !r.notify_email

const EMPTY_FORM = {
  name: '',
  metric: ALERT_METRICS[0]?.key || '',
  operator: 'gte',
  threshold: '',
  siteFilter: '',
  brandFilter: '',
  notifyInApp: true,
  notifyEmail: false,
  active: true,
}

const INPUT = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none'

/** Plain-English tooltip marker sitting next to a technical term. */
function InfoDot({ text }) {
  return (
    <span role="img" aria-label={text} className="inline-flex align-middle ml-1 text-gray-500 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

function fmtWhen(v) {
  if (!v) return 'Never'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

export default function ConsoleAlertRules() {
  const [rules, setRules]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busyId, setBusyId]   = useState(null)

  const [form, setForm]       = useState(EMPTY_FORM)
  const [editId, setEditId]   = useState(null)
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [openRule, setOpenRule] = useState(null)
  const [readAt, setReadAt] = useState(null)
  const [tab, setTab] = useUrlTab(TABS, 'rules')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRules(await listAlertRules())
      setReadAt(Date.now())
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setFormError(null)
    setBuilderOpen(false)
  }

  function startNew() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setFormError(null)
    setBuilderOpen(true)
  }

  function startEdit(r) {
    setOpenRule(null)
    setBuilderOpen(true)
    setEditId(r.id)
    setFormError(null)
    setForm({
      name: r.name || '',
      metric: r.metric || ALERT_METRICS[0]?.key || '',
      operator: r.operator || 'gte',
      threshold: r.threshold ?? '',
      siteFilter: r.site_filter || '',
      brandFilter: r.brand_filter || '',
      notifyInApp: r.notify_in_app !== false,
      notifyEmail: !!r.notify_email,
      active: r.active !== false,
    })
  }

  const validation = useMemo(() => {
    if (!form.name.trim()) return 'Give the rule a short name.'
    if (!form.metric) return 'Pick a metric to watch.'
    if (form.threshold === '' || !Number.isFinite(Number(form.threshold))) return 'Enter a numeric threshold value.'
    if (!form.notifyInApp && !form.notifyEmail) return 'Choose at least one notification channel.'
    return null
  }, [form])

  async function save(e) {
    e?.preventDefault?.()
    if (validation) { setFormError(validation); return }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        name: form.name.trim(),
        metric: form.metric,
        operator: form.operator,
        threshold: Number(form.threshold),
        siteFilter: form.siteFilter.trim(),
        brandFilter: form.brandFilter.trim(),
        notifyInApp: form.notifyInApp,
        notifyEmail: form.notifyEmail,
        active: form.active,
      }
      if (editId) await updateAlertRule(editId, payload)
      else await createAlertRule(payload)
      resetForm()
      await load()
    } catch (err) {
      setFormError(toUserMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function onToggle(r) {
    setBusyId(r.id)
    try {
      await toggleAlertRule(r.id, !(r.active !== false))
      await load()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  async function onDelete(r) {
    setConfirmDelete(null)
    setBusyId(r.id)
    try {
      await deleteAlertRule(r.id)
      if (editId === r.id) resetForm()
      await load()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const activeCount = rules.filter((r) => r.active !== false).length
  const totalFired = rules.reduce((a, r) => a + (Number(r.triggered_count) || 0), 0)
  const neverFired = rules.filter((r) => !r.last_triggered_at).length
  const noChannelCount = rules.filter(hasNoChannel).length
  const neverActive = rules.filter((r) => r.active !== false && !r.last_triggered_at).length

  const { sort, onSort } = useTableSort(null)
  const visibleRules = useMemo(() => {
    const byStatus = rules.filter((r) => {
      const isActive = r.active !== false
      if (statusFilter === 'active') return isActive
      if (statusFilter === 'paused') return !isActive
      if (statusFilter === 'never') return !r.last_triggered_at
      if (statusFilter === 'nochannel') return hasNoChannel(r)
      return true
    })
    const found = searchRows(byStatus, search, ['name', (r) => metricLabel(r.metric), 'site_filter', 'brand_filter'])
    return sortRows(found, sort, {
      condition: (r) => metricLabel(r.metric),
      fired: (r) => Number(r.triggered_count) || 0,
      status: (r) => (r.active !== false ? 0 : 1),
    })
  }, [rules, statusFilter, search, sort])

  const exportColumns = useMemo(() => ([
    { key: 'name', header: 'Rule' },
    { key: 'metric', header: 'Metric', value: (r) => metricLabel(r.metric) },
    { key: 'operator', header: 'Operator', value: (r) => operatorLabel(r.operator) },
    { key: 'threshold', header: 'Threshold' },
    { key: 'site_filter', header: 'Site' },
    { key: 'brand_filter', header: 'Brand' },
    { key: 'channels', header: 'Channels', value: (r) => [r.notify_in_app !== false ? 'In-app' : '', r.notify_email ? 'Email' : ''].filter(Boolean).join(', ') || 'None' },
    { key: 'triggered_count', header: 'Fired' },
    { key: 'last_triggered_at', header: 'Last fired' },
    { key: 'status', header: 'Status', value: (r) => (r.active !== false ? 'Active' : 'Paused') },
  ]), [])

  // Rules per metric and firings per metric: two measures, two charts.
  const byMetric = useMemo(() => {
    const m = new Map(ALERT_METRICS.map((x) => [x.key, { label: x.label, rules: 0, fired: 0 }]))
    for (const r of rules) {
      const key = r.metric || 'unknown'
      if (!m.has(key)) m.set(key, { label: metricLabel(key) || 'Unknown metric', rules: 0, fired: 0 })
      const e = m.get(key)
      e.rules += 1
      e.fired += Number(r.triggered_count) || 0
    }
    return [...m.values()]
  }, [rules])
  const ruleBars = useMemo(() => byMetric.filter((x) => x.rules > 0).map((x) => ({ label: x.label, value: x.rules })), [byMetric])
  const firedBars = useMemo(() => byMetric.filter((x) => x.rules > 0).map((x) => ({ label: x.label, value: x.fired })), [byMetric])
  const paged = usePaged(visibleRules)
  const noisiest = useMemo(() => rules
    .filter((r) => (Number(r.triggered_count) || 0) > 0)
    .sort((a, b) => (Number(b.triggered_count) || 0) - (Number(a.triggered_count) || 0))
    .slice(0, 8), [rules])

  const filterTo = useCallback((f) => { setStatusFilter(f); setSearch(''); setTab('rules') }, [setTab])
  const attention = useMemo(() => {
    const items = []
    if (noChannelCount) items.push({ key: 'nochannel', tone: 'danger', title: `${noChannelCount} rule${noChannelCount === 1 ? '' : 's'} with no notification channel`, detail: 'They can fire, but nobody is told. Add in-app or email.', action: { label: 'Show', onClick: () => filterTo('nochannel') } })
    if (neverActive) items.push({ key: 'never', tone: 'info', title: `${neverActive} active rule${neverActive === 1 ? ' has' : 's have'} never fired`, detail: 'Check the threshold is reachable, or that it is simply a healthy fleet.', action: { label: 'Show', onClick: () => filterTo('never') } })
    const paused = rules.length - activeCount
    if (paused) items.push({ key: 'paused', tone: 'warning', title: `${paused} rule${paused === 1 ? ' is' : 's are'} paused`, detail: 'Paused rules are kept but never evaluated.', action: { label: 'Show', onClick: () => filterTo('paused') } })
    return items
  }, [noChannelCount, neverActive, rules.length, activeCount, filterTo])

  const na = loading || error
  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader icon={BellRing} title="Alert Rules"
        purpose="No-code rules that watch your fleet and notify you when a threshold is crossed. Evaluated hourly."
        refreshedAt={readAt} onRefresh={load} refreshing={loading}
        actions={<Btn variant="primary" icon={Plus} onClick={startNew}>New rule</Btn>} />

      {/* KPI tiles: each one filters the rule list */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Rules" value={na ? 'N/A' : rules.length} icon={BellRing}
          onClick={() => filterTo('all')} active={tab === 'rules' && statusFilter === 'all'} />
        <StatTile label="Active" value={na ? 'N/A' : activeCount} tone="good" icon={Power}
          sub={na ? undefined : `${rules.length - activeCount} paused`}
          onClick={() => filterTo('active')} active={tab === 'rules' && statusFilter === 'active'} />
        <StatTile label="Times fired" value={na ? 'N/A' : totalFired} tone="accent" icon={AlertTriangle} sub="All rules, all time"
          onClick={() => setTab('insights')} active={tab === 'insights'} />
        <StatTile label="Never fired" value={na ? 'N/A' : neverFired} tone="muted" icon={Clock}
          onClick={() => filterTo('never')} active={tab === 'rules' && statusFilter === 'never'} />
        <StatTile label="No channel" value={na ? 'N/A' : noChannelCount} tone={noChannelCount ? 'danger' : 'default'} icon={MonitorSmartphone}
          sub="Fires but tells nobody" onClick={() => filterTo('nochannel')} active={tab === 'rules' && statusFilter === 'nochannel'} />
      </div>

      <TabBar tabs={[
        { key: 'rules', label: 'Rules', count: na ? undefined : rules.length },
        { key: 'insights', label: 'Insights' },
      ]} value={tab} onChange={setTab} label="Alert rule sections" />

      {tab === 'rules' && (
        <>
          {!loading && !error && rules.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <AttentionList items={attention} subtitle="Rules that will not do what you expect." clearText="Every rule is active, has a channel and has fired at least once." />
              <Panel>
                <PanelHeader icon={BarChart3} title="Rules per metric" subtitle="How many rules watch each signal." />
                <BarsChart bars={ruleBars} summary={ruleBars.map((b) => `${b.label} ${b.value}`).join(', ')} />
              </Panel>
            </div>
          )}

          <Panel>
            <PanelHeader
              icon={BellRing}
              title="Your alert rules"
              subtitle={rules.length > 0 ? `${activeCount} active of ${rules.length}. Select a row for its detail.` : undefined}
            />
            <Toolbar className="mb-3">
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                ariaLabel="Filter by status"
                role="group"
                options={[
                  { key: 'all', label: 'All', count: rules.length },
                  { key: 'active', label: 'Active', count: activeCount },
                  { key: 'paused', label: 'Paused', count: rules.length - activeCount },
                  { key: 'never', label: 'Never fired', count: neverFired },
                  { key: 'nochannel', label: 'No channel', count: noChannelCount },
                ]}
              />
              <SearchInput value={search} onChange={setSearch} placeholder="Search name, metric, site or brand" className="w-full sm:w-64" />
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <ExportButtons rows={visibleRules} columns={exportColumns} title="Alert Rules" />
              </div>
            </Toolbar>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : loading ? (
          <LoadingState label="Loading alert rules" />
        ) : rules.length === 0 ? (
          <EmptyState icon={BellRing} title="No alert rules yet" reason="Add one with New rule to get notified when a threshold is crossed."
            action={<Btn variant="primary" icon={Plus} onClick={startNew}>New rule</Btn>} />
        ) : visibleRules.length === 0 ? (
          <EmptyState icon={BellRing} title="No rules match" reason="Nothing matches this status and search. Clear the filters to see every rule." />
        ) : (
          <>
          <Table>
            <THead>
              <Th sortKey="name" sort={sort} onSort={onSort}>Rule</Th>
              <Th sortKey="condition" sort={sort} onSort={onSort}>Condition</Th>
              <Th>Channels</Th>
              <Th align="right" sortKey="fired" sort={sort} onSort={onSort}>Fired</Th>
              <Th sortKey="last_triggered_at" sort={sort} onSort={onSort}>Last fired</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <Th align="right">Actions</Th>
            </THead>
            <tbody>
              {paged.rows.map((r) => {
                const isActive = r.active !== false
                const noChannel = r.notify_in_app === false && !r.notify_email
                return (
                  <Tr key={r.id} className={isActive ? '' : 'opacity-70'} onClick={() => setOpenRule(r)} ariaLabel={`Open rule ${r.name || 'Untitled rule'}`}>
                    <Td className="max-w-[220px]">
                      <span className="text-gray-200 font-medium line-clamp-2" title={r.name || ''}>{r.name || 'Untitled rule'}</span>
                    </Td>
                    <Td>
                      <span className="text-gray-400">
                        If <span className="text-gray-200">{metricLabel(r.metric)}</span>{' '}
                        is <span className="text-gray-200">{operatorLabel(r.operator)}</span>{' '}
                        <span className="text-gray-200 tabular-nums">{r.threshold ?? 'N/A'}</span>
                      </span>
                      {(r.site_filter || r.brand_filter) && (
                        <span className="block text-[10px] text-gray-500 mt-0.5">
                          {r.site_filter ? `site ${r.site_filter}` : ''}
                          {r.site_filter && r.brand_filter ? ' | ' : ''}
                          {r.brand_filter ? `brand ${r.brand_filter}` : ''}
                        </span>
                      )}
                    </Td>
                    <Td nowrap>
                      <div className="flex gap-1">
                        {r.notify_in_app !== false && <Badge tone="default" icon={MonitorSmartphone}>In-app</Badge>}
                        {r.notify_email && <Badge tone="default" icon={Mail}>Email</Badge>}
                        {noChannel && <Badge tone="warning">No channel</Badge>}
                      </div>
                    </Td>
                    <Td align="right"><span className="tabular-nums text-gray-300">{r.triggered_count ?? 0}</span></Td>
                    <Td nowrap><span className="text-gray-500">{fmtWhen(r.last_triggered_at)}</span></Td>
                    <Td>{isActive ? <Badge tone="good">Active</Badge> : <Badge tone="quiet">Paused</Badge>}</Td>
                    <Td align="right" nowrap>
                      <div className="inline-flex items-center gap-1">
                        <Btn size="xs" variant="ghost" icon={Power} onClick={() => onToggle(r)} busy={busyId === r.id}
                          title={isActive ? 'Pause rule' : 'Activate rule'}>
                          {isActive ? 'Pause' : 'Activate'}
                        </Btn>
                        <Btn size="xs" variant="ghost" icon={Pencil} onClick={() => startEdit(r)} disabled={busyId === r.id} title="Edit rule">
                          Edit
                        </Btn>
                        <Btn size="xs" variant="quiet" icon={Trash2} onClick={() => setConfirmDelete(r)} disabled={busyId === r.id} title="Delete rule">
                          Delete
                        </Btn>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
          <Pager paged={paged} label="rules" />
          </>
        )}
          </Panel>
        </>
      )}

      {tab === 'insights' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader icon={AlertTriangle} title="Times fired per metric" subtitle="All-time firings, summed across the rules on each metric." />
            {loading ? <LoadingState label="Loading" rows={2} /> : error ? <ErrorState message={error} onRetry={load} /> : (
              <BarsChart bars={firedBars} summary={firedBars.map((b) => `${b.label} ${b.value}`).join(', ')}
                emptyText="None of these rules has fired yet." />
            )}
          </Panel>
          <Panel>
            <PanelHeader icon={Flame} title="Rules that fire most" subtitle="A rule that fires constantly is noise; consider raising its threshold." />
            {loading ? <LoadingState label="Loading" rows={2} /> : error ? <ErrorState message={error} onRetry={load} /> : noisiest.length === 0 ? (
              <EmptyState icon={Flame} title="No rule has fired yet" reason="Firings appear here once the hourly evaluation crosses a threshold." />
            ) : (
              <ol className="divide-y divide-gray-800/70">
                {noisiest.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpenRule(r)}
                      className="w-full flex items-center gap-3 py-2 text-left text-xs rounded hover:bg-gray-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                      <span className="flex-1 min-w-0 truncate text-gray-200">{r.name || 'Untitled rule'}</span>
                      <span className="text-gray-500 truncate">{metricLabel(r.metric)}</span>
                      <span className="tabular-nums text-orange-300 w-16 text-right">{r.triggered_count} fired</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      )}

      <Modal
        open={builderOpen}
        title={editId ? 'Edit alert rule' : 'New alert rule'}
        subtitle="Read it as a sentence: if the metric crosses the value, notify me."
        onClose={resetForm}
        footer={(
          <>
            <Btn onClick={resetForm}>Cancel</Btn>
            <Btn type="submit" form="alert-rule-form" variant="primary" icon={editId ? Save : Plus}
              busy={saving} disabled={!!validation}>
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Add rule'}
            </Btn>
          </>
        )}
      >
        <form id="alert-rule-form" onSubmit={save} className="space-y-4">
          <Note icon={Clock} tone="accent">
            Rules are evaluated hourly. Critical alerts notify immediately, warnings batch into a daily
            digest (severity routing via your notification preferences).
          </Note>
          {/* Name */}
          <div>
            <label htmlFor="alert-rule-name" className="block text-xs font-medium text-gray-400 mb-1">Rule name</label>
            <input
              id="alert-rule-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Too many high-risk tyres"
              className={INPUT}
            />
          </div>

          {/* Plain-English condition builder */}
          <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Condition</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
              <span className="text-gray-400">If</span>
              <label><span className="sr-only">Metric</span><Select
                value={form.metric}
                onChange={(v) => setForm((f) => ({ ...f, metric: v }))}
                options={ALERT_METRICS.map((m) => ({ value: m.key, label: m.label }))}
                className="w-full sm:w-52"
              /></label>
              <span className="text-gray-400">is</span>
              <label><span className="sr-only">Operator</span><Select
                value={form.operator}
                onChange={(v) => setForm((f) => ({ ...f, operator: v }))}
                options={ALERT_OPERATORS.map((o) => ({ value: o.key, label: o.label }))}
                className="w-36"
              /></label>
              <input
                aria-label="Threshold value"
                type="number"
                step="any"
                value={form.threshold}
                onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                placeholder="value"
                className={`${INPUT} w-24`}
              />
              <span className="text-gray-400">then notify me.</span>
            </div>
          </div>

          {/* Channels + filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">
                Notify via
                <InfoDot text="How you get told when this rule fires. In-app shows a notification; email sends a message." />
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={form.notifyInApp}
                    onChange={(e) => setForm((f) => ({ ...f, notifyInApp: e.target.checked }))}
                    className="accent-orange-500" />
                  <MonitorSmartphone size={13} className="text-gray-500" /> In-app
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={form.notifyEmail}
                    onChange={(e) => setForm((f) => ({ ...f, notifyEmail: e.target.checked }))}
                    className="accent-orange-500" />
                  <Mail size={13} className="text-gray-500" /> Email
                </label>
              </div>
            </div>

            <div>
              <label htmlFor="alert-rule-site" className="block text-xs font-medium text-gray-400 mb-1">
                Site filter <span className="text-gray-500">(optional)</span>
                <InfoDot text="Limit this rule to one site. Leave blank to watch all sites." />
              </label>
              <input
                id="alert-rule-site"
                value={form.siteFilter}
                onChange={(e) => setForm((f) => ({ ...f, siteFilter: e.target.value }))}
                placeholder="All sites"
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="alert-rule-brand" className="block text-xs font-medium text-gray-400 mb-1">
                Brand filter <span className="text-gray-500">(optional)</span>
                <InfoDot text="Limit this rule to one tyre brand. Leave blank to watch all brands." />
              </label>
              <input
                id="alert-rule-brand"
                value={form.brandFilter}
                onChange={(e) => setForm((f) => ({ ...f, brandFilter: e.target.value }))}
                placeholder="All brands"
                className={INPUT}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
            <input type="checkbox" checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              className="accent-orange-500" />
            Rule is active
            <InfoDot text="Inactive rules are kept but never evaluated." />
          </label>
          {(formError || (validation && form.name)) && (
            <p role="alert" className="flex items-center gap-1 text-xs text-red-300 break-words">
              <AlertTriangle size={12} /> {formError || validation}
            </p>
          )}
        </form>
      </Modal>

      <SideDrawer open={!!openRule} onClose={() => setOpenRule(null)} title={openRule?.name || 'Untitled rule'} subtitle="Alert rule"
        footer={openRule && (
          <>
            <Btn icon={Power} onClick={() => { onToggle(openRule); setOpenRule(null) }}>{openRule.active !== false ? 'Pause' : 'Activate'}</Btn>
            <Btn icon={Pencil} onClick={() => startEdit(openRule)}>Edit</Btn>
            <Btn variant="danger" icon={Trash2} onClick={() => { setConfirmDelete(openRule); setOpenRule(null) }}>Delete</Btn>
          </>
        )}>
        {openRule && (
          <>
            {hasNoChannel(openRule) && <Note icon={AlertTriangle} tone="danger">This rule has no notification channel, so nobody is told when it fires.</Note>}
            <dl>
              <Field label="Condition">If {metricLabel(openRule.metric)} is {operatorLabel(openRule.operator)} {openRule.threshold ?? 'N/A'}</Field>
              <Field label="Site">{openRule.site_filter || 'All sites'}</Field>
              <Field label="Brand">{openRule.brand_filter || 'All brands'}</Field>
              <Field label="Channels">{[openRule.notify_in_app !== false ? 'In-app' : '', openRule.notify_email ? 'Email' : ''].filter(Boolean).join(', ') || 'None'}</Field>
              <Field label="Status">{openRule.active !== false ? 'Active' : 'Paused'}</Field>
              <Field label="Times fired">{openRule.triggered_count ?? 0}</Field>
              <Field label="Last fired">{fmtWhen(openRule.last_triggered_at)}</Field>
              {openRule.created_at && <Field label="Created">{fmtWhen(openRule.created_at)}</Field>}
            </dl>
            <Note icon={Clock} tone="accent">Evaluated hourly. Critical alerts notify immediately, warnings batch into a daily digest.</Note>
          </>
        )}
      </SideDrawer>

      <Modal
        open={!!confirmDelete}
        title="Delete alert rule?"
        subtitle="This cannot be undone."
        onClose={() => setConfirmDelete(null)}
        width="max-w-md"
        footer={(
          <>
            <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
            <Btn variant="danger" icon={Trash2} onClick={() => onDelete(confirmDelete)} busy={!!confirmDelete && busyId === confirmDelete.id}>Delete rule</Btn>
          </>
        )}
      >
        <p className="text-sm text-gray-300">
          The rule <span className="text-gray-100 font-medium">{confirmDelete?.name || 'Untitled rule'}</span> will
          stop being evaluated and its firing history on this rule is removed with it.
        </p>
      </Modal>
    </div>
  )
}
