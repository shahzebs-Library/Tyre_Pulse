/**
 * Reviewer reconciliation: expected (snapshot at the cutoff) versus counted,
 * with quantity variance and value impact per currency. The comparison here is
 * for reading; "Run reconciliation" asks the server (inv_audit_reconcile) to
 * compute the official variances and raise discrepancy records. Lines outside
 * tolerance can be sent to a recount by a DIFFERENT person.
 */
import { useMemo, useState } from 'react'
import { Calculator, RotateCcw, Scale, Target, RotateCw, HelpCircle } from 'lucide-react'
import { KitTable, Kpi } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { loadReconciliation, reconcileAudit, assignRecount, newIdempotencyKey } from '../../lib/api/inventory'
import { buildReconciliationRows, summarizeReconciliation, needsRecount } from '../../lib/inventory/auditView'
import { formatMoney, formatQty, formatTotals } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { useInvQuery, ErrorNote, NotSetUp, Note, StatusPill, Field, alignNumeric, ExplainedKpi } from './InvUi'
import { RequestApprovalButton, ApprovalState } from './ApprovalsPanel'

const STATUS_TONE = { match: 'good', over: 'warning', short: 'bad', not_counted: 'muted', unexpected: 'warning' }

export default function AuditReconciliation({ audit, can, userId, people = [], onChanged }) {
  const { t } = useLanguage()
  const q = useInvQuery(() => loadReconciliation(audit.id), [audit.id])
  const [filter, setFilter] = useState('exceptions')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [recounter, setRecounter] = useState('')
  const [stateKey, setStateKey] = useState(0)
  const [keys] = useState(() => ({ reconcile: newIdempotencyKey(), recount: newIdempotencyKey() }))
  const showValue = can('view_value')

  const rows = useMemo(() => buildReconciliationRows(q.data?.snapshot, q.data?.counts), [q.data])
  const sum = useMemo(() => summarizeReconciliation(rows), [rows])
  const visible = filter === 'all' ? rows : rows.filter((r) => r.status !== 'match')
  const recountRows = rows.filter((r) => needsRecount(r))
  // Mirrors inv_recount_assign: not the counter, an earlier recounter, the audit's
  // approver, or yourself (the approver was offered and then refused server-side).
  const eligible = people.filter((p) => ![audit.counter_id, audit.recount_counter_id, audit.approver_id, userId].includes(p.id))

  const run = async (fn) => {
    setBusy(true); setErr('')
    try { await fn(); onChanged?.() } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.objects.inventory_audits')} />

  const columns = [
    { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || r.serial_no || <span className="cc-na">{t('wmsfloor.common.na')}</span> },
    { key: 'location_code', header: t('inventory.common.location'), cell: (r) => r.location_code || <span className="cc-na">{t('wmsfloor.common.na')}</span> },
    { key: 'expected_qty', header: t('inventory.recon.expected'), numeric: true, cell: (r) => formatQty(r.expected_qty) },
    { key: 'counted_qty', header: t('inventory.recon.counted'), numeric: true, cell: (r) => formatQty(r.counted_qty) },
    { key: 'variance', header: t('inventory.recon.variance'), numeric: true, cell: (r) => (r.variance === null ? <span className="cc-na">{t('wmsfloor.common.na')}</span> : `${r.variance > 0 ? '+' : ''}${formatQty(r.variance)}`) },
    ...(showValue ? [{ key: 'value_impact', header: t('inventory.recon.valueImpact'), numeric: true, cell: (r) => formatMoney(r.value_impact, r.currency) }] : []),
    { key: 'round', header: t('inventory.recon.round'), numeric: true, cell: (r) => r.round ?? <span className="cc-na">{t('wmsfloor.common.na')}</span> },
    { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone={STATUS_TONE[r.status]} label={t(`inventory.recon.status.${r.status}`)} /> },
    { key: 'recount', header: t('inventory.recon.recount'), cell: (r) => (needsRecount(r) ? <StatusPill value="yes" tone="warning" label={t('inventory.recon.recountNeeded')} /> : null) },
  ]

  return (
    <div className="inv-hub" style={{ gap: 12 }}>
      <div className="inv-kpis">
        <ExplainedKpi metricId="inv_accuracy_exact_line" country={audit.country} icon={Target} tone="t-green" display={sum.accuracyPct === null ? t('wmsfloor.common.na') : `${sum.accuracyPct}%`} label={t('inventory.recon.accuracy')} />
        <Kpi icon={RotateCw} tone="t-amber" value={sum.recount} label={t('inventory.recon.recountLines')} />
        <Kpi icon={HelpCircle} tone="t-blue" value={sum.byStatus.not_counted} label={t('inventory.recon.status.not_counted')} />
        {showValue && <Kpi icon={Scale} tone="t-red" display={formatTotals(sum.net.totals)} label={t('inventory.recon.netValue')} />}
        {showValue && <Kpi icon={Scale} tone="t-purple" display={formatTotals(sum.abs.totals)} label={t('inventory.recon.absValue')} />}
      </div>
      {showValue && <p className="cc-card-sub">{t('inventory.recon.netAbsHint')}</p>}
      {q.data?.truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}
      <div className="cc-filters">
        <label className="cc-field">
          <span>{t('inventory.recon.show')}</span>
          <select className="cc-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="exceptions">{t('inventory.recon.exceptions')}</option>
            <option value="all">{t('inventory.common.all')}</option>
          </select>
        </label>
        <div className="inv-actions">
          <button type="button" className="cc-btn-primary" disabled={busy || !rows.length}
            onClick={() => run(() => reconcileAudit(audit.id, keys.reconcile))}>
            <Calculator size={14} aria-hidden="true" /> {t('inventory.recon.run')}
          </button>
        </div>
      </div>
      <KitTable compact columns={alignNumeric(columns)} rows={visible} loading={q.loading && !q.data}
        empty={rows.length ? t('inventory.recon.noExceptions') : t('inventory.recon.noLines')} />

      {can('recount') && recountRows.length > 0 && (
        <div className="inv-note warn">
          <RotateCcw size={16} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>{t('inventory.recon.recountTitle', { n: recountRows.length })}</strong>
            <p className="cc-card-sub">{t('inventory.recon.recountBody')}</p>
            <div className="cc-filters">
              <Field label={t('inventory.recon.recounter')}>
                <select className="cc-select" value={recounter} onChange={(e) => setRecounter(e.target.value)}>
                  <option value="">{t('inventory.common.choose')}</option>
                  {eligible.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
                </select>
              </Field>
              <button type="button" className="cc-btn-ghost" disabled={busy || !recounter}
                onClick={() => run(() => assignRecount({ auditId: audit.id, recounterId: recounter, lineKeys: recountRows.map((r) => r.key) }, keys.recount))}>
                {t('inventory.recon.assign')}
              </button>
            </div>
            <p className="cc-card-sub">{t('inventory.disc.recountSteps')}</p>
            <ApprovalState entityType="recount_assignment" entityId={audit.id} refreshKey={stateKey} />
            <RequestApprovalButton entityType="recount_assignment" entityId={audit.id}
              proposal={recounter ? { counter_id: recounter } : null} disabled={!recounter}
              label={t('inventory.disc.requestRecount')} onDone={() => setStateKey((k) => k + 1)} />
          </div>
        </div>
      )}
      {err && <ErrorNote error={err} />}
    </div>
  )
}
