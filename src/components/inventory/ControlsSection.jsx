/**
 * Controls: what the current user may do (inventory capabilities), opening
 * balance batches, and the master-data review queue (duplicate-looking items
 * are reviewed, never auto-merged - owner correction 3).
 */
import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Tabs, KitTable } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { listMasterReviews } from '../../lib/api/inventory'
import { INVENTORY_CAPABILITIES } from '../../lib/inventory/hubSections'
import { useInvQuery, useHubTab, PagedTable, Note, StatusPill, SectionCard, fmtDateTime } from './InvUi'
import OpeningBalancePanel from './OpeningBalancePanel'
import ApprovalsPanel from './ApprovalsPanel'
import UnmatchedItemsPanel from './UnmatchedItemsPanel'
import StockReconcilePanel from './StockReconcilePanel'
import ErpLedgerPanel from './ErpLedgerPanel'

function Permissions({ can }) {
  const { t } = useLanguage()
  const rows = INVENTORY_CAPABILITIES.map((c) => ({ key: c, allowed: can(c) }))
  return (
    <SectionCard title={t('inventory.controls.permTitle')} sub={t('inventory.controls.permSub')}>
      <KitTable compact rows={rows} columns={[
        { key: 'key', header: t('inventory.controls.capability'), cell: (r) => t(`inventory.caps.${r.key}`) },
        { key: 'allowed', header: t('inventory.controls.you'), cell: (r) => (r.allowed
          ? <span className="cc-pill good"><Check size={12} aria-hidden="true" /> {t('inventory.controls.allowed')}</span>
          : <span className="cc-pill muted"><X size={12} aria-hidden="true" /> {t('inventory.controls.notAllowed')}</span>) },
      ]} />
      <Note>{t('inventory.controls.serverNote')}</Note>
    </SectionCard>
  )
}

function MasterReviews() {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('pending')
  const q = useInvQuery(() => listMasterReviews({ page, pageSize, status }), [page, pageSize, status])
  return (
    <div className="inv-hub">
      <Note>{t('inventory.controls.noAutoMerge')}</Note>
      <label className="cc-field" style={{ maxWidth: 220 }}>
        <span>{t('inventory.common.status')}</span>
        <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          {['pending', 'approved', 'rejected', 'all'].map((s) => <option key={s} value={s}>{t(`inventory.controls.review.${s}`)}</option>)}
        </select>
      </label>
      <PagedTable query={q} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
        empty={t('inventory.controls.reviewsEmpty')} what={t('inventory.objects.material_master_reviews')} noun={t('inventory.controls.reviewNoun')}
        columns={[
          { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || <span className="cc-na">{t('wmsfloor.common.na')}</span> },
          { key: 'proposed_change', header: t('inventory.controls.change'), cell: (r) => (typeof r.proposed_change === 'object' ? JSON.stringify(r.proposed_change) : r.proposed_change || t('wmsfloor.common.na')) },
          { key: 'reason', header: t('inventory.movements.reason'), cell: (r) => r.reason || <span className="cc-na">{t('wmsfloor.common.na')}</span> },
          { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'muted' : 'warning'} /> },
          { key: 'created_at', header: t('inventory.common.created'), cell: (r) => fmtDateTime(r.created_at) },
        ]} />
    </div>
  )
}

const CONTROL_TABS = ['approvals', 'permissions', 'opening', 'erp_ledger', 'master', 'unmatched', 'reconcile']

export default function ControlsSection(props) {
  const { t } = useLanguage()
  const [tab, setTab] = useHubTab(props.tab, props.onTab, CONTROL_TABS, 'approvals')
  return (
    <div className="inv-hub">
      <Tabs label={t('inventory.sections.controls')} value={tab} onChange={setTab} tabs={[
        { key: 'approvals', label: t('inventory.controls.tabs.approvals') },
        { key: 'permissions', label: t('inventory.controls.tabs.permissions') },
        { key: 'opening', label: t('inventory.controls.tabs.opening') },
        { key: 'erp_ledger', label: t('wmsfloor.controls.erpLedger') },
        { key: 'master', label: t('inventory.controls.tabs.master') },
        { key: 'unmatched', label: t('wmsfloor.controls.unmatched') },
        { key: 'reconcile', label: t('wmsfloor.controls.reconcile') },
      ]} />
      {tab === 'approvals' && <ApprovalsPanel {...props} />}
      {tab === 'permissions' && <Permissions can={props.can} />}
      {tab === 'opening' && <OpeningBalancePanel {...props} />}
      {tab === 'erp_ledger' && <ErpLedgerPanel {...props} />}
      {tab === 'master' && <MasterReviews />}
      {tab === 'unmatched' && <UnmatchedItemsPanel {...props} />}
      {tab === 'reconcile' && <StockReconcilePanel {...props} />}
    </div>
  )
}
