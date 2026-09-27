import Modal from '../ui/Modal'
import { AlertTriangle, Camera } from 'lucide-react'
import EntityApprovalPanel from '../workflow/EntityApprovalPanel'
import VehicleTyreDiagram from '../VehicleTyreDiagram'
import { LAYOUT_KEYS } from '../../lib/vehicleTyreLayout'
import { damagedPositions } from '../../lib/inspectionTyreFlags'
import {
  INSPECTION_TYPES, OBSERVATION_TYPES, TRAINING_TYPES, STATUSES, SEVERITIES, RISK_LEVELS,
  isObservationType, isTrainingType,
} from '../../lib/inspectionsAnalytics'
import { useLanguage } from '../../contexts/LanguageContext'
import TyreDueBanner from './TyreDueBanner'

// Every wheel layout the diagram can draw, so this picker can never drift from
// the diagram (it used to omit Line pump / Truck 6x4 / Tanker / Trailer).
const VEHICLE_TYPES = LAYOUT_KEYS

/**
 * Add or edit one inspection, observation or training record.
 *
 * Moved out of Inspections.jsx. The save stays with the page (it owns the
 * writable-column whitelist and the reload); this component edits `form` and
 * reports the approval lock through setWfLocked, exactly as before. While the
 * record is mid-approval or approved the whole form is disabled.
 */
export default function InspectionFormModal({
  form, setForm, sites, flagMap, selectedTyre, setSelectedTyre,
  wfLocked, setWfLocked, saving, saveError, onSave, onClose, fileRef, onPhotoChange,
}) {
  const { t } = useLanguage()
  const canSave = !(wfLocked || saving || !form.title?.trim() || !form.site?.trim() || !form.scheduled_date)
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={form.id ? t('inspections.modal.editRecord') : t('inspections.modal.addRecord')}
      footer={(
        <div className="w-full space-y-3">
          {saveError && (
            <div role="alert" className="p-3 rounded-lg border text-sm" style={{ background: 'rgba(220,38,38,0.08)', borderColor: 'rgba(220,38,38,0.4)', color: '#dc2626' }}>
              {saveError}
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 min-h-[44px]">{t('common.cancel')}</button>
            <button type="button" onClick={onSave}
              disabled={!canSave}
              title={wfLocked ? 'Locked, in approval' : undefined}
              className="btn-primary flex-1 min-h-[44px] disabled:opacity-50">
              {saving ? t('common.saving') : form.id ? t('inspections.modal.saveChanges') : t('common.add')}
            </button>
          </div>
        </div>
      )}
    >
      {/* Immediate tyre-change flag for this vehicle (open detail) */}
      {form.asset_no && (
        <TyreDueBanner entry={flagMap?.[form.asset_no]} damaged={damagedPositions(form)} inspection={form} />
      )}

      {/* Universal Approval & Workflow Engine — inspection approval + lock.
          Only for persisted records (needs a stable entity id). While the
          record is mid-approval or approved, edits/saves are disabled. */}
      {form.id && (
        <div className="mb-5">
          <EntityApprovalPanel
            entityType="inspection"
            entityId={form.id}
            entityLabel={form.asset_no || form.title || form.id}
            context={{
              pressure: form.tyre_conditions?.[selectedTyre]?.pressure ?? null,
              tread: form.tread_depth ?? null,
              odometer: form.odometer_km ?? null,
              severity: form.severity ?? null,
              site: form.site ?? null,
              asset_no: form.asset_no ?? null,
              inspection_type: form.inspection_type ?? null,
            }}
            onStateChange={({ isActive, isLocked }) => {
              const locked = !!(isActive || isLocked)
              setWfLocked((prev) => (prev === locked ? prev : locked))
            }}
            title={t('inspections.approval.title') || 'Inspection Approval'}
          />
          {wfLocked && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
              <AlertTriangle size={12} aria-hidden /> Locked, in approval
            </div>
          )}
        </div>
      )}

      <fieldset disabled={wfLocked} className="space-y-4 disabled:opacity-60">
        <div>
          <label className="label" htmlFor="insp-title">{t('inspections.modal.titleField')} <span aria-hidden className="text-red-500">*</span></label>
          <input id="insp-title" required className="input" value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder={t('inspections.modal.titlePlaceholder')} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="insp-type">{t('inspections.modal.type')}</label>
            <select id="insp-type" className="input" value={form.inspection_type}
              onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value }))}>
              <optgroup label={t('inspections.modal.groupInspections')}>
                {INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
              <optgroup label={t('inspections.modal.groupObservations')}>
                {OBSERVATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
              <optgroup label={t('inspections.modal.groupTraining')}>
                {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="insp-status">{t('inspections.modal.status')}</label>
            <select id="insp-status" className="input" value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="insp-site">{t('inspections.modal.siteField')} <span aria-hidden className="text-red-500">*</span></label>
            <input id="insp-site" required className="input" value={form.site}
              onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
              placeholder={t('inspections.form.sitePlaceholder')} list="insp-sites" />
            <datalist id="insp-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="insp-date">{t('inspections.modal.dateField')} <span aria-hidden className="text-red-500">*</span></label>
            <input id="insp-date" required type="date" className="input" value={form.scheduled_date}
              onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="insp-asset">{t('inspections.modal.assetNo')}</label>
            <input id="insp-asset" className="input" value={form.asset_no}
              onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))}
              placeholder={t('inspections.form.assetPlaceholder')} />
          </div>
          {!isTrainingType(form.inspection_type) && (
            <div>
              <label className="label" htmlFor="insp-severity">{t('inspections.modal.severity')}</label>
              <select id="insp-severity" className="input" value={form.severity || 'Medium'}
                onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          {isTrainingType(form.inspection_type) && (
            <div>
              <label className="label" htmlFor="insp-serial">{t('inspections.modal.tyreSerial')}</label>
              <input id="insp-serial" className="input" value={form.tyre_serial}
                onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))}
                placeholder={t('inspections.modal.serialPlaceholder')} />
            </div>
          )}
        </div>

        {/* Tyre diagram - inspections only */}
        {!isObservationType(form.inspection_type) && !isTrainingType(form.inspection_type) && (
          <div>
            <label className="label" htmlFor="insp-vtype">{t('inspections.modal.vehicleType')}</label>
            <select id="insp-vtype" className="input mb-3" value={form.vehicle_type || ''}
              onChange={e => { setForm(f => ({ ...f, vehicle_type: e.target.value, tyre_conditions: {} })); setSelectedTyre(null) }}>
              <option value="">{t('inspections.modal.selectVehicleType')}</option>
              {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>

            {form.vehicle_type && (
              <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-[var(--border-bright)]">
                <p className="text-xs text-[var(--text-secondary)] mb-3">{t('inspections.modal.clickTyre')}</p>
                <VehicleTyreDiagram
                  vehicleType={form.vehicle_type}
                  tyreData={form.tyre_conditions || {}}
                  onTyreClick={(id) => setSelectedTyre(id === selectedTyre ? null : id)}
                  width={180}
                />

                {selectedTyre && (
                  <div className="mt-4 p-3 bg-[var(--surface-1)] rounded-lg border border-[var(--border-bright)]">
                    <p className="text-xs font-semibold text-[var(--text-primary)] mb-2">{t('inspections.modal.tyreLabel', { id: selectedTyre })}</p>
                    <div className="flex gap-2 flex-wrap mb-2">
                      {RISK_LEVELS.map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setForm(f => ({
                            ...f,
                            tyre_conditions: {
                              ...f.tyre_conditions,
                              [selectedTyre]: { ...(f.tyre_conditions?.[selectedTyre] ?? {}), risk: r },
                            },
                          }))}
                          aria-pressed={(form.tyre_conditions?.[selectedTyre]?.risk ?? 'none') === r}
                        className={`text-xs px-2.5 min-h-[36px] py-1 rounded border capitalize transition-all ${
                            (form.tyre_conditions?.[selectedTyre]?.risk ?? 'none') === r
                              ? r === 'good'     ? 'bg-green-600 border-green-500 text-white'
                              : r === 'warning'  ? 'bg-yellow-600 border-yellow-500 text-white'
                              : r === 'critical' ? 'bg-red-600 border-red-500 text-white'
                              :                    'bg-[var(--surface-3)] border-[var(--border-bright)] text-[var(--text-primary)]'
                              : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {r === 'none' ? t('inspections.modal.noData') : r}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      aria-label={`Pressure for tyre ${selectedTyre}`}
                      className="input text-xs py-1"
                      placeholder={t('inspections.modal.pressurePlaceholder')}
                      value={form.tyre_conditions?.[selectedTyre]?.pressure ?? ''}
                      onChange={e => setForm(f => ({
                        ...f,
                        tyre_conditions: {
                          ...f.tyre_conditions,
                          [selectedTyre]: { ...(f.tyre_conditions?.[selectedTyre] ?? {}), pressure: e.target.value },
                        },
                      }))}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isTrainingType(form.inspection_type) ? (
          <div>
            <label className="label" htmlFor="insp-attendees">{t('inspections.modal.attendees')}</label>
            <input id="insp-attendees" className="input" value={form.attendees || ''}
              onChange={e => setForm(f => ({ ...f, attendees: e.target.value }))}
              placeholder={t('inspections.modal.attendeesPlaceholder')} />
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="insp-inspector">{t('inspections.modal.inspectorObserver')}</label>
            <input id="insp-inspector" className="input" value={form.inspector}
              onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))}
              placeholder={t('inspections.modal.namePlaceholder')} />
          </div>
        )}

        <div>
          <label className="label" htmlFor="insp-findings">{isTrainingType(form.inspection_type) ? t('inspections.modal.trainingContent') : t('inspections.modal.findings')}</label>
          <textarea id="insp-findings" className="input h-20 resize-none" value={form.findings}
            onChange={e => setForm(f => ({ ...f, findings: e.target.value }))}
            placeholder={isTrainingType(form.inspection_type) ? t('inspections.modal.topicsPlaceholder') : t('inspections.modal.findingsPlaceholder')} />
        </div>
        <div>
          <label className="label" htmlFor="insp-notes">{t('inspections.modal.notes')}</label>
          <textarea id="insp-notes" className="input h-16 resize-none" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder={t('inspections.modal.notesPlaceholder')} />
        </div>

        {/* Photo upload */}
        <div>
          <p className="label">{t('inspections.modal.photo')}</p>
          <div className="flex items-center gap-3">
            <button type="button"
              onClick={() => fileRef.current?.click()}
              className="btn-secondary text-sm flex items-center gap-2 px-3 py-2">
              <Camera size={14} /> {form.photo_data ? t('inspections.modal.changePhoto') : t('inspections.modal.uploadPhoto')}
            </button>
            {form.photo_data && (
              <button type="button" onClick={() => setForm(f => ({ ...f, photo_data: null }))}
                className="text-xs min-h-[36px] px-2 text-red-500 hover:text-red-600">{t('inspections.modal.remove')}</button>
            )}
            <input ref={fileRef} aria-label={t('inspections.modal.uploadPhoto')} type="file" accept="image/*" className="hidden"
              onChange={onPhotoChange} />
          </div>
          {form.photo_data && (
            <img src={form.photo_data} alt="Attached" className="mt-2 rounded-lg max-h-48 border border-[var(--border-bright)] object-cover" />
          )}
        </div>

        {form.status === 'Done' && (
          <div>
            <label className="label" htmlFor="insp-completed">{t('inspections.modal.completedDate')}</label>
            <input id="insp-completed" type="date" className="input" value={form.completed_date || ''}
              onChange={e => setForm(f => ({ ...f, completed_date: e.target.value }))} />
          </div>
        )}
      </fieldset>
      
    </Modal>
  )
}
