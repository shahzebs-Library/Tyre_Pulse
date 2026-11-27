import { useEffect, useMemo, useState } from 'react'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/safeError'
import { canVerify, previewVerification } from '../../lib/fleetVerification'
import {
  currentPosition, listPeerIdentifiers, newVerificationId, submitFleetVerification,
  uploadVerificationPhoto, validateVerificationPhoto,
} from '../../lib/api/fleetVerification'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']

/**
 * One on-site check of one machine. The verification id is minted once per
 * open, so a retried save never creates a second record or a second photo.
 */
export default function VerifyOnSiteModal({ open, onClose, vehicle, onDone }) {
  const { t } = useLanguage()
  const { profile, isSuperAdmin } = useAuth()
  const allowed = canVerify({ role: profile?.role, isSuperAdmin })

  const [verificationId, setVerificationId] = useState(() => newVerificationId())
  const [outcome, setOutcome] = useState('present')
  const [assetNo, setAssetNo] = useState('')
  const [plate, setPlate] = useState('')
  const [chassis, setChassis] = useState('')
  const [otherCountry, setOtherCountry] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState(null)
  const [peers, setPeers] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!open || !vehicle) return
    setVerificationId(newVerificationId())
    setOutcome('present'); setAssetNo(vehicle.asset_no || ''); setPlate(''); setChassis('')
    setOtherCountry(''); setNote(''); setFile(null); setError(null); setResult(null)
    let alive = true
    listPeerIdentifiers(vehicle).then((rows) => { if (alive) setPeers(rows) })
    return () => { alive = false }
  }, [open, vehicle])

  const preview = useMemo(() => previewVerification({
    vehicle, outcome, observedAssetNo: assetNo, observedPlate: plate, observedChassis: chassis,
    hasPhoto: Boolean(file), others: peers,
  }), [vehicle, outcome, assetNo, plate, chassis, file, peers])

  if (!vehicle) return null
  const list = (keys, ns) => keys.map((k) => t(`fleetVerification.${ns}.${k}`)).join(', ')
  const onFile = (v) => t('fleetVerification.modal.onFile', { value: v || t('fleetVerification.modal.blank') })

  async function save() {
    setError(null)
    if (outcome === 'other_country' && !otherCountry) { setError(t('fleetVerification.modal.needCountry')); return }
    setBusy(true)
    try {
      if (file) validateVerificationPhoto(file)
      const position = await currentPosition()
      const photoPath = file ? await uploadVerificationPhoto({ file, vehicle, verificationId }) : null
      const res = await submitFleetVerification({
        verificationId, vehicle, outcome, observedAssetNo: assetNo, observedPlate: plate,
        observedChassis: chassis, photoPath, position, otherCountry, note,
      })
      if (res?.notSetUp) { setError(t('fleetVerification.notSetUp')); return }
      setResult(res)
      onDone?.(res)
    } catch (e) {
      setError(toUserMessage(e, t('fleetVerification.loadError')))
    } finally {
      setBusy(false)
    }
  }

  const footer = result ? (
    <button type="button" className="btn-primary" onClick={onClose}>{t('fleetVerification.action.close')}</button>
  ) : (
    <div className="flex gap-2 justify-end">
      <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t('fleetVerification.action.cancel')}</button>
      <button type="button" className="btn-primary" onClick={save} disabled={busy || !allowed}>
        {busy ? t('fleetVerification.modal.saving') : t('fleetVerification.action.submit')}
      </button>
    </div>
  )

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} size="md" footer={footer}
      title={t('fleetVerification.modal.title')}
      subtitle={t('fleetVerification.modal.subtitle', { asset: vehicle.asset_no })}>
      {!allowed && <p role="alert" className="text-sm" style={{ color: 'var(--danger, #b91c1c)' }}>{t('fleetVerification.modal.notAllowed')}</p>}
      {result ? (
        <p role="status" className="text-sm">
          {result.status === 'auto_applied' ? t('fleetVerification.modal.savedApplied') : t('fleetVerification.modal.savedPending')}
        </p>
      ) : (
        <div className="space-y-4" aria-busy={busy}>
          <fieldset>
            <legend className="text-sm font-medium mb-2">{t('fleetVerification.modal.outcome')}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {[['present', 'present'], ['not_found', 'notFound'], ['other_country', 'otherCountry']].map(([v, k]) => (
                <label key={v} className="flex items-center gap-2 text-sm px-3 py-2 rounded border cursor-pointer"
                  style={{ borderColor: outcome === v ? 'var(--accent, #16a34a)' : 'var(--border)', minHeight: 44 }}>
                  <input type="radio" name="fv-outcome" value={v} checked={outcome === v} onChange={() => setOutcome(v)} />
                  {t(`fleetVerification.modal.${k}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {outcome === 'other_country' && (
            <label className="block text-sm">
              {t('fleetVerification.modal.whichCountry')}
              <select className="input mt-1 w-full" value={otherCountry} onChange={(e) => setOtherCountry(e.target.value)}>
                <option value="">-</option>
                {COUNTRIES.filter((c) => c !== vehicle.country).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}

          {outcome === 'present' && (
            <>
              <label className="block text-sm">
                {t('fleetVerification.modal.assetCode')}
                <input className="input mt-1 w-full" value={assetNo} onChange={(e) => setAssetNo(e.target.value)} autoCapitalize="characters" />
              </label>
              <label className="block text-sm">
                {t('fleetVerification.modal.plate')}
                <input className="input mt-1 w-full" value={plate} onChange={(e) => setPlate(e.target.value)} autoCapitalize="characters" />
                <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{onFile(vehicle.registration_no)}</span>
              </label>
              <label className="block text-sm">
                {t('fleetVerification.modal.chassis')}
                <input className="input mt-1 w-full" value={chassis} onChange={(e) => setChassis(e.target.value)} autoCapitalize="characters" />
                <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{onFile(vehicle.chassis_no)}</span>
              </label>
            </>
          )}

          <label className="block text-sm">
            {t('fleetVerification.modal.photo')}
            <input className="mt-1 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.modal.photoHint')}</span>
          </label>

          <label className="block text-sm">
            {t('fleetVerification.modal.note')}
            <textarea className="input mt-1 w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <div className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
            {outcome === 'not_found' && <p>{t('fleetVerification.modal.notFoundHint')}</p>}
            {outcome === 'other_country' && <p>{t('fleetVerification.modal.otherCountryHint')}</p>}
            {outcome === 'present' && preview.applyNow.length > 0 && <p>{t('fleetVerification.modal.willFill', { fields: list(preview.applyNow, 'fields') })}</p>}
            {outcome === 'present' && preview.status === 'pending' && <p>{t('fleetVerification.modal.willWait', { reasons: list(preview.flags, 'flags') })}</p>}
            {outcome === 'present' && preview.status === 'auto_applied' && <p>{t('fleetVerification.modal.willApply')}</p>}
            <p>{t('fleetVerification.modal.gps')}</p>
          </div>

          {error && <p role="alert" className="text-sm" style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p>}
        </div>
      )}
    </Modal>
  )
}
