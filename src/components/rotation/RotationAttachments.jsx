/**
 * Photos and documents attached to a rotation schedule (tyre_rotations.attachments).
 * Files live in the private `tyre-photos` bucket and open through short-lived
 * signed URLs, resolved here on display and never stored.
 */
import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon } from 'lucide-react'
import { attachmentsOf } from '../../lib/rotationScheduleView'
import { attachmentUrl } from '../../lib/api/rotations'
import { safeHref, safeImageSrc } from '../../lib/safeUrl'

export default function RotationAttachments({ row }) {
  const list = row ? attachmentsOf(row) : []
  const key = list.map((a) => a.path).join('|')
  const [urls, setUrls] = useState({ key: '', map: {}, loading: false })

  useEffect(() => {
    if (!key) return undefined
    let live = true
    setUrls({ key, map: {}, loading: true })
    Promise.all(list.map(async (a) => [a.path, await attachmentUrl(a).catch(() => null)]))
      .then((pairs) => { if (live) setUrls({ key, map: Object.fromEntries(pairs), loading: false }) })
    return () => { live = false }
    // list is derived from key; key is the stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!row) return <div className="cc-empty">Select a schedule to see its files.</div>
  if (!list.length) {
    return <div className="cc-empty"><ImageIcon size={18} aria-hidden="true" /><br />No photos or documents on this schedule. Edit it to add JPG, PNG or PDF files.</div>
  }
  const loading = urls.key !== key || urls.loading
  return (
    <ul className="rs-files">
      {list.map((a) => {
        const url = urls.key === key ? urls.map[a.path] : null
        const isImage = String(a.type || '').startsWith('image/')
        const img = isImage && url ? safeImageSrc(url) : null
        const href = url ? safeHref(url) : null
        return (
          <li key={a.path}>
            {img ? <img src={img} alt="" width={28} height={28} style={{ objectFit: 'cover', borderRadius: 4 }} /> : isImage ? <ImageIcon size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
            <span>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.name}</span>
            <small>{loading ? 'Loading...' : href ? '' : 'Unavailable'}</small>
          </li>
        )
      })}
    </ul>
  )
}
