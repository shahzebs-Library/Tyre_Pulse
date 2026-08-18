import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ClipboardCheck, ArrowLeft, ChevronRight, Loader2, AlertTriangle, AlertOctagon,
  Send, Star, ImagePlus, X, PenLine, Camera, CheckCircle2, RefreshCw, Gauge, Lock, Languages,
  Hash, Clock, Info, RotateCcw,
} from 'lucide-react'
import { useSettings } from '../contexts/SettingsContext'
import { formatDate } from '../lib/formatters'
import { useAuth } from '../contexts/AuthContext'
import {
  draftKey, isWorthSaving, buildDraft, isUsableDraft, draftSummary,
  saveDraft, readDraft, clearDraft, promoteDraftKey,
} from '../lib/checklist/checklistDraft'
import { useLanguage } from '../contexts/LanguageContext'
import { getTemplate, createSubmission, uploadChecklistPhoto, listSubmissions } from '../lib/api/checklists'
import { blankAnswer, validateSubmission, isLayoutField, visibleFields, computeScore, isReferenceField, referenceSource, isAutoField, resolveAutoValue, signatureFields } from '../lib/checklist/fieldTypes'
// The marks / auto-fill / close-gate engine. THIS PAGE OWNS NO COPY OF THESE
// RULES - every one of them is read from the shared module so the screen, the
// phone and guard_checklist_approval_stages cannot drift apart.
import {
  autoFillAnswers, blockingAnswers, blockingMarks, fieldOptionSet, isFieldLocked,
  markMeta, missingNotes, recurrenceNotice, unsatisfiedGroups,
} from '../lib/checklist/checklistMarks'
import {
  CHECKLIST_LANGS, DEFAULT_LANG, normalizeLang, langDir, isRtlLang,
  fieldLabel, fieldOptions, fieldOptionValues, templateName, templateDescription,
  hasTranslations, translatedLangs,
} from '../lib/checklist/checklistI18n'
import { completeAssignment } from '../lib/api/checklistSchedules'
import SignaturePad from '../components/SignaturePad'
import ReferencePicker from '../components/checklist/ReferencePicker'
import MarkChip from '../components/checklist/MarkChip'
import BlockingMarksNotice from '../components/checklist/BlockingMarksNotice'
import { getAssetByNo } from '../lib/api/assets'
import { safeHref, safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'

/**
 * THE HEADER MUST NOT ASK WHAT THE SHEET ALREADY ASKS.
 *
 * Every published template carries its own asset field and its own site field
 * (the workshop sheet has `f_ws_asset` / `f_ws_site`, the transit mixer sheet
 * the same pair), so the old header block asked for both a second time, one
 * card above the line that asks for them properly. The owner reported exactly
 * that: "in both places they are showing 2 places for asset to be entered".
 *
 * The rule is DERIVED from the template's own fields, never from its name: a
 * plain template that asks for neither keeps the header input as its only way
 * of recording them, so nothing regresses for a sheet built without them.
 */
export function fieldAsksFor(field, kind) {
  if (!field || !field.id || isLayoutField(field.type)) return false
  if (referenceSource(field.type) === kind) return true
  // A field that is filled FROM the asset register's site is the same question
  // wearing a different type (the workshop sheet's Location is exactly this).
  if (kind === 'site' && field.autoFrom === 'asset.site') return true
  return false
}

/** Ids of the fields that already ask for `kind` ('asset' | 'site'). */
export function askingFieldIds(fields, kind) {
  return (Array.isArray(fields) ? fields : []).filter((f) => fieldAsksFor(f, kind)).map((f) => f.id)
}

/**
 * The first real answer among `ids`. Blank-safe rather than truthy-safe: a
 * meter reading of 0 is a reading, and a site called "0" would be a value too.
 */
export function firstAnswer(ids, answers) {
  for (const id of Array.isArray(ids) ? ids : []) {
    const v = answers?.[id]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/**
 * A meter reading below the one the register holds. WARNS, never blocks: a
 * meter really can be replaced, and vehicle_fleet.current_km is stale (set on
 * 248 of 1,030 KSA assets), so refusing the reading would refuse honest work.
 * Anything that is not a real number on either side compares as "no opinion".
 */
function meterBelowRegister(value, previous) {
  if (String(value ?? '').trim() === '' || String(previous ?? '').trim() === '') return false
  const v = Number(value)
  const p = Number(previous)
  if (!Number.isFinite(v) || !Number.isFinite(p)) return false
  return v < p
}

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
  const { language: appLanguage } = useLanguage()
  const back = useCallback(() => navigate('/checklists'), [navigate])

  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Fallback header, used ONLY for what this template does not ask for itself.
  const [header, setHeader] = useState({ title: '', asset_no: '', site: '' })
  // The vehicle_fleet row behind the picked asset. It fills the sheet; it is
  // never required, because an asset the register does not know must still be
  // recordable by hand.
  const [asset, setAsset] = useState(null)
  // Whether a lookup has actually RUN for the current asset. "We have not
  // looked" and "the register holds nothing" are different statements, and the
  // read-only hint below only makes the second one.
  const [assetLookedUp, setAssetLookedUp] = useState(false)
  const [recurrence, setRecurrence] = useState(null)
  const assetStamp = useRef(0)
  const [answers, setAnswers] = useState({})
  const [photos, setPhotos] = useState({})       // { fieldId: [urls] }
  // Every signature FIELD keeps its own capture, keyed by field id, exactly as
  // photos are. A workshop sheet is signed off by three trades (mechanic, auto
  // electrician, inspecting engineer); a single slot here silently overwrote
  // the previous signature and submitted only the last one.
  const [signatures, setSignatures] = useState({})   // { fieldId: dataUrl }
  // The template-level sign-off (template.require_signature), which is not tied
  // to any field and is stored in submissions.signature_data.
  const [primarySignature, setPrimarySignature] = useState(null)
  const [notes, setNotes] = useState({})         // { fieldId: remark }
  const [errors, setErrors] = useState({})
  const [uploading, setUploading] = useState({})   // { fieldId: bool }
  const [showSignPad, setShowSignPad] = useState(false)
  const [signTargetField, setSignTargetField] = useState(null) // fieldId for a signature-type field, else null
  // The language the checklist CONTENT is read in. Separate from the app UI
  // language: the sheet is filled on the floor by mechanics who read Arabic,
  // Hindi or Urdu. `null` until the template loads and we know what it offers.
  const [lang, setLang] = useState(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Depend on the VALUES the load uses, never on the `profile` object itself: a
  // caller that rebuilds that object each render would otherwise reload the
  // template on every render, and the reload resets the form.
  const inspectorName = profile?.full_name || profile?.username || ''
  const employeeId = profile?.employee_id || profile?.id || ''

  /* ── Resumable fill ────────────────────────────────────────────────────
   * A part-filled sheet survives a closed tab, a refresh or a flat battery.
   * The draft is LOCAL by design: V594 mints the document number on insert so
   * an abandoned fill never burns one, and a server-side draft row would gap
   * the numbered register permanently. See src/lib/checklist/checklistDraft.js.
   */
  const userId = profile?.id || ''
  const [resumeOffer, setResumeOffer] = useState(null)   // draft awaiting Continue / Start new
  const [resumed, setResumed] = useState(false)
  const draftCheckedRef = useRef(false)
  const lastDraftKeyRef = useRef(null)
  const currentDraftKey = draftKey({ userId, templateId, assetNo: header.asset_no })

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const tpl = await getTemplate(templateId)
      if (!tpl) { setTemplate(null); setLoadError('not_found'); return }
      setTemplate(tpl)
      // Seed answers with blank values so controlled inputs stay controlled.
      // Auto-fill + lock fields are prefilled from live context (inspector/today).
      const today = new Date().toISOString().slice(0, 10)
      const userName = inspectorName
      const seeded = {}
      for (const f of Array.isArray(tpl.fields) ? tpl.fields : []) {
        if (f?.id && !isLayoutField(f.type) && f.type !== 'photo' && f.type !== 'signature') {
          seeded[f.id] = isAutoField(f) ? resolveAutoValue(f, { userName, today }) : blankAnswer(f)
        }
      }
      setAnswers(seeded)
      // Open in the reader's own language when this template actually carries
      // it; otherwise English. Offering a language the template has no words in
      // would show an English sheet under an Arabic heading.
      const wanted = normalizeLang(appLanguage)
      setLang(wanted !== DEFAULT_LANG && translatedLangs(tpl).includes(wanted) ? wanted : DEFAULT_LANG)
    } catch (err) {
      setLoadError(isMissingRelation(err) ? 'missing' : toUserMessage(err, 'Could not load the checklist.'))
    } finally {
      setLoading(false)
    }
  }, [templateId, inspectorName, appLanguage])

  useEffect(() => { load() }, [load])

  // Offer a resume ONCE the template is loaded, and only once per visit. The
  // seed in `load` overwrites answers, so this must run after it or the restore
  // would be wiped by the blank seed a moment later.
  useEffect(() => {
    if (!template || !userId || draftCheckedRef.current) return
    draftCheckedRef.current = true
    const key = draftKey({ userId, templateId, assetNo: '' })
    const { status, draft } = readDraft(key)
    // 'torn' and 'unreadable' are NOT 'absent'. We do not offer a resume we
    // cannot honour, and just as important we never delete on a failed read.
    if (status !== 'ok' || !isUsableDraft(draft, { userId, templateId })) return
    setResumeOffer({ key, draft })
  }, [template, userId, templateId])

  const acceptResume = useCallback(() => {
    const d = resumeOffer?.draft
    if (!d) return
    setHeader(d.header || { title: '', asset_no: '', site: '' })
    setAnswers(d.answers || {})
    setNotes(d.notes || {})
    setPhotos(d.photos || {})
    setSignatures(d.signatures || {})
    setPrimarySignature(d.primarySignature || null)
    if (d.lang) setLang(d.lang)
    setResumed(true)
    setResumeOffer(null)
  }, [resumeOffer])

  // Discarding is destructive, so it is only ever reached from an explicit
  // confirm in the prompt - never automatically, and never silently.
  const discardResume = useCallback(() => {
    if (resumeOffer?.key) clearDraft(resumeOffer.key)
    setResumeOffer(null)
  }, [resumeOffer])

  // Autosave, debounced. An untouched sheet never becomes a draft, or every
  // template anyone merely opened would come back offering to resume nothing.
  useEffect(() => {
    if (!template || !userId || !currentDraftKey || resumeOffer) return
    const state = {
      userId, templateId, templateName: template?.name || '',
      header, answers, notes, photos, signatures, primarySignature, lang,
    }
    if (!isWorthSaving(state)) return
    const id = setTimeout(() => {
      // Picking the asset moves the sheet onto that vehicle's slot; the copy
      // refuses to overwrite a sheet already part filled for it.
      const prev = lastDraftKeyRef.current
      if (prev && prev !== currentDraftKey) promoteDraftKey(prev, currentDraftKey)
      lastDraftKeyRef.current = currentDraftKey
      saveDraft(currentDraftKey, buildDraft(state, Date.now()))
    }, 800)
    return () => clearTimeout(id)
  }, [template, userId, templateId, currentDraftKey, resumeOffer,
      header, answers, notes, photos, signatures, primarySignature, lang])

  const fields = useMemo(() => (Array.isArray(template?.fields) ? template.fields : []), [template])
  const readLang = normalizeLang(lang)
  const rtl = isRtlLang(readLang)
  // Only offer a language switch when the template has real words in another
  // language; a picker whose every option renders English is a lie.
  const offeredLangs = useMemo(() => {
    if (!template || !hasTranslations(template)) return []
    const have = new Set([DEFAULT_LANG, ...translatedLangs(template)])
    return CHECKLIST_LANGS.filter((l) => have.has(l.code))
  }, [template])

  // Translated label / options for a field, in the reader's language. The
  // OPTION VALUE stays English wherever it is stored or compared.
  const labelFor = useCallback((f) => fieldLabel(f, readLang), [readLang])
  const optionsFor = useCallback((f) => fieldOptionValues(f, template), [template])

  // What this template asks for itself. Everything below is derived from these
  // two lists, so a template that asks for neither keeps its header inputs.
  const assetFieldIds = useMemo(() => askingFieldIds(fields, 'asset'), [fields])
  const siteFieldIds = useMemo(() => askingFieldIds(fields, 'site'), [fields])
  const asksAsset = assetFieldIds.length > 0
  const asksSite = siteFieldIds.length > 0
  // The reference is minted server-side on insert from the template's prefix
  // (WDC-TM514-2026-0001), so a template that has one is not asked for a title.
  const mintsReference = Boolean(String(template?.doc_prefix ?? '').trim())

  // The values that reach the submission: the ANSWER when the sheet asks, the
  // header input when it does not. One question, one place, either way.
  const effectiveAssetNo = asksAsset ? firstAnswer(assetFieldIds, answers) : header.asset_no.trim()
  const effectiveSite = asksSite ? firstAnswer(siteFieldIds, answers) : header.site.trim()

  const setAnswer = useCallback((id, value) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
    setErrors((prev) => (prev[id] ? { ...prev, [id]: undefined } : prev))
  }, [])

  /**
   * Picking the asset fills the sheet.
   *
   * The register supplies the site, the registration / fleet number and the
   * chassis where it has them (checklistMarks.autoFillAnswers decides what
   * lands where - this page never maps a column to a field itself). Both halves
   * are BEST EFFORT: a lookup that fails leaves the operator typing by hand
   * rather than blocking the sheet, and it says nothing at all about the 10-day
   * rule, because "we could not look" is not "it is not due".
   */
  useEffect(() => {
    const code = effectiveAssetNo
    const stamp = ++assetStamp.current
    if (!code || !template) {
      setAsset(null); setAssetLookedUp(false); setRecurrence(null)
      return
    }
    let cancelled = false
    setAssetLookedUp(false)
    ;(async () => {
      let row = null
      try {
        row = await getAssetByNo(code, activeCountry)
      } catch { row = null }
      if (cancelled || assetStamp.current !== stamp) return
      setAsset(row || null)
      setAssetLookedUp(true)
      if (row) {
        setAnswers((prev) => {
          const patch = autoFillAnswers(template, row, prev)
          return Object.keys(patch).length ? { ...prev, ...patch } : prev
        })
      }

      // The recurrence warning is only asked for when the template states an
      // interval; a template without one must not pay for the read.
      const minDays = Number(template.min_interval_days)
      if (!Number.isFinite(minDays) || minDays <= 0) { setRecurrence(null); return }
      try {
        const rows = await listSubmissions({ templateId: template.id, assetNo: code, limit: 1 })
        if (cancelled || assetStamp.current !== stamp) return
        const last = Array.isArray(rows) ? rows[0] : null
        const when = last?.submitted_at || last?.created_at
        const at = when ? new Date(when).getTime() : NaN
        if (!last || !Number.isFinite(at)) { setRecurrence(null); return }
        setRecurrence(recurrenceNotice({
          found: true,
          days_ago: Math.floor((Date.now() - at) / 86400000),
          document_no: last.document_no ?? null,
        }, minDays))
      } catch {
        // Silence is correct here: an unreadable history is not a due date.
        if (!cancelled && assetStamp.current === stamp) setRecurrence(null)
      }
    })()
    return () => { cancelled = true }
  }, [effectiveAssetNo, template, activeCountry])

  const setNote = useCallback((id, text) => {
    setNotes((prev) => ({ ...prev, [id]: text }))
  }, [])

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

  // Each capture lands in its OWN slot: a signature field writes to its field
  // id, the template-level pad writes to primarySignature. Signing one can no
  // longer wipe another.
  function handleSignatureSave(dataUrl) {
    if (signTargetField) {
      const id = signTargetField
      setSignatures((prev) => ({ ...prev, [id]: dataUrl }))
      setErrors((prev) => (prev[id] ? { ...prev, [id]: undefined } : prev))
    } else {
      setPrimarySignature(dataUrl)
    }
    setShowSignPad(false)
    setSignTargetField(null)
  }

  /**
   * THE TWO GATES ARE NOT THE SAME GATE.
   *
   * `blocking` (a line marked Not OK) stops the sheet being CLOSED, never being
   * SUBMITTED - a fault found on the last item of the day must still reach the
   * office, and guard_checklist_approval_stages is what refuses the approval.
   * The other two DO stop a submission: a sheet with no meter reading, or a
   * fault with no reason, records nothing anyone can act on.
   */
  const blocking = useMemo(() => (template ? blockingAnswers(template, answers) : []), [template, answers])
  const openGroups = useMemo(() => (template ? unsatisfiedGroups(template, answers) : []), [template, answers])
  const openNotes = useMemo(() => (template ? missingNotes(template, answers, notes) : []), [template, answers, notes])

  async function handleSubmit() {
    setSubmitError('')
    const { valid, errors: fieldErrors } = validateSubmission(fields, answers, {
      signatures, labelFor, optionsFor,
    })
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
    // The meter pair. Either reading satisfies it and neither may be skipped:
    // 98 of 227 KSA transit mixers carry no odometer at all while every one of
    // them has engine hours. ZERO IS A READING and counts as answered.
    if (openGroups.length) {
      const names = openGroups.flatMap((g) => g.fields.map((f) => labelFor(fields.find((x) => x.id === f.id)) || f.label)).join(' or ')
      setErrors({})
      setSubmitError(`Record at least one meter reading: ${names}.`)
      const firstId = openGroups[0]?.fields?.[0]?.id
      const el = firstId ? document.getElementById(`field-${firstId}`) : null
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    // A fault with no remark records nothing anyone can act on.
    if (openNotes.length) {
      const remarkErrors = {}
      for (const n of openNotes) remarkErrors[n.id] = 'Say what is wrong before submitting.'
      setErrors(remarkErrors)
      const names = openNotes.map((n) => labelFor(fields.find((x) => x.id === n.id)) || n.label).join(', ')
      setSubmitError(`A remark is required on: ${names}.`)
      const el = document.getElementById(`field-${openNotes[0].id}`)
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    // The first signature captured on a signature FIELD, in template order.
    // It backs signature_data when the template has no separate sign-off pad,
    // which is what the single-slot version used to write there.
    const firstFieldSignature =
      signatureFields(fields).map((f) => signatures[f.id]).find((s) => typeof s === 'string' && s) || null
    const primary = primarySignature || firstFieldSignature

    // require_signature is satisfied by the template-level pad OR by any
    // signature field having been signed (the historic behaviour): a sheet that
    // already carries three trade signatures should not demand a fourth.
    if (template?.require_signature && !primary) {
      setSubmitError('A signature is required to submit this checklist.')
      return
    }

    setSubmitting(true)
    try {
      // Keep only real remarks, and only on lines that asked for one and are
      // still visible. A blank box is not an observation.
      const noteMap = {}
      for (const f of visibleFields(fields, answers)) {
        if (!f?.allow_note) continue
        const text = String(notes[f.id] ?? '').trim()
        if (text) noteMap[f.id] = text
      }
      // Only signatures that belong to a field this template still has.
      const signatureMap = {}
      for (const f of signatureFields(fields)) {
        if (typeof signatures[f.id] === 'string' && signatures[f.id]) signatureMap[f.id] = signatures[f.id]
      }

      const payload = {
        template_id: template.id,
        template_name: template.name,
        template_version: template.version ?? 1,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : (template.country ?? null),
        // Taken from the ANSWER when the sheet asks for it itself, and from
        // the fallback header only when it does not.
        site: effectiveSite || null,
        asset_no: effectiveAssetNo || null,
        // A template with a prefix has its reference minted server-side on
        // insert, so nothing here invents one.
        title: (mintsReference ? '' : header.title.trim()) || template.name || null,
        status: 'submitted',
        answers,
        photos,
        notes: noteMap,
        // Every captured signature, keyed by field id. signature_data keeps its
        // meaning as the single primary sign-off so every existing reader,
        // export and PDF is unchanged.
        signatures: signatureMap,
        signature_data: primary,
        printed_name: primary ? (inspectorName || null) : null,
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
        // The work now belongs to the submission. Keeping the draft would let
        // the same sheet be filled and submitted a second time.
        clearDraft(currentDraftKey)
        clearDraft(draftKey({ userId, templateId, assetNo: '' }))
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
    <div className="space-y-4 pb-24" dir={langDir(readLang)} lang={readLang}>
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
            <h1 className="text-xl font-bold text-[var(--text-primary)] truncate">{templateName(template, readLang) || 'Checklist'}</h1>
            {templateDescription(template, readLang) && (
              <p className="text-sm text-[var(--text-muted)] mt-0.5">{templateDescription(template, readLang)}</p>
            )}
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

        {/* Reading language. Only the languages this template really carries
            are offered; the stored answer stays the English option either way. */}
        {offeredLangs.length > 1 && (
          <div className="mt-4 pt-4 border-t border-[var(--border-dim)] flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Languages size={14} /> Language
            </span>
            <div className="flex flex-wrap gap-1.5">
              {offeredLangs.map((l) => (
                <button
                  key={l.code} type="button" onClick={() => setLang(l.code)}
                  lang={l.code} dir={l.dir}
                  aria-pressed={readLang === l.code}
                  className={`px-3 py-1 rounded-lg text-sm border transition-colors ${
                    readLang === l.code
                      ? 'bg-green-600 border-green-600 text-white'
                      : 'bg-[var(--surface-1)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:border-green-600/50'
                  }`}
                >
                  {l.native}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">
              Answers are recorded in English whichever language you fill in.
            </span>
          </div>
        )}

        {/* The reference. A template with a prefix has its document number
            minted server-side on insert, so the screen says what will happen
            and never invents one. */}
        {mintsReference && (
          <p className="mt-4 pt-4 border-t border-[var(--border-dim)] text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <Hash size={13} className="shrink-0" />
            Reference: {String(template.doc_prefix).trim()} - assigned automatically when you submit.
          </p>
        )}

        {/* FALLBACK HEADER ONLY. Each input renders only when this template does
            not already ask the same question on the sheet below - asking twice
            is what the owner reported, and dropping the field instead would
            lose it on a plain template that has no asset or site line. */}
        {(!mintsReference || !asksAsset || !asksSite) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 pt-4 border-t border-[var(--border-dim)]">
            {!mintsReference && (
              <div>
                <label className="label" htmlFor="header-title">Title / Reference</label>
                <input id="header-title" className="input" value={header.title} placeholder={template.name || 'e.g. Morning inspection'}
                  onChange={(e) => setHeader((h) => ({ ...h, title: e.target.value }))} />
              </div>
            )}
            {!asksAsset && (
              <div>
                <label className="label" htmlFor="header-asset">Asset No.</label>
                <input id="header-asset" className="input" value={header.asset_no} placeholder="e.g. TRK-1024"
                  onChange={(e) => setHeader((h) => ({ ...h, asset_no: e.target.value }))} />
              </div>
            )}
            {!asksSite && (
              <div>
                <label className="label" htmlFor="header-site">Site</label>
                <input id="header-site" className="input" value={header.site} placeholder="e.g. Central Depot"
                  onChange={(e) => setHeader((h) => ({ ...h, site: e.target.value }))} />
              </div>
            )}
          </div>
        )}

        {/* What the register knows about the machine on the sheet. Shown only
            once a lookup has really run, so an unread register never renders as
            an empty one. */}
        {asksAsset && effectiveAssetNo && assetLookedUp && (
          <p className="mt-3 text-xs text-[var(--text-muted)] flex items-start gap-1.5">
            <Info size={13} className="shrink-0 mt-0.5" />
            {asset
              ? `Register: ${[asset.vehicle_type, asset.make, asset.model, asset.site].filter(Boolean).join(' - ') || 'no details recorded'}`
              : `${effectiveAssetNo} is not in the asset register for this country. The sheet can still be filled by hand.`}
          </p>
        )}
      </div>

      {/* The 10-day rule. ADVISORY: it warns, it never refuses, and it says
          nothing at all when the history could not be read. */}
      {recurrence && (
        <div className="rounded-xl border border-amber-700/50 bg-amber-500/[0.07] p-3 flex items-start gap-2.5">
          <Clock size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-300">This machine is not due yet.</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Last checked {recurrence.daysAgo} {recurrence.daysAgo === 1 ? 'day' : 'days'} ago
              {recurrence.documentNo ? ` (${recurrence.documentNo})` : ''}. Next due in {recurrence.dueInDays}
              {recurrence.dueInDays === 1 ? ' day' : ' days'}. You can still record this check.
            </p>
          </div>
        </div>
      )}

      {/* Unfinished work. Continue or start fresh - never resumed silently,
          never discarded silently. */}
      {resumeOffer && (() => {
        const sum = draftSummary(resumeOffer.draft)
        return (
          <div className="card" style={{ borderColor: '#fde047', background: 'rgba(250,204,21,0.06)' }}>
            <div className="flex items-start gap-3">
              <RotateCcw size={18} className="shrink-0 mt-0.5" style={{ color: '#facc15' }} />
              <div className="flex-1 space-y-2">
                <p className="font-semibold">You have an unfinished checklist</p>
                <p className="text-sm text-[var(--text-secondary)]">
                  {sum.assetNo ? `For ${sum.assetNo}. ` : ''}
                  {sum.answered > 0 ? `${sum.answered} answer${sum.answered === 1 ? '' : 's'} recorded. ` : ''}
                  {sum.savedAt ? `Last saved ${formatDate(sum.savedAt)}.` : ''}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Saved on this device only, so it will not appear on another computer or phone.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className="btn-primary" onClick={acceptResume}>Continue it</button>
                  <button
                    type="button" className="btn-secondary"
                    onClick={() => {
                      if (window.confirm('Start a new checklist and discard the unfinished one? This cannot be undone.')) discardResume()
                    }}
                  >
                    Start new
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {resumed && (
        <div className="text-xs text-[var(--text-muted)] px-0.5">
          Continued from your unfinished checklist.
        </div>
      )}

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
        {contentFields.map((field) => {
          const value = answers[field.id]
          // A field locks ONLY once the register really supplied something.
          // fleet_number is set on 398 of 1,030 KSA assets and on NONE of the
          // 452 UAE or 135 Egypt ones, so an unconditionally read-only field
          // would be permanently blank and unfillable for most of the fleet.
          const locked = isFieldLocked(field, value)
          // ...and when the register was read and had nothing, say so, so the
          // operator types what is stamped on the machine instead of assuming
          // the box is broken. Only claimed once a lookup actually returned a row.
          const registerBlank = Boolean(field.readOnly) && !locked && assetLookedUp && Boolean(asset)
          const previousMeter = field.compareTo === 'asset.current_km' && asset?.current_km != null
            ? String(asset.current_km)
            : ''
          return (
          <FieldRenderer
            key={field.id}
            field={field}
            value={value}
            error={errors[field.id]}
            country={activeCountry}
            locked={locked}
            registerBlank={registerBlank}
            previousMeter={previousMeter}
            optionSet={fieldOptionSet(template, field)}
            onChange={(v) => setAnswer(field.id, v)}
            photos={photos[field.id] || []}
            uploading={!!uploading[field.id]}
            onPickPhoto={(files) => handlePhotoPick(field.id, files)}
            onRemovePhoto={(url) => removePhoto(field.id, url)}
            signature={signatures[field.id] || null}
            onOpenSignature={() => openSignaturePad(field.id)}
            note={notes[field.id] ?? ''}
            onNoteChange={(v) => setNote(field.id, v)}
            label={labelFor(field)}
            options={fieldOptions(field, template, readLang)}
            rtl={rtl}
          />
          )
        })}
      </div>

      {/* Signature block (template-level requirement) */}
      {template.require_signature && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <PenLine size={16} className="text-brand-bright" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Signature <span className="text-red-400">*</span></h3>
          </div>
          {primarySignature ? (
            <div className="space-y-2">
              <img src={primarySignature} alt="Signature" className="h-24 rounded-lg border border-[var(--border-dim)] bg-white" />
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

      {/* What still stops this sheet being CLOSED. It never stops it being
          submitted; the same decision is enforced by the approval trigger, and
          this is it made before anyone signs. */}
      <BlockingMarksNotice template={template} answers={answers} />

      {/* Submit bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={back} className="btn-secondary text-sm inline-flex items-center gap-2">
          <ArrowLeft size={15} /> Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {submitting ? 'Submitting…' : (blocking.length ? 'Submit with faults recorded' : 'Submit checklist')}
        </button>
      </div>

      {showSignPad && (
        <SignaturePad
          // Name the signature being given: on a sheet signed by three trades,
          // an unlabelled pad cannot tell the mechanic from the electrician.
          label={
            (signTargetField && labelFor(fields.find((f) => f.id === signTargetField))) ||
            'Checklist Signature'
          }
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
function FieldRenderer({
  field, value, error, onChange, country, photos, uploading, onPickPhoto, onRemovePhoto,
  signature, onOpenSignature, note, onNoteChange, label, options, rtl,
  locked = false, registerBlank = false, previousMeter = '', optionSet = null,
}) {
  const fileRef = useRef(null)
  const type = field?.type
  // `label` and `options` arrive already resolved into the reading language.
  // An option's `value` is the ENGLISH token that gets stored; only its `label`
  // is translated, so an answer means the same thing in every language.
  const text = label || field?.label || ''
  const choices = Array.isArray(options) ? options : []

  if (type === 'section') {
    return (
      <div className="pt-2 first:pt-0">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--text-primary)]">{text || 'Section'}</h3>
          <div className="flex-1 h-px bg-[var(--border-dim)]" />
        </div>
        {field.help && <p className="text-xs text-[var(--text-muted)] mt-1">{field.help}</p>}
      </div>
    )
  }

  const labelEl = (
    <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
      {text || 'Field'}
      {field.required && <span className="text-red-400"> *</span>}
    </label>
  )

  const allowInlinePhoto = field.allow_photo && type !== 'photo'
  const auto = isAutoField(field)
  // Two different reasons for the same read-only box, and the box says which:
  // the app filled it (inspector, today) or the asset register did.
  const readOnlyBox = auto || locked
  // The 8-mark legend. A field answers with marks when its option set carries
  // the meta - icon, tone and plain-English meaning - that V595 added. Anything
  // else keeps the plain dropdown, so a template with a free option list is
  // untouched.
  const marks = optionSet ? blockingMarks(optionSet) : []
  const useMarks = type === 'select'
    && choices.length > 0
    && optionSet != null
    && choices.some((o) => markMeta(optionSet, o.value).known)
  const meterWarn = meterBelowRegister(value, previousMeter)

  return (
    <div id={`field-${field.id}`} className={`rounded-lg ${error ? 'ring-1 ring-red-500/50 p-3 -m-0.5 bg-red-900/5' : ''}`}>
      {type !== 'signature' && labelEl}
      {field.help && type !== 'section' && <p className="text-xs text-[var(--text-muted)] -mt-1 mb-1.5">{field.help}</p>}

      {readOnlyBox && (
        <div>
          <div className="input flex items-center gap-2 opacity-80 cursor-not-allowed select-none" aria-readonly="true" title={auto ? 'Auto-filled and locked' : 'From the asset register'}>
            <span className="flex-1 truncate text-[var(--text-primary)]">{value != null && value !== '' ? String(value) : 'Not recorded'}</span>
            <Lock size={14} className="shrink-0 text-[var(--text-muted)]" />
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
            <Lock size={11} /> {auto ? 'Auto-filled · locked' : 'From the asset register · locked'}
          </p>
        </div>
      )}

      {!readOnlyBox && isReferenceField(type) && (
        <ReferencePicker
          source={referenceSource(type)}
          value={value ?? ''}
          onChange={(v) => onChange(v)}
          country={country}
          placeholder={`Select ${field.label || 'value'}`}
        />
      )}

      {!readOnlyBox && type === 'text' && (
        <input className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Enter value" />
      )}

      {!readOnlyBox && type === 'textarea' && (
        <textarea className="input" rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Enter notes" />
      )}

      {!readOnlyBox && type === 'number' && (
        <div>
          <input
            type="number" className="input" value={value ?? ''}
            min={field.min ?? undefined} max={field.max ?? undefined}
            onChange={(e) => onChange(e.target.value)} placeholder="0"
          />
          {previousMeter && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Register reading: {previousMeter}</p>
          )}
          {/* A lower reading WARNS and is always recorded: a meter really can
              be replaced, and the register's figure is often stale. */}
          {meterWarn && (
            <p className="text-[11px] text-amber-400 mt-1 flex items-center gap-1">
              <AlertTriangle size={11} /> Lower than the register reading. It will still be recorded.
            </p>
          )}
        </div>
      )}

      {!readOnlyBox && type === 'date' && (
        <input type="date" className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}

      {/* A legend mark is recorded in place: one click, the icon and tone the
          legend itself declares, and the plain-English meaning of the mark that
          was chosen. A mark nobody can explain is a mark picked at random.
          The glyph and tone come from checklistMarks via MarkChip - never
          invented here - and the STORED value stays the English token whatever
          language the label is read in. */}
      {!readOnlyBox && type === 'select' && useMarks && (
        <div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={text || 'Mark'}>
            {choices.map((o) => {
              const selected = String(value ?? '') === o.value
              return (
                <button
                  key={o.value} type="button"
                  aria-pressed={selected}
                  title={o.label}
                  onClick={() => onChange(selected ? '' : o.value)}
                  className={`rounded-full transition-shadow ${selected ? 'ring-2 ring-offset-1 ring-offset-transparent ring-[var(--border-bright)]' : 'opacity-70 hover:opacity-100'}`}
                >
                  <MarkChip
                    mark={{ ...markMeta(optionSet, o.value), value: o.label, blocking: marks.includes(o.value) }}
                    size={selected ? 'lg' : 'sm'}
                  />
                </button>
              )
            })}
          </div>
          {value != null && String(value) !== '' && markMeta(optionSet, value).meaning && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">{markMeta(optionSet, value).meaning}</p>
          )}
        </div>
      )}

      {!readOnlyBox && type === 'select' && !useMarks && (
        <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select</option>
          {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {!readOnlyBox && type === 'multiselect' && (
        <div className="flex flex-wrap gap-2">
          {choices.map((o) => {
            const arr = Array.isArray(value) ? value : []
            const checked = arr.includes(o.value)
            return (
              <button
                key={o.value} type="button"
                onClick={() => onChange(checked ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  checked ? 'bg-green-600 border-green-600 text-white' : 'bg-[var(--surface-1)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:border-green-600/50'
                }`}
              >
                {o.label}
              </button>
            )
          })}
          {choices.length === 0 && <p className="text-xs text-[var(--text-muted)]">No options configured.</p>}
        </div>
      )}

      {!readOnlyBox && type === 'boolean' && (
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

      {!readOnlyBox && type === 'rating' && (
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
          {signature ? (
            <div className="space-y-2">
              <img src={signature} alt={text || 'Signature'} className="h-24 rounded-lg border border-[var(--border-dim)] bg-white" />
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <CheckCircle2 size={13} className="text-green-400" /> Signed
                <button onClick={onOpenSignature} className="underline hover:text-[var(--text-primary)]">Redo signature</button>
              </div>
            </div>
          ) : (
            <button onClick={onOpenSignature} className="btn-secondary text-sm inline-flex items-center gap-2 w-fit">
              <PenLine size={15} /> Add signature
            </button>
          )}
        </div>
      )}

      {/* The register was read and holds nothing for this machine. Outside KSA
          the fleet number and chassis are simply not recorded, so the field
          stays typeable and says why rather than looking broken. */}
      {registerBlank && (
        <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
          <Info size={11} className="shrink-0" /> The asset register has no value for this machine. Type what is on the machine.
        </p>
      )}

      {/* Per-line remark. Both paper sheets carry a Remarks column beside every
          line: it is where a fitter says WHY a line is not OK, and without it
          "Not OK" is a result with no cause. Optional by design. */}
      {field.allow_note && (
        <div className="mt-2">
          <textarea
            className="input text-sm"
            rows={2}
            dir={rtl ? 'rtl' : 'ltr'}
            value={note ?? ''}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Remarks (optional)"
            aria-label={`Remarks for ${text || 'this line'}`}
          />
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
