/**
 * checklistsAnalytics - the pure engine behind the Checklists workspace
 * (/checklists): the templates grid, the submissions register and the
 * headline figures above them.
 *
 * The page used to filter templates and submissions inline; the rules now
 * live here, with the status buckets, the evidence reading and the export
 * rows. Target resolution (asset / site from columns or legacy answers) and
 * the checklist date come from ./checklistMonthly, never re-derived.
 *
 * No I/O. Time is injected (`now`, epoch ms).
 *
 * HONEST NULLS: an approval rate with nothing decided is null (N/A), not 0%.
 */
import { submissionTarget, submissionDate } from './checklistMonthly'
import { isValueField } from './checklist/fieldTypes'

const DAY_MS = 24 * 60 * 60 * 1000

/** Submission status buckets. Unknown statuses fall into "other", never guessed. */
export const STATUS_BUCKETS = [
  { key: 'approved', label: 'Approved', statuses: ['approved'] },
  { key: 'pending', label: 'Awaiting review', statuses: ['submitted', 'in_review', 'pending', 'pending_approval'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'draft', label: 'Draft', statuses: ['draft'] },
]

export const EVIDENCE_OPTIONS = [
  { key: 'exact', label: 'Exact revision' },
  { key: 'gap', label: 'Evidence gaps' },
  { key: 'legacy_unavailable', label: 'Legacy unavailable' },
  { key: 'missing_revision', label: 'Missing revision' },
]

export function statusBucket(status) {
  const s = String(status || 'submitted').toLowerCase()
  return STATUS_BUCKETS.find((b) => b.statuses.includes(s))?.key || 'other'
}

export function prettyStatus(s) {
  return String(s || 'submitted').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function evidenceLabel(snapshotStatus) {
  if (snapshotStatus === 'exact') return 'Exact template evidence'
  if (snapshotStatus === 'missing_revision') return 'Template revision missing'
  return 'Legacy evidence unavailable'
}

/** Number of answerable (non-layout) fields on a template. */
export function fieldCount(tpl) {
  return (Array.isArray(tpl?.fields) ? tpl.fields : []).filter((f) => isValueField(f?.type)).length
}

export function templateCategories(templates = []) {
  return [...new Set((templates || []).map((t) => t?.category).filter(Boolean))].sort()
}

/** Narrow templates by category and free text (name, description, category). */
export function filterTemplates(templates = [], { query = '', category = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (templates || []).filter((t) => {
    if (category !== 'all' && (t?.category || '') !== category) return false
    if (!q) return true
    return [t?.name, t?.description, t?.category].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
  })
}

/** Template headline figures. */
export function summarizeTemplates(templates = []) {
  const list = templates || []
  return {
    total: list.length,
    requireApproval: list.filter((t) => t?.require_approval).length,
    requireSignature: list.filter((t) => t?.require_signature).length,
    targeted: list.filter((t) => Array.isArray(t?.assignee_roles) && t.assignee_roles.length > 0).length,
    categories: templateCategories(list).length,
  }
}

const templateFor = (templates, id) => (templates || []).find((t) => String(t?.id) === String(id))

/** The ISO day a submission belongs to: the sheet's own date, else when received. */
export function submissionDay(sub, templates = []) {
  const d = submissionDate(sub, templateFor(templates, sub?.template_id)?.fields)
  if (d?.year == null) return null
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/**
 * Narrow submissions. `templateId` pins one template (the ?template= deep
 * link); `evidence` is an EVIDENCE_OPTIONS key or 'all'; `bucket` a
 * STATUS_BUCKETS key or 'all'; `from`/`to` bound the checklist day inclusively.
 */
export function filterSubmissions(submissions = [], templates = [], {
  templateId = '', evidence = 'all', bucket = 'all', query = '', from = '', to = '',
} = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (submissions || []).filter((s) => {
    if (templateId && String(s?.template_id) !== String(templateId)) return false
    if (evidence === 'gap' && s?.template_snapshot_status === 'exact') return false
    if (evidence !== 'all' && evidence !== 'gap' && s?.template_snapshot_status !== evidence) return false
    if (bucket !== 'all' && statusBucket(s?.status) !== bucket) return false
    if (from || to) {
      const day = submissionDay(s, templates)
      if (!day) return false
      if (from && day < from) return false
      if (to && day > to) return false
    }
    if (q) {
      const target = submissionTarget(s, templateFor(templates, s?.template_id)?.fields)
      const hit = [s?.template_name, s?.title, target.assetNo, target.site, s?.status]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
      if (!hit) return false
    }
    return true
  })
}

/** Submission headline figures. */
export function summarizeSubmissions(submissions = [], now = Date.now()) {
  const counts = { approved: 0, pending: 0, rejected: 0, draft: 0, other: 0 }
  let gaps = 0
  let recent = 0
  const assets = new Set()
  for (const s of submissions || []) {
    counts[statusBucket(s?.status)] += 1
    if (s?.template_snapshot_status !== 'exact') gaps += 1
    const t = Date.parse(s?.submitted_at || s?.created_at || '')
    if (Number.isFinite(t) && t >= now - 30 * DAY_MS) recent += 1
    const a = String(s?.asset_no || '').trim()
    if (a) assets.add(a)
  }
  const total = (submissions || []).length
  const decided = counts.approved + counts.rejected
  return {
    total,
    ...counts,
    evidenceGaps: gaps,
    last30Days: recent,
    assets: assets.size,
    approvalRatePct: decided > 0 ? Math.round((counts.approved / decided) * 1000) / 10 : null,
    exactEvidencePct: total > 0 ? Math.round(((total - gaps) / total) * 1000) / 10 : null,
  }
}

export const SUBMISSION_EXPORT_COLUMNS = [
  { key: 'checklist', header: 'Checklist' },
  { key: 'template', header: 'Template' },
  { key: 'asset', header: 'Asset' },
  { key: 'site', header: 'Site' },
  { key: 'country', header: 'Country' },
  { key: 'status', header: 'Status' },
  { key: 'evidence', header: 'Evidence' },
  { key: 'checklist_date', header: 'Checklist date' },
  { key: 'received', header: 'Received' },
  { key: 'score', header: 'Score %' },
]

export function submissionExportRows(submissions = [], templates = []) {
  return (submissions || []).map((s) => {
    const target = submissionTarget(s, templateFor(templates, s?.template_id)?.fields)
    const received = s?.submitted_at || s?.created_at
    return {
      checklist: s?.title || s?.template_name || 'Checklist',
      template: s?.template_name || '',
      asset: target.assetNo || '',
      site: target.site || '',
      country: s?.country || '',
      status: prettyStatus(s?.status),
      evidence: evidenceLabel(s?.template_snapshot_status),
      checklist_date: submissionDay(s, templates) || '',
      received: received ? String(received).slice(0, 10) : '',
      score: s?.score_pct == null || s?.score_pct === '' ? '' : Number(s.score_pct),
    }
  })
}
