/**
 * Read-only health card for the Material Master links: duplicates and
 * cross-country links (should be 0), and how much is still unlinked. Counts come
 * from inv_material_link_health() (SECURITY INVOKER), so each user sees the
 * counts for the rows their scope can read. Nothing here writes.
 */
import { RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react'
import { loadLinkHealth } from '../../lib/api/materialLinks'
import { healthRows } from '../../lib/oem/materialLinks'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, StatusPill, fmtDateTime } from '../inventory/InvUi'

export default function MaterialLinkHealthCard() {
  const q = useInvQuery(() => loadLinkHealth(), [])
  const rows = healthRows(q.data?.health)
  const problems = rows.filter((r) => r.problem && Number(r.value) > 0)

  return (
    <SectionCard
      title="Link health"
      sub={q.data?.health?.generated_at ? `Checked ${fmtDateTime(q.data.health.generated_at)}. Read only.` : 'Read only.'}
      action={(
        <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      )}>
      {q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
        : q.data?.status === 'not_provisioned' ? <NotSetUp what="The link health check" />
          : q.loading && !q.data ? <div className="cc-skel" style={{ height: 160 }} aria-busy="true" />
            : (
              <>
                {problems.length
                  ? <Note tone="bad" icon={ShieldAlert} title="Link problems found">Each count below in red needs a correction request. Nothing is fixed automatically.</Note>
                  : <Note tone="good" icon={ShieldCheck}>No duplicate links and no links across countries.</Note>}
                <dl className="oem-health-list">
                  {rows.map((r) => (
                    <div key={r.key} className="oem-health-row">
                      <dt>{r.label}</dt>
                      <dd>
                        {r.value === null ? <span className="cc-na">Not recorded</span>
                          : r.problem
                            ? <StatusPill value={String(r.value)} tone={r.value > 0 ? 'bad' : 'good'} label={formatQty(r.value)} />
                            : formatQty(r.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <style>{`
                  .oem-health-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 18px; margin: 10px 0 0; }
                  .oem-health-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--cc-line, rgba(127,127,127,.2)); min-width: 0; }
                  .oem-health-row dt { font-size: 13px; overflow-wrap: anywhere; }
                  .oem-health-row dd { margin: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
                `}</style>
              </>
            )}
    </SectionCard>
  )
}
