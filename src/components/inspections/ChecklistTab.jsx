import { useLanguage } from '../../contexts/LanguageContext'
import {
  FileText, Camera, CheckSquare, Share2, WifiOff, PenLine, Image as ImageIcon, Gauge, Clock, Send,
  ExternalLink, X, AlertTriangle, CircleDot,
} from 'lucide-react'
import VehicleTyreDiagram from '../VehicleTyreDiagram'
import { layoutSlotsFor, isTyrelessEquipment } from '../../lib/vehicleTyreLayout'
import { shareOrCopy } from '../../hooks/useWakeLock'
import { damagedPositions } from '../../lib/inspectionTyreFlags'
import { inferVehicleTypeFromAsset, checklistProgress, checklistConditionTally } from '../../lib/inspectionsAnalytics'
import TyreDueBanner from './TyreDueBanner'
import PositionSheet from './PositionSheet'
import { CHECKLIST_LABELS } from './checklistLabels'

const MAX_PHOTOS = 6

/** Downscale a picked image to at most 800px and re-encode as JPEG (q 0.75). */
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = (ev) => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not an image this browser can read.'))
      img.onload = () => {
        const MAX = 800
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = img.width * scale
        canvas.height = img.height * scale
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  })
}

/**
 * The daily tyre checklist tab: the field form (asset, site, the tap-a-wheel
 * diagram, meters, photos, signature, notes) and the saved-confirmation view with
 * its report, share and send-for-approval actions.
 *
 * Moved out of Inspections.jsx. ALL writes stay with the page: the save, the
 * approval request and the reset arrive as callbacks, so the checklist's write
 * path and its completeness gate are exactly what they were. The gate value
 * itself (clTyresIncomplete) is computed by the page and passed in, so the
 * button below and the save handler still read one single value.
 */
export default function ChecklistTab({
  lang, setLang,
  clSaved, clOffline, clAsset, setClAsset, clSite, setClSite, clDate, setClDate,
  clInspector, setClInspector, clFleetInfo, clPositions, setClPositions,
  clNotes, setClNotes, clOdometer, setClOdometer, clHourMeter, setClHourMeter,
  clPhotos, setClPhotos, clSignature, setClSignature, clError, clSaving, clLookingUp,
  clSelectedPos, setClSelectedPos, clApproverEmail, setClApproverEmail,
  clApprovalStatus, clEmailSent, clSendingEmail, showApprovalForm, setShowApprovalForm,
  clTyresIncomplete, clMissingPressure, clPendingNames, pendingCount,
  masterAssets, masterSites, sites, flagMap, diagramRef,
  cameraInputRef, galleryInputRef,
  loadFleetInfo, saveChecklist, exportChecklistPdf, onNewChecklist, onSendForApproval,
  onOpenSignaturePad, onPhotoError,
}) {
  const { t } = useLanguage()
  const onCameraFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try { const url = await compressImageFile(file); setClPhotos((ps) => [...ps, url].slice(0, MAX_PHOTOS)) }
    catch (err) { onPhotoError?.(err) }
  }
  const onGalleryFiles = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, MAX_PHOTOS - clPhotos.length)
    e.target.value = ''
    for (const file of files) {
      try { const url = await compressImageFile(file); setClPhotos((ps) => [...ps, url].slice(0, MAX_PHOTOS)) }
      catch (err) { onPhotoError?.(err) }
    }
  }
  const tally = checklistConditionTally(clPositions)

  return (
      <div className="space-y-4">
        {clSaved ? (
          <div
            className="card"
            dir={lang === 'ar' ? 'rtl' : undefined}
            style={{ background: clOffline ? '#fffbeb' : undefined, borderColor: clOffline ? '#fde68a' : undefined }}
          >
            <div className="flex items-center gap-3 mb-4">
              {clOffline
                ? <WifiOff size={20} style={{ color: '#d97706' }} />
                : <CheckSquare size={20} className="text-green-400" />
              }
              <h3 className="text-lg font-semibold" style={{ color: clOffline ? '#92400e' : undefined }}>
                {clOffline ? t('inspections.saved.savedOfflineTitle') : t('inspections.saved.savedTitle')}
              </h3>
            </div>
            {clOffline && (
              <p className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                {t('inspections.saved.offlineNote')}
              </p>
            )}
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              {t('inspections.saved.for')} <span className="text-[var(--text-primary)] font-mono">{clSaved.asset_no}</span> {t('inspections.saved.on')} {clSaved.scheduled_date}{clOffline ? ` ${t('inspections.saved.queuedSuffix')}` : ` ${t('inspections.saved.doneSuffix')}`}
            </p>
            {/* Summary badges */}
            <div className="flex flex-wrap gap-2 mb-2">
              {tally.good > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-700/40">
                  {t('inspections.saved.badgeGood', { count: tally.good })}
                </span>
              )}
              {tally.wear > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-yellow-900/30 text-yellow-400 border border-yellow-700/40">
                  {t('inspections.saved.badgeWear', { count: tally.wear })}
                </span>
              )}
              {tally.critical > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-red-900/30 text-red-400 border border-red-700/40">
                  {t('inspections.saved.badgeCritical', { count: tally.critical })}
                </span>
              )}
              {clSignature && (
                <span className="text-xs px-2 py-1 rounded-full bg-blue-900/30 text-blue-400 border border-blue-700/40">
                  {t('inspections.saved.badgeSigned')}
                </span>
              )}
              {clPhotos.length > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-purple-900/30 text-purple-400 border border-purple-700/40">
                  {t('inspections.saved.badgePhotos', { count: clPhotos.length })}
                </span>
              )}
            </div>

            {/* Immediate tyre-change flag for the just-inspected vehicle */}
            <TyreDueBanner
              entry={flagMap?.[clSaved.asset_no || clAsset]}
              damaged={damagedPositions({ tyre_conditions: clPositions })}
              inspection={{ ...clSaved, asset_no: clSaved.asset_no || clAsset, tyre_conditions: clPositions }}
            />

            <div className="flex gap-3 flex-wrap">
              {!clOffline && (
                <button onClick={() => exportChecklistPdf(false)} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                  <FileText size={14} /> {CHECKLIST_LABELS[lang].export}
                </button>
              )}
              {!clOffline && (
                <button onClick={() => exportChecklistPdf(true)} className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]">
                  <ExternalLink size={14} /> {t('inspections.saved.previewPdf')}
                </button>
              )}
              {!clOffline && navigator.share && (
                <button
                  onClick={async () => {
                    await shareOrCopy({
                      title: `TyrePulse Inspection: ${clSaved.asset_no}`,
                      text: `Daily tyre inspection for ${clSaved.asset_no} on ${clSaved.scheduled_date} completed. ${tally.critical} critical tyre(s) flagged.`,
                    })
                  }}
                  className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]"
                >
                  <Share2 size={14} /> {t('inspections.saved.share')}
                </button>
              )}
              {!clOffline && (
                <button
                  onClick={() => setShowApprovalForm(v => !v)}
                  className="btn-secondary flex items-center gap-2 text-sm min-h-[44px]"
                  style={{ borderColor: '#6366f1', color: '#6366f1' }}
                >
                  <Send size={14} /> {t('inspections.saved.sendForApproval')}
                </button>
              )}
              <button type="button" onClick={onNewChecklist}
                className="btn-primary text-sm min-h-[44px]">
                {t('inspections.saved.newChecklist')}
              </button>
            </div>

            {/* Approval workflow panel */}
            {showApprovalForm && !clOffline && (
              <div className="mt-3 p-4 rounded-xl" style={{ background: 'var(--panel-3)', border: '1px solid #4338ca' }}>
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <Send size={14} /> {t('inspections.approval.title')}
                </h4>
                <div className="space-y-3">
                  <div>
                    <label className="label" htmlFor="cl-approver-email">{t('inspections.approval.approverEmail')}</label>
                    <input
                      id="cl-approver-email"
                      type="email"
                      autoComplete="email"
                      className="input"
                      placeholder={t('inspections.approval.emailPlaceholder')}
                      value={clApproverEmail}
                      onChange={e => setClApproverEmail(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {t('inspections.approval.hint')}
                  </p>
                  <button
                    disabled={!clApproverEmail.trim() || clSendingEmail}
                    onClick={onSendForApproval}
                    className="btn-primary text-sm w-full disabled:opacity-50"
                    style={{ background: '#4338ca' }}
                  >
                    {clSendingEmail
                      ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" /> {t('inspections.approval.sending')}</>
                      : <><Send size={13} className="inline mr-1" /> {t('inspections.approval.send')}</>
                    }
                  </button>
                </div>
              </div>
            )}

            {clApprovalStatus === 'pending_approval' && !showApprovalForm && (
              <div className="mt-3 px-3 py-2 rounded-xl flex items-center gap-2 text-sm"
                style={{ background: 'var(--panel-3)', border: '1px solid #4338ca', color: '#4f46e5' }}>
                <Send size={14} />
                <span>
                  {clEmailSent ? t('inspections.approval.sentTo') : t('inspections.approval.awaiting')}{' '}
                  <strong>{clApproverEmail}</strong>
                </span>
              </div>
            )}
          </div>
        ) : (
          <div
            className={`card space-y-4${lang === 'ar' ? ' text-right' : ''}`}
            dir={lang === 'ar' ? 'rtl' : undefined}
          >
            {/* Offline queue banner */}
            {pendingCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
                style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e' }}>
                <WifiOff size={14} />
                <span>
                  {t('inspections.form.offlineQueued', { count: pendingCount })}
                </span>
              </div>
            )}

            {/* Card header with language toggle */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">{CHECKLIST_LABELS[lang].title}</h3>
              <div className="flex gap-1 p-0.5 bg-[var(--surface-2)] rounded-lg" role="group" aria-label="Checklist language">
                {['en', 'ar'].map(l => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    aria-label={l === 'en' ? 'English' : 'Arabic'}
                    onClick={() => setLang(l)}
                    className={`px-3 min-h-[36px] min-w-[44px] py-1 rounded-md text-xs font-semibold transition-all ${
                      lang === l
                        ? 'bg-green-600 text-white shadow'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {l === 'en' ? 'EN' : 'AR'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="cl-asset">{CHECKLIST_LABELS[lang].asset}</label>
                {masterAssets.length > 0 ? (
                  <select
                    id="cl-asset"
                    className="input"
                    value={clAsset}
                    onChange={e => {
                      setClAsset(e.target.value)
                      if (e.target.value) loadFleetInfo(e.target.value)
                    }}
                  >
                    <option value="">{t('inspections.form.selectAsset')}</option>
                    {masterAssets.map(a => (
                      <option key={a.asset_no} value={a.asset_no}>
                        {a.asset_no}{a.vehicle_type ? ` - ${a.vehicle_type}` : ''}{a.site ? ` (${a.site})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input id="cl-asset" className="input flex-1" placeholder={t('inspections.form.assetPlaceholder')} value={clAsset}
                      onChange={e => setClAsset(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && loadFleetInfo(clAsset)} />
                    <button onClick={() => loadFleetInfo(clAsset)} disabled={clLookingUp || !clAsset.trim()}
                      className="btn-secondary px-3 min-h-[44px] text-sm disabled:opacity-50">
                      {clLookingUp ? t('common.loading') : t('inspections.form.load')}
                    </button>
                  </div>
                )}
                {(clFleetInfo || (clAsset && inferVehicleTypeFromAsset(clAsset))) && (() => {
                  const vt = clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset)
                  // A machine with no wheels says so, instead of quietly
                  // showing "0 tyres" and an empty checklist.
                  if (isTyrelessEquipment(vt)) {
                    return (
                      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {vt} carries no tyres, so there is no wheel checklist to fill.
                      </p>
                    )
                  }
                  return (
                    <p className="text-xs mt-1" style={{ color: '#16a34a' }}>
                      {vt} · {layoutSlotsFor(vt).length} {t('inspections.form.tyres')}
                    </p>
                  )
                })()}
              </div>
              <div>
                <label className="label" htmlFor="cl-site">{CHECKLIST_LABELS[lang].site}</label>
                {masterSites.length > 0 ? (
                  <select id="cl-site" className="input" value={clSite} onChange={e => setClSite(e.target.value)}>
                    <option value="">{t('inspections.form.selectSite')}</option>
                    {masterSites.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input id="cl-site" className="input" placeholder={t('inspections.form.sitePlaceholder')} value={clSite}
                    onChange={e => setClSite(e.target.value)} list="cl-sites" />
                )}
                <datalist id="cl-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label" htmlFor="cl-inspector">{CHECKLIST_LABELS[lang].inspector}</label>
                <input id="cl-inspector" autoComplete="name" className="input" placeholder={t('inspections.form.inspectorPlaceholder')} value={clInspector}
                  onChange={e => setClInspector(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="cl-date">{t('inspections.form.date')}</label>
                <input id="cl-date" type="date" className="input" value={clDate} onChange={e => setClDate(e.target.value)} />
              </div>
            </div>

            {clPositions.length > 0 && (() => {
              const progress = checklistProgress(clPositions)
              const allFilled = progress.allFilled
              const posIdx = clPositions.findIndex(p => p.position === clSelectedPos)
              const selPos = posIdx >= 0 ? clPositions[posIdx] : null
              return (
                <div className="space-y-3">
                  {/* SVG diagram - single source of truth, tap to fill */}
                  <div
                    ref={diagramRef}
                    className="rounded-2xl flex flex-col items-center py-4 px-2"
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}
                  >
                    <p className="text-xs font-medium mb-3" style={{ color: '#4b5563' }}>{t('inspections.form.tapTyre')}</p>
                    <VehicleTyreDiagram
                      vehicleType={clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset) || 'Pickup'}
                      positions={clPositions.map(p => ({
                        position: p.position,
                        risk_level: p.condition === 'Good' ? 'good'
                          : p.condition === 'Wear' ? 'warning'
                          : (p.condition === 'Damage' || p.condition === 'Puncture') ? 'critical'
                          : 'none',
                      }))}
                      onPositionClick={({ position }) => setClSelectedPos(position)}
                    />
                  </div>

                  {/* Position chips - tap any to jump, shows fill status */}
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tyre positions">
                    {clPositions.map(p => {
                      const has = !!p.pressure
                      const isActive = p.position === clSelectedPos
                      const isPuncture = p.condition === 'Puncture'
                      const isDmg = p.condition === 'Damage' || isPuncture
                      const isWear = p.condition === 'Wear'
                      const bg = isActive ? '#16a34a'
                        : has && isWear ? '#fefce8'
                        : has && isDmg  ? '#fef2f2'
                        : has ? '#f0fdf4'
                        : '#f9fafb'
                      const fg = isActive ? '#ffffff'
                        : has && isWear ? '#854d0e'
                        : has && isDmg  ? '#991b1b'
                        : has ? '#166534'
                        : '#9ca3af'
                      const bd = isActive ? '#16a34a'
                        : has && isWear ? '#fde047'
                        : has && isDmg  ? '#fca5a5'
                        : has ? '#86efac'
                        : '#e5e7eb'
                      return (
                        <button
                          key={p.position}
                          type="button"
                          aria-current={isActive ? 'true' : undefined}
                          aria-label={`${p.label || p.position}: ${has ? `${p.pressure} PSI, ${p.condition || 'no condition'}` : 'not recorded yet'}`}
                          onClick={() => setClSelectedPos(p.position)}
                          className="px-2.5 min-h-[40px] py-1.5 rounded-lg text-xs font-mono font-bold transition-all active:scale-95"
                          style={{ background: bg, color: fg, border: `1.5px solid ${bd}` }}
                        >
                          {p.label || p.position}{has ? ' ✓' : ''}
                          {isPuncture && !isActive && <CircleDot size={10} className="inline ml-0.5" aria-hidden style={{ color: '#dc2626' }} />}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs px-0.5" role="status" style={{ color: allFilled ? '#16a34a' : 'var(--text-muted)' }}>
                    {allFilled
                      ? t('inspections.form.allFilled', { count: clPositions.length })
                      : t('inspections.form.fillProgress', { filled: progress.filled, total: progress.total, remaining: progress.unfilled })}
                  </p>

                  {/* Bottom sheet for selected position */}
                  {clSelectedPos && selPos && (
                    <PositionSheet
                      pos={selPos}
                      posIdx={posIdx}
                      total={clPositions.length}
                      isLast={posIdx === clPositions.length - 1}
                      unfilledCount={progress.unfilled}
                      allFilled={allFilled}
                      lang={lang}
                      onUpdate={(field, val) =>
                        setClPositions(ps => ps.map(p => p.position === clSelectedPos ? { ...p, [field]: val } : p))
                      }
                      onNext={() => {
                        const isOnLast = posIdx === clPositions.length - 1
                        if (isOnLast) {
                          // Re-check unfilled at call time (state may have just changed)
                          const stillUnfilled = clPositions.find((p, i) => i !== posIdx && !p.pressure)
                          if (stillUnfilled) { setClSelectedPos(stillUnfilled.position); return }
                          // All filled - close sheet
                          setClSelectedPos(null)
                          return
                        }
                        setClSelectedPos(clPositions[posIdx + 1].position)
                      }}
                      onPrev={() => { if (posIdx > 0) setClSelectedPos(clPositions[posIdx - 1].position) }}
                      onClose={() => setClSelectedPos(null)}
                    />
                  )}
                </div>
              )
            })()}

            {clPositions.length === 0 && clAsset.trim() && (
              <p className="text-[var(--text-muted)] text-sm text-center py-4">
                {CHECKLIST_LABELS[lang].no_asset}
              </p>
            )}

            {/* Odometer + Hour Meter */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="cl-odometer" className="label flex items-center gap-1.5"><Gauge size={12} className="text-[var(--text-secondary)]" /> {t('inspections.form.odometer')}</label>
                <input id="cl-odometer" type="number" inputMode="numeric" className="input" placeholder={t('inspections.form.odometerPlaceholder')} min="0"
                  value={clOdometer} onChange={e => setClOdometer(e.target.value)} />
              </div>
              <div>
                <label htmlFor="cl-hours" className="label flex items-center gap-1.5"><Clock size={12} className="text-[var(--text-secondary)]" /> {t('inspections.form.hourMeter')}</label>
                <input id="cl-hours" type="number" inputMode="decimal" className="input" placeholder={t('inspections.form.hourMeterPlaceholder')} min="0"
                  value={clHourMeter} onChange={e => setClHourMeter(e.target.value)} />
              </div>
            </div>

            {/* Photo capture */}
            <div>
              <p className="label flex items-center gap-1.5"><Camera size={12} className="text-[var(--text-secondary)]" /> {t('inspections.form.photos')}</p>
              <div className="flex gap-2 flex-wrap mb-2">
                {clPhotos.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt={`Checklist photo ${i + 1}`}
                      style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--hairline)' }} />
                    <button
                      type="button"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => setClPhotos(ps => ps.filter((_, j) => j !== i))}
                      className="absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center text-white"
                      style={{ background: '#dc2626' }}
                    ><X size={14} aria-hidden /></button>
                  </div>
                ))}
                {clPhotos.length < MAX_PHOTOS && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-xs font-semibold bg-[var(--surface-2)] text-[var(--text-primary)]"
                      style={{ border: '1.5px solid #0369a1' }}
                    >
                      <Camera size={13} /> {t('inspections.form.camera')}
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-xs font-semibold bg-[var(--surface-2)] text-[var(--text-primary)]"
                      style={{ border: '1.5px solid #4338ca' }}
                    >
                      <ImageIcon size={13} /> {t('inspections.form.gallery')}
                    </button>
                  </div>
                )}
              </div>
              <input ref={cameraInputRef} aria-label={t('inspections.form.camera')} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={onCameraFile}
              />
              <input ref={galleryInputRef} aria-label={t('inspections.form.gallery')} type="file" accept="image/*" multiple className="hidden"
                onChange={onGalleryFiles}
              />
            </div>

            {/* Inspector Signature */}
            <div>
              <p className="label flex items-center gap-1.5"><PenLine size={12} className="text-[var(--text-secondary)]" /> {t('inspections.form.inspectorSignature')}</p>
              {clSignature ? (
                <div className="flex items-center gap-3">
                  <img src={clSignature} alt="Inspector signature"
                    style={{ height: 56, maxWidth: 180, background: '#fff', borderRadius: 8, border: '1px solid var(--hairline)', padding: 4 }} />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: '#16a34a' }}>{t('inspections.form.signedAs', { name: clInspector })}</p>
                    <button type="button" onClick={() => setClSignature(null)}
                      className="text-xs min-h-[32px] text-[var(--text-muted)] hover:text-red-500 transition-colors mt-0.5">
                      {t('inspections.form.clearSignature')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onOpenSignaturePad}
                  className="flex items-center gap-2 px-4 min-h-[48px] rounded-xl text-sm font-semibold w-full bg-[var(--surface-2)] text-[var(--text-primary)]"
                  style={{ border: '1.5px dashed #16a34a' }}
                >
                  <PenLine size={15} /> {t('inspections.form.tapToSign')}
                </button>
              )}
            </div>

            <div>
              <label className="label" htmlFor="cl-notes">{CHECKLIST_LABELS[lang].notes}</label>
              <textarea id="cl-notes" className="input h-20 resize-none" placeholder={t('inspections.form.notesPlaceholder')}
                value={clNotes} onChange={e => setClNotes(e.target.value)} />
            </div>

            {clError && (
              <div role="alert" className="p-3 rounded-lg border text-sm" style={{ background: 'rgba(220,38,38,0.08)', borderColor: 'rgba(220,38,38,0.4)', color: '#dc2626' }}>
                {clError}
              </div>
            )}
            {clPositions.length > 0 && clTyresIncomplete && (
              <div role="status" className="p-3 rounded-xl flex items-start gap-2 text-sm"
                style={{ background: '#fefce8', border: '1px solid #fde047', color: '#854d0e' }}>
                <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />
                <span>
                  {t('inspections.form.psiWarning', { count: clMissingPressure.length })}
                  {clPendingNames.length > 0 && (
                    <> {t('inspections.form.tyresPending')}: {clPendingNames.join(', ')}</>
                  )}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={saveChecklist}
              disabled={clSaving || !clAsset.trim() || clPositions.length === 0 || clTyresIncomplete}
              className="btn-primary w-full min-h-[48px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {clSaving ? t('common.saving') : CHECKLIST_LABELS[lang].save}
            </button>
          </div>
        )}
      </div>
  )
}
