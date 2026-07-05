import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  UploadCloud, FileSpreadsheet, Wand2, ShieldCheck, CheckCircle2, AlertTriangle,
  Loader2, ArrowRight, ArrowLeft, RefreshCw, Database, Save, Bookmark, Paperclip, FileArchive,
  Trash2, RotateCcw,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import {
  parseWorkbook, sha256OfArrayBuffer, suggestMapping, transformRow, validateRow,
  classifyDuplicates, naturalKey, countryConflict, rowFingerprint, MODULE_FIELDS,
  wrongModuleWarning, WRONG_MODULE_THRESHOLD,
  buildAliasMap, applyAliasesToRow,
  extractZip, matchAttachment, buildMatchRows,
  headerFingerprint, aggregateStagedRows,
} from '../lib/import'
import * as imports from '../lib/api/imports'
import MappingProfilesManager from '../components/intake/MappingProfilesManager'
import DataLinkPanel from '../components/intake/DataLinkPanel'
import CostControlPanel from '../components/intake/CostControlPanel'
import DataCompletenessPanel from '../components/intake/DataCompletenessPanel'

const MODULES = [
  { key: 'fleet', label: 'Fleet / Assets' },
  { key: 'tyre', label: 'Tyre Lifecycle' },
  { key: 'stock', label: 'Stock' },
  { key: 'accident', label: 'Accidents / Insurance' },
  { key: 'inspection', label: 'Inspections' },
  { key: 'workorder', label: 'Work Orders' },
  { key: 'warranty', label: 'Warranty Claims' },
  { key: 'gatepass', label: 'Gate Pass' },
  { key: 'supplier', label: 'Suppliers' },
  { key: 'driver', label: 'Drivers' },
]
const MODULE_LABELS = Object.fromEntries(MODULES.map((m) => [m.key, m.label]))
const ELEVATED = ['admin', 'manager', 'director']
const STEP_KEYS = ['upload', 'mapColumns', 'validate', 'approve']

function statusColor(s) {
  return s === 'ready' ? 'text-green-400 bg-green-900/30'
    : s === 'warning' ? 'text-amber-400 bg-amber-900/30'
    : s === 'error' ? 'text-red-400 bg-red-900/30'
    : 'text-gray-400 bg-gray-800'
}

export default function DataIntakeCenter() {
  const { profile } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const { t } = useLanguage()
  const fmtMoney = (n) => `${activeCurrency || ''} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
  const isElevated = ELEVATED.includes(String(profile?.role || '').toLowerCase())
  const countryReady = activeCountry && activeCountry !== 'All'

  const [searchParams] = useSearchParams()
  const initialModule = (() => {
    const requested = String(searchParams.get('module') || '').toLowerCase()
    return MODULES.some((m) => m.key === requested) ? requested : 'fleet'
  })()

  const [step, setStep] = useState(0)
  const [module, setModule] = useState(initialModule)
  const [file, setFile] = useState(null)
  const [fileQueue, setFileQueue] = useState([])   // extra files picked in one go, imported one-by-one
  const [appliedProfile, setAppliedProfile] = useState(null) // fingerprint-matched saved mapping
  const autoSavedFp = useRef(null) // fingerprint we've already auto-remembered this session
  const [parsed, setParsed] = useState(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [batchId, setBatchId] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [mapping, setMapping] = useState([])
  const [annotated, setAnnotated] = useState([])
  const [counts, setCounts] = useState(null)
  const [result, setResult] = useState(null)
  // Live per-chunk totals while a large (50k+) batch commits/enriches (V93).
  const [commitProgress, setCommitProgress] = useState(null)
  const [automation, setAutomation] = useState(null)
  const [recent, setRecent] = useState([])
  const [files, setFiles] = useState([])
  const [countryAck, setCountryAck] = useState(false)
  // Elevated override: force validation-error rows through the commit anyway.
  const [forceFlagged, setForceFlagged] = useState(false)
  // Cross-file enrichment: fill blanks on existing live records instead of skipping.
  const [enrichExisting, setEnrichExisting] = useState(false)
  const [aliasMaps, setAliasMaps] = useState(null) // { site, supplier, brand } → Map
  const [fxRatesMap, setFxRatesMap] = useState(null) // { quoteCurrency: {rate,rate_date,source} }

  // Accident-only: evidence ZIP ingestion (Phase 3). Each item tracks one file
  // through extract → match → upload → record, with a per-file status/error so a
  // single failure never aborts the package.
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachItems, setAttachItems] = useState([]) // { name, sizeBytes, matchedBy, status, error }
  const [attachWarnings, setAttachWarnings] = useState([])
  const [attachDone, setAttachDone] = useState(false)

  const sheet = parsed?.sheets?.[sheetIdx] || null
  const targetOptions = useMemo(
    () => (MODULE_FIELDS[module] || []).map((f) => ({ key: f.key, label: f.label || f.key, required: f.required })),
    [module],
  )

  const loadRecent = useCallback(async () => {
    try { setRecent(await imports.listBatches({ country: activeCountry, limit: 8 })) } catch { /* non-blocking */ }
    try { setFiles(await imports.listFiles({ country: activeCountry, limit: 25 })) } catch { /* non-blocking */ }
  }, [activeCountry])
  useEffect(() => { loadRecent() }, [loadRecent])

  // Finer-granularity ("wrong module") heuristic: when >60% of keyed rows collapse
  // onto an existing/repeated natural key, the file is likely line-item data staged
  // against the wrong module. Non-blocking - surfaced as a banner on the Validate step.
  const granularityWarning = useMemo(
    () => wrongModuleWarning(counts, module, WRONG_MODULE_THRESHOLD),
    [counts, module],
  )

  // Uploaded files that never became an import (orphans from abandoned attempts).
  const orphanFiles = useMemo(() => files.filter((f) => f.orphan), [files])
  async function deleteOrphan(f) {
    if (!window.confirm(t('intake.orphans.deletePrompt', { name: f.original_filename }))) return
    setError('')
    try { await imports.deleteFile(f.id); await loadRecent() }
    catch (err) { setError(err?.message || t('intake.errors.couldNotDeleteFile')) }
  }

  // Warn before an accidental full-page reload/close while an import is in
  // progress (state lives in memory and cannot survive a hard navigation).
  useEffect(() => {
    const dirty = step > 0 && !result
    if (!dirty) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [step, result])

  const [rowBusyId, setRowBusyId] = useState(null)

  // Delete an abandoned/staged batch (cascades to its rows). A committed batch
  // is reversed instead, so the live rows it produced are also removed.
  async function deleteRecent(b) {
    if (rowBusyId) return
    const committed = b.import_status === 'committed'
    const msg = committed
      ? t('intake.recent.reverseCommittedConfirm', { module: b.module, rows: b.imported_rows || 0 })
      : t('intake.recent.deleteStagedConfirm', { module: b.module, status: b.import_status, rows: b.total_rows || 0 })
    if (!window.confirm(msg)) return
    setRowBusyId(b.id); setError('')
    try {
      if (committed) await imports.reverseBatch(b.id)
      else await imports.deleteBatch(b.id)
      await loadRecent()
    } catch (err) {
      console.error('[DataIntakeCenter] delete/reverse batch failed:', err)
      setError(err?.message || t('intake.errors.couldNotRemoveBatch'))
    } finally { setRowBusyId(null) }
  }

  function reset() {
    setStep(0); setFile(null); setParsed(null); setSheetIdx(0); setBatchId(null); setAppliedProfile(null)
    setMapping([]); setAnnotated([]); setCounts(null); setResult(null); setAutomation(null); setError(''); setProfiles([]); setCountryAck(false); setForceFlagged(false); setEnrichExisting(false); setAliasMaps(null); setFxRatesMap(null); autoSavedFp.current = null
    setAttachItems([]); setAttachWarnings([]); setAttachDone(false); setAttachBusy(false)
  }

  // ── Step 1: parse a chosen file ──────────────────────────────────────────────
  async function loadFile(f) {
    setError(''); setBusy(true)
    try {
      const buf = await f.arrayBuffer()
      const wb = await parseWorkbook(buf)
      setFile(f); setParsed(wb); setSheetIdx(0)
    } catch (err) {
      setError(err?.message || t('intake.errors.couldNotReadFile'))
    } finally { setBusy(false) }
  }

  // Multi-file selection: the first file enters the wizard immediately; the rest
  // wait in a visible queue and are offered one-by-one after each commit, so a
  // whole batch of exports can be imported in one sitting without re-picking.
  async function onFile(e) {
    const list = Array.from(e.target.files || [])
    if (!list.length) return
    setFileQueue(list.slice(1))
    await loadFile(list[0])
  }

  async function nextQueuedFile() {
    const [next, ...rest] = fileQueue
    if (!next) return
    reset()
    setFileQueue(rest)
    await loadFile(next)
  }

  async function startBatch() {
    if (!sheet) return
    setError(''); setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const sha = await sha256OfArrayBuffer(buf)
      const { fileId } = await imports.uploadOriginalFile(file, { module, country: activeCountry, sha256: sha })
      const id = await imports.createBatch({
        fileId, module, country: activeCountry, sheet: sheet.name,
        headerRowDetected: sheet.headerRow, headerRowConfirmed: sheet.headerRow,
      })
      await imports.saveSheets(id, parsed.sheets)
      setBatchId(id)
      // seed mapping suggestions - but do NOT pre-apply low-confidence guesses.
      // A 'review' action (confidence < SUGGEST_THRESHOLD) keeps its guess only
      // as a hint; the selected target defaults to null ("preserve as custom")
      // so a weak guess (e.g. Store Code → Country) is never silently applied.
      const suggestions = suggestMapping({ columns: sheet.columns, module, sampleRows: sheet.rows.slice(0, 20) }).map((m) =>
        m.action === 'review'
          ? { ...m, target: null, suggestedTarget: m.target, suggestedConfidence: m.confidence }
          : m,
      )
      // Exact-format recognition: if a saved profile's header fingerprint matches
      // this upload, apply its remembered mapping automatically (zero clicks for
      // known report formats). Fingerprint mismatch → normal suggestions.
      setAppliedProfile(null)
      let applied = false
      try {
        const fp = headerFingerprint(sheet.columns)
        const prof = await imports.findProfileByFingerprint({ module, fingerprint: fp })
        if (prof?.rules?.length) {
          const byHeader = new Map(prof.rules.map((r) => [r.source_header, r.target_field]))
          setMapping(suggestions.map((m) => byHeader.has(m.sourceHeader)
            ? { ...m, target: byHeader.get(m.sourceHeader) || null, action: byHeader.get(m.sourceHeader) ? 'mapped' : 'preserve_custom', confidence: 100, reason: 'profile' }
            : { ...m, target: null, action: 'preserve_custom' }))
          setAppliedProfile(prof)
          imports.touchProfile(prof.id).catch(() => {})
          applied = true
        }
      } catch { /* fall back to suggestions */ }
      if (!applied) setMapping(suggestions)
      // offer reusable mapping profiles for this module/country (non-blocking)
      imports.listProfiles({ module, country: activeCountry }).then(setProfiles).catch(() => setProfiles([]))
      // load master-data aliases once so the validate pass can normalise spellings
      imports.listAliases({ country: activeCountry }).then((rows) => {
        const by = { site: [], supplier: [], brand: [] }
        for (const a of rows || []) if (by[a.entity_type]) by[a.entity_type].push(a)
        setAliasMaps({ site: buildAliasMap(by.site), supplier: buildAliasMap(by.supplier), brand: buildAliasMap(by.brand) })
      }).catch(() => setAliasMaps(null))
      // preload APPROVED FX rates (base = active currency) so currency conversion
      // stays synchronous and only ever uses approved rates (directive §12).
      imports.listApprovedRatesMap({ baseCurrency: activeCurrency }).then(setFxRatesMap).catch(() => setFxRatesMap(null))
      setStep(1)
    } catch (err) {
      setError(err?.message || 'Could not start the import.')
    } finally { setBusy(false) }
  }

  function setTarget(sourceHeader, target) {
    setMapping((m) => m.map((row) => row.sourceHeader === sourceHeader
      ? { ...row, target: target || null, action: target ? 'mapped' : 'preserve_custom' }
      : row))
  }

  // Apply a saved mapping profile: re-map source headers to its remembered targets.
  async function applyProfile(profileId) {
    if (!profileId) return
    setError(''); setBusy(true)
    try {
      const rules = await imports.getProfileRules(profileId)
      const byHeader = new Map(rules.map((r) => [r.source_header, r.target_field]))
      setMapping((m) => m.map((row) => {
        if (!byHeader.has(row.sourceHeader)) return row
        const target = byHeader.get(row.sourceHeader) || null
        return { ...row, target, action: target ? 'mapped' : 'preserve_custom', confidence: 100 }
      }))
      imports.touchProfile(profileId).catch(() => {})
    } catch (err) {
      setError(err?.message || 'Could not apply the profile.')
    } finally { setBusy(false) }
  }

  // Save the current column mapping as a reusable profile for this module/country.
  async function saveAsProfile() {
    const name = window.prompt('Save this mapping as a reusable profile. Name:')
    if (!name?.trim()) return
    setError(''); setBusy(true)
    try {
      const rules = mapping
        .filter((m) => m.target)
        .map((m) => ({ sourceHeader: m.sourceHeader, target: m.target, confidence: m.confidence ?? 100 }))
      await imports.saveProfile({
        name: name.trim(), module, country: activeCountry,
        headerFingerprint: sheet ? headerFingerprint(sheet.columns) : null,
      }, rules)
      const next = await imports.listProfiles({ module, country: activeCountry })
      setProfiles(next)
      autoSavedFp.current = sheet ? headerFingerprint(sheet.columns) : null
    } catch (err) {
      setError(err?.message || 'Could not save the profile.')
    } finally { setBusy(false) }
  }

  // Auto-remember a new file format: if this mapping did not come from a saved
  // profile, silently save it (keyed by header fingerprint) so the NEXT upload of
  // the same file auto-maps with zero clicks. Best-effort — never blocks staging.
  async function autoSaveProfile() {
    try {
      if (appliedProfile) return                       // already a known format
      if (!sheet) return
      const fp = headerFingerprint(sheet.columns)
      if (!fp || autoSavedFp.current === fp) return     // already remembered this session
      const rules = mapping
        .filter((m) => m.target)
        .map((m) => ({ sourceHeader: m.sourceHeader, target: m.target, confidence: m.confidence ?? 100 }))
      if (rules.length < 2) return                      // nothing worth remembering
      const base = (file?.name || '').replace(/\.[^.]+$/, '').trim()
      const name = `${MODULE_LABELS[module] || module}${base ? ` — ${base}` : ''} (auto)`
      await imports.saveProfile({ name, module, country: activeCountry, headerFingerprint: fp }, rules)
      autoSavedFp.current = fp
      imports.listProfiles({ module, country: activeCountry }).then(setProfiles).catch(() => {})
    } catch { /* auto-save is best-effort; never surface to the user */ }
  }

  // ── Step 3: validate + classify (in-batch + live-table dedup) ────────────────
  async function runValidation() {
    let rows = sheet.rows.map((raw, i) => {
      const { mapped, transformed: t0, custom } = transformRow(raw, mapping, { module, baseCurrency: activeCurrency, fxRates: fxRatesMap })
      // Normalise master-data spellings via saved aliases (site/supplier/brand).
      let transformed = t0
      if (aliasMaps) {
        for (const field of ['site', 'supplier', 'brand']) {
          if (aliasMaps[field]?.size) transformed = applyAliasesToRow(transformed, field, aliasMaps[field])
        }
      }
      const v = validateRow(transformed, module)
      // An out-of-domain enum value would be rejected by the DB CHECK and fail
      // the whole commit. Preserve the original in custom_data and drop the
      // column so the row still commits (the DB default applies) - the warning
      // from validateRow keeps it visible for review.
      const cleanCustom = { ...custom }
      for (const iss of v.issues || []) {
        if (iss.code === 'ENUM_INVALID' && transformed[iss.field] != null) {
          cleanCustom[`${iss.field}__unmapped`] = transformed[iss.field]
          delete transformed[iss.field]
          delete mapped[iss.field]
        }
      }
      return {
        sourceRowNo: i + 1, raw, mapped, transformed, custom: cleanCustom,
        validationStatus: v.status, issues: v.issues || [],
        fingerprint: rowFingerprint(raw),
      }
    })

    // Line-item aggregation: a profile can declare that this format carries
    // several rows per business record (e.g. store-issue lines per work order).
    // Collapse them here - costs summed, every source line preserved in
    // custom_data.line_items - so the commit produces ONE record per key.
    const aggCfg = appliedProfile?.unit_settings?.aggregate
    if (aggCfg?.by) rows = aggregateStagedRows(rows, aggCfg)

    // Country-scope guard (directive rule #1: never mix countries). A row whose
    // own country value disagrees with the selected import country is flagged for
    // review - never silently re-filed under the selected country.
    setCountryAck(false)
    rows.forEach((r) => {
      if (countryConflict(r.transformed, activeCountry)) {
        r.countryConflict = true
        r.issues = [...(r.issues || []), {
          field: 'country', severity: 'warning', code: 'COUNTRY_MISMATCH',
          message: `Row country "${r.transformed.country}" differs from the selected import country ${activeCountry}.`,
        }]
        if (r.validationStatus === 'ready') r.validationStatus = 'warning'
      }
    })

    // In-batch duplicate classification (rows that repeat within this file).
    const withDup = classifyDuplicates(rows.map((r) => r.transformed), module)
    rows.forEach((r, i) => { r.dupStatus = withDup[i]?.dup_status || 'none' })

    // Live-table duplicate detection (V47). Fault-tolerant: if the RPC is not yet
    // deployed or errors, fall back to in-batch dedup only - never break the wizard.
    let liveKeys = null
    try {
      liveKeys = await imports.existingKeys({ module, country: activeCountry })
    } catch (err) {
      console.warn('Live duplicate detection unavailable; using in-batch dedup only.', err)
    }

    // Default action: reject errors; insert everything else. A row whose natural
    // key already exists live is flagged duplicate and switched to 'skip' so the
    // commit never creates a second live row (conflicts are left for the operator).
    rows.forEach((r) => {
      let action = r.validationStatus === 'error' ? 'reject' : 'insert'
      let isLiveDup = false
      if (liveKeys && r.validationStatus !== 'error') {
        const key = naturalKey(r.transformed, module)
        if (key && liveKeys.has(key)) {
          isLiveDup = true
          if (r.dupStatus !== 'conflict') r.dupStatus = 'duplicate'
          // Enrichment mode: instead of skipping the existing record, mark it to
          // fill its blank fields from this file (server-side, fill-only-empty).
          action = (enrichExisting && isElevated) ? 'update' : 'skip'
        }
      }
      r.liveDuplicate = isLiveDup
      r.action = action
    })

    const c = { total: rows.length, ready: 0, warning: 0, error: 0, duplicate: 0, conflict: 0, liveDuplicate: 0, countryConflict: 0, keyed: 0, amount: 0, qty: 0 }
    rows.forEach((r) => {
      c[r.validationStatus] = (c[r.validationStatus] || 0) + 1
      if (r.dupStatus === 'duplicate') c.duplicate++
      if (r.dupStatus === 'conflict') c.conflict++
      if (r.liveDuplicate) c.liveDuplicate++
      if (r.countryConflict) c.countryConflict++
      // Rows that produce a usable natural key - the denominator for the
      // finer-granularity ("wrong module") duplicate-ratio heuristic.
      if (naturalKey(r.transformed, module) != null) c.keyed++
      // Roll up spend for the batch: prefer the derived per-line total, else
      // fall back to qty × unit cost. Only meaningful for tyre imports.
      const t = r.transformed || {}
      const line = Number(t.line_total)
      if (Number.isFinite(line)) c.amount += line
      else {
        const unit = Number(t.cost_per_tyre); const qn = Number(t.qty)
        if (Number.isFinite(unit)) c.amount += unit * (Number.isFinite(qn) && qn > 0 ? qn : 1)
      }
      const qv = Number(t.qty); if (Number.isFinite(qv)) c.qty += qv
    })
    c.amount = Math.round(c.amount * 100) / 100
    setAnnotated(rows); setCounts(c)
  }
  useEffect(() => { if (step === 2 && sheet && mapping.length) runValidation() }, [step]) // eslint-disable-line

  async function stageAll() {
    if (counts?.countryConflict > 0 && !countryAck) {
      setError(`${counts.countryConflict} row(s) have a country that differs from ${activeCountry}. Confirm the override to continue.`)
      return
    }
    setError(''); setBusy(true)
    try {
      await imports.stageRows(batchId, annotated.map((r) => {
        // Derive the row action from the CURRENT toggle state + row flags, so a
        // toggle flipped after validation still takes effect:
        //  · force-include: push a validation-error row through the commit (a
        //    genuinely-broken row still fails its own INSERT per-row, so the
        //    batch is never corrupted).
        //  · enrich: fill blanks on the matching existing record instead of skip.
        const forced = forceFlagged && isElevated && r.validationStatus === 'error'
        const enrich = enrichExisting && isElevated && r.liveDuplicate && r.validationStatus !== 'error'
        let action
        if (r.validationStatus === 'error') action = forced ? 'insert' : 'reject'
        else if (r.liveDuplicate) action = enrich ? 'update' : 'skip'
        else action = 'insert'
        return {
          sheetName: sheet.name, sourceRowNo: r.sourceRowNo, raw: r.raw, mapped: r.mapped,
          transformed: r.transformed, custom: r.custom,
          validationStatus: forced ? 'warning' : r.validationStatus,
          dupStatus: r.dupStatus,
          action,
          fingerprint: r.fingerprint,
        }
      }))
      await imports.setBatchCounts(batchId, counts)
      await autoSaveProfile() // remember this format for next time (best-effort)
      setStep(3)
    } catch (err) {
      setError(err?.message || 'Could not stage the rows.')
    } finally { setBusy(false) }
  }

  // ── Accident-only: evidence ZIP ingestion (Phase 3) ──────────────────────────
  // Extract a .zip client-side, match each file to a staged accident row by
  // claim/police/asset no, upload each privately, then record the matches.
  // Fully fault-tolerant: a single file failure is surfaced per-row, never aborts.
  async function onAttachmentZip(e) {
    const zip = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!zip || !batchId) return
    setError(''); setAttachBusy(true); setAttachDone(false); setAttachWarnings([])

    try {
      const { files, warnings } = await extractZip(zip)
      setAttachWarnings(warnings)
      if (!files.length) {
        setAttachItems([])
        setError(warnings.length ? 'No usable files found in the archive.' : 'The archive is empty.')
        return
      }

      // Match each file to a staged row, then render a pending table immediately.
      const matches = files.map((f) => matchAttachment(f.name, annotated))
      setAttachItems(files.map((f, i) => ({
        name: f.name, sizeBytes: f.sizeBytes, matchedBy: matches[i]?.matchedBy || null, status: 'pending', error: null,
      })))

      const recordPayload = []
      const finalItems = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const base = { name: f.name, sizeBytes: f.sizeBytes, matchedBy: matches[i]?.matchedBy || null }
        try {
          const { fileId } = await imports.uploadAttachment(f.blob, {
            batchId, country: activeCountry, filename: f.name,
          })
          recordPayload.push({ file: f, match: matches[i], fileId })
          finalItems.push({ ...base, status: 'uploaded', error: null })
        } catch (err) {
          finalItems.push({ ...base, status: 'failed', error: err?.message || 'Upload failed.' })
        }
        setAttachItems([...finalItems]) // progressive UI update
      }

      // Record matches for everything that uploaded (matched + unmatched alike).
      if (recordPayload.length) {
        try {
          const rows = buildMatchRows({ batchId, items: recordPayload, rows: annotated })
          await imports.recordAttachmentMatches(rows)
        } catch (err) {
          setError(`Files uploaded, but recording matches failed: ${err?.message || 'unknown error'}`)
        }
      }
      setAttachDone(true)
    } catch (err) {
      setError(err?.message || 'Could not process the attachment package.')
    } finally {
      setAttachBusy(false)
    }
  }

  // ── Step 4: approve + commit ─────────────────────────────────────────────────
  async function commit() {
    setError(''); setBusy(true); setCommitProgress(null)
    try {
      await imports.submitForApproval(batchId)
      if (isElevated) await imports.approveBatch(batchId)
      // V93: commits run in server-side chunks so 50k+ row files never time
      // out; each chunk reports running totals for the progress line below.
      const res = await imports.commitBatch(batchId, {
        onProgress: (p) => setCommitProgress({ phase: 'commit', ...p }),
      })
      // Cross-file enrichment: fill blanks on existing records from this file.
      if (enrichExisting && isElevated) {
        try {
          const enr = await imports.enrichBatch(batchId, {
            onProgress: (p) => setCommitProgress({ phase: 'enrich', ...p }),
          })
          if (enr) res.enriched = enr.enriched ?? 0
        } catch (e) { res.enrichError = e?.message || 'Enrichment failed' }
      }
      setResult(res)
      // Value-producing automation (directive §20). Best-effort - must never
      // block or fail the commit the operator already succeeded at.
      if (res?.status === 'committed') {
        imports.runPostImportAutomation(batchId, module, { country: activeCountry })
          .then((a) => { if (a && (a.alerts || a.actions)) setAutomation(a) })
          .catch(() => {})
      }
      loadRecent()
    } catch (err) {
      setError(err?.message || 'Commit failed.')
    } finally { setBusy(false); setCommitProgress(null) }
  }

  if (!countryReady) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Data Intake Center</h1>
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-6 text-amber-300 flex gap-3">
          <AlertTriangle className="shrink-0" />
          <p>Select a single country (top bar) before importing. Every import is scoped to one country - mixing countries is not allowed.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1800px] mx-auto text-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Database size={22} /> Data Intake Center</h1>
          <p className="text-sm text-gray-400">Controlled import for <span className="text-white">{activeCountry}</span> - staged, validated, approved, then committed.</p>
        </div>
        <button onClick={reset} className="text-sm px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center gap-2"><RefreshCw size={15} /> New import</button>
      </div>

      {/* stepper */}
      <div className="flex items-center gap-2 mb-6">
        {STEP_KEYS.map((key, i) => (
          <div key={key} className={`flex items-center gap-2 text-sm ${i === step ? 'text-white' : i < step ? 'text-green-400' : 'text-gray-500'}`}>
            <span className={`w-6 h-6 rounded-full grid place-items-center text-xs ${i === step ? 'bg-green-600 text-white' : i < step ? 'bg-green-900/40' : 'bg-gray-800'}`}>{i + 1}</span>
            {t(`intake.steps.${key}`)}{i < STEP_KEYS.length - 1 && <span className="text-gray-700 mx-1">-</span>}
          </div>
        ))}
      </div>

      {error && <div className="mb-4 bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm flex gap-2"><AlertTriangle size={16} /> {error}</div>}

      {/* STEP 1 */}
      {step === 0 && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Module</label>
            <div className="flex gap-2">
              {MODULES.map((m) => (
                <button key={m.key} onClick={() => setModule(m.key)} className={`px-4 py-2 rounded-lg text-sm border ${module === m.key ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-900 border-gray-700 hover:border-gray-500'}`}>{m.label}</button>
              ))}
            </div>
          </div>
          <label className="block border-2 border-dashed border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-green-600/60">
            <input type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt" multiple className="hidden" onChange={onFile} />
            {busy ? <Loader2 className="animate-spin mx-auto text-green-400" /> : <UploadCloud className="mx-auto text-gray-500" size={34} />}
            <p className="mt-2 text-sm text-gray-400">{file ? file.name : 'Choose one or more Excel / CSV files'}</p>
            {fileQueue.length > 0 && (
              <p className="mt-1 text-xs text-sky-400">{fileQueue.length} more file{fileQueue.length !== 1 ? 's' : ''} queued - offered after this import finishes.</p>
            )}
          </label>

          {parsed && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-sm text-gray-400 flex items-center gap-2"><FileSpreadsheet size={15} /> {parsed.sheets.length} sheet(s)</p>
              <div className="flex flex-wrap gap-2">
                {parsed.sheets.map((s, i) => (
                  <button key={s.name + i} onClick={() => setSheetIdx(i)} className={`px-3 py-1.5 rounded-lg text-xs ${i === sheetIdx ? 'bg-green-600 text-white' : 'bg-gray-800 hover:bg-gray-700'}`}>{s.name} <span className="opacity-70">({s.rows.length} rows)</span></button>
                ))}
              </div>
              {sheet && <p className="text-xs text-gray-500">Header row detected at line {(sheet.headerRow ?? 0) + 1} · {sheet.columns.length} columns</p>}
              <button onClick={startBatch} disabled={busy || !sheet} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} Continue to mapping</button>
            </div>
          )}

          {/* Browse & manage the reusable column mappings you've saved. */}
          <MappingProfilesManager moduleLabels={MODULE_LABELS} />

          {/* Cross-table link health (asset_no → vehicles) + one-click repair. */}
          <DataLinkPanel isElevated={isElevated} />

          {/* Budget override commands: set / derive monthly tyre budgets. */}
          <CostControlPanel isElevated={isElevated} />

          {/* Per-field fill scorecard: which analytics are starving + how to fix. */}
          <DataCompletenessPanel />
        </div>
      )}

      {/* STEP 2 */}
      {step === 1 && sheet && (
        <div className="space-y-4">
          {appliedProfile && (
            <div className="bg-sky-900/20 border border-sky-700/50 rounded-xl p-3 text-sky-300 text-sm flex items-center gap-2">
              <Bookmark size={15} className="shrink-0" />
              <span>Recognised format - mapping profile <span className="font-semibold text-white">“{appliedProfile.name}”</span> applied automatically{appliedProfile.unit_settings?.aggregate?.by ? ' (line items will be combined per record)' : ''}. Review below and adjust if needed.</span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-400 flex items-center gap-2"><Wand2 size={15} /> Review the suggested mapping. Unknown columns are kept (never dropped).</p>
            <div className="flex items-center gap-2">
              {profiles.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Bookmark size={15} className="text-gray-500" />
                  <select
                    defaultValue=""
                    onChange={(e) => { applyProfile(e.target.value); e.target.value = '' }}
                    className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                    title="Apply a saved mapping profile"
                  >
                    <option value="">Apply saved profile...</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <button onClick={saveAsProfile} disabled={busy || !mapping.some((m) => m.target)} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs flex items-center gap-1.5 disabled:opacity-50" title="Save this mapping for reuse"><Save size={14} /> Save as profile</button>
            </div>
          </div>
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/60 text-gray-400 text-xs">
                <tr><th className="text-left px-3 py-2">Source header</th><th className="text-left px-3 py-2">Sample</th><th className="text-left px-3 py-2">Map to</th><th className="text-left px-3 py-2">Confidence</th></tr>
              </thead>
              <tbody>
                {mapping.map((m) => {
                  const sample = sheet.rows.find((r) => r[m.sourceHeader] != null && r[m.sourceHeader] !== '')?.[m.sourceHeader]
                  return (
                    <tr key={m.sourceHeader} className="border-t border-gray-800">
                      <td className="px-3 py-2 font-medium">{m.sourceHeader}</td>
                      <td className="px-3 py-2 text-gray-500 truncate max-w-[160px]">{String(sample ?? '')}</td>
                      <td className="px-3 py-2">
                        <select value={m.target || ''} onChange={(e) => setTarget(m.sourceHeader, e.target.value)} className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs">
                          <option value="">- preserve as custom -</option>
                          {targetOptions.map((t) => <option key={t.key} value={t.key}>{t.label}{t.required ? ' *' : ''}</option>)}
                        </select>
                        {!m.target && m.suggestedTarget && (
                          <button
                            type="button"
                            onClick={() => setTarget(m.sourceHeader, m.suggestedTarget)}
                            className="mt-1 block text-[11px] text-amber-400 hover:text-amber-300 underline decoration-dotted"
                            title="Low-confidence guess - click to apply"
                          >
                            Suggested: {targetOptions.find((t) => t.key === m.suggestedTarget)?.label || m.suggestedTarget}
                            {typeof m.suggestedConfidence === 'number' ? ` (${m.suggestedConfidence}%)` : ''}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded ${m.confidence >= 90 ? 'bg-green-900/30 text-green-400' : m.confidence >= 60 ? 'bg-amber-900/30 text-amber-400' : 'bg-gray-800 text-gray-400'}`}>{m.target ? `${m.confidence}%` : 'custom'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm flex items-center gap-2"><ArrowLeft size={15} /> Back</button>
            <button onClick={() => setStep(2)} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2">Validate <ArrowRight size={15} /></button>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 2 && (
        <div className="space-y-4">
          {counts && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[['Total', counts.total, 'text-white'], ['Ready', counts.ready, 'text-green-400'], ['Warning', counts.warning, 'text-amber-400'], ['Error', counts.error, 'text-red-400'], ['Duplicate', counts.duplicate, 'text-purple-400'], ['Already live', counts.liveDuplicate || 0, 'text-sky-400']].map(([l, v, c]) => (
                <div key={l} className="bg-gray-900 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-500">{l}</p><p className={`text-2xl font-bold ${c}`}>{v}</p></div>
              ))}
            </div>
          )}
          {module === 'tyre' && counts && counts.amount > 0 && (
            <div className="bg-emerald-900/15 border border-emerald-700/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-emerald-300/80 uppercase tracking-wide">Total tyre amount (this import)</p>
                <p className="text-3xl font-bold text-emerald-300">{fmtMoney(counts.amount)}</p>
              </div>
              <p className="text-xs text-gray-400 max-w-xs">Derived from <span className="text-gray-200">{counts.qty || counts.total}</span> tyres × unit cost. Quantity and unit cost are stored; the total is computed so all spend rolls up in one place.
                <span className="block mt-1 text-amber-300/90">Looks too high vs your file? Your cost column may already include the quantity — go Back and map it to <span className="font-semibold">"Total Amount"</span> instead; the per-tyre price is derived automatically.</span></p>
            </div>
          )}
          {granularityWarning && (
            <div className="bg-amber-900/20 border border-amber-600/50 rounded-xl p-4 space-y-2">
              <p className="text-sm text-amber-300 flex items-center gap-2">
                <AlertTriangle size={16} />
                This file looks like line-item / finer-grained data - it may be the wrong module.
              </p>
              <p className="text-xs text-gray-400">
                The natural key for <span className="text-gray-200 font-semibold">{MODULES.find((m) => m.key === module)?.label || module}</span> is
                {' '}<span className="text-gray-200 font-semibold">{granularityWarning.keyLabel}</span>, but
                {' '}<span className="text-amber-200 font-semibold">{granularityWarning.pct}%</span> of keyed rows
                {' '}({granularityWarning.collapsed.toLocaleString('en-US')} of {granularityWarning.keyed.toLocaleString('en-US')})
                {' '}collapse to existing keys. Committing here would discard the line-item detail. If this is
                {' '}per-line data (e.g. parts consumption), import it under a finer-grained module instead. Review before committing.
              </p>
            </div>
          )}
          <div className="overflow-x-auto border border-gray-800 rounded-xl max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/60 text-gray-400 text-xs sticky top-0"><tr><th className="text-left px-3 py-2">#</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Dup</th><th className="text-left px-3 py-2">Issues</th></tr></thead>
              <tbody>
                {annotated.slice(0, 200).map((r) => (
                  <tr key={r.sourceRowNo} className="border-t border-gray-800">
                    <td className="px-3 py-1.5 text-gray-500">{r.sourceRowNo}</td>
                    <td className="px-3 py-1.5"><span className={`text-xs px-2 py-0.5 rounded ${statusColor(r.validationStatus)}`}>{r.validationStatus}</span></td>
                    <td className="px-3 py-1.5 text-xs text-gray-400">{r.liveDuplicate ? <span className="text-sky-400">already live · skip</span> : r.dupStatus !== 'none' ? r.dupStatus : '-'}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-500 truncate max-w-[280px]">{r.issues.map((i) => i.message).join('; ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {counts?.countryConflict > 0 && (
            <div className="bg-amber-900/20 border border-amber-600/50 rounded-xl p-4 space-y-2">
              <p className="text-sm text-amber-300 flex items-center gap-2"><AlertTriangle size={16} /> {counts.countryConflict} row(s) carry a country that differs from the selected import country <span className="font-semibold">{activeCountry}</span>.</p>
              <p className="text-xs text-gray-400">To protect country isolation these will be committed under <span className="text-gray-200">{activeCountry}</span> only if you explicitly confirm the override. The original country value is preserved in the source row either way.</p>
              <label className="flex items-center gap-2 text-sm text-amber-200 cursor-pointer">
                <input type="checkbox" checked={countryAck} onChange={(e) => setCountryAck(e.target.checked)} className="accent-amber-500" />
                I confirm these rows belong to {activeCountry} and approve the override.
              </label>
            </div>
          )}
          {isElevated && counts?.liveDuplicate > 0 && (
            <div className="bg-sky-900/15 border border-sky-700/40 rounded-xl p-4 space-y-2">
              <p className="text-sm text-sky-300 flex items-center gap-2"><Database size={16} /> {counts.liveDuplicate} row(s) match records that already exist.</p>
              <label className="flex items-center gap-2 text-sm text-sky-200 cursor-pointer">
                <input type="checkbox" checked={enrichExisting} onChange={(e) => setEnrichExisting(e.target.checked)} className="accent-sky-500" />
                Enrich existing records — fill their blank fields from this file (don't skip).
              </label>
              <p className="text-xs text-gray-400">Combines this file with data already on record: it only fills fields that are currently empty and <span className="text-gray-200">never overwrites</span> a value you already have. Great for stitching together assets/tyres/work orders from different source files. Every change is audited.</p>
            </div>
          )}
          {isElevated && counts?.error > 0 && (
            <div className="bg-red-900/15 border border-red-700/40 rounded-xl p-4 space-y-2">
              <p className="text-sm text-red-300 flex items-center gap-2"><AlertTriangle size={16} /> {counts.error} row(s) failed validation and will be skipped by default.</p>
              <label className="flex items-center gap-2 text-sm text-red-200 cursor-pointer">
                <input type="checkbox" checked={forceFlagged} onChange={(e) => setForceFlagged(e.target.checked)} className="accent-red-500" />
                Force-include these {counts.error} flagged row(s) — commit them anyway.
              </label>
              <p className="text-xs text-gray-400">Use this to push through rows you know are acceptable despite a validation warning. Rows that are genuinely un-insertable (e.g. a missing required field) still fail safely at commit and are logged — the rest of the batch is unaffected.</p>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm flex items-center gap-2"><ArrowLeft size={15} /> Back</button>
            <button onClick={stageAll} disabled={busy || (counts?.countryConflict > 0 && !countryAck)} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Stage & continue{forceFlagged ? ' (forced)' : ''}</button>
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 3 && (
        <div className="space-y-4 max-w-xl">
          {/* Accident-only: attach an evidence package (.zip) and match to rows */}
          {module === 'accident' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Paperclip size={16} className="text-sky-400" />
                <h3 className="text-sm font-semibold text-white">Attach evidence package (optional)</h3>
              </div>
              <p className="text-xs text-gray-400">
                Upload a <span className="text-gray-200">.zip</span> of photos, police reports, invoices, quotations, or insurance
                docs. Files are stored privately and matched to staged accident rows by claim no, police report no, or asset no.
                Unmatched files are kept for later reconciliation.
              </p>
              <label className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer ${attachBusy ? 'border-gray-700 opacity-60 pointer-events-none' : 'border-gray-700 hover:border-sky-600/60'}`}>
                <input type="file" accept=".zip,application/zip" className="hidden" onChange={onAttachmentZip} disabled={attachBusy} />
                {attachBusy ? <Loader2 className="animate-spin mx-auto text-sky-400" /> : <FileArchive className="mx-auto text-gray-500" size={28} />}
                <p className="mt-2 text-xs text-gray-400">{attachBusy ? 'Processing package...' : 'Choose a .zip evidence package'}</p>
              </label>

              {attachWarnings.length > 0 && (
                <div className="bg-amber-900/15 border border-amber-700/40 rounded-lg p-3 text-amber-300 text-xs space-y-1">
                  <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> {attachWarnings.length} file(s) skipped</p>
                  <ul className="list-disc pl-5 max-h-28 overflow-y-auto">
                    {attachWarnings.slice(0, 30).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {attachItems.length > 0 && (
                <div className="overflow-x-auto border border-gray-800 rounded-lg max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800/60 text-gray-400 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">File</th>
                        <th className="text-left px-3 py-2">Matched to</th>
                        <th className="text-left px-3 py-2">Size</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attachItems.map((it, i) => (
                        <tr key={it.name + i} className="border-t border-gray-800">
                          <td className="px-3 py-1.5 text-gray-200 truncate max-w-[200px]">{it.name}</td>
                          <td className="px-3 py-1.5">
                            {it.matchedBy
                              ? <span className="text-green-400">{it.matchedBy === 'claim_no' ? 'Claim no' : it.matchedBy === 'police_report_no' ? 'Police report' : 'Asset no'}</span>
                              : <span className="text-gray-500">unmatched</span>}
                          </td>
                          <td className="px-3 py-1.5 text-gray-400">{(it.sizeBytes / 1024).toFixed(0)} KB</td>
                          <td className="px-3 py-1.5">
                            <span className={`px-2 py-0.5 rounded ${it.status === 'uploaded' ? 'text-green-400 bg-green-900/30' : it.status === 'failed' ? 'text-red-400 bg-red-900/30' : 'text-gray-400 bg-gray-800'}`}>{it.status}</span>
                            {it.error && <span className="ml-2 text-red-400">{it.error}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {attachDone && attachItems.length > 0 && (
                <p className="text-xs text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 size={13} />
                  {attachItems.filter((i) => i.status === 'uploaded').length} uploaded · {attachItems.filter((i) => i.matchedBy).length} matched · {attachItems.filter((i) => i.status === 'failed').length} failed
                </p>
              )}
            </div>
          )}

          {!result ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
              <p className="text-sm text-gray-300">{counts?.ready ?? 0} ready + {counts?.warning ?? 0} warning rows will be committed to the live <span className="text-white">{module}</span> table. Error rows are skipped.</p>
              {module === 'tyre' && counts?.amount > 0 && (
                <p className="text-sm text-emerald-300 border-t border-gray-800 pt-3">Total tyre amount to be recorded: <span className="font-bold">{fmtMoney(counts.amount)}</span> across {counts.qty || counts.total} tyres.</p>
              )}
              {!isElevated && <p className="text-xs text-amber-400">Your role can stage but not approve - this will be submitted for approval.</p>}
              <button onClick={commit} disabled={busy} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2 disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} {isElevated ? 'Approve & commit' : 'Submit for approval'}</button>
              {busy && commitProgress && (
                <div className="space-y-1.5">
                  {commitProgress.phase === 'commit' ? (
                    <>
                      <div className="w-full bg-gray-800 rounded h-1.5 overflow-hidden">
                        <div className="bg-green-500 h-1.5 rounded transition-all"
                          style={{ width: `${Math.min(100, Math.round(((commitProgress.inserted + commitProgress.skipped + commitProgress.failed + commitProgress.merged) / Math.max(1, commitProgress.inserted + commitProgress.skipped + commitProgress.failed + commitProgress.merged + (commitProgress.remaining || 0))) * 100))}%` }} />
                      </div>
                      <p className="text-xs text-gray-400">
                        Committing in chunks… {(commitProgress.inserted || 0).toLocaleString('en-US')} inserted
                        {commitProgress.merged ? ` · ${commitProgress.merged.toLocaleString('en-US')} merged` : ''}
                        {commitProgress.failed ? ` · ${commitProgress.failed.toLocaleString('en-US')} failed` : ''}
                        {' · '}{(commitProgress.remaining || 0).toLocaleString('en-US')} remaining
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400">
                      Enriching existing records… {(commitProgress.enriched || 0).toLocaleString('en-US')} enriched · {(commitProgress.no_match || 0).toLocaleString('en-US')} no match
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className={`rounded-xl p-6 ${result.status === 'failed'
              ? 'bg-red-900/20 border border-red-700/50 text-red-300'
              : 'bg-green-900/20 border border-green-700/50 text-green-300'}`}>
              {result.status === 'failed' ? <AlertTriangle className="mb-2" /> : <CheckCircle2 className="mb-2" />}
              <p className="font-semibold">
                {result.status === 'committed' && `Committed - ${result.inserted} row(s) inserted, ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ''}${result.enriched ? `, ${result.enriched} existing record(s) enriched` : ''}.`}
                {result.status === 'failed' && `No rows could be committed - ${result.failed} row(s) failed. The reasons are listed below.`}
                {result.status !== 'committed' && result.status !== 'failed' && `Status: ${result.status}`}
              </p>
              {Array.isArray(result.errors) && result.errors.length > 0 && (
                <div className="mt-3 bg-black/25 border border-red-800/40 rounded-lg p-3 space-y-1 max-h-52 overflow-y-auto">
                  <p className="text-xs font-semibold text-red-300 uppercase tracking-wide">Why rows failed</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-200/90">
                      <span className="font-mono text-red-300">Row {e.row}:</span> {e.message}
                    </p>
                  ))}
                  {result.failed > result.errors.length && (
                    <p className="text-[11px] text-red-300/70">...and {result.failed - result.errors.length} more - every failed row's reason is saved on the row (Validation issues, code COMMIT_FAILED).</p>
                  )}
                  <p className="text-[11px] text-red-300/70 pt-1">Fix the source values (or the column mapping) and re-import the file - committed rows are skipped automatically.</p>
                </div>
              )}
              {automation && (automation.alerts > 0 || automation.actions > 0) && (
                <p className="mt-2 text-xs text-sky-300 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Automation: {automation.alerts} tyre-risk alert(s) and {automation.actions} corrective action(s) generated{automation.skipped ? ` · ${automation.skipped} skipped (already open)` : ''}.
                </p>
              )}
              {fileQueue.length > 0 ? (
                <div className="mt-3 flex items-center gap-4">
                  <button onClick={nextQueuedFile} className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-2">
                    <UploadCloud size={14} /> Import next file ({fileQueue.length} remaining)
                  </button>
                  <button onClick={() => { setFileQueue([]); reset() }} className="text-sm underline">Discard queue</button>
                </div>
              ) : (
                <button onClick={reset} className="mt-3 text-sm underline">Start another import</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* recent imports */}
      <div className="mt-10">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Recent imports</h2>
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/60 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">Module</th><th className="text-left px-3 py-2">Country</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Rows</th><th className="text-left px-3 py-2">When</th><th className="text-right px-3 py-2">Actions</th></tr></thead>
            <tbody>
              {recent.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-600">No imports yet.</td></tr>}
              {recent.map((b) => {
                const committed = b.import_status === 'committed'
                const rowBusy = rowBusyId === b.id
                return (
                <tr key={b.id} className="border-t border-gray-800">
                  <td className="px-3 py-1.5 capitalize">{b.module}</td>
                  <td className="px-3 py-1.5 text-gray-400">{b.country || '-'}</td>
                  <td className="px-3 py-1.5"><span className={`text-xs px-2 py-0.5 rounded ${committed ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{b.import_status}</span></td>
                  <td className="px-3 py-1.5 text-gray-400">{b.imported_rows || 0}/{b.total_rows || 0}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-xs">{b.created_at ? new Date(b.created_at).toLocaleString('en-GB') : ''}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link to="/data-intake/history" title="Open in import history"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600">
                        Open
                      </Link>
                      <button onClick={() => deleteRecent(b)} disabled={rowBusy}
                        title={committed ? 'Reverse this committed import' : 'Delete this staged batch'}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-700/50 disabled:opacity-50">
                        {rowBusy ? <Loader2 size={12} className="animate-spin" /> : committed ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                        {committed ? 'Reverse' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-600">Original files are stored privately; every source row is preserved. Commits run server-side (permission + country scope + idempotency). <Link to="/upload" className="underline">Legacy upload</Link></p>
      </div>

      {/* uploaded-but-not-imported files (orphans) - nothing is hidden */}
      {orphanFiles.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-amber-400/90 mb-2 flex items-center gap-2"><AlertTriangle size={15} /> Uploaded but not yet imported</h2>
          <p className="text-xs text-gray-500 mb-2">These files were uploaded but never completed the wizard, so they added nothing to your live data. Re-run the import from step 1, or remove them.</p>
          <div className="border border-amber-800/40 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-amber-900/10 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">File</th><th className="text-left px-3 py-2">Country</th><th className="text-left px-3 py-2">Size</th><th className="text-left px-3 py-2">Uploaded</th><th className="text-right px-3 py-2">Actions</th></tr></thead>
              <tbody>
                {orphanFiles.map((f) => (
                  <tr key={f.id} className="border-t border-gray-800">
                    <td className="px-3 py-1.5 text-gray-300 truncate max-w-[240px]">{f.original_filename}</td>
                    <td className="px-3 py-1.5 text-gray-400">{f.country || '-'}</td>
                    <td className="px-3 py-1.5 text-gray-500 text-xs">{f.size_bytes ? `${Math.round(f.size_bytes / 1024)} KB` : '-'}</td>
                    <td className="px-3 py-1.5 text-gray-500 text-xs">{f.created_at ? new Date(f.created_at).toLocaleString('en-GB') : ''}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => deleteOrphan(f)} title="Remove this unused upload"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-700/50">
                        <Trash2 size={12} /> Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
