/**
 * DailyUploadPanel - Daily Ops -> Workshop Status -> Daily upload (Loop 5).
 *
 * Flow: pick the country -> choose the morning-update Excel -> parse it in the
 * browser (excelParser.parseWorkshopFile, no writes) -> load the vehicles that
 * are active now (listActiveRecords) -> compare (compareUpload, pure) -> show
 * exactly what a confirm WOULD do -> on Confirm: stageUpload then confirmUpload.
 *
 * Nothing reaches the server until Confirm. The server function is the
 * authority: it re-checks permissions, refuses a stale preview
 * (code 'stale_preview') and a repeated file without acknowledgement
 * (code 'duplicate_file'). Hiding the button is not the security boundary.
 *
 * States: loading (permissions), permission denied, empty (no file yet),
 * processing, validation error, preview, success, failure.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  UploadCloud, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, Search, X,
  PlusCircle, PencilLine, Equal, MinusCircle, Archive, Ban, Copy, ShieldAlert, RotateCcw,
} from 'lucide-react'
import { Card, Kpi, Tabs, KitTable, fmtInt } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings, COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'
import { parseWorkshopFile } from '../../lib/workshopStatus/excelParser'
import { compareWorkshopUpload, describeChange } from '../../lib/workshopStatus/compareUpload'
import {
  listActiveRecords, findPreviousUploadByHash, stageUpload, confirmUpload, cancelUpload, buildStagedRows,
} from '../../lib/api/workshopStatus'
import './workshopStatus.css'

const REVIEW_TABS = ['new', 'changed', 'unchanged', 'removed', 'closed', 'invalid', 'duplicate']
const KPI_META = {
  new: { icon: PlusCircle, tone: 't-green' },
  changed: { icon: PencilLine, tone: 't-blue' },
  unchanged: { icon: Equal, tone: 't-blue' },
  removed: { icon: MinusCircle, tone: 't-amber' },
  closed: { icon: Archive, tone: 't-purple' },
  invalid: { icon: Ban, tone: 't-red' },
  duplicate: { icon: Copy, tone: 't-amber' },
}
const SUMMARY_KEYS = ['new', 'updated', 'unchanged', 'removed', 'closed', 'invalid', 'duplicate', 'previous_active', 'active_after']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** yyyy-mm-dd (or an ISO timestamp) -> "07 Oct 2026"; anything else as given. */
export function fmtDay(v) {
  if (!v) return null
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(v)
  return `${m[3]} ${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`
}

/**
 * The parser throws plain `Error`s with messages written for the person
 * uploading (wrong type, empty, no vehicle column). Those are shown as is.
 * Anything else (a bug, a DOMException, a backend error) goes through
 * toUserMessage so no internal text reaches the screen. toUserMessage alone
 * would hide the parser's "no vehicle number column" message because it
 * contains the word "column".
 */
function parseErrorMessage(err, fallback) {
  if (err instanceof Error && err.constructor === Error && !err.code && err.message && err.message.length <= 300) {
    return err.message
  }
  return toUserMessage(err, fallback)
}

const errCode = (err) => (err && typeof err === 'object' && typeof err.code === 'string' ? err.code : '')

/** Display rows for one review tab, from the comparison. */
function itemsFor(tab, cmp) {
  if (!cmp) return []
  const warn = (row) => (row?.warnings?.length ? row.warnings.join('; ') : null)
  switch (tab) {
    case 'new':
      return cmp.newRecords.map((r) => ({
        id: `n-${r.asset_no}`, asset: r.asset_no, rowNumber: r.row?.rowNumber ?? null,
        category: r.data.vehicle_category, site: r.data.site, jobCard: r.data.job_card_ref,
        complaint: r.data.complaint, since: fmtDay(r.data.ooc_since), daysDown: r.row?.data?.days_down ?? null,
        notes: warn(r.row),
      }))
    case 'changed':
      return cmp.changedRecords.map((r) => ({
        id: `c-${r.asset_no}`, asset: r.asset_no, rowNumber: r.row?.rowNumber ?? null,
        changes: Object.entries(r.changes).map(([f, c]) => describeChange(f, c.from, c.to)),
        notes: warn(r.row),
      }))
    case 'unchanged':
      return cmp.unchangedRecords.map((r) => ({
        id: `u-${r.asset_no}`, asset: r.asset_no, rowNumber: r.row?.rowNumber ?? null,
        category: r.row?.data?.vehicle_category, site: r.row?.data?.site, jobCard: r.row?.data?.job_card_ref,
      }))
    case 'removed':
      return cmp.removedRecords.map((r) => ({
        id: `r-${r.asset_no}`, asset: r.asset_no, rowNumber: r.closedRow?.rowNumber ?? null,
        category: r.record?.vehicle_category, site: r.record?.site,
        jobCard: r.closedRow?.data?.job_card_ref || r.record?.job_card_ref, reason: r.reason,
      }))
    case 'closed':
      return cmp.closedRecords.map((r, i) => ({
        id: `x-${r.asset_no}-${r.row?.rowNumber ?? i}`, asset: r.asset_no, rowNumber: r.row?.rowNumber ?? null,
        site: r.row?.data?.site, jobCard: r.row?.data?.job_card_ref, notes: warn(r.row),
      }))
    case 'invalid':
    case 'duplicate': {
      const list = tab === 'invalid' ? cmp.invalidRecords : cmp.duplicateRecords
      return list.map((r, i) => ({
        id: `${tab[0]}-${r.rowNumber ?? i}-${i}`, asset: r.asset_no || null, rowNumber: r.rowNumber ?? null,
        site: r.data?.site, errors: (r.errors || []).join('; ') || null,
      }))
    }
    default:
      return []
  }
}

export default function DailyUploadPanel({ permissions, permState = 'ready', onRetryPermissions }) {
  const { t } = useLanguage()
  const w = useCallback((k, v) => t(`workshopStatus.upload.${k}`, v), [t])
  const { activeCountry } = useSettings()
  const countries = Array.isArray(COUNTRIES) && COUNTRIES.length ? COUNTRIES : ['KSA', 'UAE', 'Egypt']

  const [country, setCountry] = useState(() => (countries.includes(activeCountry) ? activeCountry : ''))
  const [phase, setPhase] = useState('idle') // idle | processing | comparing | preview | success
  const [fileMeta, setFileMeta] = useState(null) // { fileName, fileHash, fileSize }
  const [preview, setPreview] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [duplicateOf, setDuplicateOf] = useState(null)
  const [ackDuplicate, setAckDuplicate] = useState(false)
  const [parseError, setParseError] = useState('')
  const [recordsError, setRecordsError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [staleNotice, setStaleNotice] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [reviewTab, setReviewTab] = useState('new')
  const [search, setSearch] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const stagedRef = useRef(null) // { uploadId, uploadNo } once staged on the server
  const runRef = useRef(0) // guards against a slow earlier file finishing after a newer one
  const inputRef = useRef(null)

  const canUpload = permissions?.upload === true
  const canConfirm = permissions?.confirm === true

  const discardStaged = useCallback(() => {
    const staged = stagedRef.current
    stagedRef.current = null
    if (staged?.uploadId) {
      // Best effort: a staged upload that is never confirmed changes nothing.
      Promise.resolve().then(() => cancelUpload(staged.uploadId)).catch(() => {})
    }
  }, [])

  const reset = useCallback(() => {
    runRef.current += 1
    discardStaged()
    setPhase('idle'); setFileMeta(null); setPreview(null); setComparison(null)
    setDuplicateOf(null); setAckDuplicate(false); setParseError(''); setRecordsError('')
    setSubmitError(''); setStaleNotice(false); setConfirmOpen(false); setResult(null)
    setReviewTab('new'); setSearch('')
    if (inputRef.current) inputRef.current.value = ''
  }, [discardStaged])

  // Discard a staged-but-unconfirmed upload if the page is left.
  useEffect(() => () => discardStaged(), [discardStaged])

  /** Load the active list for the country and compare. Keeps the parsed file. */
  const compare = useCallback(async (pv, meta, forCountry, run) => {
    setPhase('comparing'); setRecordsError('')
    try {
      const [records, previous] = await Promise.all([
        listActiveRecords({ country: forCountry }),
        meta?.fileHash
          ? findPreviousUploadByHash({ fileHash: meta.fileHash, country: forCountry }).catch(() => null)
          : Promise.resolve(null),
      ])
      if (run !== runRef.current) return
      const cmp = compareWorkshopUpload(pv, records || [], { country: forCountry })
      setComparison(cmp)
      setDuplicateOf(previous || null)
      const first = REVIEW_TABS.find((k) => cmp.summary[k] > 0) || 'new'
      setReviewTab((cur) => (cmp.summary[cur] > 0 ? cur : first))
      setPhase('preview')
    } catch (err) {
      if (run !== runRef.current) return
      setRecordsError(toUserMessage(err, w('fallbackError')))
      setPhase('preview')
    }
  }, [w])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    if (!country) { setParseError(w('countryRequired')); return }
    discardStaged()
    const run = ++runRef.current
    setPhase('processing'); setParseError(''); setRecordsError(''); setSubmitError('')
    setStaleNotice(false); setResult(null); setPreview(null); setComparison(null)
    setDuplicateOf(null); setAckDuplicate(false); setSearch('')
    setFileMeta({ fileName: file.name, fileHash: null, fileSize: file.size })
    let parsed
    try {
      parsed = await parseWorkshopFile(file)
    } catch (err) {
      if (run !== runRef.current) return
      setParseError(parseErrorMessage(err, w('fallbackError')))
      setFileMeta(null)
      setPhase('idle')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    if (run !== runRef.current) return
    const meta = { fileName: parsed.fileName || file.name, fileHash: parsed.fileHash || null, fileSize: parsed.fileSize ?? file.size }
    setFileMeta(meta)
    setPreview(parsed.preview)
    await compare(parsed.preview, meta, country, run)
  }, [country, compare, discardStaged, w])

  const onCountryChange = (value) => {
    if (value === country) return
    reset()
    setCountry(value)
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    if (!canUpload || !country || phase === 'processing' || phase === 'comparing') return
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }

  const rerunAfterStale = useCallback(async () => {
    discardStaged()
    const run = ++runRef.current
    await compare(preview, fileMeta, country, run)
  }, [compare, country, discardStaged, fileMeta, preview])

  const submit = async () => {
    if (!comparison || !preview || submitting) return
    setSubmitting(true); setSubmitError(''); setStaleNotice(false)
    try {
      let staged = stagedRef.current
      if (!staged) {
        const res = await stageUpload({
          country,
          fileName: fileMeta?.fileName,
          fileHash: fileMeta?.fileHash,
          fileSize: fileMeta?.fileSize,
          sheetName: preview.sheetName,
          reportDate: preview.reportDate,
          headerMap: preview.headerMap,
          unmappedHeaders: preview.unmappedHeaders,
          rows: buildStagedRows(comparison, preview),
        })
        staged = { uploadId: res?.uploadId, uploadNo: res?.uploadNo ?? null }
        stagedRef.current = staged
        if (res?.duplicateOf && !ackDuplicate) {
          // The server saw this file before the preview did. Ask first.
          setDuplicateOf((d) => d || (typeof res.duplicateOf === 'object' ? res.duplicateOf : {}))
          setConfirmOpen(false)
          setSubmitError(w('duplicateNeedAck'))
          return
        }
      }
      const summary = await confirmUpload(staged.uploadId, { acknowledgeDuplicate: ackDuplicate })
      stagedRef.current = null
      setResult({ summary: summary || {}, uploadNo: staged.uploadNo, country })
      setConfirmOpen(false)
      setPhase('success')
    } catch (err) {
      setConfirmOpen(false)
      const code = errCode(err)
      if (code === 'stale_preview') {
        setStaleNotice(true)
        await rerunAfterStale()
      } else if (code === 'duplicate_file') {
        setDuplicateOf((d) => d || {})
        setAckDuplicate(false)
        setSubmitError(w('duplicateNeedAck'))
      } else {
        setSubmitError(toUserMessage(err, w('fallbackError')))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const items = useMemo(() => {
    const all = itemsFor(reviewTab, comparison)
    const q = search.trim().toUpperCase().replace(/\s+/g, '')
    return q ? all.filter((it) => String(it.asset || '').toUpperCase().includes(q)) : all
  }, [reviewTab, comparison, search])

  // ── Permission states ──────────────────────────────────────────────────────
  if (permState === 'loading') {
    return (
      <Card>
        <div className="wks-state" role="status" aria-live="polite">
          <Loader2 size={18} className="wks-spin" aria-hidden="true" /> {w('loadingPerms')}
        </div>
      </Card>
    )
  }
  if (!canUpload) {
    return (
      <Card>
        <div className="wks-state wks-state-col" role="alert">
          <ShieldAlert size={26} aria-hidden="true" className="wks-ico-warn" />
          <h2 className="wks-h">{w('deniedTitle')}</h2>
          <p className="wks-muted">{w('deniedBody')}</p>
          {permState === 'error' && onRetryPermissions && (
            <button type="button" className="cc-btn-ghost wks-tap" onClick={onRetryPermissions}>
              <RotateCcw size={14} aria-hidden="true" /> {w('retry')}
            </button>
          )}
        </div>
      </Card>
    )
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (phase === 'success' && result) {
    const s = result.summary
    return (
      <Card>
        <div className="wks-success" role="status" aria-live="polite">
          <CheckCircle2 size={26} aria-hidden="true" className="wks-ico-good" />
          <div>
            <h2 className="wks-h">{w('successTitle')}</h2>
            <p className="wks-muted">
              {result.uploadNo
                ? w('successBody', { no: result.uploadNo, country: result.country, active: fmtInt(s.active_after) })
                : w('successNoNumber', { country: result.country, active: fmtInt(s.active_after) })}
            </p>
          </div>
        </div>
        <dl className="wks-summary-grid">
          {SUMMARY_KEYS.map((k) => (
            <div key={k} className="wks-summary-cell">
              <dt>{w(`summary.${k}`)}</dt>
              <dd>{fmtInt(s[k])}</dd>
            </div>
          ))}
        </dl>
        <div className="wks-actions">
          <button type="button" className="cc-btn-primary wks-tap" onClick={reset}>
            <UploadCloud size={15} aria-hidden="true" /> {w('uploadAnother')}
          </button>
        </div>
      </Card>
    )
  }

  const busy = phase === 'processing' || phase === 'comparing'
  const summary = comparison?.summary
  const blockedByDuplicate = Boolean(duplicateOf) && !ackDuplicate
  const confirmDisabled = !comparison || submitting || busy || !canConfirm || blockedByDuplicate || Boolean(recordsError)

  const columns = columnsFor(reviewTab, w)

  return (
    <div className="wks-panel">
      {/* Country + file */}
      <Card>
        <div className="wks-pick">
          <label className="cc-field wks-country">
            <span>{w('countryLabel')}</span>
            <select
              className="cc-select wks-tap"
              value={country}
              onChange={(e) => onCountryChange(e.target.value)}
              disabled={busy || submitting}
            >
              <option value="">{w('countryPick')}</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <p className="wks-muted wks-hint">{w('countryHint')}</p>
        </div>

        <div
          className={`wks-drop ${dragOver ? 'is-over' : ''} ${!country ? 'is-off' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (country) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <FileSpreadsheet size={28} aria-hidden="true" className="wks-ico" />
          <p className="wks-drop-title">{w('dropTitle')}</p>
          <p className="wks-muted">{w('dropHint')}</p>
          <label className={`cc-btn-primary wks-tap wks-file-btn ${!country || busy ? 'is-disabled' : ''}`}>
            <UploadCloud size={15} aria-hidden="true" /> {w('chooseFile')}
            <input
              ref={inputRef}
              type="file"
              className="wks-file-input"
              accept=".xlsx,.xls,.csv"
              aria-label={w('fileLabel')}
              disabled={!country || busy || submitting}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
        </div>

        <div aria-live="polite" role="status" className="wks-live">
          {phase === 'processing' && (
            <p className="wks-state"><Loader2 size={16} className="wks-spin" aria-hidden="true" /> {w('processing', { name: fileMeta?.fileName || '' })}</p>
          )}
          {phase === 'comparing' && (
            <p className="wks-state"><Loader2 size={16} className="wks-spin" aria-hidden="true" /> {w('loadingRecords')}</p>
          )}
        </div>

        {parseError && (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <div><strong>{w('parseErrorTitle')}</strong><p>{parseError}</p></div>
          </div>
        )}

        {phase === 'idle' && !parseError && (
          <div className="wks-empty">
            <h2 className="wks-h">{w('emptyTitle')}</h2>
            <p className="wks-muted">{w('emptyBody')}</p>
          </div>
        )}
      </Card>

      {recordsError && (
        <div className="cc-card wks-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>{w('recordsErrorTitle')}</strong>
            <p>{recordsError}</p>
            <button type="button" className="cc-btn-ghost wks-tap" onClick={() => compare(preview, fileMeta, country, ++runRef.current)}>
              <RotateCcw size={14} aria-hidden="true" /> {w('retry')}
            </button>
          </div>
        </div>
      )}

      {preview && comparison && phase === 'preview' && (
        <>
          {staleNotice && (
            <div className="cc-card wks-banner warn" role="status" aria-live="polite">
              <AlertTriangle size={17} aria-hidden="true" />
              <p>{w('staleNotice')}</p>
            </div>
          )}

          {duplicateOf && (
            <div className="cc-card wks-banner warn" role="alert">
              <Copy size={17} aria-hidden="true" />
              <div>
                <p>{w('duplicateBanner', {
                  date: fmtDay(duplicateOf.uploaded_at) || '-',
                  name: duplicateOf.uploaded_by_name || w('duplicateUnknownName'),
                })}</p>
                <label className="wks-check wks-tap">
                  <input type="checkbox" checked={ackDuplicate} onChange={(e) => setAckDuplicate(e.target.checked)} />
                  <span>{w('duplicateAck')}</span>
                </label>
              </div>
            </div>
          )}

          <Card title={w('previewTitle')} sub={w('previewSub')}>
            <dl className="wks-meta">
              <div><dt>{w('fileName')}</dt><dd>{fileMeta?.fileName}</dd></div>
              <div><dt>{w('reportDate')}</dt><dd>{fmtDay(preview.reportDate) || w('notInFile')}</dd></div>
              <div><dt>{w('sheet')}</dt><dd>{preview.sheetName || w('notInFile')}</dd></div>
              <div><dt>{w('previousActive')}</dt><dd>{fmtInt(summary.previousActive)}</dd></div>
              <div><dt>{w('rowsInFile')}</dt><dd>{fmtInt(summary.rowsInFile)}</dd></div>
            </dl>
            <div className="wks-kpis">
              {REVIEW_TABS.map((k) => (
                <Kpi
                  key={k}
                  icon={KPI_META[k].icon}
                  tone={KPI_META[k].tone}
                  value={summary[k]}
                  label={w(`kpi.${k}`)}
                  danger={k === 'invalid' && summary.invalid > 0}
                  onClick={() => setReviewTab(k)}
                />
              ))}
            </div>
            {preview.unmappedHeaders?.length > 0 && (
              <div className="wks-unmapped">
                <strong>{w('unmappedTitle')}</strong>
                <p className="wks-muted">{w('unmappedBody')}</p>
                <ul>{preview.unmappedHeaders.map((h) => <li key={h}><span className="cc-pill muted">{h}</span></li>)}</ul>
              </div>
            )}
          </Card>

          <Card>
            <div className="wks-review-head">
              <Tabs
                label={w('reviewLabel')}
                value={reviewTab}
                onChange={setReviewTab}
                tabs={REVIEW_TABS.map((k) => ({
                  key: k, label: w(`kpi.${k}`), count: summary[k],
                  countTone: k === 'invalid' && summary.invalid ? 'red' : '',
                }))}
              />
              <label className="cc-search wks-search">
                <Search size={14} aria-hidden="true" />
                <span className="wks-sr">{w('searchLabel')}</span>
                <input
                  type="search"
                  value={search}
                  placeholder={w('searchPlaceholder')}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button type="button" className="wks-clear" aria-label={t('common.clearSearch')} onClick={() => setSearch('')}>
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </label>
            </div>

            <div role="tabpanel" aria-label={w(`kpi.${reviewTab}`)} data-testid={`wks-review-${reviewTab}`}>
              {items.length === 0 ? (
                <p className="cc-empty wks-tab-empty">{search ? w('noMatches') : w(`emptyTab.${reviewTab}`)}</p>
              ) : (
                <>
                  <div className="wks-desktop">
                    <KitTable columns={columns} rows={items} compact />
                  </div>
                  <ul className="wks-cards">
                    {items.map((it) => (
                      <li key={it.id} className="wks-item">
                        {columns.map((c) => {
                          const v = c.cell ? c.cell(it) : it[c.key]
                          if (v == null || v === '') return null
                          return (
                            <div key={c.key} className="wks-item-row">
                              <span className="wks-item-k">{c.header}</span>
                              <span className="wks-item-v">{v}</span>
                            </div>
                          )
                        })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>

          {submitError && (
            <div className="cc-card wks-banner bad" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <div>
                <strong>{w('failureTitle')}</strong>
                <p>{submitError}</p>
                <p className="wks-muted">{w('failureKept')}</p>
              </div>
            </div>
          )}

          <div className="cc-card wks-actionbar">
            <div className="wks-muted">
              {!canConfirm && <p>{w('needConfirmPerm')}</p>}
              {blockedByDuplicate && canConfirm && <p>{w('duplicateNeedAck')}</p>}
            </div>
            <div className="wks-actions">
              <button type="button" className="cc-btn-ghost wks-tap" onClick={reset} disabled={submitting}>
                {w('cancel')}
              </button>
              <button
                type="button"
                className="cc-btn-primary wks-tap"
                onClick={() => setConfirmOpen(true)}
                disabled={confirmDisabled}
              >
                {submitting ? <Loader2 size={15} className="wks-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
                {submitting ? w('confirming') : w('confirm')}
              </button>
            </div>
          </div>

          <Modal
            open={confirmOpen}
            onClose={() => { if (!submitting) setConfirmOpen(false) }}
            closeOnBackdrop={!submitting}
            title={w('dialogTitle')}
            size="md"
            className="cc wks-modal"
            footer={(
              <div className="wks-actions">
                <button type="button" className="cc-btn-ghost wks-tap" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                  {w('dialogBack')}
                </button>
                <button type="button" className="cc-btn-primary wks-tap" onClick={submit} disabled={submitting || blockedByDuplicate}>
                  {submitting && <Loader2 size={15} className="wks-spin" aria-hidden="true" />}
                  {submitting ? w('confirming') : w('dialogConfirm')}
                </button>
              </div>
            )}
          >
            <div className="wks-dialog">
              <p>{w('dialogIntro', { file: fileMeta?.fileName || '', country })}</p>
              <ul>
                <li>{w('dialogNew', { count: summary.new })}</li>
                <li>{w('dialogChanged', { count: summary.changed })}</li>
                <li>{w('dialogUnchanged', { count: summary.unchanged })}</li>
                <li>{w('dialogRemoved', { count: summary.removed })}</li>
                <li>{w('dialogSkipped', { count: summary.invalid + summary.duplicate })}</li>
              </ul>
              <p className="wks-muted">{w('dialogRemovedNote')}</p>
              <p className="wks-muted">{w('dialogOwnedNote')}</p>
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}

function columnsFor(tab, w) {
  const asset = { key: 'asset', header: w('col.asset'), cell: (r) => <span className="wks-mono">{r.asset || '-'}</span> }
  const row = { key: 'rowNumber', header: w('col.row'), numeric: true }
  const site = { key: 'site', header: w('col.site') }
  const jobCard = { key: 'jobCard', header: w('col.jobCard') }
  const notes = { key: 'notes', header: w('col.notes') }
  switch (tab) {
    case 'new':
      return [asset, { key: 'category', header: w('col.category') }, site, jobCard,
        { key: 'complaint', header: w('col.complaint') }, { key: 'since', header: w('col.since') },
        { key: 'daysDown', header: w('col.daysDown'), numeric: true }, notes]
    case 'changed':
      return [asset, {
        key: 'changes', header: w('col.changes'), sortable: false,
        cell: (r) => <ul className="wks-changes">{r.changes.map((c) => <li key={c}>{c}</li>)}</ul>,
      }, notes]
    case 'unchanged':
      return [asset, { key: 'category', header: w('col.category') }, site, jobCard]
    case 'removed':
      return [asset, { key: 'category', header: w('col.category') }, site, jobCard, {
        key: 'reason', header: w('col.reason'),
        cell: (r) => <span className={`cc-pill ${r.reason === 'listed_as_closed' ? 'info' : 'warn'}`}>{w(`reason.${r.reason}`)}</span>,
      }]
    case 'closed':
      return [asset, row, site, jobCard, notes]
    case 'invalid':
    case 'duplicate':
      return [row, asset, site, { key: 'errors', header: w('col.errors') }]
    default:
      return [asset]
  }
}
