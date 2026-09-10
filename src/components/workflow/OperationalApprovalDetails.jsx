import JobCardDetail from '../workorders/JobCardDetail'

const fields = [
  ['position', 'Tyre position', 'موضع الإطار'], ['serial_no', 'New tyre serial', 'الرقم التسلسلي للإطار الجديد'],
  ['brand', 'Brand', 'العلامة التجارية'], ['km_at_fitment', 'Odometer at fitment', 'عداد المسافة عند التركيب'],
  ['cost_per_tyre', 'Tyre cost', 'تكلفة الإطار'], ['issue_date', 'Issue date', 'تاريخ الصرف'],
  ['removal_reason', 'Removal reason', 'سبب الإزالة'], ['km_at_removal', 'Odometer at removal', 'عداد المسافة عند الإزالة'],
  ['removal_date', 'Removal date', 'تاريخ الإزالة'], ['reason', 'Reason', 'السبب'],
  ['km', 'Odometer', 'عداد المسافة'], ['date', 'Operation date', 'تاريخ العملية'],
  ['to_asset_no', 'Destination vehicle', 'المركبة المستقبلة'], ['to_position', 'Destination position', 'الموضع المستهدف'],
]

/** Only immutable submitted data is shown; current_source_snapshot is never substituted. */
export default function OperationalApprovalDetails({ entityType, document, language = 'en' }) {
  const ar = language === 'ar'
  if (entityType === 'work_order') return <JobCardDetail row={document.source_snapshot} canEdit={false} />
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
      return <div key={key} className="rounded-lg border border-[var(--hairline)] p-3"><h4 className="font-semibold">{ar ? arabic : en}</h4><p>{[row.asset_no, row.serial_no || row.serial_number, row.position || row.tyre_position, row.brand, row.site, row.country].filter(Boolean).join(' · ')}</p></div>
    })}</div>
    <dl className="grid gap-3 sm:grid-cols-2">{fields.filter(([key]) => payload[key] !== null && payload[key] !== undefined && payload[key] !== '').map(([key, en, arabic]) => <div key={key}><dt className="text-xs text-[var(--text-muted)]">{ar ? arabic : en}</dt><dd className="whitespace-pre-wrap break-words text-sm">{String(payload[key])}</dd></div>)}</dl>
  </section>
}
