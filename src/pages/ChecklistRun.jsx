import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ClipboardCheck, ArrowLeft, ChevronRight, Loader2, AlertTriangle, AlertOctagon,
  Send, Star, ImagePlus, X, PenLine, Camera, CheckCircle2, RefreshCw, Gauge, Lock,
} from 'lucide-react'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { getTemplate, createSubmission, uploadChecklistPhoto } from '../lib/api/checklists'
import { blankAnswer, validateSubmission, isLayoutField, isFieldVisible, visibleFields, computeScore, isReferenceField, referenceSource, isAutoField, resolveAutoValue } from '../lib/checklist/fieldTypes'
import { completeAssignment } from '../lib/api/checklistSchedules'
import SignaturePad from '../components/SignaturePad'
import ReferencePicker from '../components/checklist/ReferencePicker'
import { safeHref, safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

export default function ChecklistRun() {
  const { templateId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const assignmentId = searchParams.get('assignment') || null
  const { activeCountry } = useSettings()
  const { profile } = useAuth()
  const back = useCallback(() => navigate('/checklists'), [navigate])

  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [header, setHeader] = useState({ title: '', asset_no: '', site: '' })
  const [answers, setAnswers] = useState({})
  const [photos, setPhotos] = useState({})       // { fieldId: [urls] }
  const [signature, setSignature] = useState(null) // { fieldId?, dataUrl }
  const [errors, setErrors] = useState({})
  const [uploading, setUploading] = useState({})   // { fieldId: bool }
  const [showSignPad, setShowSignPad] = useState(false)
  const [signTargetField, setSignTargetField] = useState(null) // fieldId for a signature-type field, else null

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const tpl = await getTemplate(templateId)
      if (!tpl) { setTemplate(null); setLoadError('not_found'); return }
      setTemplate(tpl)
      // Seed answers with blank values so controlled inputs stay controlled.
      // Auto-fill + lock fields are prefilled from live context (inspector/today).
      const today = new Date().toISOString().slice(0, 10)
      const userName = profile?.full_name || profile?.username || ''
      const seeded = {}
      for (const f of Array.isArray(tpl.fields) ? tpl.fields : []) {
        if (f?.id && !isLayoutField(f.type) && f.type !== 'photo' && f.type !== 'signature') {
          seeded[f.id] = isAutoField(f) ? resolveAutoValue(f, { userName, today }) : blankAnswer(f)
        }
      }
      setAnswers(seeded)
    } catch (err) {
      setLoadError(isMissingRelation(err) ? 'missing' : toUserMessage(err, 'Could not load the checklist.'))
    } finally {
      setLoading(false)
    }
  }, [templateId, profile])

  useEffect(() => { load() }, [load])

  const fields = useMemo(() => (Array.isArray(template?.fields) ? template.fields : []), [template])

  const setAnswer = useCallback((id, value) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
    setErrors((prev) => (prev[id] ? { ...prev, [id]: undefined } : prev))
  }, [])

  const inspectorName = profile?.full_name || profile?.username || ''
  const employeeId = profile?.employee_id || profile?.id || ''

  // ── Photo capture (works for photo-type fields and any allow_photo field) ──
  async function handlePhotoPick(fieldId, fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading((p) => ({ ...p, [fieldId]: true }))
    setSubmitError('')
    try {
      const urls = []
      for (const file of files) {
        const url = await uploadChecklistPhoto(file, { prefix: `${templateId}/${fieldId}` })
        if (url) urls.push(url)
      }
      if (urls.length) {
        setPhotos((prev) => ({ ...prev, [fieldId]: [...(prev[fieldId] || []), ...urls] }))
      }
    } catch (err) {
      setSubmitError(toUserMessage(err, 'Photo upload failed.'))
    } finally {
      setUploading((p) => ({ ...p, [fieldId]: false }))
    }
  }

  function removePhoto(fieldId, url) {
    setPhotos((prev) => ({ ...prev, [fieldId]: (prev[fieldId] || []).filter((u) => u !== url) }))
  }

  function openSignaturePad(fieldId = null) {
    setSignTargetField(fieldId)
    setShowSignPad(true)
  }

  function handleSignatureSave(dataUrl) {
    setSignature({ fieldId: signTargetField, dataUrl })
    setShowSignPad(false)
    setSignTargetField(null)
  }

  async function handleSubmit() {
    setSubmitError('')
    const { valid, errors: fieldErrors } = validateSubmission(fields, answers)
    if (!valid) {
      setErrors(fieldErrors)
      setSubmitError('Please correct the highlighted fields before submitting.')
      // Scroll to first error
      const firstId = Object.keys(fieldErrors)[0]
      if (firstId) {
        const el = document.getElementById(`field-${firstId}`)
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return
    }
    if (template?.require_signature && !signature?.dataUrl) {
      setSubmitError('A signature is required to submit this checklist.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        template_id: template.id,
        template_name: template.name,
        template_version: template.version ?? 1,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : (template.country ?? null),
        site: header.site.trim() || null,
        asset_no: header.asset_no.trim() || null,
        title: header.title.trim() || template.name || null,
        status: 'submitted',
        answers,
        photos,
        signature_data: signature?.dataUrl ?? null,
        printed_name: signature?.dataUrl ? (inspectorName || null) : null,
      }
      if (template.scored) {
        const score = computeScore(fields, answers, template.pass_threshold)
        payload.score_pct = score.pct
        payload.score_passed = score.passed
      }
      const created = await createSubmission(payload)
      if (created?.id) {
        // Complete a linked assignment when arriving via ?assignment=<id>. A
        // completion failure must not block navigation to the saved submission.
        if (assignmentId) {
          try {
            await completeAssignment(assignmentId, created.id)
          } catch (err) {
            setSubmitError(`Submission saved, but the assignment could not be marked complete: ${toUserMessage(err, 'unknown error')}`)
          }
        }
        navigate(`/checklists/submission/${created.id}`)
      } else { setSubmitError('Submission saved but no id was returned.'); setSubmitting(false) }
    } catch (err) {
      setSubmitError(toUserMessage(err, 'Could not submit the checklist.'))
      setSubmitting(false)
    }
  }

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

  if (loadError === 'not_found' || !template) {
    return (
      <div className="space-y-4">
        <BackLink onClick={back} />
        <div className="card text-center py-12 space-y-3">
          <AlertOctagon size={32} className="mx-auto text-red-400" />
          <p className="text-[var(--text-primary)] font-semibold">Checklist not found</p>
          <p className="text-sm text-[var(--text-muted)]">
            {loadError && loadError !== 'not_found' ? loadError : 'This checklist may have been unpublished or deleted.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={load} className="btn-secondary text-sm">Retry</button>
            <button onClick={back} className="btn-primary text-sm">Back to Checklists</button>
          </div>
        </div>
      </div>
    )
  }

  // Recomputed on every render against the live `answers` state so conditional
  // fields appear/disappear as the user answers. Hidden fields never render and
  // (via validateSubmission/computeScore) never block submit or affect the score.
  const contentFields = visibleFields(fields, answers)
  const liveScore = template.scored ? computeScore(fields, answers, template.pass_threshold) : null

  return (
    <div className="space-y-4 pb-24">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <button onClick={back} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors">
          <ArrowLeft size={13} /> Checklists
        </button>
        <ChevronRight size={12} />
        <span className="text-[var(--text-dim)] truncate max-w-[50vw]">{template.name || 'Checklist'}</span>
      </div>

      {/* Header card */}
      <div className="card">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-[rgba(22,163,74,0.2)] flex items-center justify-center shrink-0">
            <ClipboardCheck size={18} className="text-brand-bright" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[var(--text-primary)] truncate">{template.name || 'Checklist'}</h1>
            {template.description && <p className="text-sm text-[var(--text-muted)] mt-0.5">{template.description}</p>}
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {(template.category || 'General')} · v{template.version ?? 1}
              {activeCountry && activeCountry !== 'All' ? ` · ${activeCountry}` : ''}
            </p>
          </div>
          {liveScore && liveScore.pct != null && (
            <div
              className={`ml-auto shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                liveScore.passed === true
                  ? 'bg-green-900/30 text-green-300 border-green-700/50'
                  : liveScore.passed === false
                    ? 'bg-red-900/30 text-red-300 border-red-700/50'
                    : 'bg-[var(--input-bg)] text-[var(--text-dim)] border-[var(--input-border)]'
              }`}
              title="Live score — updates as you fill the checklist"
            >
              <Gauge size={13} /> Score: {liveScore.pct}%
              {liveScore.passed != null && <span>· {liveScore.passed ? 'Pass' : 'Fail'}</span>}
            </div>
          )}
        </div>

        {/* Optional header block */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 pt-4 border-t border-[var(--border-dim)]">
          <div>
            <label className="label">Title / Reference</label>
            <input className="input" value={header.title} placeholder={template.name || 'e.g. Morning inspection'}
              onChange={(e) => setHeader((h) => ({ ...h, title: e.target.value }))} />
          </div>
          <div>
            <label className="label">Asset No.</label>
            <input className="input" value={header.asset_no} placeholder="e.g. TRK-1024"
              onChange={(e) => setHeader((h) => ({ ...h, asset_no: e.target.value }))} />
          </div>
          <div>
            <label className="label">Site</label>
            <input className="input" value={header.site} placeholder="e.g. Central Depot"
              onChange={(e) => setHeader((h) => ({ ...h, site: e.target.value }))} />
          </div>
        </div>
      </div>

      {submitError && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {submitError}
        </div>
      )}

      {/* Fields */}
      <div className="card space-y-5">
        {contentFields.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">This checklist has no fields to fill.</p>
        )}
        {contentFields.map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={answers[field.id]}
            error={errors[field.id]}
            country={activeCountry}
            onChange={(v) => setAnswer(field.id, v)}
            photos={photos[field.id] || []}
            uploading={!!uploading[field.id]}
            onPickPhoto={(files) => handlePhotoPick(field.id, files)}
            onRemovePhoto={(url) => removePhoto(field.id, url)}
            signature={signature?.fieldId === field.id ? signature : null}
            onOpenSignature={() => openSignaturePad(field.id)}
          />
        ))}
      </div>

      {/* Signature block (template-level requirement) */}
      {template.require_signature && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <PenLine size={16} className="text-brand-bright" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Signature <span className="text-red-400">*</span></h3>
          </div>
          {signature?.dataUrl && signature.fieldId == null ? (
            <div className="space-y-2">
              <img src={signature.dataUrl} alt="Signature" className="h-24 rounded-lg border border-[var(--border-dim)] bg-white" />
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <CheckCircle2 size={13} className="text-green-400" /> Captured{inspectorName ? ` · ${inspectorName}` : ''}
                <button onClick={() => openSignaturePad(null)} className="underline hover:text-[var(--text-primary)]">Redo</button>
              </div>
            </div>
          ) : (
            <button onClick={() => openSignaturePad(null)} className="btn-secondary text-sm inline-flex items-center gap-2 w-fit">
              <PenLine size={15} /> Add signature
            </button>
          )}
        </div>
      )}

      {/* Submit bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={back} className="btn-secondary text-sm inline-flex items-center gap-2">
          <ArrowLeft size={15} /> Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {submitting ? 'Submitting…' : 'Submit checklist'}
        </button>
      </div>

      {showSignPad && (
        <SignaturePad
          label="Checklist Signature"
          inspectorName={inspectorName}
          employeeId={employeeId}
          onSave={handleSignatureSave}
          onClose={() => { setShowSignPad(false); setSignTargetField(null) }}
        />
      )}
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

// ── Field renderer ─────────────────────────────────────────────────────────────
function FieldRenderer({ field, value, error, onChange, country, photos, uploading, onPickPhoto, onRemovePhoto, signature, onOpenSignature }) {
  const fileRef = useRef(null)
  const type = field?.type

  if (type === 'section') {
    return (
      <div className="pt-2 first:pt-0">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--text-primary)]">{field.label || 'Section'}</h3>
          <div className="flex-1 h-px bg-[var(--border-dim)]" />
        </div>
        {field.help && <p className="text-xs text-[var(--text-muted)] mt-1">{field.help}</p>}
      </div>
    )
  }

  const labelEl = (
    <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
      {field.label || 'Field'}
      {field.required && <span className="text-red-400"> *</span>}
    </label>
  )

  const allowInlinePhoto = field.allow_photo && type !== 'photo'
  const auto = isAutoField(field)

  return (
    <div id={`field-${field.id}`} className={`rounded-lg ${error ? 'ring-1 ring-red-500/50 p-3 -m-0.5 bg-red-900/5' : ''}`}>
      {type !== 'signature' && labelEl}
      {field.help && type !== 'section' && <p className="text-xs text-[var(--text-muted)] -mt-1 mb-1.5">{field.help}</p>}

      {auto && (
        <div>
          <div className="input flex items-center gap-2 opacity-80 cursor-not-allowed select-none" aria-readonly="true" title="Auto-filled and locked">
            <span className="flex-1 truncate text-[var(--text-primary)]">{value != null && value !== '' ? String(value) : '—'}</span>
            <Lock size={14} className="shrink-0 text-[var(--text-muted)]" />
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
            <Lock size={11} /> Auto-filled · locked
          </p>
        </div>
      )}

      {!auto && isReferenceField(type) && (
        <ReferencePicker
          source={referenceSource(type)}
          value={value ?? ''}
          onChange={(v) => onChange(v)}
          country={country}
          placeholder={`Select ${field.label || 'value'}`}
        />
      )}

      {!auto && type === 'text' && (
        <input className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Enter value" />
      )}

      {!auto && type === 'textarea' && (
        <textarea className="input" rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Enter notes" />
      )}

      {!auto && type === 'number' && (
        <input
          type="number" className="input" value={value ?? ''}
          min={field.min ?? undefined} max={field.max ?? undefined}
          onChange={(e) => onChange(e.target.value)} placeholder="0"
        />
      )}

      {!auto && type === 'date' && (
        <input type="date" className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}

      {!auto && type === 'select' && (
        <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select —</option>
          {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}

      {!auto && type === 'multiselect' && (
        <div className="flex flex-wrap gap-2">
          {(field.options || []).map((o) => {
            const arr = Array.isArray(value) ? value : []
            const checked = arr.includes(o)
            return (
              <button
                key={o} type="button"
                onClick={() => onChange(checked ? arr.filter((x) => x !== o) : [...arr, o])}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  checked ? 'bg-green-600 border-green-600 text-white' : 'bg-[var(--surface-1)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:border-green-600/50'
                }`}
              >
                {o}
              </button>
            )
          })}
          {(field.options || []).length === 0 && <p className="text-xs text-[var(--text-muted)]">No options configured.</p>}
        </div>
      )}

      {!auto && type === 'boolean' && (
        <div className="flex items-center gap-2">
          {[['Yes', true], ['No', false]].map(([lbl, val]) => (
            <button
              key={lbl} type="button" onClick={() => onChange(val)}
              className={`px-4 py-1.5 rounded-lg text-sm border transition-colors ${
                value === val
                  ? (val ? 'bg-green-600 border-green-600 text-white' : 'bg-red-600 border-red-600 text-white')
                  : 'bg-[var(--surface-1)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:border-[var(--border-bright)]'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}

      {!auto && type === 'rating' && (
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => onChange(Number(value) === n ? 0 : n)} title={`${n}`}
              className="p-0.5 transition-transform hover:scale-110">
              <Star size={26} className={Number(value) >= n ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-muted)]'} />
            </button>
          ))}
          {Number(value) > 0 && <span className="ml-2 text-sm text-[var(--text-muted)]">{Number(value)}/5</span>}
        </div>
      )}

      {type === 'photo' && (
        <PhotoField
          fileRef={fileRef} photos={photos} uploading={uploading}
          onPickPhoto={onPickPhoto} onRemovePhoto={onRemovePhoto}
        />
      )}

      {type === 'signature' && (
        <div className="space-y-2">
          {labelEl}
          {signature?.dataUrl ? (
            <div className="space-y-2">
              <img src={signature.dataUrl} alt="Signature" className="h-24 rounded-lg border border-[var(--border-dim)] bg-white" />
              <button onClick={onOpenSignature} className="text-xs underline text-[var(--text-muted)] hover:text-[var(--text-primary)]">Redo signature</button>
            </div>
          ) : (
            <button onClick={onOpenSignature} className="btn-secondary text-sm inline-flex items-center gap-2 w-fit">
              <PenLine size={15} /> Add signature
            </button>
          )}
        </div>
      )}

      {/* Inline "add photo" affordance for any allow_photo value field */}
      {allowInlinePhoto && (
        <div className="mt-2">
          <PhotoField
            fileRef={fileRef} photos={photos} uploading={uploading}
            onPickPhoto={onPickPhoto} onRemovePhoto={onRemovePhoto} compact
          />
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1"><AlertTriangle size={12} /> {error}</p>}
    </div>
  )
}

function PhotoField({ fileRef, photos, uploading, onPickPhoto, onRemovePhoto, compact }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {(photos || []).map((url) => (
          <div key={url} className="relative group">
            <a href={safeHref(url)} target="_blank" rel="noreferrer">
              <img src={safeImageSrc(url)} alt="Photo" className="h-16 w-16 object-cover rounded-lg border border-[var(--border-dim)] hover:border-green-500 transition-colors" />
            </a>
            <button
              type="button" onClick={() => onRemovePhoto(url)}
              className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full p-0.5 opacity-90 hover:opacity-100"
              title="Remove"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          className={`h-16 ${compact ? 'px-3' : 'w-16'} rounded-lg border-2 border-dashed border-[var(--border-bright)] flex flex-col items-center justify-center gap-1 text-[var(--text-muted)] hover:border-green-600/60 disabled:opacity-50`}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : (compact ? <Camera size={16} /> : <ImagePlus size={18} />)}
          {compact && <span className="text-[10px]">Photo</span>}
        </button>
      </div>
      <input
        ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden"
        onChange={(e) => { onPickPhoto(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
