import { useState, useEffect, useCallback } from 'react'
import {
  Link2, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, Wrench, Truck,
} from 'lucide-react'
import * as imports from '../../lib/api/imports'

const TABLE_LABELS = {
  tyre_records: 'Tyre Records',
  work_orders: 'Work Orders',
  inspections: 'Inspections',
  corrective_actions: 'Corrective Actions',
  accidents: 'Accidents',
}

/**
 * Data Links — cross-table linkage health for the Data Intake Center. The whole
 * app joins business tables to vehicles by asset_no; this panel shows, per table,
 * how many rows actually link to a real vehicle vs are orphaned (no matching
 * vehicle) vs have no asset at all, and offers a one-click admin repair that
 * creates skeleton vehicles for every orphan asset found in tyre data.
 *
 * @param {{ isElevated?: boolean }} props
 */
export default function DataLinkPanel({ isElevated = false }) {
  const [open, setOpen] = useState(false)
  const [audit, setAudit] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [repairing, setRepairing] = useState(false)
  const [repairMsg, setRepairMsg] = useState('')

  const load = useCallback(async () => {
    setError('')
    try { setAudit(await imports.linkAudit()) }
    catch (e) { setError(e?.message || 'Could not load link health.'); setAudit({}) }
  }, [])
  useEffect(() => { load() }, [load])

  async function repair() {
    if (!window.confirm(
      `Create ${audit?.missing_assets_count ?? 'the'} missing vehicle record(s) from your tyre data?\n\n` +
      'Each orphan Asset No becomes a skeleton vehicle (country + site copied from its tyres) so every ' +
      'tyre/work-order/inspection links to a real vehicle. You can complete the details later in Fleet Master.',
    )) return
    setRepairing(true); setRepairMsg(''); setError('')
    try {
      const res = await imports.linkCreateMissingAssets()
      setRepairMsg(`Created ${res?.created ?? 0} vehicle record(s). All linked records now resolve.`)
      await load()
    } catch (e) {
      setError(e?.message || 'Repair failed.')
    } finally { setRepairing(false) }
  }

  const tables = audit?.tables ?? {}
  const totalOrphans = Object.values(tables).reduce((s, t) => s + (t?.orphans ?? 0), 0)
  const healthy = audit != null && totalOrphans === 0

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/40 transition-colors"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <Link2 size={16} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Data links</span>
        {audit == null ? (
          <span className="text-xs text-[var(--text-muted)]">…</span>
        ) : healthy ? (
          <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={13} /> all linked</span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-400"><AlertCircle size={13} /> {totalOrphans.toLocaleString('en-US')} unlinked record(s)</span>
        )}
        <span className="ml-auto" />
        <RefreshCw
          size={14}
          className="text-gray-500 hover:text-gray-300"
          onClick={(e) => { e.stopPropagation(); setAudit(null); load() }}
          title="Refresh"
        />
      </button>

      {open && (
        <div className="border-t border-[var(--card-border)] p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">
              <AlertCircle size={15} /> {error}
            </div>
          )}
          {repairMsg && (
            <div className="flex items-center gap-2 text-sm text-green-300 bg-green-900/20 border border-green-700 rounded-lg px-3 py-2">
              <CheckCircle2 size={15} /> {repairMsg}
            </div>
          )}

          {audit == null && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Checking cross-table links…</div>
          )}

          {audit != null && (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                Every module links to a vehicle by <span className="text-[var(--text-secondary)] font-medium">Asset No</span>.
                Fleet has <span className="text-[var(--text-primary)] font-semibold">{Number(audit.fleet_assets ?? 0).toLocaleString('en-US')}</span> vehicle(s).
                An <span className="text-amber-300">unlinked</span> row references an asset that doesn't exist in the fleet yet.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--text-muted)] text-left">
                      <th className="py-1.5 pr-4 font-medium">Table</th>
                      <th className="py-1.5 pr-4 font-medium text-right">Rows</th>
                      <th className="py-1.5 pr-4 font-medium text-right">Linked</th>
                      <th className="py-1.5 pr-4 font-medium text-right">Unlinked</th>
                      <th className="py-1.5 font-medium text-right">No asset</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(TABLE_LABELS).map(([key, label]) => {
                      const t = tables[key] ?? { total: 0, orphans: 0, blank_asset: 0 }
                      const linked = Math.max(0, (t.total ?? 0) - (t.orphans ?? 0) - (t.blank_asset ?? 0))
                      return (
                        <tr key={key} className="border-t border-gray-800/60">
                          <td className="py-1.5 pr-4 text-[var(--text-secondary)]">{label}</td>
                          <td className="py-1.5 pr-4 text-right text-[var(--text-primary)]">{Number(t.total ?? 0).toLocaleString('en-US')}</td>
                          <td className="py-1.5 pr-4 text-right text-green-400">{linked.toLocaleString('en-US')}</td>
                          <td className={`py-1.5 pr-4 text-right ${t.orphans ? 'text-amber-400 font-semibold' : 'text-[var(--text-muted)]'}`}>{Number(t.orphans ?? 0).toLocaleString('en-US')}</td>
                          <td className="py-1.5 text-right text-[var(--text-muted)]">{Number(t.blank_asset ?? 0).toLocaleString('en-US')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {(audit.missing_assets_count ?? 0) > 0 && (
                <div className="bg-amber-900/15 border border-amber-700/40 rounded-xl p-4 space-y-3">
                  <p className="text-sm text-amber-300 flex items-center gap-2">
                    <Truck size={15} />
                    {Number(audit.missing_assets_count).toLocaleString('en-US')} asset(s) referenced by your data don't exist in Fleet Master yet.
                  </p>
                  {(audit.missing_assets_top ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {audit.missing_assets_top.slice(0, 12).map((m) => (
                        <span key={m.asset_no} className="text-[11px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300">
                          {m.asset_no} <span className="text-gray-500">×{m.records}</span>
                        </span>
                      ))}
                      {audit.missing_assets_top.length > 12 && (
                        <span className="text-[11px] text-gray-500">+{audit.missing_assets_top.length - 12} more…</span>
                      )}
                    </div>
                  )}
                  {isElevated ? (
                    <button
                      onClick={repair}
                      disabled={repairing}
                      className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {repairing ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
                      Create the missing vehicles from tyre data
                    </button>
                  ) : (
                    <p className="text-xs text-gray-400">Ask an administrator to run the linkage repair.</p>
                  )}
                  <p className="text-[11px] text-gray-500">
                    Creates one skeleton vehicle per missing Asset No (country &amp; site copied from its latest tyre record),
                    marked "Auto-created" — complete the details later in Fleet Master. Fully audited.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
