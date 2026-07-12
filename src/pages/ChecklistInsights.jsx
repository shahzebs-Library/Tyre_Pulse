import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3, ClipboardList, Inbox, CalendarClock, ShieldCheck, CheckCircle2,
  AlertTriangle, RefreshCw, Search, ListChecks, TrendingUp, Layers,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listSubmissions, listTemplates } from '../lib/api/checklists'
import { isValueField, fieldTypeDef } from '../lib/checklist/fieldTypes'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
)

// ── Missing-table heuristic (mirrors Billing.jsx / Checklists.jsx) ───────────
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

// ── Chart options factory (mirrors EngineeringKpi / Analytics style) ─────────
function chartOpts(horizontal = false, yLabel = '', xLabel = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false, labels: { color: '#9ca3af', font: { size: 10 } } },
      title: { display: false },
      tooltip: {
        backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db',
        borderColor: 'var(--hairline)', borderWidth: 1,
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(31,41,55,0.6)' },
        ticks: { color: '#9ca3af', font: { size: 10 }, autoSkip: false },
        title: xLabel ? { display: true, text: xLabel, color: '#6b7280', font: { size: 10 } } : { display: false },
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(31,41,55,0.6)' },
        ticks: { color: '#9ca3af', font: { size: 10 }, precision: 0 },
        title: yLabel ? { display: true, text: yLabel, color: '#6b7280', font: { size: 10 } } : { display: false },
      },
    },
  }
}

// ── Safe date parsing / formatting ───────────────────────────────────────────
function parseDate(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
function submissionDate(s) {
  return parseDate(s?.created_at) || parseDate(s?.submitted_at) || null
}
function fmtDate(v) {
  const d = parseDate(v)
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-'
}
function fmtShort(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
// Monday-anchored start of the ISO week (mutates a clone, not the input).
function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dow = (d.getDay() + 6) % 7 // 0 = Monday
  d.setDate(d.getDate() - dow)
  d.setHours(0, 0, 0, 0)
  return d
}
function weekKey(date) {
  const w = weekStart(date)
  return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`
}

// Interpret a boolean answer: is it answered, and is it a "Yes"/pass?
function boolAnswered(v) {
  return v !== null && v !== undefined && v !== ''
}
function boolIsYes(v) {
  if (v === true) return true
  const s = String(v).trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === 'pass' || s === '1' || s === 'ok'
}

const WEEKS = 10

const STATUS_META = {
  submitted: { label: 'Submitted', chip: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
  approved: { label: 'Approved', chip: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  rejected: { label: 'Rejected', chip: 'bg-red-900/40 text-red-300 border border-red-700/50' },
  draft: { label: 'Draft', chip: 'bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border-dim)]' },
}
function statusChip(s) {
  return STATUS_META[String(s || '').toLowerCase()]?.chip || STATUS_META.draft.chip
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, accent = 'text-[var(--text-primary)]' }) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className="text-[var(--text-muted)] shrink-0" />}
        <span className="text-xs font-medium text-[var(--text-muted)] truncate">{title}</span>
      </div>
      <p className={`text-2xl font-bold leading-tight ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] leading-snug">{sub}</p>}
    </div>
  )
}

function pct(n, d) {
  if (!d) return null
  return (n / d) * 100
}
function fmtPct(v) {
  return v == null ? 'N/A' : `${v.toFixed(1)}%`
}

export default function ChecklistInsights() {
  const { activeCountry } = useSettings()

  const [templates, setTemplates] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [templateFilter, setTemplateFilter] = useState('all')
  const [search, setSearch] = useState('')

  const reqIdRef = useRef(0)

  const country = activeCountry && activeCountry !== 'All' ? activeCountry : undefined

  const loadData = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const [tpls, subs] = await Promise.all([
        listTemplates({ country }),
        listSubmissions({ country }),
      ])
      if (myReq !== reqIdRef.current) return
      setTemplates(Array.isArray(tpls) ? tpls : [])
      setSubmissions(Array.isArray(subs) ? subs : [])
    } catch (err) {
      if (myReq === reqIdRef.current) setError(err)
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [country])

  useEffect(() => { loadData() }, [loadData])

  // Template lookup by id.
  const templateById = useMemo(() => {
    const map = new Map()
    for (const t of templates) if (t?.id != null) map.set(t.id, t)
    return map
  }, [templates])

  // Submissions filtered by the template selector + free-text search.
  const filteredSubs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return submissions.filter((s) => {
      if (!s) return false
      if (templateFilter !== 'all' && String(s.template_id) !== String(templateFilter)) return false
      if (!q) return true
      const hay = [s.site, s.template_name, s.title, s.asset_no].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [submissions, templateFilter, search])

  // ── KPI metrics ─────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const publishedTemplates = templates.filter((t) => t?.status === 'published').length
    const total = filteredSubs.length

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisMonth = filteredSubs.filter((s) => {
      const d = submissionDate(s)
      return d && d >= monthStart
    }).length

    let approved = 0, rejected = 0
    for (const s of filteredSubs) {
      if (s?.status === 'approved') approved++
      else if (s?.status === 'rejected') rejected++
    }
    const approvalRate = pct(approved, approved + rejected)

    // Of submissions whose template requires approval, how many passed (approved).
    let requiresApproval = 0, requiresApprovalPassed = 0
    for (const s of filteredSubs) {
      const tpl = templateById.get(s?.template_id)
      if (tpl?.require_approval) {
        requiresApproval++
        if (s?.status === 'approved') requiresApprovalPassed++
      }
    }
    const approvalPassRate = pct(requiresApprovalPassed, requiresApproval)

    return {
      publishedTemplates,
      totalTemplates: templates.length,
      total,
      thisMonth,
      approved,
      rejected,
      approvalRate,
      requiresApproval,
      requiresApprovalPassed,
      approvalPassRate,
    }
  }, [templates, filteredSubs, templateById])

  // ── Submissions over time (last WEEKS weeks) ─────────────────────────────────
  const weeklyChart = useMemo(() => {
    const axis = []
    const now = new Date()
    for (let i = WEEKS - 1; i >= 0; i--) {
      const d = weekStart(now)
      d.setDate(d.getDate() - i * 7)
      axis.push(d)
    }
    const counts = new Map(axis.map((d) => [weekKey(d), 0]))
    let anyDated = false
    for (const s of filteredSubs) {
      const d = submissionDate(s)
      if (!d) continue
      const k = weekKey(d)
      if (counts.has(k)) { counts.set(k, counts.get(k) + 1); anyDated = true }
    }
    if (!anyDated) return null
    return {
      data: {
        labels: axis.map(fmtShort),
        datasets: [{
          label: 'Submissions',
          data: axis.map((d) => counts.get(weekKey(d)) || 0),
          backgroundColor: 'rgba(34,197,94,0.65)',
          borderColor: 'rgb(34,197,94)',
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
    }
  }, [filteredSubs])

  // ── By template (count, last submitted, status mix) ──────────────────────────
  const byTemplate = useMemo(() => {
    const map = new Map()
    for (const s of filteredSubs) {
      const id = s?.template_id ?? '—'
      let row = map.get(id)
      if (!row) {
        row = {
          id,
          name: s?.template_name || templateById.get(id)?.name || 'Unknown template',
          count: 0, last: null,
          submitted: 0, approved: 0, rejected: 0, draft: 0,
        }
        map.set(id, row)
      }
      row.count++
      const d = submissionDate(s)
      if (d && (!row.last || d > row.last)) row.last = d
      const st = String(s?.status || 'submitted').toLowerCase()
      if (st === 'approved') row.approved++
      else if (st === 'rejected') row.rejected++
      else if (st === 'draft') row.draft++
      else row.submitted++
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [filteredSubs, templateById])

  // ── By site (top sites) ──────────────────────────────────────────────────────
  const bySite = useMemo(() => {
    const map = new Map()
    for (const s of filteredSubs) {
      const site = (s?.site && String(s.site).trim()) || 'Unassigned'
      map.set(site, (map.get(site) || 0) + 1)
    }
    return [...map.entries()]
      .map(([site, count]) => ({ site, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
  }, [filteredSubs])

  const siteChart = useMemo(() => {
    if (!bySite.length) return null
    return {
      data: {
        labels: bySite.map((s) => s.site),
        datasets: [{
          label: 'Submissions',
          data: bySite.map((s) => s.count),
          backgroundColor: 'rgba(59,130,246,0.6)',
          borderColor: 'rgb(59,130,246)',
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
    }
  }, [bySite])

  // ── Boolean field pass-rates ─────────────────────────────────────────────────
  const boolPassRates = useMemo(() => {
    // Group submissions by template for efficient field scans.
    const subsByTpl = new Map()
    for (const s of filteredSubs) {
      const id = s?.template_id
      if (!subsByTpl.has(id)) subsByTpl.set(id, [])
      subsByTpl.get(id).push(s)
    }

    const rows = []
    for (const tpl of templates) {
      if (templateFilter !== 'all' && String(tpl?.id) !== String(templateFilter)) continue
      const fields = Array.isArray(tpl?.fields) ? tpl.fields : []
      const boolFields = fields.filter((f) => f?.type === 'boolean' && isValueField(f.type))
      if (!boolFields.length) continue
      const subs = subsByTpl.get(tpl.id) || []
      if (!subs.length) continue

      for (const f of boolFields) {
        let responses = 0, yes = 0
        for (const s of subs) {
          const v = s?.answers?.[f.id]
          if (!boolAnswered(v)) continue
          responses++
          if (boolIsYes(v)) yes++
        }
        if (responses < 1) continue
        rows.push({
          key: `${tpl.id}:${f.id}`,
          template: tpl.name || 'Untitled',
          question: f.label || fieldTypeDef(f.type)?.label || 'Yes / No',
          yesPct: (yes / responses) * 100,
          responses,
        })
      }
    }
    return rows.sort((a, b) => a.yesPct - b.yesPct)
  }, [templates, filteredSubs, templateFilter])

  const hasActivity = submissions.length > 0 || templates.length > 0

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Checklist Insights" subtitle="Analytics across checklist templates and submissions" icon={BarChart3} />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="card animate-pulse h-72" />
          <div className="card animate-pulse h-72" />
        </div>
      </div>
    )
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (error) {
    const missing = isMissingRelation(error)
    return (
      <div className="space-y-6">
        <PageHeader title="Checklist Insights" subtitle="Analytics across checklist templates and submissions" icon={BarChart3} />
        <div className="card border border-red-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[var(--text-primary)] font-semibold">Couldn&apos;t load checklist insights.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                {missing
                  ? <>The checklist tables aren&apos;t applied to this database yet. Apply{' '}
                    <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V123_CHECKLIST_TEMPLATES.sql</span>, then reload.</>
                  : (error.message || 'An unexpected error occurred.')}
              </p>
              <button onClick={loadData} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!hasActivity) {
    return (
      <div className="space-y-6">
        <PageHeader title="Checklist Insights" subtitle="Analytics across checklist templates and submissions" icon={BarChart3} />
        <div className="card text-center py-16 space-y-3">
          <ListChecks size={34} className="mx-auto text-[var(--text-muted)]" />
          <p className="text-[var(--text-primary)] font-semibold">No checklist activity yet</p>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Once teams publish templates and capture submissions, this page fills with submission trends,
            approval rates, per-site volume, and question-level pass rates.
          </p>
          <Link to="/checklists" className="btn-primary inline-flex items-center gap-2 text-sm mt-2">
            <ClipboardList size={15} /> Go to Checklists
          </Link>
        </div>
      </div>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Checklist Insights"
        subtitle={`Analytics across ${templates.length} template${templates.length === 1 ? '' : 's'} and ${submissions.length} submission${submissions.length === 1 ? '' : 's'}${country ? ` · ${country}` : ''}`}
        icon={BarChart3}
        updatedAt={new Date()}
        onRefresh={loadData}
        refreshing={loading}
      />

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)]">Template</label>
          <select
            className="input w-56 text-sm"
            value={templateFilter}
            onChange={(e) => setTemplateFilter(e.target.value)}
          >
            <option value="all">All templates</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name || 'Untitled'}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-xs text-[var(--text-muted)]">Search</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              className="input w-full text-sm pl-9"
              placeholder="Filter by site, template, asset or title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {(templateFilter !== 'all' || search) && (
          <button
            onClick={() => { setTemplateFilter('all'); setSearch('') }}
            className="btn-secondary text-xs px-3 py-2"
          >
            Clear
          </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard title="Published templates" value={metrics.publishedTemplates}
          sub={`${metrics.totalTemplates} total`} icon={Layers} />
        <KpiCard title="Submissions" value={metrics.total.toLocaleString()}
          sub={templateFilter === 'all' ? 'All templates' : 'Filtered'} icon={Inbox} />
        <KpiCard title="This month" value={metrics.thisMonth.toLocaleString()}
          sub="By capture date" icon={CalendarClock} />
        <KpiCard title="Approval rate" value={fmtPct(metrics.approvalRate)}
          sub={`${metrics.approved} approved · ${metrics.rejected} rejected`}
          icon={CheckCircle2}
          accent={metrics.approvalRate == null ? 'text-[var(--text-primary)]'
            : metrics.approvalRate >= 85 ? 'text-green-400'
            : metrics.approvalRate >= 60 ? 'text-amber-400' : 'text-red-400'} />
        <KpiCard title="Approval pass rate" value={fmtPct(metrics.approvalPassRate)}
          sub={`${metrics.requiresApprovalPassed} of ${metrics.requiresApproval} required`}
          icon={ShieldCheck}
          accent={metrics.approvalPassRate == null ? 'text-[var(--text-primary)]'
            : metrics.approvalPassRate >= 85 ? 'text-green-400'
            : metrics.approvalPassRate >= 60 ? 'text-amber-400' : 'text-red-400'} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
              <TrendingUp size={15} className="text-[var(--text-muted)]" /> Submissions over time
            </h3>
            <span className="text-xs text-[var(--text-muted)]">Last {WEEKS} weeks</span>
          </div>
          {weeklyChart ? (
            <div style={{ height: 280 }}>
              <Bar data={weeklyChart.data} options={chartOpts(false, 'Submissions', 'Week')} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">
              No dated submissions in this range
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
              <BarChart3 size={15} className="text-[var(--text-muted)]" /> Top sites by volume
            </h3>
            <span className="text-xs text-[var(--text-muted)]">Top {bySite.length}</span>
          </div>
          {siteChart ? (
            <div style={{ height: 280 }}>
              <Bar data={siteChart.data} options={chartOpts(true, '', 'Submissions')} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">
              No site data available
            </div>
          )}
        </div>
      </div>

      {/* By template table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-dim)] flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">By template</h3>
          <span className="text-xs text-[var(--text-muted)]">{byTemplate.length} active</span>
        </div>
        {byTemplate.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">No submissions match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-dim)]">
                  <th className="px-4 py-2 font-medium">Template</th>
                  <th className="px-4 py-2 font-medium text-right">Submissions</th>
                  <th className="px-4 py-2 font-medium">Last submitted</th>
                  <th className="px-4 py-2 font-medium">Status mix</th>
                </tr>
              </thead>
              <tbody>
                {byTemplate.map((row) => (
                  <tr key={String(row.id)} className="border-b border-[var(--border-dim)] last:border-0">
                    <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{row.name}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--text-primary)]">{row.count.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)]">{row.last ? fmtDate(row.last) : '-'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {row.submitted > 0 && <span className={`text-[11px] px-1.5 py-0.5 rounded ${statusChip('submitted')}`}>{row.submitted} submitted</span>}
                        {row.approved > 0 && <span className={`text-[11px] px-1.5 py-0.5 rounded ${statusChip('approved')}`}>{row.approved} approved</span>}
                        {row.rejected > 0 && <span className={`text-[11px] px-1.5 py-0.5 rounded ${statusChip('rejected')}`}>{row.rejected} rejected</span>}
                        {row.draft > 0 && <span className={`text-[11px] px-1.5 py-0.5 rounded ${statusChip('draft')}`}>{row.draft} draft</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Boolean field pass-rates */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-dim)] flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Yes / No question pass rates</h3>
          <span className="text-xs text-[var(--text-muted)]">Lowest pass rate first</span>
        </div>
        {boolPassRates.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            No answered Yes/No questions yet. Add boolean fields to templates to surface quality signals here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-dim)]">
                  <th className="px-4 py-2 font-medium">Template</th>
                  <th className="px-4 py-2 font-medium">Question</th>
                  <th className="px-4 py-2 font-medium text-right">Yes %</th>
                  <th className="px-4 py-2 font-medium text-right">Responses</th>
                </tr>
              </thead>
              <tbody>
                {boolPassRates.map((r) => {
                  const color = r.yesPct >= 85 ? 'text-green-400' : r.yesPct >= 60 ? 'text-amber-400' : 'text-red-400'
                  return (
                    <tr key={r.key} className="border-b border-[var(--border-dim)] last:border-0">
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{r.template}</td>
                      <td className="px-4 py-2.5 text-[var(--text-primary)]">{r.question}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${color}`}>{r.yesPct.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">{r.responses}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
