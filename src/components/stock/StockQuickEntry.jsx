import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, Plus, Trash2, CheckCircle2, AlertTriangle, Package, Lock, Loader2 } from 'lucide-react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useSettings } from '../../contexts/SettingsContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { listSites } from '../../lib/api/sites'
import { searchStockItems, saveStockEntry } from '../../lib/api/stockQuickEntry'
import { stockDraft, stockItem, STOCK_KIND_LABELS as STOCK_KINDS, existingStockOptions, mergeStockSuggestions, entryErrors, entryPayload, suggestStockUnit } from '../../lib/stockQuickEntry'
import { todayStr } from '../../lib/stockManagementAnalytics'
import { toUserMessage } from '../../lib/safeError'
import './stockWorkspace.css'

const UNITS = ['PCS', 'SET', 'PAIR', 'BOX', 'KG', 'L']
const CONDITIONS = ['Unspecified', 'New', 'Serviceable', 'Retread']
// Source tokens stay as data; only their display label is translated.
const SOURCE_KEYS = new Set(['stock', 'material', 'mis', 'dtr', 'manual'])
const sourceLabel = (t, source) => (SOURCE_KEYS.has(source) ? t(`wmsissue.quick.source.${source}`) : source)
const kindLabel = (t, kind) => (Object.prototype.hasOwnProperty.call(STOCK_KINDS, kind) ? t(`wmsissue.quick.kind.${kind}`) : '')
const emptyManual = { name: '', code: '', kind: 'tyre', brand: '', size: '', unit: 'PCS' }

export default function StockQuickEntry({ records, initialSite = '', onClose, onSaved }) {
  const { t } = useLanguage()
  const { profile, hasCapability } = useAuth()
  const { activeCountry, workingContext } = useSettings()
  const country = activeCountry
  const [site, setSite] = useState(initialSite || workingContext?.site || '')
  const [siteRows, setSiteRows] = useState([])
  const [siteError, setSiteError] = useState('')
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState([])
  const [lookupError, setLookupError] = useState('')
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('count')
  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(null)
  const [highlight, setHighlight] = useState(0)
  const [suggestionsOpen, setSuggestionsOpen] = useState(true)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [review, setReview] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState([])
  const [manualOpen, setManualOpen] = useState(false)
  const [manual, setManual] = useState(emptyManual)
  const [manualUnitTouched, setManualUnitTouched] = useState(false)
  const manualGuess = useMemo(() => suggestStockUnit({ name: manual.name, kind: manual.kind, t }), [manual.name, manual.kind, t])
  const request = useRef(null)
  const alive = useRef(true)
  const searchRef = useRef(null)
  const canCreate = typeof hasCapability === 'function' && hasCapability('stock', 'create')
  const canEdit = typeof hasCapability === 'function' && hasCapability('stock', 'edit')
  const scopeReady = country && country !== 'All'

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let cancelled = false
    if (!scopeReady) return
    setSiteError('')
    listSites({ country, activeOnly: true }).then(data => { if (!cancelled) setSiteRows(data || []) })
      .catch(e => { if (!cancelled) setSiteError(toUserMessage(e, t('wmsissue.quick.siteListError'))) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, scopeReady])
  const sites = useMemo(() => [...new Set([...siteRows.map(r => r.name), ...records.map(r => r.site), workingContext?.site].filter(Boolean))].sort(), [siteRows, records, workingContext?.site])
  const local = useMemo(() => existingStockOptions(records, site, query), [records, site, query])
  const suggestions = useMemo(() => mergeStockSuggestions(local, remote).filter(o => o.source === 'stock' ? canEdit : canCreate), [local, remote, canEdit, canCreate])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setRemote([]); setLookupError(''); setHighlight(0)
    if (!scopeReady || !site || query.trim().length < 2 || !canCreate) { setLoading(false); return () => controller.abort() }
    setLoading(true)
    const timer = setTimeout(() => {
      searchStockItems({ country, site, query, signal: controller.signal })
        .then(data => { if (!cancelled) setRemote(data) })
        .catch(e => { if (!cancelled && !controller.signal.aborted) setLookupError(toUserMessage(e, t('wmsissue.quick.lookupError'))) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer); controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, site, query, retry, scopeReady, canCreate])

  const update = (index, patch) => { setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r)); setErrors([]) }
  function choose(option) {
    if (rows.some(r => r.rowKey === option.key)) { setErrors([t('wmsissue.quick.alreadyAdded')]); return }
    const row = stockDraft(option, t)
    setRows(prev => [...prev, row]); setSelected(row); setQuery(''); setRemote([]); setErrors([]); setSuggestionsOpen(false)
  }
  function changeSite(value) {
    setSite(value); setRows([]); setSelected(null); setQuery(''); setErrors([]); request.current = null
  }
  function openReview() {
    const problems = entryErrors(rows, { site, country, mode, reference, t })
    setErrors(problems)
    if (!problems.length) { setReview(true); setConfirmed(false); request.current = crypto.randomUUID() }
  }
  async function save() {
    if (saving) return
    const problems = entryErrors(rows, { site, country, mode, reference, confirmed, t })
    setErrors(problems)
    if (problems.length) return
    setSaving(true)
    try {
      const result = await saveStockEntry({ requestId: request.current, country, site, mode, reference, notes, lines: entryPayload(rows) })
      if (alive.current) onSaved(result)
    } catch (e) { if (alive.current) setErrors([toUserMessage(e, t('wmsissue.quick.saveError'))]) }
    finally { if (alive.current) setSaving(false) }
  }
  function addManual(e) {
    e.preventDefault()
    const unit = manualUnitTouched ? manual.unit : manualGuess.unit
    if (!manual.name.trim() || !unit) return
    choose({ ...manual, unit, source: 'manual', source_id: null, key: `manual:${crypto.randomUUID()}`, label: t('wmsissue.quick.source.manual') })
    setManualOpen(false); setManual(emptyManual); setManualUnitTouched(false)
  }
  const backToEntry = () => { setReview(false); setConfirmed(false); setErrors([]); request.current = null }
  const current = selected || rows[rows.length - 1]

  return <div className="stock-workspace stock-entry">
    <div className="stock-entry-heading">
      <div><button type="button" onClick={review ? backToEntry : onClose} disabled={saving} className="stock-back"><ArrowLeft size={15} className="rtl-flip" aria-hidden="true" />{review ? t('wmsissue.quick.editCount') : t('wmsissue.quick.backToStock')}</button>
        <h1>{review ? (mode === 'count' ? t('wmsissue.quick.confirmCurrentStock') : t('wmsissue.quick.reviewReceipt')) : t('wmsissue.quick.addStockTitle')}</h1>
        <p>{review ? t('wmsissue.quick.reviewHint') : t('wmsissue.quick.entryHint')}</p></div>
      {!review && <div className="stock-mode" aria-label={t('wmsissue.quick.entryType')}>{[['count', t('wmsissue.quick.modeCount')], ['receipt', t('wmsissue.quick.modeReceipt')]].map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setErrors([]); request.current = null }}>{label}</button>)}</div>}
    </div>
    {!scopeReady && <p className="stock-notice" role="alert">{t('wmsissue.quick.chooseCountry')}</p>}
    {!canCreate && !canEdit && <p className="stock-notice" role="alert">{t('wmsissue.quick.viewOnly')}</p>}
    {errors.length > 0 && <div className="stock-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
    <section className="stock-panel">
      <div className="stock-entry-context">
        <label>{t('wmsissue.quick.siteStore')}<select value={site} disabled={review || saving || !scopeReady} onChange={e => changeSite(e.target.value)}><option value="">{t('wmsissue.quick.chooseSite')}</option>{sites.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>{mode === 'count' ? t('wmsissue.quick.countDate') : t('wmsissue.quick.recordedDate')}<input value={todayStr()} readOnly dir="ltr" /></label>
        {mode === 'receipt' && <label>{t('wmsissue.quick.reference')}<input value={reference} maxLength={200} disabled={review || saving} onChange={e => setReference(e.target.value)} placeholder={t('wmsissue.quick.referencePlaceholder')} /></label>}
      </div>
      {siteError && <p role="alert" className="stock-error">{siteError} {t('wmsissue.quick.sitesRemain')}</p>}
      {!review && <>
        <div className="stock-search-layout">
          <div className="stock-search-block">
            <label htmlFor="stock-item-search">{t('wmsissue.quick.searchLabel')}</label>
            <div className="stock-search-input"><Search size={19} aria-hidden="true" /><input id="stock-item-search" ref={searchRef} role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen && suggestions.length > 0} aria-controls="stock-item-results" aria-activedescendant={suggestionsOpen && suggestions[highlight] ? `stock-suggestion-${highlight}` : undefined}
              autoComplete="off" value={query} disabled={!site || !scopeReady || (!canCreate && !canEdit)} onFocus={() => setSuggestionsOpen(true)} onChange={e => { setQuery(e.target.value); setSuggestionsOpen(true) }} placeholder={t('wmsissue.quick.searchPlaceholder')}
              onKeyDown={e => { if (e.key === 'Escape') setSuggestionsOpen(false); if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(i => Math.min(i + 1, suggestions.length - 1)); setSuggestionsOpen(true) } if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(i => Math.max(0, i - 1)) } if (e.key === 'Enter' && suggestionsOpen && suggestions[highlight]) { e.preventDefault(); choose(suggestions[highlight]) } }} />{loading && <Loader2 size={17} className="animate-spin" aria-label={t('wmsissue.quick.searching')} />}</div>
            {suggestionsOpen && suggestions.length > 0 && <ul className="stock-suggestions" id="stock-item-results" role="listbox" aria-label={t('wmsissue.quick.matchingItems')}>{suggestions.map((o, i) => <li key={o.key} id={`stock-suggestion-${i}`} role="option" aria-selected={highlight === i}><button type="button" onClick={() => choose(o)} onMouseEnter={() => setHighlight(i)}><Package size={20} aria-hidden="true" /><span><strong>{o.code || o.name}</strong><small>{o.code ? o.name : [o.brand, o.size].filter(Boolean).join(' · ')}</small></span><span className="stock-source">{sourceLabel(t, o.source)}</span></button></li>)}</ul>}
            {lookupError && <p className="stock-lookup-error" role="alert">{lookupError} <button type="button" onClick={() => setRetry(n => n + 1)}>{t('wmsissue.quick.retryLookup')}</button></p>}
            {!loading && !lookupError && query.trim().length >= 2 && !suggestions.length && <p role="status" className="stock-empty">{t('wmsissue.quick.noItems')}</p>}
            <p className="stock-help">{t('wmsissue.quick.searchHelp')}</p>
          </div>
          <aside className="stock-item-preview" aria-label={t('wmsissue.quick.selectedDetails')}>
            <strong>{t('wmsissue.quick.selectedItem')}</strong>{current ? <><h2 dir="auto">{current.code || current.name}</h2><p>{current.code ? current.name : ''}</p><dl><div><dt>{t('wmsissue.quick.brand')}</dt><dd>{current.brand || t('wmsissue.quick.notRecorded')}</dd></div><div><dt>{t('wmsissue.quick.type')}</dt><dd>{kindLabel(t, current.kind) || t('wmsissue.quick.confirmType')}</dd></div><div><dt>{t('wmsissue.quick.size')}</dt><dd dir="ltr">{current.size || t('wmsissue.quick.notRecorded')}</dd></div><div><dt>{t('wmsissue.quick.unit')}</dt><dd>{current.unit ? `${current.unit}${current.pack ? ` ${t('wmsissue.quick.packEach', { pack: current.pack })}` : ''}` : t('wmsissue.quick.confirmBelow')}{current.unitReason && <small className="stock-unit-why">{current.unitReason}</small>}</dd></div></dl><span className="stock-source">{sourceLabel(t, current.source)}</span>{current.reference && <p className="stock-help">{t('wmsissue.quick.sourceReference', { reference: current.reference })}{current.date ? ` · ${current.date}` : ''}</p>}<p className="stock-help">{t('wmsissue.quick.dtrHelp')}</p></> : <p>{t('wmsissue.quick.chooseSuggestion')}</p>}
          </aside>
        </div>
        <p className="stock-notice"><Lock size={16} aria-hidden="true" />{mode === 'count' ? t('wmsissue.quick.autoFillCounted') : t('wmsissue.quick.autoFillReceived')}</p>
      </>}
    </section>
    <section className="stock-panel">
      <div className="stock-section-heading"><h2>{review ? t('wmsissue.quick.checkQuantities') : t('wmsissue.quick.stockInStore')}</h2>{!review && <button type="button" className="btn-secondary" disabled={!site} onClick={() => { setQuery(''); setSuggestionsOpen(true); searchRef.current?.focus() }}><Plus size={15} aria-hidden="true" /> {t('wmsissue.quick.addAnother')}</button>}</div>
      <div className="stock-entry-table-wrap"><table className="stock-entry-table"><thead><tr><th>{t('wmsissue.quick.colItem')}</th><th>{t('wmsissue.quick.colRecorded')}</th><th>{mode === 'count' ? t('wmsissue.quick.colCounted') : t('wmsissue.quick.colReceived')} *</th><th>{mode === 'count' ? t('wmsissue.quick.colDifference') : t('wmsissue.quick.colAfterReceipt')}</th><th>{t('wmsissue.quick.unit')} *</th><th>{t('wmsissue.quick.condition')}</th><th>{t('wmsissue.quick.binOptional')}</th>{!review && <th>{t('wmsissue.quick.remove')}</th>}</tr></thead><tbody>
        {rows.map((r, i) => {
          const value = r.quantity === '' ? null : Number(r.quantity)
          const before = r.expected_qty ?? 0
          const impact = value === null ? null : mode === 'count' ? value - before : before + value
          const colCounted = mode === 'count' ? t('wmsissue.quick.colCounted') : t('wmsissue.quick.colReceived')
          const colImpact = mode === 'count' ? t('wmsissue.quick.colDifference') : t('wmsissue.quick.colAfterReceipt')
          return <tr key={r.rowKey}><td className="stock-cell-item"><strong dir="auto">{r.code || r.name}</strong><span>{r.code ? r.name : r.brand}</span><small>{sourceLabel(t, r.source)}{r.source === 'dtr' ? ` · ${t('wmsissue.quick.confirmMatch')}` : ''}</small></td><td data-label={t('wmsissue.quick.colRecorded')}>{r.stock_id ? `${before} ${r.unit || t('wmsissue.quick.units')}` : t('wmsissue.quick.noOpening')}</td>
            <td data-label={colCounted}>{review ? <strong>{r.quantity} {r.unit}</strong> : <input type="number" min={mode === 'count' ? 0 : 1} step="1" aria-label={mode === 'count' ? t('wmsissue.quick.physicalCountFor', { name: r.name }) : t('wmsissue.quick.quantityReceivedFor', { name: r.name })} value={r.quantity} onChange={e => update(i, { quantity: e.target.value })} />}</td>
            <td data-label={colImpact}><span className={impact < 0 ? 'stock-difference-warning' : 'stock-difference'} dir={impact === null ? undefined : 'ltr'}>{impact === null ? t('wmsissue.quick.enterQuantity') : `${mode === 'count' && impact > 0 ? '+' : ''}${impact} ${r.unit || ''}`}</span></td>
            <td data-label={t('wmsissue.quick.unit')} className="stock-cell-unit">{review ? <strong>{r.unit}</strong> : <select aria-label={t('wmsissue.quick.unitFor', { name: r.name })} aria-describedby={`unit-why-${r.rowKey}`} value={r.unit} disabled={!!stockItem(r.stock).unit} onChange={e => update(i, { unit: e.target.value, unitBasis: 'chosen', unitReason: e.target.value ? t('wmsissue.quick.chosenByYou') : '' })}><option value="">{t('wmsissue.quick.confirmUnit')}</option>{UNITS.map(u => <option key={u}>{u}</option>)}</select>}{r.unitReason && <small id={`unit-why-${r.rowKey}`} className={`stock-unit-why${r.unitBasis === 'rule' || r.unitBasis === 'confirm' ? ' is-suggested' : ''}`}>{r.unitBasis === 'rule' ? `${t('wmsissue.quick.suggestedPrefix')} ` : ''}{r.unitBasis === 'confirm' ? `${t('wmsissue.quick.noUnitSuggested', { unit: r.suggestedUnit })} ` : ''}{r.unitReason}{r.pack && r.unitBasis !== 'rule' && r.unitBasis !== 'confirm' ? ` ${t('wmsissue.quick.packEachSentence', { pack: r.pack })}` : ''}</small>}{!review && r.unitBasis === 'confirm' && !r.unit && <button type="button" className="stock-link stock-unit-use" onClick={() => update(i, { unit: r.suggestedUnit, unitBasis: 'chosen', unitReason: t('wmsissue.quick.confirmedByYou') })}>{t('wmsissue.quick.useUnit', { unit: r.suggestedUnit })}</button>}</td>
            <td data-label={t('wmsissue.quick.condition')}><select aria-label={t('wmsissue.quick.conditionFor', { name: r.name })} value={r.condition} disabled={review || !!r.stock_id} onChange={e => update(i, { condition: e.target.value })}>{CONDITIONS.map(c => <option key={c} value={c}>{t(`wmsissue.quick.conditions.${c}`)}</option>)}</select></td>
            <td data-label={t('wmsissue.quick.binOptional')}><input aria-label={t('wmsissue.quick.binFor', { name: r.name })} value={r.bin} maxLength={80} disabled={review || !!r.stock_id} onChange={e => update(i, { bin: e.target.value })} /></td>
            {!review && <td className="stock-cell-remove"><button type="button" className="stock-remove" aria-label={t('wmsissue.quick.removeName', { name: r.name })} onClick={() => { setRows(prev => prev.filter((_, index) => index !== i)); if (selected?.rowKey === r.rowKey) setSelected(null) }}><Trash2 size={17} aria-hidden="true" /></button></td>}</tr>
        })}
        {!rows.length && <tr><td colSpan={8} className="stock-empty">{t('wmsissue.quick.emptyRows')}</td></tr>}
      </tbody></table></div>
      {!review && <div className="stock-table-foot">{canCreate && <button type="button" className="stock-link" disabled={!site || !scopeReady} onClick={() => setManualOpen(true)}><Plus size={15} aria-hidden="true" /> {t('wmsissue.quick.addManual')}</button>}<p>{mode === 'count' ? t('wmsissue.quick.countFoot') : t('wmsissue.quick.receiptFoot')}</p></div>}
      <label className="stock-notes">{t('wmsissue.quick.notesOptional')}<textarea value={notes} maxLength={1000} disabled={review || saving} onChange={e => setNotes(e.target.value)} placeholder={t('wmsissue.quick.notesPlaceholder')} /></label>
    </section>
    {review && <section className="stock-panel stock-confirmation">
      <h2><CheckCircle2 size={21} aria-hidden="true" />{mode === 'count' ? t('wmsissue.quick.confirmPhysical') : t('wmsissue.quick.confirmDelivery')}</h2>
      <p>{mode === 'count' ? t('wmsissue.quick.countExplain') : t('wmsissue.quick.receiptExplain')}</p>
      <p>{t('wmsissue.quick.historyNote')}</p>
      <label className="stock-confirm-check"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} />{t('wmsissue.quick.confirmCheck')}</label>
    </section>}
    <footer className="stock-entry-footer"><div><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>{t('wmsissue.common.cancel')}</button>{review && <button type="button" className="btn-secondary" disabled={saving} onClick={backToEntry}><ArrowLeft size={15} className="rtl-flip" aria-hidden="true" /> {t('wmsissue.quick.back')}</button>}</div>
      <button type="button" className="btn-primary" disabled={saving || !scopeReady || !rows.length || (review && !confirmed)} onClick={review ? save : openReview}>{saving ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t('wmsissue.quick.savingStock')}</> : review ? (mode === 'count' ? t('wmsissue.quick.confirmStockCount') : t('wmsissue.quick.saveReceipt')) : (rows.length === 0 ? t('wmsissue.quick.reviewItems') : t(rows.length === 1 ? 'wmsissue.quick.reviewOne' : 'wmsissue.quick.reviewMany', { count: rows.length }))}</button></footer>
    <Modal open={manualOpen} onClose={() => setManualOpen(false)} title={t('wmsissue.quick.manualTitle')} size="lg"><form onSubmit={addManual} className="stock-manual-form">
      <p>{t('wmsissue.quick.manualIntro')}</p>
      <label>{t('wmsissue.quick.category')}<select value={manual.kind} onChange={e => setManual(r => ({ ...r, kind: e.target.value }))}>{Object.keys(STOCK_KINDS).map((key) => <option key={key} value={key}>{kindLabel(t, key)}</option>)}</select></label>
      <label>{t('wmsissue.quick.descriptionRequired')}<input required maxLength={500} value={manual.name} onChange={e => setManual(r => ({ ...r, name: e.target.value }))} /></label>
      <div className="stock-entry-context"><label>{t('wmsissue.quick.erpCode')}<input maxLength={100} dir="ltr" value={manual.code} onChange={e => setManual(r => ({ ...r, code: e.target.value }))} /></label><label>{t('wmsissue.quick.size')}<input maxLength={80} dir="ltr" value={manual.size} onChange={e => setManual(r => ({ ...r, size: e.target.value }))} /></label><label>{t('wmsissue.quick.brandOptional')}<input maxLength={80} value={manual.brand} onChange={e => setManual(r => ({ ...r, brand: e.target.value }))} /></label><label>{t('wmsissue.quick.unit')} *<select required value={manualUnitTouched ? manual.unit : manualGuess.unit} aria-describedby="manual-unit-why" onChange={e => { setManualUnitTouched(true); setManual(r => ({ ...r, unit: e.target.value })) }}><option value="">{t('wmsissue.quick.confirmUnit')}</option>{UNITS.map(u => <option key={u}>{u}</option>)}</select></label></div>
      <p id="manual-unit-why" className="stock-unit-why" role="status">{manualUnitTouched ? t('wmsissue.quick.manualUnitChosen') : t('wmsissue.quick.manualUnitSuggested', { unit: manualGuess.unit, reason: manualGuess.reason })}</p>
      <p className="stock-help">{t('wmsissue.quick.manualHelp')}</p><button type="submit" className="btn-primary">{t('wmsissue.quick.addToCount')}</button>
    </form></Modal>
    <span className="sr-only">{t('wmsissue.quick.srEntryFor', { name: profile?.full_name || t('wmsissue.quick.currentUser') })}</span>
  </div>
}
