import { useEffect, useRef, useState } from 'react'
import { Camera, Upload, User, Type, Check, Trash2 } from 'lucide-react'
import Modal from '../ui/Modal'
import ProfileAvatar from './ProfileAvatar'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { AVATAR_PRESETS, AVATAR_COLORS, validateAvatarFile, cropAvatarPhoto, makeAvatar } from '../../lib/profileAvatar'
import { saveMyAvatar } from '../../lib/api/profileAvatar'

export default function AvatarEditor({ open, onClose }) {
  const { profile } = useAuth() || {}
  const { t } = useLanguage()
  const [mode, setMode] = useState('photo')
  const [file, setFile] = useState(null)
  const [draft, setDraft] = useState(undefined)
  const [preset, setPreset] = useState('green')
  const [zoom, setZoom] = useState(1)
  const [vertical, setVertical] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  const owner = useRef(profile?.id)
  useEffect(() => {
    owner.current = profile?.id
    setFile(null); setDraft(undefined); setError(''); setZoom(1); setVertical(50); setMode('photo'); setPreset('green')
  }, [open, profile?.id])
  useEffect(() => {
    let alive = true
    if (!open) return
    if (mode === 'photo') {
      if (!file) return
      const timer = setTimeout(() => { cropAvatarPhoto(file, zoom, vertical).then(value => { if (alive) { setDraft(value); setError('') } })
        .catch(() => { if (alive) { setDraft(undefined); setError('invalidPhoto') } }) }, 120)
      return () => { alive = false; clearTimeout(timer) }
    } else {
      try { setDraft(makeAvatar(profile?.full_name || profile?.username, preset, mode === 'avatar')); setError('') }
      catch { setDraft(undefined); setError('invalidPhoto') }
    }
    return () => { alive = false }
  }, [open, mode, file, zoom, vertical, preset, profile?.full_name, profile?.username])
  async function save(value) {
    const id = profile?.id
    setBusy(true); setError('')
    try {
      await saveMyAvatar(value, id)
      if (owner.current === id) onClose()
    } catch { if (owner.current === id) setError('saveFailed') }
    finally { setBusy(false) }
  }
  function choose(event) {
    const next = event.target.files?.[0]
    event.target.value = ''
    if (!next) return
    try { validateAvatarFile(next); setFile(next); setDraft(undefined); setZoom(1); setVertical(50); setError('') }
    catch (err) { setFile(null); setDraft(undefined); setError(err.message === 'size' ? 'tooLarge' : 'invalidPhoto') }
  }
  return <Modal open={open} onClose={busy ? undefined : onClose} title={t('shell.pictureTitle')} subtitle={t('shell.pictureSubtitle')} size="sm"
    footer={<div className="flex justify-between gap-2 flex-wrap">
      <button type="button" className="btn-secondary" disabled={busy || !profile?.avatar_url} onClick={() => save(null)}><Trash2 size={14} /> {t('shell.removePicture')}</button>
      <button type="button" className="btn-primary" disabled={busy || draft === undefined} onClick={() => save(draft)}><Check size={14} /> {busy ? t('shell.savingPicture') : t('shell.savePicture')}</button>
    </div>}>
    <div className="tp-avatar-tabs" role="group" aria-label={t('shell.pictureStyle')}>
      {[[ 'photo', Upload, 'uploadPhoto' ], ['avatar', User, 'createAvatar'], ['initials', Type, 'useInitials']].map(([key, Icon, label]) =>
        <button type="button" key={key} disabled={busy} aria-pressed={mode === key} onClick={() => { setMode(key); setDraft(undefined); setError('') }}><Icon size={15} />{t(`shell.${label}`)}</button>)}
    </div>
    <div className="tp-avatar-preview"><ProfileAvatar profile={profile} source={draft} size={120} />{file && mode === 'photo' && !draft && !error && <span>{t('shell.preparingPicture')}</span>}</div>
    {mode === 'photo' ? <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} hidden aria-label={t('shell.uploadPhoto')} />
      <button type="button" className="tp-avatar-upload" disabled={busy} onClick={() => input.current?.click()}><Camera size={20} /><strong>{t('shell.choosePhoto')}</strong><span>{t('shell.photoFormats')}</span></button>
      {file && <div className="tp-avatar-crop">
        <label>{t('shell.photoZoom')}<input type="range" min="1" max="3" step="0.05" value={zoom} disabled={busy} onChange={e => { setDraft(undefined); setZoom(Number(e.target.value)) }} /></label>
        <label>{t('shell.photoPosition')}<input type="range" min="0" max="100" step="1" value={vertical} disabled={busy} onChange={e => { setDraft(undefined); setVertical(Number(e.target.value)) }} /></label>
      </div>}
    </> : <div className="tp-avatar-colors" role="group" aria-label={t('shell.avatarColor')}>
      {AVATAR_PRESETS.map(color => <button type="button" key={color} disabled={busy} style={{ background: AVATAR_COLORS[color] }} aria-label={t(`shell.avatarColors.${color}`)} aria-pressed={preset === color} onClick={() => { setDraft(undefined); setPreset(color) }}>{preset === color && <Check size={18} />}</button>)}
    </div>}
    {error && <p role="alert" className="text-red-500 text-sm mt-3">{t(`shell.${error}`)}</p>}
  </Modal>
}
