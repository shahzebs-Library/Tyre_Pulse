import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Link2, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, Wrench, Truck,
} from 'lucide-react'
import * as imports from '../../lib/api/imports'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import EnterpriseTable from '../ui/EnterpriseTable'
import { compareValues } from '../../lib/consoleTable'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

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
    catch (e) { setError(toUserMessage(e, t('intake.panels.dataLink.errorLoad'))); setAudit({ failed: true }) }
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

  const tables = useMemo(() => audit?.tables ?? {}, [audit])
  const totalOrphans = Object.values(tables).reduce((s, t) => s + (t?.orphans ?? 0), 0)
  // A failed audit is not a clean bill of health: never report "all linked" for it.
  const failed = audit?.failed === true
  const healthy = audit != null && !failed && totalOrphans === 0
  const fmt = (n) => Number(n ?? 0).toLocaleString('en-US')
  const linkRows = useMemo(() => TABLE_KEYS.map((key) => {
    const row = tables[key] ?? { total: 0, orphans: 0, blank_asset: 0 }
    return {
      key,
      label: t(`intake.panels.dataLink.tables.${key}`),
      total: Number(row.total ?? 0),
      linked: Math.max(0, (row.total ?? 0) - (row.orphans ?? 0) - (row.blank_asset ?? 0)),
      orphans: Number(row.orphans ?? 0),
      blank: Number(row.blank_asset ?? 0),
    }
  }), [tables, t])
  const linkColumns = useMemo(() => [
    { id: 'label', header: t('intake.panels.dataLink.table'), accessorKey: 'label', sortingFn: valueSort, cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue()}</span> },
    { id: 'total', header: t('intake.panels.dataLink.rows'), accessorKey: 'total', sortingFn: valueSort, meta: { align: 'right' }, cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{fmt(getValue())}</span> },
    { id: 'linked', header: t('intake.panels.dataLink.linked'), accessorKey: 'linked', sortingFn: valueSort, meta: { align: 'right' }, cell: ({ getValue }) => <span className="text-green-500">{fmt(getValue())}</span> },
    { id: 'orphans', header: t('intake.panels.dataLink.unlinked'), accessorKey: 'orphans', sortingFn: valueSort, meta: { align: 'right' }, cell: ({ getValue }) => <span className={getValue() ? 'text-amber-500 font-semibold' : 'text-[var(--text-muted)]'}>{fmt(getValue())}</span> },
    { id: 'blank', header: t('intake.panels.dataLink.noAsset'), accessorKey: 'blank', sortingFn: valueSort, meta: { align: 'right' }, cell: ({ getValue }) => <span className="text-[var(--text-muted)]">{fmt(getValue())}</span> },
  ], [t])

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center gap-1 pr-2 hover:bg-[var(--surface-2)] transition-colors">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 min-w-0 min-h-[44px] flex flex-wrap items-center gap-2 px-4 py-3 text-left"
        >
          {open ? <ChevronDown size={16} className="text-[var(--text-muted)]" aria-hidden="true" /> : <ChevronRight size={16} className="text-[var(--text-muted)]" aria-hidden="true" />}
          <Link2 size={16} className="text-[var(--accent)]" aria-hidden="true" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">{t('intake.panels.dataLink.header')}</span>
          {audit == null ? (
            <span className="text-xs text-[var(--text-muted)]">…</span>
          ) : failed ? (
            <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle size={13} aria-hidden="true" /> {t('intake.panels.dataLink.errorLoad')}</span>
          ) : healthy ? (
            <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle2 size={13} aria-hidden="true" /> {t('intake.panels.dataLink.allLinked')}</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-amber-500"><AlertCircle size={13} aria-hidden="true" /> {t('intake.panels.dataLink.unlinkedCount', { count: totalOrphans.toLocaleString('en-US') })}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => { setAudit(null); load() }}
          title={t('intake.panels.dataLink.refresh')}
          aria-label={t('intake.panels.dataLink.refresh')}
          className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--card-border)] p-4 space-y-4">
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
              <AlertCircle size={15} className="text-red-500" aria-hidden="true" /> <span className="flex-1">{error}</span>
              <button type="button" onClick={() => { setAudit(null); load() }} className="btn-secondary text-xs px-3 min-h-[44px]">Retry</button>
            </div>
          )}
          {repairMsg && (
            <div role="status" className="flex items-center gap-2 text-sm text-[var(--text-primary)] bg-green-500/10 border border-green-500/40 rounded-lg px-3 py-2">
              <CheckCircle2 size={15} className="text-green-500" aria-hidden="true" /> {repairMsg}
            </div>
          )}

          {audit == null && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> {t('intake.panels.dataLink.checking')}</div>
          )}

          {audit != null && !failed && (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                {t('intake.panels.dataLink.intro', { count: Number(audit.fleet_assets ?? 0).toLocaleString('en-US') })}
              </p>

              <EnterpriseTable
                columns={linkColumns}
                data={linkRows}
                getRowId={(r) => r.key}
                enableColumnVisibility={false}
                enableColumnFilters={false}
                initialPageSize={25}
                searchPlaceholder={t('intake.panels.dataLink.table')}
                exportFileName="Data Link Health"
                reportMeta={{ title: t('intake.panels.dataLink.header') }}
              />

              {(audit.missing_assets_count ?? 0) > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 space-y-3">
                  <p className="text-sm text-[var(--text-primary)] flex items-center gap-2">
                    <Truck size={15} className="text-amber-500" aria-hidden="true" />
                    {t('intake.panels.dataLink.missingAssets', { count: Number(audit.missing_assets_count).toLocaleString('en-US') })}
                  </p>
                  {(audit.missing_assets_top ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {audit.missing_assets_top.slice(0, 12).map((m) => (
                        <span key={m.asset_no} className="text-[11px] bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text-secondary)]">
                          {m.asset_no} <span className="text-[var(--text-muted)]">×{m.records}</span>
                        </span>
                      ))}
                      {audit.missing_assets_top.length > 12 && (
                        <span className="text-[11px] text-[var(--text-muted)]">{t('intake.panels.dataLink.moreAssets', { count: audit.missing_assets_top.length - 12 })}</span>
                      )}
                    </div>
                  )}
                  {isElevated ? (
                    <button
                      type="button"
                      onClick={repair}
                      disabled={repairing}
                      className="btn-primary text-xs min-h-[44px] px-3 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {repairing ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
                      {t('intake.panels.dataLink.repairButton')}
                    </button>
                  ) : (
                    <p className="text-xs text-[var(--text-secondary)]">{t('intake.panels.dataLink.askAdmin')}</p>
                  )}
                  <p className="text-[11px] text-[var(--text-muted)]">
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
