import { useState, useEffect, useCallback } from 'react'
import {
  Link2, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, Wrench, Truck,
} from 'lucide-react'
import * as imports from '../../lib/api/imports'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'

const TABLE_KEYS = ['tyre_records', 'work_orders', 'inspections', 'corrective_actions', 'accidents']

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
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [audit, setAudit] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [repairing, setRepairing] = useState(false)
  const [repairMsg, setRepairMsg] = useState('')

  const load = useCallback(async () => {
    setError('')
    try { setAudit(await imports.linkAudit()) }
    catch (e) { setError(toUserMessage(e, t('intake.panels.dataLink.errorLoad'))); setAudit({}) }
  }, [t])
  useEffect(() => { load() }, [load])

  async function repair() {
    if (!window.confirm(t('intake.panels.dataLink.repairConfirm', { count: audit?.missing_assets_count ?? '' }))) return
    setRepairing(true); setRepairMsg(''); setError('')
    try {
      const res = await imports.linkCreateMissingAssets()
      setRepairMsg(t('intake.panels.dataLink.repairSuccess', { count: res?.created ?? 0 }))
      await load()
    } catch (e) {
      setError(toUserMessage(e, t('intake.panels.dataLink.errorRepair')))
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
        <span className="text-sm font-semibold text-[var(--text-primary)]">{t('intake.panels.dataLink.header')}</span>
        {audit == null ? (
          <span className="text-xs text-[var(--text-muted)]">…</span>
        ) : healthy ? (
          <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={13} /> {t('intake.panels.dataLink.allLinked')}</span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-amber-400"><AlertCircle size={13} /> {t('intake.panels.dataLink.unlinkedCount', { count: totalOrphans.toLocaleString('en-US') })}</span>
        )}
        <span className="ml-auto" />
        <RefreshCw
          size={14}
          className="text-gray-500 hover:text-gray-300"
          onClick={(e) => { e.stopPropagation(); setAudit(null); load() }}
          title={t('intake.panels.dataLink.refresh')}
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
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> {t('intake.panels.dataLink.checking')}</div>
          )}

          {audit != null && (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                {t('intake.panels.dataLink.intro', { count: Number(audit.fleet_assets ?? 0).toLocaleString('en-US') })}
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--text-muted)] text-left">
                      <th className="py-1.5 pr-4 font-medium">{t('intake.panels.dataLink.table')}</th>
                      <th className="py-1.5 pr-4 font-medium text-right">{t('intake.panels.dataLink.rows')}</th>
                      <th className="py-1.5 pr-4 font-medium text-right">{t('intake.panels.dataLink.linked')}</th>
                      <th className="py-1.5 pr-4 font-medium text-right">{t('intake.panels.dataLink.unlinked')}</th>
                      <th className="py-1.5 font-medium text-right">{t('intake.panels.dataLink.noAsset')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TABLE_KEYS.map((key) => {
                      const row = tables[key] ?? { total: 0, orphans: 0, blank_asset: 0 }
                      const linked = Math.max(0, (row.total ?? 0) - (row.orphans ?? 0) - (row.blank_asset ?? 0))
                      return (
                        <tr key={key} className="border-t border-gray-800/60">
                          <td className="py-1.5 pr-4 text-[var(--text-secondary)]">{t(`intake.panels.dataLink.tables.${key}`)}</td>
                          <td className="py-1.5 pr-4 text-right text-[var(--text-primary)]">{Number(row.total ?? 0).toLocaleString('en-US')}</td>
                          <td className="py-1.5 pr-4 text-right text-green-400">{linked.toLocaleString('en-US')}</td>
                          <td className={`py-1.5 pr-4 text-right ${row.orphans ? 'text-amber-400 font-semibold' : 'text-[var(--text-muted)]'}`}>{Number(row.orphans ?? 0).toLocaleString('en-US')}</td>
                          <td className="py-1.5 text-right text-[var(--text-muted)]">{Number(row.blank_asset ?? 0).toLocaleString('en-US')}</td>
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
                    {t('intake.panels.dataLink.missingAssets', { count: Number(audit.missing_assets_count).toLocaleString('en-US') })}
                  </p>
                  {(audit.missing_assets_top ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {audit.missing_assets_top.slice(0, 12).map((m) => (
                        <span key={m.asset_no} className="text-[11px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300">
                          {m.asset_no} <span className="text-gray-500">×{m.records}</span>
                        </span>
                      ))}
                      {audit.missing_assets_top.length > 12 && (
                        <span className="text-[11px] text-gray-500">{t('intake.panels.dataLink.moreAssets', { count: audit.missing_assets_top.length - 12 })}</span>
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
                      {t('intake.panels.dataLink.repairButton')}
                    </button>
                  ) : (
                    <p className="text-xs text-gray-400">{t('intake.panels.dataLink.askAdmin')}</p>
                  )}
                  <p className="text-[11px] text-gray-500">
                    {t('intake.panels.dataLink.repairNote')}
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
