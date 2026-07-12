import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ClipboardList, Plus, Search, Filter, FileText, PenLine, ShieldCheck,
  Play, Pencil, RefreshCw, AlertTriangle, ChevronRight, ListChecks,
  Layers, Inbox,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { listTemplates, listSubmissions } from '../lib/api/checklists'
import { isValueField } from '../lib/checklist/fieldTypes'

const ELEVATED = ['admin', 'manager', 'director']

// The friendly "tables not deployed yet" heuristic — mirrors Billing.jsx.
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

const STATUS_BADGE = {
  submitted: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  approved: 'bg-green-900/40 text-green-300 border border-green-700/50',
  rejected: 'bg-red-900/40 text-red-300 border border-red-700/50',
  in_review: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  pending: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  draft: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
function statusBadge(s) {
  return STATUS_BADGE[String(s || '').toLowerCase()] || 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'
}
function prettyStatus(s) {
  return String(s || 'submitted').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function fieldCount(tpl) {
  return (Array.isArray(tpl?.fields) ? tpl.fields : []).filter((f) => isValueField(f?.type)).length
}
function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const TABS = [
  { key: 'templates', label: 'Templates', icon: Layers },
  { key: 'submissions', label: 'Recent Submissions', icon: Inbox },
]

export default function Checklists() {
  const navigate = useNavigate()
  const { activeCountry } = useSettings()
  const { profile } = useAuth()
  const isElevated = ELEVATED.includes(String(profile?.role || '').toLowerCase())

  const [tab, setTab] = useState('templates')
  const [templates, setTemplates] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(false)
    try {
      const [tpls, subs] = await Promise.all([
        listTemplates({ status: 'published', country: activeCountry }),
        listSubmissions({ country: activeCountry }).catch(() => []),
      ])
      setTemplates(Array.isArray(tpls) ? tpls : [])
      setSubmissions(Array.isArray(subs) ? subs : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(err?.message || 'Could not load checklists.')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => {
    const set = new Set()
    for (const t of templates) if (t?.category) set.add(t.category)
    return Array.from(set).sort()
  }, [templates])

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter((t) => {
      if (category !== 'all' && (t.category || '') !== category) return false
      if (!q) return true
      return [t.name, t.description, t.category].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    })
  }, [templates, search, category])

  const filteredSubmissions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return submissions
    return submissions.filter((s) =>
      [s.template_name, s.title, s.asset_no, s.site, s.status].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
  }, [submissions, search])

  const headerActions = isElevated ? (
    <button onClick={() => navigate('/checklist-builder')} className="btn-primary text-sm inline-flex items-center gap-2">
      <Plus size={15} /> New template
    </button>
  ) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Checklists"
        subtitle="Published inspection and compliance checklists — fill, submit, and route for approval."
        icon={ClipboardList}
        actions={headerActions}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-dim)]">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = key === 'templates' ? templates.length : submissions.length
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px transition-colors ${
                tab === key ? 'border-green-500 text-green-400' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon size={15} /> {label}
              {!loading && !missing && <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className="input pl-9"
            placeholder={tab === 'templates' ? 'Search checklists…' : 'Search submissions…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {tab === 'templates' && categories.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-[var(--text-muted)]" />
            <select className="input py-2" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Migration hint */}
      {missing && (
        <div className="card border border-amber-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-amber-300 font-medium">Checklists aren't enabled on this database yet.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V123_CHECKLIST_TEMPLATES.sql</span> to create the
                {' '}<span className="font-mono">checklist_templates</span> and <span className="font-mono">checklist_submissions</span> tables, then reload.
              </p>
              <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !missing && (
        <div className="card border border-red-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-red-300 font-medium">Couldn't load checklists.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
              <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !missing && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-5 w-40 bg-[var(--input-bg)] rounded" />
              <div className="h-3 w-full bg-[var(--input-bg)] rounded" />
              <div className="h-3 w-2/3 bg-[var(--input-bg)] rounded" />
              <div className="h-8 w-24 bg-[var(--input-bg)] rounded mt-2" />
            </div>
          ))}
        </div>
      )}

      {/* Templates tab */}
      {!loading && !missing && !error && tab === 'templates' && (
        filteredTemplates.length === 0 ? (
          <div className="card text-center py-16 space-y-3">
            <ListChecks size={34} className="mx-auto text-[var(--text-muted)]" />
            <p className="text-[var(--text-primary)] font-semibold">
              {templates.length === 0 ? 'No checklists yet' : 'No checklists match your filters'}
            </p>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
              {templates.length === 0
                ? 'Published checklist templates will appear here. Create one to start capturing structured inspections.'
                : 'Try clearing the search or category filter.'}
            </p>
            {isElevated && templates.length === 0 && (
              <button onClick={() => navigate('/checklist-builder')} className="btn-primary text-sm inline-flex items-center gap-2 mx-auto">
                <Plus size={15} /> Create a checklist
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((tpl) => (
              <div key={tpl.id} className="card flex flex-col group">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-[rgba(22,163,74,0.2)] flex items-center justify-center shrink-0">
                    <FileText size={18} className="text-brand-bright" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[var(--text-primary)] font-semibold truncate">{tpl.name || 'Untitled checklist'}</h3>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {tpl.category || 'General'} · v{tpl.version ?? 1}
                    </p>
                  </div>
                </div>

                {tpl.description && (
                  <p className="text-sm text-[var(--text-muted)] mt-3 line-clamp-2">{tpl.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <span className="badge text-xs bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)] inline-flex items-center gap-1">
                    <ListChecks size={11} /> {fieldCount(tpl)} field{fieldCount(tpl) === 1 ? '' : 's'}
                  </span>
                  {tpl.require_signature && (
                    <span className="badge text-xs bg-sky-900/40 text-sky-300 border border-sky-700/50 inline-flex items-center gap-1">
                      <PenLine size={11} /> Signature
                    </span>
                  )}
                  {tpl.require_approval && (
                    <span className="badge text-xs bg-purple-900/40 text-purple-300 border border-purple-700/50 inline-flex items-center gap-1">
                      <ShieldCheck size={11} /> Approval
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[var(--border-dim)]">
                  <button
                    onClick={() => navigate(`/checklists/${tpl.id}/run`)}
                    className="btn-primary text-sm inline-flex items-center gap-2 flex-1 justify-center"
                  >
                    <Play size={15} /> Fill
                  </button>
                  {isElevated && (
                    <Link
                      to={`/checklist-builder/${tpl.id}`}
                      className="btn-secondary text-sm inline-flex items-center gap-1.5"
                      title="Edit this template"
                    >
                      <Pencil size={14} /> Edit
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Submissions tab */}
      {!loading && !missing && !error && tab === 'submissions' && (
        filteredSubmissions.length === 0 ? (
          <div className="card text-center py-16 space-y-3">
            <Inbox size={34} className="mx-auto text-[var(--text-muted)]" />
            <p className="text-[var(--text-primary)] font-semibold">
              {submissions.length === 0 ? 'No submissions yet' : 'No submissions match your search'}
            </p>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
              {submissions.length === 0
                ? 'Completed checklists will appear here once they are filled and submitted.'
                : 'Try a different search term.'}
            </p>
          </div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-header text-left">Checklist</th>
                  <th className="table-header text-left">Asset / Site</th>
                  <th className="table-header text-left">Status</th>
                  <th className="table-header text-left">Submitted</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody>
                {filteredSubmissions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => navigate(`/checklists/submission/${s.id}`)}
                    className="border-t border-[var(--border-dim)] cursor-pointer"
                  >
                    <td className="table-cell">
                      <div className="font-medium text-[var(--text-primary)]">{s.title || s.template_name || 'Checklist'}</div>
                      {s.title && s.template_name && s.title !== s.template_name && (
                        <div className="text-xs text-[var(--text-muted)]">{s.template_name}</div>
                      )}
                    </td>
                    <td className="table-cell">
                      <div className="text-[var(--text-primary)]">{s.asset_no || '-'}</div>
                      <div className="text-xs text-[var(--text-muted)]">{[s.site, s.country].filter(Boolean).join(' · ') || '-'}</div>
                    </td>
                    <td className="table-cell">
                      <span className={`badge text-xs ${statusBadge(s.status)}`}>{prettyStatus(s.status)}</span>
                    </td>
                    <td className="table-cell whitespace-nowrap text-[var(--text-muted)]">
                      {fmtDate(s.submitted_at || s.created_at)}
                    </td>
                    <td className="table-cell text-right">
                      <ChevronRight size={16} className="text-[var(--text-muted)] inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
