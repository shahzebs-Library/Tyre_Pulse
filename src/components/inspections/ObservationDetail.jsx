/**
 * One observation, on its own: the wheel it is about, what was recorded there,
 * the photo of THAT wheel, where it sits on the vehicle, and whether the tyre
 * has since been replaced. "Open full inspection" is still one click away, but
 * a reviewer no longer has to find the finding inside the whole sheet.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Wrench, ImageOff, Download } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import InspectionDiagram from '../inspection/InspectionDiagram'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeImageSrc } from '../../lib/safeUrl'
import { TYRE_NOW_META } from '../../lib/observationTracking'
import { downloadObservationReport, observationReportId, observationRevision } from '../../lib/observationReportPdf'
import ObservationErpEvidence from './ObservationErpEvidence'
import { getObservationErpLink, isErpReviewNotProvisioned } from '../../lib/api/observationErpEvidence'
import StoredPdfPanel from '../pdf/StoredPdfPanel'
import { getOrCreatePdf, deliverPdf } from '../../lib/pdfCache/service'
import { observationPdfRequest } from '../../lib/pdfCache/reportRequests'
import { applyExportPolicy } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'

const fmtDay = (d) => {
  if (!d) return 'N/A'
  const x = new Date(`${d}T00:00:00`)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Photo({ refValue }) {
  const { t } = useLanguage()
  const [state, setState] = useState({ status: refValue ? 'loading' : 'none', url: null })
  useEffect(() => {
    let alive = true
    if (!refValue) { setState({ status: 'none', url: null }); return undefined }
    setState({ status: 'loading', url: null })
    resolveStorageUrl(refValue)
      .then((url) => { if (alive) setState({ status: url ? 'ok' : 'failed', url }) })
      .catch(() => { if (alive) setState({ status: 'failed', url: null }) })
    return () => { alive = false }
  }, [refValue])
  const src = state.url ? safeImageSrc(state.url) : null
  if (state.status === 'ok' && src) {
    return <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={t('inspections.obsDetail.photo.alt')} className="iw-od-photo" /></a>
  }
  return (
    <div className="iw-od-nophoto">
      <ImageOff size={18} aria-hidden="true" />
      <span>
        {state.status === 'loading' ? t('inspections.obsDetail.photo.loading')
          : state.status === 'failed' ? t('inspections.obsDetail.photo.failed')
            : t('inspections.obsDetail.photo.none')}
      </span>
    </div>
  )
}

export default function ObservationDetail({ obs: first, observations = [], onClose, onOpenInspection, onRaiseAction }) {
  const { t } = useLanguage()
  const p = (k, v) => t(`inspections.obsDetail.${k}`, v)
  const notRec = p('notRecorded')
  const val = (v, unit) => (v == null || v === '' ? notRec : `${v}${unit ? ` ${unit}` : ''}`)
  const diagramRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const [checkedKeys, setCheckedKeys] = useState([])
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [pdfNote, setPdfNote] = useState('')
  const [pdfRev, setPdfRev] = useState(0)
  const { profile, isSuperAdmin } = useAuth() || {}
  const role = String(profile?.role || '').toLowerCase()
  const isAdmin = !!isSuperAdmin || role === 'admin'
  const findings = observations.length ? observations : first ? [first] : []
  const obs = findings.find((f) => f.key === selected) || findings[0]
  const sourceRow = obs?.row || null

  // The observation report for this inspection: served from the stored copy when the
  // current revision is already saved, otherwise drawn here once (same generator) and stored.
  const ensureObservationPdf = useCallback(async (opts = {}) => {
    const req = await observationPdfRequest(sourceRow, findings)
    return getOrCreatePdf({
      ...req, ...opts,
      generate: async () => {
        const links = {}
        let unreadable = false
        const actionIds = [...new Set(findings.map(f => f.actionRecord?.id).filter(Boolean))]
        await Promise.all(actionIds.map(async id => {
          try { links[id] = await getObservationErpLink(id) }
          // Review not set up in the database yet: there is no link to read, which is
          // "not confirmed", not an unreadable record.
          catch (e) { if (!isErpReviewNotProvisioned(e)) unreadable = true }
        }))
        const warnings = []
        const doc = await downloadObservationReport(sourceRow, findings, {
          svgEl: diagramRef.current?.querySelector('svg[data-tyre-map]') || diagramRef.current?.querySelector('svg'),
          erpLinks: links, erpUnreadable: unreadable, save: false, warnings,
        })
        return { bytes: doc.output('arraybuffer'), fileName: req.fileName, warnings }
      },
    })
  }, [sourceRow, findings])
  // The panel re-reads only when what the report prints changes (findings are rebuilt
  // by the parent on every render, so their identity cannot be the trigger).
  const findingsRef = useRef(findings)
  findingsRef.current = findings
  const findingsSig = findings.map((f) => `${f.key}:${f.tyreNow?.state || ''}:${f.actionRecord?.status || ''}`).join('|')
  const buildPdfRequest = () => observationPdfRequest(sourceRow, findingsRef.current)
  const eligible = findings.filter((f) => f.kind === 'tyre' && !f.actionRaised && f.tyreNow?.state !== 'replaced')
  const checked = eligible.filter((f) => checkedKeys.includes(f.key))
  if (!obs) return null
  const now = obs.tyreNow
  const meta = now ? TYRE_NOW_META[now.state] : null
  return (
    <SideDrawer
      open
      onClose={onClose}
      size="lg"
      title={`${obs.asset_no || p('noAsset')}${obs.position ? `, ${obs.position}` : ''}`}
      subtitle={`${p('kindOn', { kind: t(`inspections.obsDetail.kinds.${obs.kind}`), date: fmtDay(obs.day) })}${obs.site ? `, ${obs.site}` : ''}`}
      closeLabel={p('close')}
      footer={(
        <div className="cc iw-od-foot">
          <button type="button" className="cc-btn" disabled={pdfBusy} onClick={async () => {
            setPdfBusy(true); setPdfError(''); setPdfNote('')
            try {
              const result = await ensureObservationPdf()
              // A stored copy skips the generator, so the export switch and audit are applied here.
              if (result.cached) applyExportPolicy([], 'Observation PDF ' + observationReportId(obs.row))
              await deliverPdf(result)
              if (result.note) setPdfNote(result.note)
              setPdfRev((n) => n + 1)
            }
            catch (e) { setPdfError(toUserMessage(e, p('pdfError'))) }
            finally { setPdfBusy(false) }
          }}><Download size={14} aria-hidden="true" /> {pdfBusy ? p('pdfBusy') : p('pdfDownload')}</button>
          {eligible.length > 0 && onRaiseAction && (
            <button type="button" className="cc-btn-primary" disabled={!checked.length}
              onClick={() => onRaiseAction(obs.row, checked.map((f) => `damage:${f.rawPosition}`))}>
              <Wrench size={14} aria-hidden="true" /> {p('createActions', { count: checked.length })}
            </button>
          )}
          {obs.actionRaised && <Link className="cc-link" to="/actions">{p('actionRaised')}</Link>}
          <button type="button" className="cc-btn-primary" onClick={() => onOpenInspection(obs.row)}>
            <ExternalLink size={14} aria-hidden="true" /> {p('openFull')}
          </button>
        </div>
      )}
    >
      <div className="cc iw-od">
        {pdfError && <p role="alert" className="iw-od-muted">{pdfError}</p>}
        {pdfNote && <p role="status" className="iw-od-muted">{pdfNote}</p>}
        {sourceRow?.id && (
          <StoredPdfPanel
            refreshKey={`${sourceRow.id}:${pdfRev}:${findingsSig}`}
            buildRequest={buildPdfRequest}
            canRegenerate={isAdmin || role === 'manager' || role === 'director'}
            isAdmin={isAdmin}
            onRegenerate={async ({ reason }) => {
              const result = await ensureObservationPdf({ regenerate: true, reason })
              if (result.note) setPdfNote(result.note)
              setPdfRev((n) => n + 1)
            }}
          />
        )}
        <section className="iw-od-block" aria-label={p('refAria')}>
          <h4>{p('details')}</h4>
          <dl className="iw-od-facts">
            <div><dt>{p('facts.reportId')}</dt><dd>{observationReportId(obs.row)}</dd></div>
            <div><dt>{p('facts.templateVersion')}</dt><dd>1.0</dd></div>
            <div><dt>{p('facts.revision')}</dt><dd>{observationRevision(obs.row)}</dd></div>
            <div><dt>{p('facts.asset')}</dt><dd>{obs.asset_no || notRec}</dd></div>
            <div><dt>{p('facts.date')}</dt><dd>{fmtDay(obs.day)}</dd></div>
            <div><dt>{p('facts.site')}</dt><dd>{obs.site || notRec}</dd></div>
            <div><dt>{p('facts.type')}</dt><dd>{obs.row?.inspection_type || notRec}</dd></div>
            <div><dt>{p('facts.inspector')}</dt><dd>{obs.inspector || notRec}</dd></div>
            <div><dt>{p('facts.status')}</dt><dd>{obs.row?.approval_status || obs.row?.status || notRec}</dd></div>
          </dl>
        </section>
        <section className="iw-od-block" aria-label={p('findingsAria')}>
          <h4>{p('findings', { count: findings.length })}</h4>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="iw-od-muted">{p('selected', { checked: checked.length, total: eligible.length })}</p>
            <div className="flex gap-2">
              <button type="button" className="cc-btn" onClick={() => setCheckedKeys(eligible.map((f) => f.key))}>{p('selectAll')}</button>
              <button type="button" className="cc-btn" onClick={() => setCheckedKeys([])}>{p('clear')}</button>
            </div>
          </div>
          <div className="space-y-2">
            {findings.map((f, i) => {
              const available = eligible.some((e) => e.key === f.key)
              return (
                <div key={f.key} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" disabled={!available}
                    aria-label={p('selectFor', { name: f.position || f.text })}
                    checked={checkedKeys.includes(f.key) && available}
                    onChange={(e) => setCheckedKeys((old) => e.target.checked ? [...new Set([...old, f.key])] : old.filter((key) => key !== f.key))} />
                  <button type="button" className="flex-1 text-left text-sm" aria-pressed={f.key === obs.key}
                    onClick={() => setSelected(f.key)}>
                    <span className="font-semibold">{i + 1}. {f.position || (f.kind === 'note' ? p('kinds.note') : p('kinds.observation'))}</span>
                    <span className="block text-[var(--text-secondary)]">{f.text}</span>
                  </button>
                  <span className="text-xs text-[var(--text-muted)]">{f.actionRaised ? p('actionRaised') : f.tyreNow?.state === 'replaced' ? p('state.replaced') : !available ? p('infoOnly') : p('needsAction')}</span>
                </div>
              )
            })}
          </div>
          <p className="iw-od-muted">{p('tickHint')}</p>
        </section>
        <section className="iw-od-head">
          <span className={`cc-pill ${obs.tone}`}>{obs.severity}</span>
          <h3>{obs.text}</h3>
          {obs.remarks && <p>{obs.remarks}</p>}
        </section>

        {obs.kind === 'tyre' && (
          <>
            <dl className="iw-od-facts">
              <div><dt>{p('facts.position')}</dt><dd>{obs.position || notRec}</dd></div>
              <div><dt>{p('facts.pressure')}</dt><dd>{val(obs.pressure, 'PSI')}</dd></div>
              <div><dt>{p('facts.tread')}</dt><dd>{val(obs.tread, 'mm')}</dd></div>
              <div><dt>{p('facts.inspector')}</dt><dd>{obs.inspector || p('na')}</dd></div>
            </dl>

            <section className="iw-od-block">
              <h4>{p('fixed.title')}</h4>
              {!now ? (
                <p className="iw-od-muted">{p('fixed.checking')}</p>
              ) : (
                <div className={`iw-od-now ${meta.tone}`}>
                  <span className={`cc-pill ${meta.tone}`}>{p(`state.${now.state}`)}</span>
                  <p>
                    {now.state === 'replaced' && (
                      <>{p('fixed.replaced', {
                        tyre: now.replacement?.serial ? (now.replacement.brand ? p('fixed.tyreBrand', { serial: now.replacement.serial, brand: now.replacement.brand }) : p('fixed.tyreSerial', { serial: now.replacement.serial })) : '',
                        date: fmtDay(now.replacement?.fittedOn),
                        days: now.daysToReplace != null ? (now.daysToReplace === 1 ? p('fixed.dayAfter') : p('fixed.daysAfter', { days: now.daysToReplace })) : '',
                        job: now.replacement?.jobCard ? p('fixed.onJobCard', { jobCard: now.replacement.jobCard }) : p('fixed.noJobCard'),
                      })}</>
                    )}
                    {now.state === 'removed_not_replaced' && <>{now.removedOn ? p('fixed.removedOn', { date: fmtDay(now.removedOn) }) : p('fixed.removed')}</>}
                    {now.state === 'on_vehicle' && <>{p('fixed.onVehicle')}</>}
                    {now.state === 'unknown' && <>{now.reason || p('fixed.unknown')}</>}
                  </p>
                </div>
              )}
            </section>

            <section className="iw-od-block">
              <h4>{p('photoTitle')}</h4>
              <Photo refValue={obs.photo} />
            </section>

            <ObservationErpEvidence observation={obs} />
          </>
        )}

        {obs.row && (
          <section className="iw-od-block">
            <h4>{p('onVehicle')}</h4>
            <div ref={diagramRef}><InspectionDiagram inspection={obs.row} width={360} showReadings={false} variant="board" /></div>
          </section>
        )}
      </div>
    </SideDrawer>
  )
}
