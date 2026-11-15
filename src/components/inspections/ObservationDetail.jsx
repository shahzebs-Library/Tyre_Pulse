/**
 * One observation, on its own: the wheel it is about, what was recorded there,
 * the photo of THAT wheel, where it sits on the vehicle, and whether the tyre
 * has since been replaced. "Open full inspection" is still one click away, but
 * a reviewer no longer has to find the finding inside the whole sheet.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Wrench, ImageOff, Download } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import InspectionDiagram from '../inspection/InspectionDiagram'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeImageSrc } from '../../lib/safeUrl'
import { TYRE_NOW_META } from '../../lib/observationTracking'
import { downloadObservationReport, observationReportId, observationRevision } from '../../lib/observationReportPdf'

const fmtDay = (d) => {
  if (!d) return 'N/A'
  const x = new Date(`${d}T00:00:00`)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const KIND = { tyre: 'Tyre finding', note: 'Inspector note', observation: 'Site observation' }
const val = (v, unit) => (v == null || v === '' ? 'Not recorded' : `${v}${unit ? ` ${unit}` : ''}`)

function Photo({ refValue }) {
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
    return <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt="Photo of this tyre" className="iw-od-photo" /></a>
  }
  return (
    <div className="iw-od-nophoto">
      <ImageOff size={18} aria-hidden="true" />
      <span>
        {state.status === 'loading' ? 'Loading photo...'
          : state.status === 'failed' ? 'A photo was taken but could not be opened.'
            : 'No photo was taken of this tyre.'}
      </span>
    </div>
  )
}

export default function ObservationDetail({ obs: first, observations = [], onClose, onOpenInspection, onRaiseAction }) {
  const diagramRef = useRef(null)
  const [selected, setSelected] = useState(null)
  const [checkedKeys, setCheckedKeys] = useState([])
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const findings = observations.length ? observations : first ? [first] : []
  const obs = findings.find((f) => f.key === selected) || findings[0]
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
      title={`${obs.asset_no || 'No asset'}${obs.position ? `, ${obs.position}` : ''}`}
      subtitle={`${KIND[obs.kind]} on ${fmtDay(obs.day)}${obs.site ? `, ${obs.site}` : ''}`}
      closeLabel="Close observation"
      footer={(
        <div className="cc iw-od-foot">
          <button type="button" className="cc-btn" disabled={pdfBusy} onClick={async () => {
            setPdfBusy(true); setPdfError('')
            try { await downloadObservationReport(obs.row, findings, { svgEl: diagramRef.current?.querySelector('svg[data-tyre-map]') || diagramRef.current?.querySelector('svg') }) }
            catch (e) { setPdfError(e?.message || 'Could not download the observation report.') }
            finally { setPdfBusy(false) }
          }}><Download size={14} aria-hidden="true" /> {pdfBusy ? 'Preparing PDF...' : 'Download observation PDF'}</button>
          {eligible.length > 0 && onRaiseAction && (
            <button type="button" className="cc-btn-primary" disabled={!checked.length}
              onClick={() => onRaiseAction(obs.row, checked.map((f) => `damage:${f.rawPosition}`))}>
              <Wrench size={14} aria-hidden="true" /> Create actions ({checked.length})
            </button>
          )}
          {obs.actionRaised && <Link className="cc-link" to="/actions">Action raised</Link>}
          <button type="button" className="cc-btn-primary" onClick={() => onOpenInspection(obs.row)}>
            <ExternalLink size={14} aria-hidden="true" /> Open full inspection
          </button>
        </div>
      )}
    >
      <div className="cc iw-od">
        {pdfError && <p role="alert" className="iw-od-muted">{pdfError}</p>}
        <section className="iw-od-block" aria-label="Inspection report reference">
          <h4>Inspection details</h4>
          <dl className="iw-od-facts">
            <div><dt>Report ID</dt><dd>{observationReportId(obs.row)}</dd></div>
            <div><dt>PDF template version</dt><dd>1.0</dd></div>
            <div><dt>Source revision</dt><dd>{observationRevision(obs.row)}</dd></div>
            <div><dt>Asset</dt><dd>{obs.asset_no || 'Not recorded'}</dd></div>
            <div><dt>Inspection date</dt><dd>{fmtDay(obs.day)}</dd></div>
            <div><dt>Site</dt><dd>{obs.site || 'Not recorded'}</dd></div>
            <div><dt>Inspection type</dt><dd>{obs.row?.inspection_type || 'Not recorded'}</dd></div>
            <div><dt>Inspector</dt><dd>{obs.inspector || 'Not recorded'}</dd></div>
            <div><dt>Status</dt><dd>{obs.row?.approval_status || obs.row?.status || 'Not recorded'}</dd></div>
          </dl>
        </section>
        <section className="iw-od-block" aria-label="Findings in this inspection">
          <h4>Findings ({findings.length})</h4>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="iw-od-muted">{checked.length} of {eligible.length} actionable tyres selected</p>
            <div className="flex gap-2">
              <button type="button" className="cc-btn" onClick={() => setCheckedKeys(eligible.map((f) => f.key))}>Select all</button>
              <button type="button" className="cc-btn" onClick={() => setCheckedKeys([])}>Clear</button>
            </div>
          </div>
          <div className="space-y-2">
            {findings.map((f, i) => {
              const available = eligible.some((e) => e.key === f.key)
              return (
                <div key={f.key} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" disabled={!available}
                    aria-label={`Select action for ${f.position || f.text}`}
                    checked={checkedKeys.includes(f.key) && available}
                    onChange={(e) => setCheckedKeys((old) => e.target.checked ? [...new Set([...old, f.key])] : old.filter((key) => key !== f.key))} />
                  <button type="button" className="flex-1 text-left text-sm" aria-pressed={f.key === obs.key}
                    onClick={() => setSelected(f.key)}>
                    <span className="font-semibold">{i + 1}. {f.position || (f.kind === 'note' ? 'Inspector note' : 'Site observation')}</span>
                    <span className="block text-[var(--text-secondary)]">{f.text}</span>
                  </button>
                  <span className="text-xs text-[var(--text-muted)]">{f.actionRaised ? 'Action raised' : f.tyreNow?.state === 'replaced' ? 'Replaced' : !available ? 'Information only' : 'Needs action'}</span>
                </div>
              )
            })}
          </div>
          <p className="iw-od-muted">Tick several tyres, then create their actions together. Click a tyre name to view its photos and readings below.</p>
        </section>
        <section className="iw-od-head">
          <span className={`cc-pill ${obs.tone}`}>{obs.severity}</span>
          <h3>{obs.text}</h3>
          {obs.remarks && <p>{obs.remarks}</p>}
        </section>

        {obs.kind === 'tyre' && (
          <>
            <dl className="iw-od-facts">
              <div><dt>Position</dt><dd>{obs.position || 'Not recorded'}</dd></div>
              <div><dt>Pressure</dt><dd>{val(obs.pressure, 'PSI')}</dd></div>
              <div><dt>Tread</dt><dd>{val(obs.tread, 'mm')}</dd></div>
              <div><dt>Inspector</dt><dd>{obs.inspector || 'N/A'}</dd></div>
            </dl>

            <section className="iw-od-block">
              <h4>Is it fixed?</h4>
              {!now ? (
                <p className="iw-od-muted">Checking the tyre change records...</p>
              ) : (
                <div className={`iw-od-now ${meta.tone}`}>
                  <span className={`cc-pill ${meta.tone}`}>{meta.label}</span>
                  <p>
                    {now.state === 'replaced' && (
                      <>A new tyre{now.replacement?.serial ? ` (${now.replacement.serial}${now.replacement.brand ? `, ${now.replacement.brand}` : ''})` : ''} was fitted on this wheel on {fmtDay(now.replacement?.fittedOn)}
                        {now.daysToReplace != null ? `, ${now.daysToReplace} ${now.daysToReplace === 1 ? 'day' : 'days'} after this inspection` : ''}{now.replacement?.jobCard ? `, on job card ${now.replacement.jobCard}` : ', no job card recorded'}. No action is needed.</>
                    )}
                    {now.state === 'removed_not_replaced' && <>This tyre was taken off{now.removedOn ? ` on ${fmtDay(now.removedOn)}` : ''}, but no new tyre has been recorded on this wheel.</>}
                    {now.state === 'on_vehicle' && <>The same tyre is still fitted on this wheel. It has not been changed since this inspection.</>}
                    {now.state === 'unknown' && <>{now.reason || 'No tyre change record covers this wheel.'}</>}
                  </p>
                </div>
              )}
            </section>

            <section className="iw-od-block">
              <h4>Photo of this tyre</h4>
              <Photo refValue={obs.photo} />
            </section>
          </>
        )}

        {obs.row && (
          <section className="iw-od-block">
            <h4>On the vehicle</h4>
            <div ref={diagramRef}><InspectionDiagram inspection={obs.row} width={360} showReadings={false} variant="board" /></div>
          </section>
        )}
      </div>
    </SideDrawer>
  )
}
