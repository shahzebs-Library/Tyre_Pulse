import { useEffect, useState } from 'react'
import { avatarInitials, avatarSource } from '../../lib/profileAvatar'

export default function ProfileAvatar({ profile, size = 34, source, className = '' }) {
  const [saved, setSaved] = useState(null)
  const [failed, setFailed] = useState('')
  useEffect(() => {
    const onChange = event => {
      if (event.detail?.id === profile?.id) setSaved({ id: event.detail.id, value: event.detail.value })
    }
    window.addEventListener('tp-profile-avatar', onChange)
    return () => window.removeEventListener('tp-profile-avatar', onChange)
  }, [profile?.id])
  useEffect(() => { setSaved(null) }, [profile?.id, profile?.avatar_url])
  const raw = source !== undefined ? source : saved && saved.id === profile?.id ? saved.value : profile?.avatar_url
  const src = avatarSource(raw)
  return <span className={`tp-profile-avatar ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }} aria-hidden="true">
    {src && failed !== src ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(src)} /> : avatarInitials(profile?.full_name || profile?.username)}
  </span>
}
