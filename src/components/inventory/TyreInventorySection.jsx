/**
 * Tyre inventory: one custody state per physical tyre (`tyre_items`, derived
 * read-only from tyre_records) and the custody conflicts, including the seven
 * tyres that are scrapped yet still active. Conflicts are shown with their
 * evidence for an authorised decision; they are never corrected from here.
 * Holding time in stock is not tyre running life, so no km or life is shown.
 */
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import { listTyreItems, countTyreItemsByState, listCustodyConflicts } from '../../lib/api/inventory'
import { summarizeCustody, conflictEvidence, CUSTODY_TONE } from '../../lib/inventory/tyreInventoryView'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, PagedTable, SearchBox, Note, ErrorNote, StatusPill, SectionCard, fmtDateTime } from './InvUi'

export default function TyreInventorySection({ scope, can }) {
  const { t } = useLanguage()
  const [state, setState] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [cPage, setCPage] = useState(0)
  const [conflict, setConflict] = useState(null)
  const showValue = can('view_value')

  const counts = useInvQuery(() => countTyreItemsByState(scope), [scope.country, scope.site])
  const items = useInvQuery(() => listTyreItems({ ...scope, page, pageSize, state, search }), [scope.country, scope.site, page, pageSize, state, search])
  const conflicts = useInvQuery(() => listCustodyConflicts({ page: cPage, pageSize: 25, status: 'open' }), [cPage])
  const sum = summarizeCustody(counts.data || {})
  const notInstalled = counts.data && Object.values(counts.data).every((v) => v === null)

  return (
    <div className="inv-hub">
      <Note>{t('inventory.tyres.rule')}</Note>
      {counts.error && <ErrorNote error={counts.error} onRetry={counts.retry} />}

      <SectionCard title={t('inventory.tyres.conflictsTitle')} sub={t('inventory.tyres.conflictsSub')}>
        <PagedTable query={conflicts} page={cPage} pageSize={25} onPage={setCPage}
          empty={t('inventory.tyres.conflictsEmpty')} what={t('inventory.objects.tyre_custody_conflicts')} noun={t('inventory.tyres.conflictNoun')}
          onRowClick={setConflict}
          columns={[
            { key: 'serial_no', header: t('inventory.common.serial'), cell: (r) => <span className="inv-mono">{r.serial_no || 'N/A'}</span> },
            { key: 'conflict_type', header: t('inventory.tyres.conflict'), cell: (r) => (r.conflict_type || 'N/A').replace(/_/g, ' ') },
            { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status || 'open'} tone="bad" /> },
            { key: 'detected_at', header: t('inventory.tyres.detected'), cell: (r) => fmtDateTime(r.detected_at || r.created_at) },
          ]} />
      </SectionCard>

      <SectionCard title={t('inventory.tyres.custodyTitle')}
        sub={sum.total === null ? t('inventory.tyres.custodyNone') : t('inventory.tyres.custodySub', { total: formatQty(sum.total), stock: formatQty(sum.inStock) })}>
        {!notInstalled && (
          <div className="inv-tiles" role="group" aria-label={t('inventory.tyres.filterByState')}>
            <button type="button" className="inv-tile" aria-pressed={state === 'all'} onClick={() => { setState('all'); setPage(0) }}>
              <b>{formatQty(sum.total)}</b><span>{t('inventory.common.all')}</span>
            </button>
            {sum.tiles.map((tile) => (
              <button key={tile.state} type="button" className="inv-tile" aria-pressed={state === tile.state}
                onClick={() => { setState(tile.state); setPage(0) }}>
                <b>{formatQty(tile.count)}</b><span>{t(`inventory.custody.${tile.state}`)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="cc-filters" style={{ margin: '12px 0' }}>
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }} placeholder={t('inventory.tyres.search')} />
          <Link className="cc-btn-ghost" to="/serial-tracker"><ExternalLink size={14} aria-hidden="true" /> {t('inventory.tyres.serialTracker')}</Link>
        </div>
        <PagedTable query={items} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
          empty={t('inventory.tyres.empty')} what={t('inventory.objects.tyre_items')} noun={t('inventory.tyres.noun')}
          columns={[
            { key: 'serial_no', header: t('inventory.common.serial'), cell: (r) => <span className="inv-mono">{r.serial_no}</span> },
            { key: 'custody_state', header: t('inventory.tyres.state'), cell: (r) => <StatusPill value={r.custody_state} tone={CUSTODY_TONE[r.custody_state]} label={t(`inventory.custody.${r.custody_state}`)} /> },
            { key: 'brand', header: t('inventory.tyres.brandSize'), cell: (r) => [r.brand, r.size].filter(Boolean).join(' ') || <span className="cc-na">N/A</span> },
            { key: 'where', header: t('inventory.tyres.where'), cell: (r) => (r.asset_no ? `${r.asset_no}${r.position ? ` ${r.position}` : ''}` : r.location_code || r.site || <span className="cc-na">N/A</span>) },
            ...(showValue ? [{ key: 'purchase_cost', header: t('inventory.tyres.purchaseCost'), numeric: true, cell: (r) => formatMoney(r.purchase_cost, r.currency) }] : []),
          ]} />
      </SectionCard>

      <SideDrawer className="cc inv-panel" open={!!conflict} onClose={() => setConflict(null)} size="md" title={t('inventory.tyres.evidenceTitle')}
        subtitle={conflict?.serial_no} closeLabel={t('inventory.actions.close')}>
        {conflict && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <Note tone="warn">{t('inventory.tyres.noAutoFix')}</Note>
            {conflictEvidence(conflict).length ? (
              <dl className="inv-dl">
                {conflictEvidence(conflict).map((e, i) => (<Fragment key={i}><dt>{e.label}</dt><dd>{e.value || 'N/A'}</dd></Fragment>))}
              </dl>
            ) : <div className="cc-empty">{t('inventory.tyres.noEvidence')}</div>}
            <Link className="cc-btn-ghost" to={`/tyre-passport/${encodeURIComponent(conflict.serial_no || '')}`}>
              <ExternalLink size={14} aria-hidden="true" /> {t('inventory.tyres.passport')}
            </Link>
          </div>
        )}
      </SideDrawer>
    </div>
  )
}
