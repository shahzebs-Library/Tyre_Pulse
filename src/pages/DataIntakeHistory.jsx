import { useState, useEffect, useCallback, Fragment } from 'react'
import { Link } from 'react-router-dom'
import {
  History, BarChart3, Layers, Tags, Loader2, AlertTriangle, RotateCcw, ChevronRight, ChevronDown, Database, CheckCircle2, Link2, Plus, Coins,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import * as imports from '../lib/api/imports'
import { reconcileBatch } from '../lib/import/reconcile'
import { formatDate } from '../lib/formatters'

const ELEVATED = ['admin', 'manager', 'director']
const TABS = [
  { key: 'imports', label: 'Imports', icon: History },
  { key: 'quality', label: 'Data Quality', icon: BarChart3 },
  { key: 'profiles', label: 'Mapping Profiles', icon: Layers },
  { key: 'custom', label: 'Custom Fields', icon: Tags },
  { key: 'aliases', label: 'Aliases', icon: Link2 },
  { key: 'fx', label: 'FX Rates', icon: Coins },
]
const ALIAS_ENTITY_TYPES = ['site', 'supplier', 'brand', 'driver', 'make', 'model']

function chip(s) {
  const ok = s === 'committed'
  return `text-xs px-2 py-0.5 rounded ${ok ? 'bg-green-900/30 text-green-400' : s === 'reversed' ? 'bg-red-900/30 text-red-400' : 'bg-gray-800 text-gray-400'}`
}

/** Inline reconciliation indicator derived from reconcileBatch(). */
function ReconcileBadge({ summary }) {
  const { t } = useLanguage()
  if (summary.indicator === 'pending') {
    return <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-500">-</span>
  }
  const balanced = summary.indicator === 'balanced'
  const cls = balanced ? 'bg-green-900/30 text-green-400' : 'bg-amber-900/30 text-amber-400'
  const Icon = balanced ? CheckCircle2 : AlertTriangle
  return (
    <span className={`text-xs px-2 py-0.5 rounded inline-flex items-center gap-1 ${cls}`} title={t('intakehistory.reconcile.importedOfExpected', { imported: summary.imported, expected: summary.expected })}>
      <Icon size={12} /> {balanced ? t('intakehistory.reconcile.balanced') : t('intakehistory.reconcile.review')}
    </span>
  )
}

export default function DataIntakeHistory() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const { t } = useLanguage()
  const isElevated = ELEVATED.includes(String(profile?.role || '').toLowerCase())

  const [tab, setTab] = useState('imports')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [batches, setBatches] = useState([])
  const [quality, setQuality] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [aliases, setAliases] = useState([])
  const [aliasForm, setAliasForm] = useState({ entityType: 'site', rawValue: '', canonicalValue: '' })
  const [savingAlias, setSavingAlias] = useState(false)
  const [fxRates, setFxRates] = useState([])
  const [fxForm, setFxForm] = useState({ baseCurrency: '', quoteCurrency: '', rate: '', rateDate: '', source: 'manual' })
  const [savingFx, setSavingFx] = useState(false)
  const [drill, setDrill] = useState(null) // { batch, rows }
  const [busyId, setBusyId] = useState(null)
  const [reconId, setReconId] = useState(null) // batch id whose reconciliation row is expanded

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (tab === 'imports') setBatches(await imports.listBatches({ country: activeCountry, limit: 100 }))
      else if (tab === 'quality') setQuality(await imports.importControlStats({ country: activeCountry }))
      else if (tab === 'profiles') setProfiles(await imports.listProfiles({ country: activeCountry }))
      else if (tab === 'custom') setCustomFields(await imports.listCustomFields({ country: activeCountry }))
      else if (tab === 'aliases') setAliases(await imports.listAliases({ country: activeCountry }))
      else if (tab === 'fx') setFxRates(await imports.listCurrencyRates({ approvedOnly: false }))
    } catch (e) {
      setError(e?.message || t('intakehistory.errors.loadFailed'))
    } finally { setLoading(false) }
  }, [tab, activeCountry])

  async function addAlias() {
    if (!aliasForm.rawValue.trim() || !aliasForm.canonicalValue.trim()) return
    setSavingAlias(true); setError('')
    try {
      await imports.saveAlias({ ...aliasForm, country: activeCountry })
      setAliasForm((f) => ({ ...f, rawValue: '', canonicalValue: '' }))
      await load()
    } catch (e) {
      setError(e?.message || t('intakehistory.errors.aliasSaveFailed'))
    } finally { setSavingAlias(false) }
  }

  async function addFxRate() {
    const f = fxForm
    if (!f.baseCurrency.trim() || !f.quoteCurrency.trim() || !(Number(f.rate) > 0) || !f.rateDate) return
    setSavingFx(true); setError('')
    try {
      await imports.saveCurrencyRate({
        baseCurrency: f.baseCurrency.trim().toUpperCase(), quoteCurrency: f.quoteCurrency.trim().toUpperCase(),
        rate: Number(f.rate), rateDate: f.rateDate, source: f.source || 'manual',
      })
      setFxForm((s) => ({ ...s, rate: '' }))
      await load()
    } catch (e) {
      setError(e?.message || t('intakehistory.errors.fxSaveFailed'))
    } finally { setSavingFx(false) }
  }
  async function approveFx(id) {
    setError('')
    try { await imports.approveCurrencyRate(id); await load() }
    catch (e) { setError(e?.message || t('intakehistory.errors.fxApproveFailed')) }
  }
  useEffect(() => { load() }, [load])

  async function openDrill(batch) {
    setDrill({ batch, rows: null })
    try { setDrill({ batch, rows: await imports.getBatchRows(batch.id) }) }
    catch (e) { setDrill({ batch, rows: [], error: e?.message }) }
  }

  async function reverse(batch) {
    if (!window.confirm(t('intakehistory.confirm.reverseImport', { module: batch.module, country: batch.country }))) return
    setBusyId(batch.id)
    try { await imports.reverseBatch(batch.id); await load() }
    catch (e) { setError(e?.message || t('intakehistory.errors.reverseFailed')) }
    finally { setBusyId(null) }
  }

  return (
    <div className="p-6 max-w-[1800px] mx-auto text-gray-200">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2"><Database size={22} /> {t('intakehistory.title')}</h1>
          <p className="text-sm text-gray-400">{t('intakehistory.subtitle', { country: activeCountry })}</p>
        </div>
        <Link to="/data-intake" className="text-sm px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white">{t('intakehistory.newImport')}</Link>
      </div>

      <div className="flex gap-2 mb-5 border-b border-gray-800">
        {TABS.map((tabDef) => {
          const I = tabDef.icon
          return (
            <button key={tabDef.key} onClick={() => { setTab(tabDef.key); setDrill(null) }} className={`px-3 py-2 text-sm flex items-center gap-2 border-b-2 -mb-px ${tab === tabDef.key ? 'border-green-500 text-[var(--text-primary)]' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
              <I size={15} /> {t(`intakehistory.tabs.${tabDef.key}`)}
            </button>
          )
        })}
      </div>

      {error && <div className="mb-4 bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm flex gap-2"><AlertTriangle size={16} /> {error}</div>}
      {loading ? (
        <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-green-400" /></div>
      ) : (
        <>
          {/* IMPORTS */}
          {tab === 'imports' && !drill && (
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/60 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">{t('intakehistory.imports.columns.module')}</th><th className="text-left px-3 py-2">{t('intakehistory.imports.columns.country')}</th><th className="text-left px-3 py-2">{t('intakehistory.imports.columns.status')}</th><th className="text-left px-3 py-2">{t('intakehistory.imports.columns.rows')}</th><th className="text-left px-3 py-2">{t('intakehistory.imports.columns.errorsDups')}</th><th className="text-left px-3 py-2">{t('intakehistory.imports.columns.reconcile')}</th><th className="text-left px-3 py-2">{t('intakehistory.imports.columns.when')}</th><th className="px-3 py-2"></th></tr></thead>
                <tbody>
                  {batches.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-600">{t('intakehistory.imports.empty')}</td></tr>}
                  {batches.map((b) => {
                    const recon = reconcileBatch(b)
                    const canRecon = recon.indicator !== 'pending'
                    const open = reconId === b.id
                    return (
                    <Fragment key={b.id}>
                    <tr className="border-t border-gray-800 hover:bg-gray-900/40">
                      <td className="px-3 py-2 capitalize">{b.module}</td>
                      <td className="px-3 py-2 text-gray-400">{b.country || '-'}</td>
                      <td className="px-3 py-2"><span className={chip(b.import_status)}>{b.import_status}</span></td>
                      <td className="px-3 py-2 text-gray-400">{b.imported_rows || 0}/{b.total_rows || 0}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{b.error_rows || 0} / {b.duplicate_rows || 0}</td>
                      <td className="px-3 py-2">
                        {canRecon ? (
                          <button onClick={() => setReconId(open ? null : b.id)} className="inline-flex items-center gap-1" aria-expanded={open} title={t('intakehistory.imports.showReconcileDetail')}>
                            <ReconcileBadge summary={recon} />
                            {open ? <ChevronDown size={13} className="text-gray-500" /> : <ChevronRight size={13} className="text-gray-500" />}
                          </button>
                        ) : <ReconcileBadge summary={recon} />}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{b.created_at ? new Date(b.created_at).toLocaleString('en-GB') : ''}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => openDrill(b)} className="text-xs text-gray-300 hover:text-white inline-flex items-center gap-1">{t('intakehistory.imports.rowsAction')} <ChevronRight size={13} /></button>
                        {isElevated && b.import_status === 'committed' && (
                          <button onClick={() => reverse(b)} disabled={busyId === b.id} className="ml-3 text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1">{busyId === b.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} {t('intakehistory.imports.reverseAction')}</button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-gray-800/60 bg-gray-900/40">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                            <span className="text-gray-300 font-medium">{t('intakehistory.reconcile.heading')}</span>
                            {[['expected', recon.expected], ['imported', recon.imported], ['skipped', recon.skipped], ['errors', recon.errors], ['duplicates', recon.duplicates], ['accountedFor', recon.accountedFor]].map(([l, v]) => (
                              <span key={l} className="text-gray-500">{t(`intakehistory.reconcile.${l}`)}: <span className="text-gray-200">{v}</span></span>
                            ))}
                            {recon.variance !== 0 && <span className="text-amber-400">{t('intakehistory.reconcile.variance', { value: recon.variance })}</span>}
                          </div>
                          {recon.balanced ? (
                            <p className="mt-2 text-xs text-green-400 flex items-center gap-1"><CheckCircle2 size={13} /> {t('intakehistory.reconcile.allAccounted')}</p>
                          ) : (
                            <ul className="mt-2 space-y-1">
                              {recon.discrepancies.map((d, i) => (
                                <li key={i} className="text-xs text-amber-300 flex items-start gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {d}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* IMPORTS - drill into one batch's rows */}
          {tab === 'imports' && drill && (
            <div className="space-y-3">
              <button onClick={() => setDrill(null)} className="text-sm text-gray-400 hover:text-white">{t('intakehistory.drill.back')}</button>
              <p className="text-sm text-gray-300 capitalize">{drill.batch.module} · {drill.batch.country} · <span className={chip(drill.batch.import_status)}>{drill.batch.import_status}</span></p>
              {drill.rows == null ? <div className="py-8 text-center"><Loader2 className="animate-spin mx-auto text-green-400" /></div> : (
                <div className="border border-gray-800 rounded-xl overflow-hidden max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-800/60 text-gray-400 text-xs sticky top-0"><tr><th className="text-left px-3 py-2">{t('intakehistory.drill.columns.index')}</th><th className="text-left px-3 py-2">{t('intakehistory.drill.columns.validation')}</th><th className="text-left px-3 py-2">{t('intakehistory.drill.columns.dup')}</th><th className="text-left px-3 py-2">{t('intakehistory.drill.columns.action')}</th><th className="text-left px-3 py-2">{t('intakehistory.drill.columns.committedId')}</th></tr></thead>
                    <tbody>
                      {drill.rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-600">{t('intakehistory.drill.empty')}</td></tr>}
                      {drill.rows.map((r) => (
                        <tr key={r.id} className="border-t border-gray-800">
                          <td className="px-3 py-1.5 text-gray-500">{r.source_row_no}</td>
                          <td className="px-3 py-1.5 text-xs">{r.validation_status}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-400">{r.dup_status !== 'none' ? r.dup_status : '-'}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-400">{r.action}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-500 truncate max-w-[180px]">{r.target_record_id || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* QUALITY */}
          {tab === 'quality' && quality && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[['imports', quality.total, 'text-[var(--text-primary)]'], ['pendingApproval', quality.pendingApproval, 'text-amber-400'], ['errorRows', quality.errorRows, 'text-red-400'], ['importedRows', quality.importedRows, 'text-green-400']].map(([l, v, c]) => (
                  <div key={l} className="card p-4"><p className="text-xs text-gray-500">{t(`intakehistory.quality.stats.${l}`)}</p><p className={`text-2xl font-bold tabular-nums ${c}`}>{v}</p></div>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[['successRate', `${quality.successRate}%`, 'text-green-400'], ['validationErrorRate', `${quality.validationErrorRate}%`, 'text-red-400'], ['duplicateRate', `${quality.duplicateRate}%`, 'text-amber-400'], ['avgApprovalTime', quality.avgApprovalHours == null ? '-' : `${quality.avgApprovalHours}h`, 'text-[var(--text-primary)]']].map(([l, v, c]) => (
                  <div key={l} className="card p-4"><p className="text-xs text-gray-500">{t(`intakehistory.quality.stats.${l}`)}</p><p className={`text-2xl font-bold tabular-nums ${c}`}>{v}</p></div>
                ))}
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="card p-4">
                  <p className="text-sm text-gray-400 mb-2">{t('intakehistory.quality.byCountry')}</p>
                  {Object.entries(quality.byCountry).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-0.5"><span className="text-gray-300">{k}</span><span className="text-gray-500">{v}</span></div>)}
                </div>
                <div className="card p-4">
                  <p className="text-sm text-gray-400 mb-2">{t('intakehistory.quality.bySource')}</p>
                  {Object.entries(quality.bySource).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-0.5"><span className="text-gray-300">{k}</span><span className="text-gray-500">{v}</span></div>)}
                </div>
                <div className="card p-4">
                  <p className="text-sm text-gray-400 mb-2">{t('intakehistory.quality.byModule')}</p>
                  {Object.entries(quality.byModule).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-0.5"><span className="text-gray-300 capitalize">{k}</span><span className="text-gray-500">{v}</span></div>)}
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="card p-4">
                  <p className="text-sm text-gray-400 mb-2">{t('intakehistory.quality.rowQuality.heading')}</p>
                  {[['warningRows', quality.warningRows], ['duplicateRows', quality.duplicateRows], ['conflictRows', quality.conflictRows], ['skippedRows', quality.skippedRows], ['failedRows', quality.failedRows]].map(([l, v]) => <div key={l} className="flex justify-between text-sm py-0.5"><span className="text-gray-300">{t(`intakehistory.quality.rowQuality.${l}`)}</span><span className="text-gray-500">{v}</span></div>)}
                </div>
                <div className="card p-4">
                  <p className="text-sm text-gray-400 mb-2">{t('intakehistory.quality.topUploaders.heading')}</p>
                  {quality.topUploaders.length === 0 && <p className="text-xs text-gray-600">{t('intakehistory.quality.topUploaders.empty')}</p>}
                  {quality.topUploaders.map((u) => <div key={u.uploader} className="flex justify-between text-sm py-0.5"><span className="text-gray-300 truncate max-w-[220px]" title={u.uploader}>{u.uploader}</span><span className="text-gray-500">{u.count}</span></div>)}
                </div>
              </div>
              <div className="card p-4">
                <p className="text-sm text-gray-400 mb-2">{t('intakehistory.quality.latestImports.heading')}</p>
                {quality.latest.length === 0 && <p className="text-xs text-gray-600">{t('intakehistory.quality.latestImports.empty')}</p>}
                {quality.latest.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs border-t border-gray-800/60 py-1.5 first:border-t-0">
                    <span className="capitalize text-gray-300 font-medium">{i.module}</span>
                    <span className="text-gray-500">{i.country || '-'}</span>
                    <span className={chip(i.status)}>{i.status}</span>
                    <span className="text-gray-500">{t('intakehistory.quality.latestImports.rowsOfTotal', { imported: i.importedRows, total: i.totalRows })}</span>
                    <span className="text-gray-600 ml-auto">{i.createdAt ? new Date(i.createdAt).toLocaleString('en-GB') : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PROFILES */}
          {tab === 'profiles' && (
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/60 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">{t('intakehistory.profiles.columns.name')}</th><th className="text-left px-3 py-2">{t('intakehistory.profiles.columns.module')}</th><th className="text-left px-3 py-2">{t('intakehistory.profiles.columns.source')}</th><th className="text-left px-3 py-2">{t('intakehistory.profiles.columns.country')}</th><th className="text-left px-3 py-2">{t('intakehistory.profiles.columns.version')}</th><th className="text-left px-3 py-2">{t('intakehistory.profiles.columns.lastUsed')}</th></tr></thead>
                <tbody>
                  {profiles.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-600">{t('intakehistory.profiles.empty')}</td></tr>}
                  {profiles.map((p) => (
                    <tr key={p.id} className="border-t border-gray-800">
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2 capitalize text-gray-400">{p.module}</td>
                      <td className="px-3 py-2 text-gray-400">{p.source_system || '-'}</td>
                      <td className="px-3 py-2 text-gray-400">{p.country || 'any'}</td>
                      <td className="px-3 py-2 text-gray-500">{p.version}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{p.last_used_at ? formatDate(p.last_used_at) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* CUSTOM FIELDS */}
          {tab === 'custom' && (
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/60 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">{t('intakehistory.custom.columns.field')}</th><th className="text-left px-3 py-2">{t('intakehistory.custom.columns.module')}</th><th className="text-left px-3 py-2">{t('intakehistory.custom.columns.country')}</th><th className="text-left px-3 py-2">{t('intakehistory.custom.columns.seen')}</th><th className="text-left px-3 py-2">{t('intakehistory.custom.columns.status')}</th></tr></thead>
                <tbody>
                  {customFields.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-600">{t('intakehistory.custom.empty')}</td></tr>}
                  {customFields.map((c) => (
                    <tr key={c.id} className="border-t border-gray-800">
                      <td className="px-3 py-2 font-medium">{c.field_name}</td>
                      <td className="px-3 py-2 capitalize text-gray-400">{c.module}</td>
                      <td className="px-3 py-2 text-gray-400">{c.country || 'any'}</td>
                      <td className="px-3 py-2 text-gray-500">{c.occurrence_count}</td>
                      <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">{c.mapping_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ALIASES */}
          {tab === 'aliases' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">{t('intakehistory.aliases.intro')}</p>
              {isElevated && (
                <div className="card p-4 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">{t('intakehistory.aliases.form.entity')}</label>
                    <select value={aliasForm.entityType} onChange={(e) => setAliasForm((f) => ({ ...f, entityType: e.target.value }))} className="bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm capitalize">
                      {ALIAS_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-xs text-gray-500 mb-1">{t('intakehistory.aliases.form.rawValue')}</label>
                    <input value={aliasForm.rawValue} onChange={(e) => setAliasForm((f) => ({ ...f, rawValue: e.target.value }))} placeholder="Qiddiya-1" className="w-full bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-xs text-gray-500 mb-1">{t('intakehistory.aliases.form.canonicalValue')}</label>
                    <input value={aliasForm.canonicalValue} onChange={(e) => setAliasForm((f) => ({ ...f, canonicalValue: e.target.value }))} placeholder="Qiddiya G1" className="w-full bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={addAlias} disabled={savingAlias || !aliasForm.rawValue.trim() || !aliasForm.canonicalValue.trim()} className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-1.5 disabled:opacity-50">
                    {savingAlias ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t('intakehistory.aliases.addAlias')}
                  </button>
                </div>
              )}
              <div className="border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-800/60 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">{t('intakehistory.aliases.columns.entity')}</th><th className="text-left px-3 py-2">{t('intakehistory.aliases.columns.rawValue')}</th><th className="text-left px-3 py-2"></th><th className="text-left px-3 py-2">{t('intakehistory.aliases.columns.canonical')}</th><th className="text-left px-3 py-2">{t('intakehistory.aliases.columns.country')}</th><th className="text-left px-3 py-2">{t('intakehistory.aliases.columns.added')}</th></tr></thead>
                  <tbody>
                    {aliases.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-600">{t('intakehistory.aliases.empty')}</td></tr>}
                    {aliases.map((a) => (
                      <tr key={a.id} className="border-t border-gray-800">
                        <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300 capitalize">{a.entity_type}</span></td>
                        <td className="px-3 py-2 text-gray-300">{a.raw_value}</td>
                        <td className="px-3 py-2 text-gray-600"><ChevronRight size={14} /></td>
                        <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{a.canonical_value}</td>
                        <td className="px-3 py-2 text-gray-400">{a.country || 'any'}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{a.created_at ? formatDate(a.created_at) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* FX RATES */}
          {tab === 'fx' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">{t('intakehistory.fx.introPart1')} <span className="text-gray-300">{t('intakehistory.fx.introOnly')}</span> {t('intakehistory.fx.introPart2')}</p>
              {isElevated && (
                <div className="card p-4 flex flex-wrap items-end gap-3">
                  <div><label className="block text-xs text-gray-500 mb-1">{t('intakehistory.fx.form.base')}</label><input value={fxForm.baseCurrency} onChange={(e) => setFxForm((f) => ({ ...f, baseCurrency: e.target.value }))} placeholder="USD" maxLength={3} className="w-20 bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm uppercase" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">{t('intakehistory.fx.form.quote')}</label><input value={fxForm.quoteCurrency} onChange={(e) => setFxForm((f) => ({ ...f, quoteCurrency: e.target.value }))} placeholder="SAR" maxLength={3} className="w-20 bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm uppercase" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">{t('intakehistory.fx.form.rate')}</label><input type="number" step="0.00000001" value={fxForm.rate} onChange={(e) => setFxForm((f) => ({ ...f, rate: e.target.value }))} placeholder="0.2667" className="w-28 bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">{t('intakehistory.fx.form.date')}</label><input type="date" value={fxForm.rateDate} onChange={(e) => setFxForm((f) => ({ ...f, rateDate: e.target.value }))} className="bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">{t('intakehistory.fx.form.source')}</label><input value={fxForm.source} onChange={(e) => setFxForm((f) => ({ ...f, source: e.target.value }))} placeholder="manual" className="w-28 bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" /></div>
                  <button onClick={addFxRate} disabled={savingFx || !fxForm.baseCurrency.trim() || !fxForm.quoteCurrency.trim() || !(Number(fxForm.rate) > 0) || !fxForm.rateDate} className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-1.5 disabled:opacity-50">{savingFx ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t('intakehistory.fx.addDraft')}</button>
                </div>
              )}
              <div className="border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-800/60 text-gray-400 text-xs"><tr><th className="text-left px-3 py-2">{t('intakehistory.fx.columns.pair')}</th><th className="text-left px-3 py-2">{t('intakehistory.fx.columns.rate')}</th><th className="text-left px-3 py-2">{t('intakehistory.fx.columns.date')}</th><th className="text-left px-3 py-2">{t('intakehistory.fx.columns.source')}</th><th className="text-left px-3 py-2">{t('intakehistory.fx.columns.status')}</th><th className="text-right px-3 py-2">{t('intakehistory.fx.columns.action')}</th></tr></thead>
                  <tbody>
                    {fxRates.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-600">{t('intakehistory.fx.empty')}</td></tr>}
                    {fxRates.map((r) => (
                      <tr key={r.id} className="border-t border-gray-800">
                        <td className="px-3 py-2 font-medium">{r.quote_currency} → {r.base_currency}</td>
                        <td className="px-3 py-2 text-gray-300 tabular-nums">{r.rate}</td>
                        <td className="px-3 py-2 text-gray-400 text-xs">{r.rate_date}</td>
                        <td className="px-3 py-2 text-gray-400">{r.source}</td>
                        <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded ${r.approved ? 'bg-green-900/30 text-green-400' : 'bg-amber-900/30 text-amber-400'}`}>{r.approved ? t('intakehistory.fx.status.approved') : t('intakehistory.fx.status.draft')}</span></td>
                        <td className="px-3 py-2 text-right">{!r.approved && isElevated
                          ? <button onClick={() => approveFx(r.id)} className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-green-400 hover:border-green-700/50 inline-flex items-center gap-1"><CheckCircle2 size={12} /> {t('intakehistory.fx.approve')}</button>
                          : <span className="text-gray-600 text-xs">-</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
