/**
 * One observation, on its own: the wheel it is about, what was recorded there,
 * the photo of THAT wheel, where it sits on the vehicle, and whether the tyre
 * has since been replaced. "Open full inspection" is still one click away, but
 * a reviewer no longer has to find the finding inside the whole sheet.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Wrench, ImageOff } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import InspectionDiagram from '../inspection/InspectionDiagram'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeImageSrc } from '../../lib/safeUrl'
import { TYRE_NOW_META } from '../../lib/observationTracking'

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

export default function ObservationDetail({ obs, onClose, onOpenInspection, onRaiseAction }) {
  if (!obs) return null
  const now = obs.tyreNow
  const meta = now ? TYRE_NOW_META[now.state] : null
  const canAct = obs.kind !== 'note' && !obs.actionRaised && now?.state !== 'replaced'
    && (obs.tone === 'bad' || obs.tone === 'warn')
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
          {canAct && onRaiseAction && (
            <button type="button" className="cc-btn" onClick={() => onRaiseAction(obs.row)}>
              <Wrench size={14} aria-hidden="true" /> Create action
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
            <InspectionDiagram inspection={obs.row} width={360} showReadings={false} variant="board" />
          </section>
        )}
      </div>
    </SideDrawer>
  )
}
