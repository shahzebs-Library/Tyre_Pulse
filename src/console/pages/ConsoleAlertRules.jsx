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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BellRing, Plus, Pencil, Trash2, RefreshCw, AlertTriangle, Info,
  Power, Save, X, Clock, Mail, MonitorSmartphone, BarChart3,
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
import { BarsChart } from '../components/ui/charts'

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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRules(await listAlertRules())
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
  }

  function startEdit(r) {
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
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
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

  const visibleRules = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rules.filter((r) => {
      const isActive = r.active !== false
      if (statusFilter === 'active' && !isActive) return false
      if (statusFilter === 'paused' && isActive) return false
      if (!q) return true
      return [r.name, metricLabel(r.metric), r.site_filter, r.brand_filter]
        .some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [rules, statusFilter, search])

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

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2">
            <BellRing size={18} className="text-orange-400" /> Alert Rules
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            No-code rules that watch your fleet and notify you when a threshold is crossed.
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
      </header>

      {/* Honest evaluation note */}
      <Note icon={Clock} tone="accent">
        Rules are evaluated hourly. Critical alerts notify immediately, warnings batch into a daily
        digest (severity routing via your notification preferences).
      </Note>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Rules" value={(loading || error) ? 'N/A' : rules.length} icon={BellRing} />
        <StatTile label="Active" value={(loading || error) ? 'N/A' : activeCount} tone="good" icon={Power}
          sub={(loading || error) ? undefined : `${rules.length - activeCount} paused`} />
        <StatTile label="Times fired" value={(loading || error) ? 'N/A' : totalFired} tone="accent" icon={AlertTriangle} sub="All rules, all time" />
        <StatTile label="Never fired" value={(loading || error) ? 'N/A' : neverFired} tone="muted" icon={Clock} />
      </div>

      {/* Builder */}
      <Panel tone={editId ? 'accent' : undefined}>
        <PanelHeader
          icon={editId ? Pencil : Plus}
          title={editId ? 'Edit alert rule' : 'New alert rule'}
          subtitle="Read it as a sentence: if the metric crosses the value, notify me."
          actions={editId && <Btn size="xs" variant="quiet" icon={X} onClick={resetForm}>Cancel edit</Btn>}
        />
        <form onSubmit={save} className="space-y-4">
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

          {/* Active + submit */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="accent-orange-500" />
              Rule is active
              <InfoDot text="Inactive rules are kept but never evaluated." />
            </label>
            <div className="flex items-center gap-2">
              {(formError || (validation && form.name)) && (
                <span role="alert" className="flex items-center gap-1 text-xs text-red-300 break-words">
                  <AlertTriangle size={12} /> {formError || validation}
                </span>
              )}
              <Btn type="submit" variant="primary" size="md" icon={editId ? Save : Plus}
                busy={saving} disabled={!!validation}>
                {saving ? 'Saving...' : editId ? 'Save changes' : 'Add rule'}
              </Btn>
            </div>
          </div>
        </form>
      </Panel>

      {/* Charts */}
      {!loading && !error && rules.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader icon={BarChart3} title="Rules per metric" subtitle="How many rules watch each signal." />
            <BarsChart bars={ruleBars} summary={ruleBars.map((b) => `${b.label} ${b.value}`).join(', ')} />
          </Panel>
          <Panel>
            <PanelHeader icon={AlertTriangle} title="Times fired per metric" subtitle="All-time firings, summed across the rules on each metric." />
            <BarsChart bars={firedBars} summary={firedBars.map((b) => `${b.label} ${b.value}`).join(', ')}
              emptyText="None of these rules has fired yet." />
          </Panel>
        </div>
      )}

      {/* Existing rules */}
      <Panel>
        <PanelHeader
          icon={BellRing}
          title="Your alert rules"
          subtitle={rules.length > 0 ? `${activeCount} active of ${rules.length}` : undefined}
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
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, metric, site or brand" className="w-full sm:w-64" />
        </Toolbar>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : loading ? (
          <LoadingState label="Loading alert rules" />
        ) : rules.length === 0 ? (
          <EmptyState icon={BellRing} title="No alert rules yet" reason="Add one above to get notified when a threshold is crossed." />
        ) : visibleRules.length === 0 ? (
          <EmptyState icon={BellRing} title="No rules match" reason="Nothing matches this status and search. Clear the filters to see every rule." />
        ) : (
          <Table>
            <THead>
              <Th>Rule</Th>
              <Th>Condition</Th>
              <Th>Channels</Th>
              <Th align="right">Fired</Th>
              <Th>Last fired</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </THead>
            <tbody>
              {visibleRules.map((r) => {
                const isActive = r.active !== false
                const noChannel = r.notify_in_app === false && !r.notify_email
                return (
                  <Tr key={r.id} className={isActive ? '' : 'opacity-70'}>
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
        )}
      </Panel>

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
