/**
 * Detail of one APPROVED OEM link (oem_part_references.status = 'approved').
 * Shows only what is recorded; anything missing reads "Not recorded". Money is
 * shown in its own currency and never converted. An OEM number match alone is
 * not compatibility: this screen only exists for links a second person approved.
 */
import { X } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadOemPartDetail } from '../../lib/api/materialLinks'
import { fitmentSentence } from '../../lib/inventory/oemFitment'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, StatusPill, fmtDate } from '../inventory/InvUi'

function NR() {
  const { t } = useLanguage()
  return <span className="cc-na">{t('wmsparts.common.notRecorded')}</span>
}
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
  const { t } = useLanguage()
  const q = useInvQuery(() => loadOemPartDetail(reference), [reference?.id])
  const onDate = (date) => (date ? ` ${t('wmsparts.detail.onDate', { date: fmtDate(date) })}` : '')
  const d = q.data && q.data.status !== 'not_provisioned' ? q.data : null

  return (
    <SectionCard
      title={t('wmsparts.detail.title', { part: reference?.oem_part_no || '' })}
      sub={reference?.manufacturer ? t('wmsparts.detail.manufacturer', { name: reference.manufacturer }) : t('wmsparts.detail.noManufacturer')}
      action={onClose && (
        <button type="button" className="cc-btn-ghost" onClick={onClose} aria-label={t('wmsparts.detail.closeAria')}>
          <X size={14} aria-hidden="true" /> {t('wmsparts.common.close')}
        </button>
      )}>
      {q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
        : q.data?.status === 'not_provisioned' ? <NotSetUp what={t('wmsparts.detail.what')} />
          : q.loading && !d ? <div className="cc-skel" style={{ height: 220 }} aria-busy="true" />
            : d && (
              <div className="oem-dt">
                <dl className="oem-dt-grid">
                  <Row label={t('wmsparts.detail.catalogue')}>
                    {d.canonical ? `${d.canonical.company_sku} ${d.canonical.description || ''}`.trim() : <span className="cc-na">{t('wmsparts.detail.notLinked')}</span>}
                  </Row>
                  <Row label={t('wmsparts.detail.brand')}>{d.canonical?.brand || null}</Row>
                  <Row label={t('wmsparts.detail.oemNumbers')}>
                    {d.oemNumbers.length ? d.oemNumbers.map((o) => (
                      <span key={o.id} style={{ display: 'block' }}>
                        {o.partNo}{o.manufacturer ? ` (${o.manufacturer})` : ''}{' '}
                        <StatusPill value={o.status} tone={o.status === 'approved' ? 'good' : 'warn'} label={o.status === 'approved' ? t('wmsparts.common.approved') : t('wmsparts.common.awaitingApproval')} />
                      </span>
                    )) : null}
                  </Row>
                  <Row label={t('wmsparts.detail.erpCodes')}>
                    {d.erpCodes.length ? d.erpCodes.map((e) => (
                      <span key={e.id} style={{ display: 'block' }}>{e.country || t('wmsparts.common.noCountry')}: <strong dir="ltr">{e.code}</strong> {e.name || ''}</span>
                    )) : null}
                  </Row>
                  <Row label={t('wmsparts.common.onHand')}>{t('wmsparts.detail.onHandValue', { onHand: formatQty(d.totals.onHand), reserved: formatQty(d.totals.reserved) })}</Row>
                  <Row label={t('wmsparts.detail.onOpenPo')}>{d.openPo.length ? formatQty(d.openPoQty) : t('wmsparts.detail.noneOpen')}</Row>
                  <Row label={t('wmsparts.detail.suppliers')}>{d.suppliers.length ? d.suppliers.join(', ') : null}</Row>
                  <Row label={t('wmsparts.detail.lastPoPrice')}>
                    {d.lastPoPrice ? `${money(d.lastPoPrice)}${onDate(d.lastPoPrice.date)}` : null}
                  </Row>
                  <Row label={t('wmsparts.detail.lastIssue')}>
                    {d.lastIssue ? `${money(d.lastIssue)}${onDate(d.lastIssue.date)}` : null}
                  </Row>
                  <Row label={t('wmsparts.detail.leadTime')}>{d.leadTime ? t('wmsparts.detail.leadTimeValue', { days: d.leadTime.days, orders: d.leadTime.orders }) : null}</Row>
                </dl>

                <h3 className="oem-dt-h">{t('wmsparts.detail.models')}</h3>
                {!d.fitment ? <p className="cc-card-sub">{t('wmsparts.detail.noManualRow')}</p>
                  : !d.fitment.manuals.length ? <p className="cc-card-sub">{t('wmsparts.detail.noManual')}</p>
                    : (
                      <ul className="oem-dt-list">
                        {d.fitment.manuals.map((f) => (
                          <li key={f.manual.id}>
                            {fitmentSentence(f)}
                            {f.makeAssets > 0 && f.modelRecorded === 0 ? ` ${t('wmsparts.detail.noModelRecorded')}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                {d.fitment?.truncated && <Note tone="warn">{t('wmsparts.detail.fleetTruncated')}</Note>}

                <h3 className="oem-dt-h">{t('wmsparts.detail.alternatives')}</h3>
                {!d.alternatives.length ? <p className="cc-card-sub">{t('wmsparts.detail.noneRecorded')}</p> : (
                  <ul className="oem-dt-list">
                    {d.alternatives.map((a) => (
                      <li key={a.id}>
                        {a.type === 'superseded' ? t('wmsparts.detail.supersededPrefix') : t('wmsparts.detail.alternativePrefix')}{' '}<strong dir="ltr">{a.value}</strong>{' '}
                        <StatusPill value={a.verified ? 'v' : 'u'} tone={a.verified ? 'good' : 'warn'} label={a.verified ? t('wmsparts.detail.verified') : t('wmsparts.detail.notVerified')} />
                      </li>
                    ))}
                  </ul>
                )}

                <h3 className="oem-dt-h">{t('wmsparts.detail.stockByLocation')}</h3>
                <div className="inv-scroll">
                  <KitTable compact rows={d.stock} empty={t('wmsparts.detail.noStock')} columns={[
                    { key: 'country', header: t('wmsparts.common.country'), cell: (s) => s.country || <NR /> },
                    { key: 'site', header: t('wmsparts.common.site'), cell: (s) => s.site || <NR /> },
                    { key: 'location', header: t('wmsparts.common.location'), cell: (s) => s.location || <span className="cc-na">{t('wmsparts.detail.noBin')}</span> },
                    { key: 'onHand', header: t('wmsparts.common.onHand'), numeric: true, cell: (s) => formatQty(s.onHand) },
                    { key: 'reserved', header: t('wmsparts.detail.reserved'), numeric: true, cell: (s) => formatQty(s.reserved) },
                  ]} />
                </div>

                {d.openPo.length > 0 && (
                  <>
                    <h3 className="oem-dt-h">{t('wmsparts.detail.openPo')}</h3>
                    <div className="inv-scroll">
                      <KitTable compact rows={d.openPo} columns={[
                        { key: 'poNumber', header: t('wmsparts.detail.po'), cell: (p) => p.poNumber || <NR /> },
                        { key: 'supplier', header: t('wmsparts.detail.supplier'), cell: (p) => p.supplier || <NR /> },
                        { key: 'open', header: t('wmsparts.detail.stillToReceive'), numeric: true, cell: (p) => formatQty(p.open) },
                        { key: 'expected', header: t('wmsparts.detail.expected'), cell: (p) => (p.expected ? fmtDate(p.expected) : <NR />) },
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
        .oem-dt-list { margin: 0; padding-inline-start: 18px; display: grid; gap: 4px; }
      `}</style>
    </SectionCard>
  )
}
