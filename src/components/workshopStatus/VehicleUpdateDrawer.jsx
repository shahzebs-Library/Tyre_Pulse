/**
 * Vehicle Update Drawer (Workshop Status, Loop 8, spec sections 12 and 13).
 *
 * The ground / supervisor team records the real workshop update here. Every
 * save goes through workshop_status_update_record, which checks permission,
 * validates the controlled lists and stamps WHO and WHEN from the signed-in
 * user. There is deliberately no "Updated by" input: the last update is shown
 * read-only. Only the fields that actually changed are sent.
 *
 * Props: { record, open, onClose, onSaved(updatedRow), permissions, onReload? }
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Loader2, RefreshCw, Save } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { updateWorkshopRecord, listAssignableUsers } from '../../lib/api/workshopStatusUpdate'
import { SELECTABLE_STAGES, DELAY_REASONS, PARTS_STATUSES, needsDetailedReason } from '../../lib/workshopStatus/vocab'
import {
  formFromRecord, diffPatch, validateUpdateForm, vocabKey, MAX_TEXT, MAX_REF,
} from '../../lib/workshopStatus/updateForm'
import './workshopStatus.css'
import './vehicleUpdate.css'

function formatStamp(ts, language) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString(language === 'ar' ? 'ar' : 'en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

export default function VehicleUpdateDrawer({ record, open, onClose, onSaved, permissions, onReload }) {
  const { t, language } = useLanguage()
  const u = (k, v) => t(`workshopStatusUpdate.drawer.${k}`, v)
  const errText = (code) => t(`workshopStatusUpdate.errors.${code}`)
  const valueLabel = (val) => {
    const key = `workshopStatusUpdate.values.${vocabKey(val)}`
    const s = t(key)
    return !s || s === key ? val : s
  }

  const canUpdate = permissions?.update === true
  const canAssign = canUpdate && permissions?.assign === true

  const [form, setForm] = useState(() => formFromRecord(record))
  const [touchedSubmit, setTouchedSubmit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [stale, setStale] = useState(false)
  const [notice, setNotice] = useState('')
  const [users, setUsers] = useState([])
  const [usersError, setUsersError] = useState(false)

  // Reset whenever a different record (or a newer version of it) is opened.
  const recordKey = `${record?.id ?? ''}|${record?.updated_at ?? ''}`
  useEffect(() => {
    if (!open) return
    setForm(formFromRecord(record))
    setTouchedSubmit(false)
    setSaveError('')
    setStale(false)
    setNotice('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recordKey])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setUsersError(false)
    listAssignableUsers()
      .then((rows) => { if (!cancelled) setUsers(rows || []) })
      .catch(() => { if (!cancelled) { setUsers([]); setUsersError(true) } })
    return () => { cancelled = true }
  }, [open])

  const validation = useMemo(() => validateUpdateForm(form), [form])
  const showErrors = touchedSubmit ? validation.errors : {}
  const disabled = !canUpdate || saving

  const set = (field) => (e) => {
    const value = e.target.value
    setForm((f) => ({ ...f, [field]: value }))
    setNotice('')
    setSaveError('')
  }

  const save = async () => {
    if (!canUpdate || saving || !record?.id) return
    setTouchedSubmit(true)
    setNotice('')
    setSaveError('')
    if (!validation.valid) { setSaveError(u('fixErrors')); return }
    const patch = diffPatch(record, form)
    if (!canAssign) {
      delete patch.responsible_user_id
      delete patch.supporting_user_id
    }
    if (Object.keys(patch).length === 0) { setNotice(u('nothingChanged')); return }
    setSaving(true)
    try {
      const res = await updateWorkshopRecord(record.id, patch, { expectedUpdatedAt: record.updated_at })
      setSaving(false)
      if (res?.record) onSaved?.(res.record)
      else onClose?.()
    } catch (err) {
      setSaving(false)
      if (err?.code === 'record_changed') { setStale(true); return }
      setSaveError(toUserMessage(err, u('saveFailed')))
    }
  }

  if (!record) return null

  const userOptions = (field) => {
    const current = form[field]
    const known = users.some((x) => x.id.toLowerCase() === String(current || '').toLowerCase())
    return (
      <>
        <option value="">{u('pick')}</option>
        {current && !known && (
          <option value={current}>{field === 'responsible_user_id' && record.responsible_user_name
            ? record.responsible_user_name
            : field === 'supporting_user_id' && record.supporting_user_name
              ? record.supporting_user_name
              : u('unknownPerson')}</option>
        )}
        {users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </>
    )
  }

  const fieldError = (field) => showErrors[field]
    ? <span className="wks-upd-err" id={`wks-upd-err-${field}`} role="alert">{errText(showErrors[field])}</span>
    : null
  const errProps = (field) => (showErrors[field]
    ? { 'aria-invalid': true, 'aria-describedby': `wks-upd-err-${field}` }
    : {})

  const selectField = (field, labelKey, list) => (
    <label className="cc-field wks-upd-field">
      <span>{u(labelKey)}</span>
      <select className="cc-select wks-upd-control" value={form[field]} onChange={set(field)} disabled={disabled} {...errProps(field)}>
        <option value="">{u('pick')}</option>
        {form[field] && !list.includes(form[field]) && <option value={form[field]}>{form[field]}</option>}
        {list.map((v) => <option key={v} value={v}>{valueLabel(v)}</option>)}
      </select>
      {fieldError(field)}
    </label>
  )
  const textArea = (field, labelText) => (
    <label className="cc-field wks-upd-field wks-upd-wide">
      <span>{labelText}</span>
      <textarea className="wks-upd-control wks-upd-text" rows={3} maxLength={MAX_TEXT} value={form[field]}
        onChange={set(field)} disabled={disabled} {...errProps(field)} />
      {fieldError(field)}
    </label>
  )
  const textInput = (field, labelKey) => (
    <label className="cc-field wks-upd-field">
      <span>{u(labelKey)}</span>
      <input type="text" className="wks-upd-control" maxLength={MAX_REF} value={form[field]}
        onChange={set(field)} disabled={disabled} {...errProps(field)} />
      {fieldError(field)}
    </label>
  )
  const dateInput = (field, labelKey) => (
    <label className="cc-field wks-upd-field">
      <span>{u(labelKey)}</span>
      <input type="date" className="wks-upd-control" value={form[field]} onChange={set(field)}
        disabled={disabled} {...errProps(field)} />
      {fieldError(field)}
    </label>
  )
  const personField = (field, labelKey) => (
    <label className="cc-field wks-upd-field">
      <span>{u(labelKey)}</span>
      <select className="cc-select wks-upd-control" value={form[field]} onChange={set(field)}
        disabled={disabled || !canAssign} {...errProps(field)}>
        {userOptions(field)}
      </select>
      {fieldError(field)}
    </label>
  )

  const lastName = record.last_updated_by_name
  const lastAt = formatStamp(record.last_updated_at || record.updated_at, language)
  const otherSelected = needsDetailedReason(form.delay_reason)

  const footer = (
    <div className="cc wks-upd-foot">
      <button type="button" className="cc-btn-ghost wks-tap" onClick={onClose} disabled={saving}>{u('cancel')}</button>
      <button type="button" className="cc-btn-primary wks-tap" onClick={save} disabled={disabled || stale}>
        {saving ? <Loader2 size={15} className="wks-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
        {saving ? u('saving') : u('save')}
      </button>
    </div>
  )

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      size="lg"
      busy={saving}
      closeLabel={u('close')}
      title={u('title', { asset: record.asset_no || '' })}
      subtitle={u('subtitle', { site: record.site || '-', country: record.country || '-' })}
      footer={footer}
    >
      <div className="cc wks-upd">
        <p className="wks-upd-stamp" data-testid="wks-upd-last-updated">
          {lastName && lastAt ? u('lastUpdated', { name: lastName, time: lastAt }) : u('lastUpdatedNever')}
          <span className="wks-upd-sub">{u('lastUpdatedAuto')}</span>
        </p>

        {!canUpdate && (
          <div className="wks-banner warn" role="status"><Info size={16} aria-hidden="true" /><p>{u('noPermission')}</p></div>
        )}
        {stale && (
          <div className="wks-banner bad" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <p>{u('stale')}</p>
              {onReload && (
                <button type="button" className="cc-btn-ghost wks-tap" onClick={onReload}>
                  <RefreshCw size={14} aria-hidden="true" /> {u('reload')}
                </button>
              )}
            </div>
          </div>
        )}
        {saveError && (
          <div className="wks-banner bad" role="alert"><AlertTriangle size={16} aria-hidden="true" /><p>{saveError}</p></div>
        )}
        {notice && <p className="wks-muted" role="status">{notice}</p>}

        <fieldset className="wks-upd-group">
          <legend>{u('sectionStatus')}</legend>
          <div className="wks-upd-grid">
            {selectField('current_stage', 'currentStage', SELECTABLE_STAGES)}
            {selectField('delay_reason', 'delayReason', DELAY_REASONS)}
            {textArea('detailed_reason', otherSelected ? u('detailedReasonRequired') : u('detailedReason'))}
          </div>
        </fieldset>

        <fieldset className="wks-upd-group">
          <legend>{u('sectionWork')}</legend>
          <div className="wks-upd-grid">
            {textArea('work_done', u('workDone'))}
            {textArea('action_taken', u('actionTaken'))}
            {textArea('next_action', u('nextAction'))}
          </div>
        </fieldset>

        <fieldset className="wks-upd-group">
          <legend>{u('sectionParts')}</legend>
          <div className="wks-upd-grid">
            {selectField('parts_status', 'partsStatus', PARTS_STATUSES)}
            {textInput('mr_number', 'mrNumber')}
            {textInput('po_number', 'poNumber')}
            {dateInput('expected_part_date', 'expectedPartDate')}
          </div>
        </fieldset>

        <fieldset className="wks-upd-group">
          <legend>{u('sectionPeople')}</legend>
          {canUpdate && !canAssign && <p className="wks-muted">{u('noAssign')}</p>}
          {usersError && <p className="wks-muted">{u('usersError')}</p>}
          <div className="wks-upd-grid">
            {personField('responsible_user_id', 'responsible')}
            {personField('supporting_user_id', 'supporting')}
            {dateInput('expected_release_date', 'expectedRelease')}
          </div>
        </fieldset>

        <fieldset className="wks-upd-group">
          <legend>{u('sectionEscalation')}</legend>
          <div className="wks-upd-grid">
            {textArea('blocker', u('blocker'))}
            {textArea('remarks', u('remarks'))}
          </div>
        </fieldset>

        <p className="wks-muted wks-upd-attach">{u('attachmentsNote')}</p>
      </div>
    </SideDrawer>
  )
}
