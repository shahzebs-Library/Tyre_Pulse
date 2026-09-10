import { useEffect, useState } from 'react'
import JobCardDetail from '../workorders/JobCardDetail'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeHref, safeImageSrc } from '../../lib/safeUrl'

const fields = [
  ['position', 'Tyre position', 'موضع الإطار'], ['serial_no', 'New tyre serial', 'الرقم التسلسلي للإطار الجديد'],
  ['brand', 'Brand', 'العلامة التجارية'], ['km_at_fitment', 'Odometer at fitment', 'عداد المسافة عند التركيب'],
  ['size', 'Tyre size', 'مقاس الإطار'], ['tread_depth', 'Tread depth (mm)', 'عمق المداس (مم)'],
  ['cost_per_tyre', 'Tyre cost', 'تكلفة الإطار'], ['issue_date', 'Issue date', 'تاريخ الصرف'],
  ['removal_reason', 'Removal reason', 'سبب الإزالة'], ['km_at_removal', 'Odometer at removal', 'عداد المسافة عند الإزالة'],
  ['removal_date', 'Removal date', 'تاريخ الإزالة'], ['reason', 'Reason', 'السبب'],
  ['km', 'Odometer', 'عداد المسافة'], ['date', 'Operation date', 'تاريخ العملية'],
  ['to_asset_no', 'Destination vehicle', 'المركبة المستقبلة'], ['to_position', 'Destination position', 'الموضع المستهدف'],
  ['request_reason', 'Request reason', 'سبب الطلب'],
]

function RequestedPhoto({ reference, index, ar }) {
  const [photo, setPhoto] = useState({ loading: true, url: null })
  useEffect(() => {
    let cancelled = false
    setPhoto({ loading: true, url: null })
    resolveStorageUrl(reference).then(url => {
      if (!cancelled) setPhoto({ loading: false, url: safeImageSrc(url) })
    }).catch(() => { if (!cancelled) setPhoto({ loading: false, url: null }) })
    return () => { cancelled = true }
  }, [reference])
  const label = ar ? `صورة الطلب ${index + 1}` : `Request photo ${index + 1}`
  if (photo.loading) return <p role="status">{ar ? 'جارٍ تحميل صورة الطلب…' : 'Loading request photo…'}</p>
  if (!photo.url) return <p role="alert">{label}: {ar ? 'تعذر تحميل الصورة. حدّث المراجعة لإعادة المحاولة.' : 'Photo could not be loaded. Refresh the review to retry.'}</p>
  return <a href={safeHref(photo.url)} target="_blank" rel="noopener noreferrer" aria-label={label}>
    <img src={photo.url} alt={label} className="h-40 w-full rounded-lg object-contain" onError={() => setPhoto({ loading: false, url: null })} />
  </a>
}

/** Only immutable submitted data is shown; current_source_snapshot is never substituted. */
export default function OperationalApprovalDetails({ entityType, document, language = 'en' }) {
  const ar = language === 'ar'
  if (entityType === 'work_order') return <section className="space-y-4">
    {document.payload?.reason && <p className="whitespace-pre-wrap break-words"><strong>{ar ? 'سبب الطلب: ' : 'Request reason: '}</strong>{document.payload.reason}</p>}
    <JobCardDetail row={document.source_snapshot} canEdit={false} />
  </section>
  const snapshot = document.source_snapshot || {}
  const payload = document.payload || {}
  const actions = { install: ['Install tyre', 'تركيب إطار'], replace: ['Replace tyre', 'استبدال إطار'], remove: ['Remove tyre', 'إزالة إطار'], move: ['Move tyre', 'نقل إطار'] }
  const identities = [
    ['vehicle', 'Source vehicle', 'المركبة الأصلية'], ['source_tyre', 'Source tyre', 'الإطار الأصلي'],
    ['destination_vehicle', 'Destination vehicle', 'المركبة المستقبلة'], ['destination_tyre', 'Destination tyre', 'الإطار المستهدف'],
  ]
  return <section className="space-y-4" aria-label={ar ? 'عملية الإطار المطلوبة' : 'Requested tyre operation'}>
    <h3 className="font-semibold">{actions[payload.action]?.[ar ? 1 : 0] || document.title}</h3>
    <p className="text-sm text-[var(--text-secondary)]">{ar ? 'الموافقة تسمح بتنفيذ هذه العملية المحددة. لا تُغيّر الموافقة المركبة أو المخزون تلقائياً.' : 'Approval authorises this exact operation. It does not automatically change the vehicle or inventory.'}</p>
    <div className="grid gap-3 sm:grid-cols-2">{identities.map(([key, en, arabic]) => {
      const row = snapshot[key]
      if (!row) return null
      return <div key={key} className="rounded-lg border border-[var(--hairline)] p-3"><h4 className="font-semibold">{ar ? arabic : en}</h4><p className="break-words">{[row.asset_no || row.asset_number, row.serial_no || row.serial_number, row.position || row.tyre_position, row.brand, row.site, row.country].filter(Boolean).join(' · ')}</p></div>
    })}</div>
    <dl className="grid gap-3 sm:grid-cols-2">{fields.filter(([key]) => payload[key] !== null && payload[key] !== undefined && payload[key] !== '').map(([key, en, arabic]) => <div key={key}><dt className="text-xs text-[var(--text-muted)]">{ar ? arabic : en}</dt><dd className="whitespace-pre-wrap break-words text-sm">{String(payload[key])}</dd></div>)}</dl>
    {Array.isArray(payload.photos) && payload.photos.length > 0 && <section aria-label={ar ? 'صور الطلب' : 'Request photos'} className="grid gap-3 sm:grid-cols-2">
      {payload.photos.map((reference, index) => <RequestedPhoto key={`${index}:${reference}`} reference={reference} index={index} ar={ar} />)}
    </section>}
  </section>
}
