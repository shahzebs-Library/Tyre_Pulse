import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ClipboardCheck, ArrowLeft, ChevronRight, AlertTriangle, AlertOctagon,
  Star, PenLine, RefreshCw, CheckCircle2, XCircle, Download, Loader2, Gauge,
  Truck, MapPin, User, Hash, ShieldCheck,
} from 'lucide-react'
import { getSubmission } from '../lib/api/checklists'
import { isReferenceField, referenceSource } from '../lib/checklist/fieldTypes'
import {
  submissionRows, displayValue as sharedDisplayValue, submissionSignatures,
  templateFromSubmission, documentNo, submissionAnswers,
} from '../lib/checklistView'
import MarkChip from '../components/checklist/MarkChip'
import SignatureView from '../components/checklist/SignatureView'
import ChecklistApprovalLadder from '../components/checklist/ChecklistApprovalLadder'
import ChecklistDecisionPanel from '../components/checklist/ChecklistDecisionPanel'
import BlockingMarksNotice from '../components/checklist/BlockingMarksNotice'
import { renderChecklistPdf } from '../lib/checklistPdf'
import { CHECKLIST_LANGS } from '../lib/checklist/checklistI18n'

const REFERENCE_ICON = { asset: Truck, site: MapPin, user: User }
import { useTenant } from '../contexts/TenantContext'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { safeHref, safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'

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

// Which points are shown, and what each answer reads as, is decided once in
// checklistView.js - this page, the quick viewer and the approval drawer all
// render the same rows. Only the presentation below is this page's own.
// The shared reader returns null for "nothing recorded"; this page prints "-".
function displayValue(value) {
  return sharedDisplayValue(value) ?? '-'
}

export default function ChecklistSubmission() {
  const { id } = useParams()
  const navigate = useNavigate()
  const back = useCallback(() => navigate('/checklists'), [navigate])

  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  // The printed sheet is read on the floor, so the language of the printout is
  // chosen at download time rather than following the reader's UI setting.
  const [pdfLang, setPdfLang] = useState('en')
  const [exportNote, setExportNote] = useState('')

  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || 'TyrePulse'

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const row = await getSubmission(id)
      if (!row) { setSub(null); setLoadError('not_found'); return }
      setSub(row)
    } catch (err) {
      setLoadError(isMissingRelation(err) ? 'missing' : toUserMessage(err, 'Could not load the submission.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // The template travels with the submission (fields, shared option sets and
  // the translated names), so nothing here needs a second fetch.
  const template = useMemo(() => (sub ? templateFromSubmission(sub) : null), [sub])

  // The row list itself comes from the shared reader, so what this page shows and
  // what an approver sees in the queue cannot drift apart. The template has to be
  // handed to it: without the shared option set a legend answer resolves to no
  // mark at all and prints as a bare word with no icon and no meaning.
  const rows = useMemo(() => submissionRows(sub, { template }), [sub, template])
  const signatures = useMemo(
    () => (sub ? submissionSignatures(sub, { template }) : []),
    [sub, template],
  )
  // The sheet's own reference. Null when this template mints no document number,
  // in which case nothing is drawn rather than a placeholder somebody would quote.
  const docNo = sub ? documentNo(sub) : null

  const downloadPdf = useCallback(async () => {
    if (!sub || exporting) return
    setExporting(true); setExportError(''); setExportNote('')
    try {
      const res = await renderChecklistPdf({
        submission: sub, template, lang: pdfLang, company, branding,
      })
      // Say what came out. A sheet that quietly printed in English because the
      // engine cannot draw the script is not a sheet anyone should discover on
      // the workshop floor.
      if (pdfLang !== 'en' && res.fellBack) {
        setExportNote('That language could not be printed, so the English wording was used.')
      } else if (pdfLang !== 'en' && !res.translated) {
        setExportNote('This checklist carries no translation for that language, so English was used.')
      }
    } catch (err) {
      setExportError(toUserMessage(err, 'Could not generate the PDF.'))
    } finally {
      setExporting(false)
    }
  }, [sub, exporting, company, branding, template, pdfLang])

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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] min-w-0">
          <button onClick={back} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
            <ArrowLeft size={13} /> Checklists
          </button>
          <ChevronRight size={12} />
          <span className="text-[var(--text-dim)] truncate max-w-[50vw]">
            {label} · {docNo || `#${String(sub.id).slice(0, 8).toUpperCase()}`}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {exportError && <span className="text-xs text-red-400">{exportError}</span>}
          {!exportError && exportNote && <span className="text-xs text-amber-400 max-w-[24rem]">{exportNote}</span>}
          <select
            className="input py-1.5 text-xs"
            value={pdfLang}
            onChange={(e) => { setPdfLang(e.target.value); setExportNote('') }}
            title="Language of the printed sheet"
          >
            {CHECKLIST_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <button
            onClick={downloadPdf}
            disabled={exporting}
            className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
            title="Download this submission as a branded PDF"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {/* Header card */}
      <div className="card">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-[rgba(22,163,74,0.2)] flex items-center justify-center shrink-0">
              <ClipboardCheck size={18} className="text-brand-bright" />
            </div>
            <div className="min-w-0">
              {/* THE DOCUMENT NUMBER IS THE SHEET'S REFERENCE, so it is the
                  headline - it is what gets quoted, filed and asked for. When
                  the template mints none, nothing is drawn here: an invented
                  reference is worse than an absent one. */}
              {docNo && (
                <p className="inline-flex items-center gap-1.5 font-mono text-lg font-bold text-brand-bright tracking-wide">
                  <Hash size={16} className="opacity-70" />{docNo}
                </p>
              )}
              <h1 className={`text-xl font-bold text-[var(--text-primary)] truncate ${docNo ? 'mt-0.5' : ''}`}>{label}</h1>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">
                {sub.template_name || 'Checklist'}{sub.template_version ? ` · v${sub.template_version}` : ''}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`badge text-xs ${statusBadge(sub.status)}`}>{prettyStatus(sub.status)}</span>
                {sub.score_pct != null && (
                  <span
                    className={`badge text-xs inline-flex items-center gap-1 ${
                      sub.score_passed === true
                        ? 'bg-green-900/40 text-green-300 border border-green-700/50'
                        : sub.score_passed === false
                          ? 'bg-red-900/40 text-red-300 border border-red-700/50'
                          : 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'
                    }`}
                    title="Checklist score"
                  >
                    <Gauge size={12} /> Score: {sub.score_pct}%
                    {sub.score_passed != null && <span>· {sub.score_passed ? 'Passed' : 'Failed'}</span>}
                  </span>
                )}
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
          {/* What is still outstanding, named line by line. The database refuses
              a close either way; this is so nobody discovers that only after
              signing. */}
          <BlockingMarksNotice template={template} answers={submissionAnswers(sub)} />

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
                    ) : isReferenceField(r.type) ? (
                      (() => {
                        const RefIcon = REFERENCE_ICON[referenceSource(r.type)] || Truck
                        return displayValue(r.value) === '-' ? (
                          <p className="text-sm text-[var(--text-primary)] mt-0.5">-</p>
                        ) : (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
                            <RefIcon size={14} className="text-[var(--text-muted)] shrink-0" /> {displayValue(r.value)}
                          </p>
                        )
                      })()
                    ) : r.marks?.length ? (
                      // A legend answer is a MARK, not a word: it carries an
                      // icon, a tone and a plain-English meaning, and it may be
                      // the thing stopping the sheet being closed. Printing the
                      // bare word threw all of that away.
                      <div className="flex flex-wrap items-start gap-2 mt-1.5">
                        {r.marks.map((m, i) => (
                          <MarkChip key={`${r.id}-m${i}`} mark={m} showMeaning size="lg" />
                        ))}
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

                    {/* The Remarks column of the paper form: usually where the
                        finding itself is written. */}
                    {r.note && (
                      <p className="text-xs mt-1 whitespace-pre-wrap break-words text-[var(--text-muted)]">
                        {r.note}
                      </p>
                    )}

                    {r.photos.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {r.photos.map((url, i) => (
                          <a key={`${r.id}-${i}`} href={safeHref(url)} target="_blank" rel="noreferrer">
                            <img src={safeImageSrc(url)} alt={`Photo ${i + 1}`} className="h-16 w-16 object-cover rounded-lg border border-[var(--border-dim)] hover:border-green-500 transition-colors" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Signatures - every one of them. A workshop sheet is signed by the
              mechanic, the auto electrician and the engineer who certifies the
              machine fit for operation; showing one reads as an approval the
              other two never gave. */}
          {signatures.length > 0 && (
            <div className="card space-y-3">
              <div className="flex items-center gap-2">
                <PenLine size={16} className="text-brand-bright" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Signatures</h2>
              </div>
              <div className="flex flex-wrap gap-4">
                {signatures.map((s) => (
                  <SignatureView key={s.id} value={s.data} label={s.label} name={s.printedName} height={96} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Approval rail */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-4 space-y-4">
            {/* Who signed this sheet off, in the order the rules require. On a
                two-stage template that is a supervisor THEN an area manager, and
                each rung shows the name, the date and the signature itself. */}
            <div className="card space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-brand-bright" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Sign-off</h2>
              </div>
              <ChecklistApprovalLadder template={template} submission={sub} />

              {/* The ladder said WHO has signed and offered no way to sign. The
                  decision lives beside it now, so an approver reading this page
                  does not have to go and find the same sheet in a queue. It
                  renders nothing unless the sheet is waiting on this reader. */}
              <ChecklistDecisionPanel submission={sub} onDecided={load} />
            </div>

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
