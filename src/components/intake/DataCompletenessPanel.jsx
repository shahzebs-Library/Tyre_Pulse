import { useState, useEffect, useCallback } from 'react'
import { Gauge, ChevronDown, ChevronRight, RefreshCw, Loader2, AlertCircle } from 'lucide-react'
import * as imports from '../../lib/api/imports'
import { useLanguage } from '../../contexts/LanguageContext'

/**
 * Data Completeness — per-field fill scorecard for the Data Intake Center.
 * Makes it obvious which analytics pages are starving (e.g. brand/site/km at 0%)
 * and which upload would fix them, so gaps stay visible until solved.
 */
const TYRE_FIELD_KEYS = ['cost', 'brand', 'site', 'position', 'km', 'serial', 'removal', 'removal_reason']
const FLEET_FIELD_KEYS = ['vehicle_type', 'make', 'site', 'km', 'budget']

function Bar({ pct }) {
  const color = pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="w-full bg-gray-800 rounded h-1.5">
      <div className={`${color} h-1.5 rounded`} style={{ width: `${Math.max(pct, 2)}%` }} />
    </div>
  )
}

function FieldRows({ fieldKeys, labelNs, stats }) {
  const { t } = useLanguage()
  const total = stats?.total ?? 0
  return fieldKeys.map((key) => {
    const n = stats?.[key] ?? 0
    const pct = total ? Math.round((n / total) * 100) : 0
    return (
      <div key={key} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 py-1">
        <span className="text-xs text-[var(--text-secondary)] truncate" title={t(`intake.panels.completeness.${labelNs}.${key}`)}>{t(`intake.panels.completeness.${labelNs}.${key}`)}</span>
        <Bar pct={pct} />
        <span className={`text-xs text-right font-semibold ${pct >= 80 ? 'text-green-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{pct}%</span>
      </div>
    )
  })
}

export default function DataCompletenessPanel() {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try { setStats(await imports.dataCompleteness()) }
    catch (e) { setError(e?.message || t('intake.panels.completeness.errorLoad')); setStats({}) }
  }, [t])
  useEffect(() => { load() }, [load])

  const tyre = stats?.tyres
  const fleet = stats?.fleet
  const worst = tyre?.total
    ? TYRE_FIELD_KEYS.filter((k) => ((tyre[k] ?? 0) / tyre.total) < 0.4).length
    : 0

  return (
    <div className="card p-0 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-800/40 transition-colors">
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <Gauge size={16} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">{t('intake.panels.completeness.header')}</span>
        {stats == null ? <span className="text-xs text-[var(--text-muted)]">…</span>
          : worst > 0
            ? <span className="text-xs text-amber-400">{t('intake.panels.completeness.underCount', { count: worst })}</span>
            : <span className="text-xs text-green-400">{t('intake.panels.completeness.healthy')}</span>}
        <span className="ml-auto" />
        <RefreshCw size={14} className="text-gray-500 hover:text-gray-300"
          onClick={(e) => { e.stopPropagation(); setStats(null); load() }} title={t('intake.panels.completeness.refresh')} />
      </button>

      {open && (
        <div className="border-t border-[var(--card-border)] p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">
              <AlertCircle size={15} /> {error}
            </div>
          )}
          {stats == null ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> {t('intake.panels.completeness.scanning')}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">
                  {t('intake.panels.completeness.tyreRecords', { count: Number(tyre?.total ?? 0).toLocaleString('en-US') })}
                </p>
                <FieldRows fieldKeys={TYRE_FIELD_KEYS} labelNs="tyreFields" stats={tyre} />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">
                  {t('intake.panels.completeness.fleet', { count: Number(fleet?.total ?? 0).toLocaleString('en-US') })}
                </p>
                <FieldRows fieldKeys={FLEET_FIELD_KEYS} labelNs="fleetFields" stats={fleet} />
              </div>
              <p className="md:col-span-2 text-[11px] text-gray-500">
                {t('intake.panels.completeness.footer')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
