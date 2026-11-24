/**
 * Detail of one APPROVED OEM link (oem_part_references.status = 'approved').
 * Shows only what is recorded; anything missing reads "Not recorded". Money is
 * shown in its own currency and never converted. An OEM number match alone is
 * not compatibility: this screen only exists for links a second person approved.
 */
import { X } from 'lucide-react'
import { loadOemPartDetail } from '../../lib/api/materialLinks'
import { fitmentSentence } from '../../lib/inventory/oemFitment'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, StatusPill, fmtDate } from '../inventory/InvUi'

const NR = () => <span className="cc-na">Not recorded</span>
const money = (m) => (m ? `${m.currency || ''} ${Number(m.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim() : null)

function Row({ label, children }) {
  return (
    <div className="oem-dt-row">
      <dt>{label}</dt>
      <dd>{children ?? <NR />}</dd>
    </div>
  )
}

export default function OemPartDetail({ reference, onClose }) {
  const q = useInvQuery(() => loadOemPartDetail(reference), [reference?.id])
  const d = q.data && q.data.status !== 'not_provisioned' ? q.data : null

  return (
    <SectionCard
      title={`OEM ${reference?.oem_part_no || ''}`}
      sub={reference?.manufacturer ? `Manufacturer ${reference.manufacturer}` : 'Manufacturer not recorded'}
      action={onClose && (
        <button type="button" className="cc-btn-ghost" onClick={onClose} aria-label="Close detail">
          <X size={14} aria-hidden="true" /> Close
        </button>
      )}>
      {q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
        : q.data?.status === 'not_provisioned' ? <NotSetUp what="OEM part detail" />
          : q.loading && !d ? <div className="cc-skel" style={{ height: 220 }} aria-busy="true" />
            : d && (
              <div className="oem-dt">
                <dl className="oem-dt-grid">
                  <Row label="Catalogue material">
                    {d.canonical ? `${d.canonical.company_sku} ${d.canonical.description || ''}`.trim() : <span className="cc-na">Not linked to the catalogue</span>}
                  </Row>
                  <Row label="Brand">{d.canonical?.brand || null}</Row>
                  <Row label="OEM numbers">
                    {d.oemNumbers.length ? d.oemNumbers.map((o) => (
                      <span key={o.id} style={{ display: 'block' }}>
                        {o.partNo}{o.manufacturer ? ` (${o.manufacturer})` : ''}{' '}
                        <StatusPill value={o.status} tone={o.status === 'approved' ? 'good' : 'warn'} label={o.status === 'approved' ? 'Approved' : 'Awaiting approval'} />
                      </span>
                    )) : null}
                  </Row>
                  <Row label="ERP item codes">
                    {d.erpCodes.length ? d.erpCodes.map((e) => (
                      <span key={e.id} style={{ display: 'block' }}>{e.country || 'No country'}: <strong>{e.code}</strong> {e.name || ''}</span>
                    )) : null}
                  </Row>
                  <Row label="On hand">{`${formatQty(d.totals.onHand)} (reserved ${formatQty(d.totals.reserved)})`}</Row>
                  <Row label="On open purchase orders">{d.openPo.length ? formatQty(d.openPoQty) : 'None open'}</Row>
                  <Row label="Suppliers">{d.suppliers.length ? d.suppliers.join(', ') : null}</Row>
                  <Row label="Last purchase price">
                    {d.lastPoPrice ? `${money(d.lastPoPrice)}${d.lastPoPrice.date ? ` on ${fmtDate(d.lastPoPrice.date)}` : ''}` : null}
                  </Row>
                  <Row label="Last ERP issue cost">
                    {d.lastIssue ? `${money(d.lastIssue)}${d.lastIssue.date ? ` on ${fmtDate(d.lastIssue.date)}` : ''}` : null}
                  </Row>
                  <Row label="Lead time">{d.leadTime ? `${d.leadTime.days} days (average of ${d.leadTime.orders} delivered orders)` : null}</Row>
                </dl>

                <h3 className="oem-dt-h">Applicable asset models</h3>
                {!d.fitment ? <p className="cc-card-sub">The approved link does not name the manual row it came from, so no model can be shown.</p>
                  : !d.fitment.manuals.length ? <p className="cc-card-sub">The manual for this part was not found.</p>
                    : (
                      <ul className="oem-dt-list">
                        {d.fitment.manuals.map((f) => (
                          <li key={f.manual.id}>
                            {fitmentSentence(f)}
                            {f.makeAssets > 0 && f.modelRecorded === 0 ? ' The fleet register records no model for these assets.' : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                {d.fitment?.truncated && <Note tone="warn">Not every fleet asset was read; the counts may be low.</Note>}

                <h3 className="oem-dt-h">Alternatives and superseded numbers</h3>
                {!d.alternatives.length ? <p className="cc-card-sub">None recorded.</p> : (
                  <ul className="oem-dt-list">
                    {d.alternatives.map((a) => (
                      <li key={a.id}>
                        {a.type === 'superseded' ? 'Superseded: ' : 'Alternative: '}<strong>{a.value}</strong>{' '}
                        <StatusPill value={a.verified ? 'v' : 'u'} tone={a.verified ? 'good' : 'warn'} label={a.verified ? 'Verified' : 'Not verified'} />
                      </li>
                    ))}
                  </ul>
                )}

                <h3 className="oem-dt-h">Stock by location</h3>
                <div className="inv-scroll">
                  <KitTable compact rows={d.stock} empty="No stock recorded for these items." columns={[
                    { key: 'country', header: 'Country', cell: (s) => s.country || <NR /> },
                    { key: 'site', header: 'Site', cell: (s) => s.site || <NR /> },
                    { key: 'location', header: 'Location', cell: (s) => s.location || <span className="cc-na">No bin</span> },
                    { key: 'onHand', header: 'On hand', numeric: true, cell: (s) => formatQty(s.onHand) },
                    { key: 'reserved', header: 'Reserved', numeric: true, cell: (s) => formatQty(s.reserved) },
                  ]} />
                </div>

                {d.openPo.length > 0 && (
                  <>
                    <h3 className="oem-dt-h">Open purchase orders</h3>
                    <div className="inv-scroll">
                      <KitTable compact rows={d.openPo} columns={[
                        { key: 'poNumber', header: 'PO', cell: (p) => p.poNumber || <NR /> },
                        { key: 'supplier', header: 'Supplier', cell: (p) => p.supplier || <NR /> },
                        { key: 'open', header: 'Still to receive', numeric: true, cell: (p) => formatQty(p.open) },
                        { key: 'expected', header: 'Expected', cell: (p) => (p.expected ? fmtDate(p.expected) : <NR />) },
                      ]} />
                    </div>
                  </>
                )}
              </div>
            )}
      <style>{`
        .oem-dt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px 18px; margin: 0; }
        .oem-dt-row { min-width: 0; }
        .oem-dt-row dt { font-size: 12px; opacity: .75; }
        .oem-dt-row dd { margin: 2px 0 0; overflow-wrap: anywhere; }
        .oem-dt-h { font-size: 14px; margin: 16px 0 6px; }
        .oem-dt-list { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
      `}</style>
    </SectionCard>
  )
}
