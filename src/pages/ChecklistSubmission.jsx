import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ClipboardCheck, ArrowLeft, ChevronRight, AlertTriangle, AlertOctagon,
  Star, PenLine, RefreshCw, CheckCircle2, XCircle,
} from 'lucide-react'
import { getSubmission } from '../lib/api/checklists'
import { isLayoutField } from '../lib/checklist/fieldTypes'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'

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
function fmtDateTime(v) {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString()
}
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

// A submission stores answers keyed by field id, but does not embed the template.
// We reconstruct a readable list from whatever the submission carries: answers,
// photos, and (when available) any embedded field metadata. Answers are the
// source of truth for what was captured.
function displayValue(value) {
  if (value == null || value === '') return '-'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

export default function ChecklistSubmission() {
  const { id } = useParams()
  const navigate = useNavigate()
  const back = useCallback(() => navigate('/checklists'), [navigate])

  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const row = await getSubmission(id)
      if (!row) { setSub(null); setLoadError('not_found'); return }
      setSub(row)
    } catch (err) {
      setLoadError(isMissingRelation(err) ? 'missing' : (err?.message || 'Could not load the submission.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const answers = useMemo(() => (sub?.answers && typeof sub.answers === 'object' ? sub.answers : {}), [sub])
  const photosByField = useMemo(() => (sub?.photos && typeof sub.photos === 'object' ? sub.photos : {}), [sub])

  // Build an ordered, labelled row list. Prefer embedded template fields if the
  // submission carries them (defensive), else derive from answer/photo keys.
  const rows = useMemo(() => {
    const embedded = Array.isArray(sub?.template_fields) ? sub.template_fields
      : Array.isArray(sub?.fields) ? sub.fields : null
    if (embedded && embedded.length) {
      return embedded
        .filter((f) => f && !isLayoutField(f.type))
        .map((f) => ({
          id: f.id,
          type: f.type,
          label: f.label || f.id,
          value: answers?.[f.id],
          photos: Array.isArray(photosByField?.[f.id]) ? photosByField[f.id] : [],
        }))
    }
    const keys = new Set([...Object.keys(answers || {}), ...Object.keys(photosByField || {})])
    return Array.from(keys).map((k) => ({
      id: k,
      type: null,
      label: k,
      value: answers?.[k],
      photos: Array.isArray(photosByField?.[k]) ? photosByField[k] : [],
    }))
  }, [sub, answers, photosByField])

  // ── Loading / error / not-found ──
  if (loading) {
    return (
      <div className="space-y-4">
        <BackLink onClick={back} />
        <div className="card animate-pulse space-y-3">
          <div className="h-6 w-56 bg-[var(--input-bg)] rounded" />
          <div className="h-4 w-80 bg-[var(--input-bg)] rounded" />
        </div>
        <div className="card animate-pulse h-72" />
      </div>
    )
  }

  if (loadError === 'missing') {
    return (
      <div className="space-y-4">
        <BackLink onClick={back} />
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Checklists aren't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V123_CHECKLIST_TEMPLATES.sql</span>, then reload.
            </p>
            <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2"><RefreshCw size={14} /> Retry</button>
          </div>
        </div>
      </div>
    )
  }

  if (loadError === 'not_found' || !sub) {
    return (
      <div className="space-y-4">
        <BackLink onClick={back} />
        <div className="card text-center py-12 space-y-3">
          <AlertOctagon size={32} className="mx-auto text-red-400" />
          <p className="text-[var(--text-primary)] font-semibold">Submission not found</p>
          <p className="text-sm text-[var(--text-muted)]">
            {loadError && loadError !== 'not_found' ? loadError : 'This submission may have been deleted or you do not have access.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={load} className="btn-secondary text-sm">Retry</button>
            <button onClick={back} className="btn-primary text-sm">Back to Checklists</button>
          </div>
        </div>
      </div>
    )
  }

  const label = sub.title || sub.template_name || 'Checklist submission'

  return (
    <div className="space-y-4 pb-24">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <button onClick={back} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
          <ArrowLeft size={13} /> Checklists
        </button>
        <ChevronRight size={12} />
        <span className="text-[var(--text-dim)] truncate max-w-[50vw]">{label} · #{String(sub.id).slice(0, 8).toUpperCase()}</span>
      </div>

      {/* Header card */}
      <div className="card">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-[rgba(22,163,74,0.2)] flex items-center justify-center shrink-0">
              <ClipboardCheck size={18} className="text-brand-bright" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[var(--text-primary)] truncate">{label}</h1>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">
                {sub.template_name || 'Checklist'}{sub.template_version ? ` · v${sub.template_version}` : ''}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`badge text-xs ${statusBadge(sub.status)}`}>{prettyStatus(sub.status)}</span>
                {sub.asset_no && <span className="badge text-xs bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]">{sub.asset_no}</span>}
                {sub.site && <span className="badge text-xs bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]">{sub.site}</span>}
                {sub.country && <span className="badge text-xs bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]">{sub.country}</span>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Submitted</p>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{fmtDateTime(sub.submitted_at || sub.created_at)}</p>
            {sub.printed_name && <p className="text-xs text-[var(--text-muted)] mt-0.5">by {sub.printed_name}</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Answers */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Responses</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">No responses were captured.</p>
            ) : (
              <div className="divide-y divide-[var(--border-dim)]">
                {rows.map((r) => (
                  <div key={r.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">{r.label}</p>
                    {r.type === 'rating' ? (
                      <div className="flex items-center gap-1 mt-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} size={16} className={Number(r.value) >= n ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)]'} />
                        ))}
                        {Number(r.value) > 0 && <span className="ml-1.5 text-xs text-[var(--text-muted)]">{Number(r.value)}/5</span>}
                      </div>
                    ) : r.type === 'boolean' || typeof r.value === 'boolean' ? (
                      <p className="mt-1">
                        {r.value === true || r.value === 'true'
                          ? <span className="inline-flex items-center gap-1 text-sm text-green-400"><CheckCircle2 size={14} /> Yes</span>
                          : r.value === false || r.value === 'false'
                            ? <span className="inline-flex items-center gap-1 text-sm text-red-400"><XCircle size={14} /> No</span>
                            : <span className="text-sm text-[var(--text-primary)]">-</span>}
                      </p>
                    ) : (
                      <p className="text-sm text-[var(--text-primary)] mt-0.5 whitespace-pre-wrap break-words">{displayValue(r.value)}</p>
                    )}

                    {r.photos.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {r.photos.map((url, i) => (
                          <a key={`${r.id}-${i}`} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt={`Photo ${i + 1}`} className="h-16 w-16 object-cover rounded-lg border border-[var(--border-dim)] hover:border-green-500 transition-colors" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Signature */}
          {sub.signature_data && (
            <div className="card space-y-2">
              <div className="flex items-center gap-2">
                <PenLine size={16} className="text-brand-bright" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Signature</h2>
              </div>
              <img src={sub.signature_data} alt="Signature" className="h-28 rounded-lg border border-[var(--border-dim)] bg-white" />
              {sub.printed_name && <p className="text-xs text-[var(--text-muted)]">Signed by {sub.printed_name}</p>}
            </div>
          )}
        </div>

        {/* Approval rail */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-4 space-y-4">
            <EntityApprovalPanel
              entityType="checklist_submission"
              entityId={sub.id}
              entityLabel={sub.title || sub.template_name || sub.id}
              context={{
                template: sub.template_name,
                site: sub.site,
                country: sub.country,
                asset_no: sub.asset_no,
              }}
              title="Checklist Approval"
              onStateChange={() => {}}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function BackLink({ onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
      <ArrowLeft size={15} /> Back to Checklists
    </button>
  )
}
