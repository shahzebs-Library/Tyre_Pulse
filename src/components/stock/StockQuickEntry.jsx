import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, Plus, Trash2, CheckCircle2, AlertTriangle, Package, Lock, Loader2 } from 'lucide-react'
import Modal from '../ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useSettings } from '../../contexts/SettingsContext'
import { listSites } from '../../lib/api/sites'
import { searchStockItems, saveStockEntry } from '../../lib/api/stockQuickEntry'
import { stockDraft, stockItem, STOCK_KIND_LABELS, existingStockOptions, mergeStockSuggestions, entryErrors, entryPayload } from '../../lib/stockQuickEntry'
import { todayStr } from '../../lib/stockManagementAnalytics'
import { toUserMessage } from '../../lib/safeError'
import './stockWorkspace.css'

const UNITS = ['PCS', 'SET', 'PAIR', 'BOX', 'KG', 'L']
const CONDITIONS = ['Unspecified', 'New', 'Serviceable', 'Retread']
const sourceLabel = source => ({ stock: 'Existing stock', material: 'MIS / ERP catalogue', mis: 'MIS / ERP', dtr: 'DTR / tyre record', manual: 'Manual item' })[source] || source
const emptyManual = { name: '', code: '', kind: 'tyre', brand: '', size: '', unit: '' }

export default function StockQuickEntry({ records, initialSite = '', onClose, onSaved }) {
  const { profile, hasCapability } = useAuth()
  const { activeCountry, workingContext } = useSettings()
  const country = activeCountry
  const [site, setSite] = useState(workingContext?.site || initialSite)
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
      .catch(e => { if (!cancelled) setSiteError(toUserMessage(e, 'Site list unavailable.')) })
    return () => { cancelled = true }
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
        .catch(e => { if (!cancelled && !controller.signal.aborted) setLookupError(toUserMessage(e, 'MIS / DTR lookup unavailable.')) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer); controller.abort() }
  }, [country, site, query, retry, scopeReady, canCreate])

  const update = (index, patch) => { setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r)); setErrors([]) }
  function choose(option) {
    if (rows.some(r => r.rowKey === option.key)) { setErrors(['This item is already in the entry. Change its quantity below.']); return }
    const row = stockDraft(option)
    setRows(prev => [...prev, row]); setSelected(row); setQuery(''); setRemote([]); setErrors([]); setSuggestionsOpen(false)
  }
  function changeSite(value) {
    setSite(value); setRows([]); setSelected(null); setQuery(''); setErrors([]); request.current = null
  }
  function openReview() {
    const problems = entryErrors(rows, { site, country, mode, reference })
    setErrors(problems)
    if (!problems.length) { setReview(true); setConfirmed(false); request.current = crypto.randomUUID() }
  }
  async function save() {
    if (saving) return
    const problems = entryErrors(rows, { site, country, mode, reference, confirmed })
    setErrors(problems)
    if (problems.length) return
    setSaving(true)
    try {
      const result = await saveStockEntry({ requestId: request.current, country, site, mode, reference, notes, lines: entryPayload(rows) })
      if (alive.current) onSaved(result)
    } catch (e) { if (alive.current) setErrors([toUserMessage(e, 'Stock was not saved. Retry with the same entry, or go back to review it.')]) }
    finally { if (alive.current) setSaving(false) }
  }
  function addManual(e) {
    e.preventDefault()
    if (!manual.name.trim() || !manual.unit) return
    choose({ ...manual, source: 'manual', source_id: null, key: `manual:${crypto.randomUUID()}`, label: 'Manual item' })
    setManualOpen(false); setManual(emptyManual)
  }
  const backToEntry = () => { setReview(false); setConfirmed(false); setErrors([]); request.current = null }
  const current = selected || rows[rows.length - 1]

  return <div className="stock-workspace stock-entry">
    <div className="stock-entry-heading">
      <div><button type="button" onClick={review ? backToEntry : onClose} disabled={saving} className="stock-back"><ArrowLeft size={15} />{review ? 'Edit count' : 'Back to Stock Management'}</button>
        <h1>{review ? (mode === 'count' ? 'Confirm current stock' : 'Review stock receipt') : 'Add stock you already have'}</h1>
        <p>{review ? 'Check the item details and physical quantities before saving.' : 'Search an item. Confirm its details. Enter the quantity in your store.'}</p></div>
      {!review && <div className="stock-mode" aria-label="Entry type">{[['count', 'Current stock'], ['receipt', 'New delivery']].map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setErrors([]); request.current = null }}>{label}</button>)}</div>}
    </div>
    {!scopeReady && <p className="stock-notice" role="alert">Choose one country in the workspace header before adding stock.</p>}
    {!canCreate && !canEdit && <p className="stock-notice" role="alert">Your account can view stock. Create or edit permission is required to post an entry.</p>}
    {errors.length > 0 && <div className="stock-error" role="alert"><AlertTriangle size={18} /><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
    <section className="stock-panel">
      <div className="stock-entry-context">
        <label>Site / store<select value={site} disabled={review || saving || !scopeReady} onChange={e => changeSite(e.target.value)}><option value="">Choose a site / store</option>{sites.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>{mode === 'count' ? 'Count date' : 'Recorded date'}<input value={todayStr()} readOnly /></label>
        {mode === 'receipt' && <label>Receipt / delivery reference *<input value={reference} maxLength={200} disabled={review || saving} onChange={e => setReference(e.target.value)} placeholder="One reference for this delivery" /></label>}
      </div>
      {siteError && <p role="alert" className="stock-error">{siteError} Existing stock sites remain available.</p>}
      {!review && <>
        <div className="stock-search-layout">
          <div className="stock-search-block">
            <label htmlFor="stock-item-search">Type item code, size, brand or description</label>
            <div className="stock-search-input"><Search size={19} aria-hidden="true" /><input id="stock-item-search" ref={searchRef} role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen && suggestions.length > 0} aria-controls="stock-item-results" aria-activedescendant={suggestionsOpen && suggestions[highlight] ? `stock-suggestion-${highlight}` : undefined}
              autoComplete="off" value={query} disabled={!site || !scopeReady || (!canCreate && !canEdit)} onFocus={() => setSuggestionsOpen(true)} onChange={e => { setQuery(e.target.value); setSuggestionsOpen(true) }} placeholder="For example: 315, 22.5, Triangle or an item code"
              onKeyDown={e => { if (e.key === 'Escape') setSuggestionsOpen(false); if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(i => Math.min(i + 1, suggestions.length - 1)); setSuggestionsOpen(true) } if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(i => Math.max(0, i - 1)) } if (e.key === 'Enter' && suggestionsOpen && suggestions[highlight]) { e.preventDefault(); choose(suggestions[highlight]) } }} />{loading && <Loader2 size={17} className="animate-spin" aria-label="Searching catalogue" />}</div>
            {suggestionsOpen && suggestions.length > 0 && <ul className="stock-suggestions" id="stock-item-results" role="listbox" aria-label="Matching stock items">{suggestions.map((o, i) => <li key={o.key} id={`stock-suggestion-${i}`} role="option" aria-selected={highlight === i}><button type="button" onClick={() => choose(o)} onMouseEnter={() => setHighlight(i)}><Package size={20} aria-hidden="true" /><span><strong>{o.code || o.name}</strong><small>{o.code ? o.name : [o.brand, o.size].filter(Boolean).join(' · ')}</small></span><span className="stock-source">{sourceLabel(o.source)}</span></button></li>)}</ul>}
            {lookupError && <p className="stock-lookup-error" role="alert">{lookupError} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry lookup</button></p>}
            {!loading && !lookupError && query.trim().length >= 2 && !suggestions.length && <p role="status" className="stock-empty">No eligible items found. Try another code or add a manual tyre/rim item.</p>}
            <p className="stock-help">Searches existing stock, the MIS / ERP item catalogue and DTR tyre records. Only tyre and rim related items are suggested.</p>
          </div>
          <aside className="stock-item-preview" aria-label="Selected item details">
            <strong>Selected item</strong>{current ? <><h2>{current.code || current.name}</h2><p>{current.code ? current.name : ''}</p><dl><div><dt>Brand</dt><dd>{current.brand || 'Not recorded'}</dd></div><div><dt>Type</dt><dd>{STOCK_KIND_LABELS[current.kind] || 'Confirm type'}</dd></div><div><dt>Unit</dt><dd>{current.unit || 'Confirm below'}</dd></div></dl><span className="stock-source">{sourceLabel(current.source)}</span>{current.reference && <p className="stock-help">Source reference: {current.reference}{current.date ? ` · ${current.date}` : ''}</p>}<p className="stock-help">DTR means Daily Tyre Report. Issued or fitted tyres are not added to stock automatically.</p></> : <p>Choose a suggestion to fill the item details automatically.</p>}
          </aside>
        </div>
        <p className="stock-notice"><Lock size={16} aria-hidden="true" />Item details fill automatically. Check them and enter only what you physically {mode === 'count' ? 'counted' : 'received'}.</p>
      </>}
    </section>
    <section className="stock-panel">
      <div className="stock-section-heading"><h2>{review ? 'Check your quantities' : 'Stock in your store'}</h2>{!review && <button type="button" className="btn-secondary" disabled={!site} onClick={() => { setQuery(''); setSuggestionsOpen(true); searchRef.current?.focus() }}><Plus size={15} /> Add another item</button>}</div>
      <div className="stock-entry-table-wrap"><table className="stock-entry-table"><thead><tr><th>Item details</th><th>Recorded balance</th><th>{mode === 'count' ? 'Physically counted' : 'Quantity received'} *</th><th>{mode === 'count' ? 'Difference' : 'After receipt'}</th><th>Unit *</th><th>Condition</th><th>Bin (optional)</th>{!review && <th>Remove</th>}</tr></thead><tbody>
        {rows.map((r, i) => {
          const value = r.quantity === '' ? null : Number(r.quantity)
          const before = r.expected_qty ?? 0
          const impact = value === null ? null : mode === 'count' ? value - before : before + value
          return <tr key={r.rowKey}><td><strong>{r.code || r.name}</strong><span>{r.code ? r.name : r.brand}</span><small>{sourceLabel(r.source)}{r.source === 'dtr' ? ' · Confirm item match' : ''}</small></td><td>{r.stock_id ? `${before} ${r.unit || 'units'}` : 'No opening count'}</td>
            <td>{review ? <strong>{r.quantity} {r.unit}</strong> : <input type="number" min={mode === 'count' ? 0 : 1} step="1" aria-label={`${mode === 'count' ? 'Physical count' : 'Quantity received'} for ${r.name}`} value={r.quantity} onChange={e => update(i, { quantity: e.target.value })} />}</td>
            <td><span className={impact < 0 ? 'stock-difference-warning' : 'stock-difference'}>{impact === null ? 'Enter quantity' : `${mode === 'count' && impact > 0 ? '+' : ''}${impact} ${r.unit || ''}`}</span></td>
            <td><select aria-label={`Unit for ${r.name}`} value={r.unit} disabled={review || !!stockItem(r.stock).unit} onChange={e => update(i, { unit: e.target.value })}><option value="">Confirm unit</option>{UNITS.map(u => <option key={u}>{u}</option>)}</select></td>
            <td><select aria-label={`Condition for ${r.name}`} value={r.condition} disabled={review || !!r.stock_id} onChange={e => update(i, { condition: e.target.value })}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></td>
            <td><input aria-label={`Bin for ${r.name}`} value={r.bin} maxLength={80} disabled={review || !!r.stock_id} onChange={e => update(i, { bin: e.target.value })} /></td>
            {!review && <td><button type="button" className="stock-remove" aria-label={`Remove ${r.name}`} onClick={() => { setRows(prev => prev.filter((_, index) => index !== i)); if (selected?.rowKey === r.rowKey) setSelected(null) }}><Trash2 size={17} /></button></td>}</tr>
        })}
        {!rows.length && <tr><td colSpan={8} className="stock-empty">Search for an item above. Its details will appear here automatically.</td></tr>}
      </tbody></table></div>
      {!review && <div className="stock-table-foot">{canCreate && <button type="button" className="stock-link" disabled={!site || !scopeReady} onClick={() => setManualOpen(true)}><Plus size={15} /> Cannot find it? Add manual item</button>}<p>{mode === 'count' ? 'Counted quantity is the total on hand, not an additional receipt.' : 'One receipt reference covers all items in this delivery.'}</p></div>}
      <label className="stock-notes">Notes (optional)<textarea value={notes} maxLength={1000} disabled={review || saving} onChange={e => setNotes(e.target.value)} placeholder="For example: recounted rim stock" /></label>
    </section>
    {review && <section className="stock-panel stock-confirmation">
      <h2><CheckCircle2 size={21} />{mode === 'count' ? 'Confirm the physical quantities' : 'Confirm the delivery quantities'}</h2>
      <p>{mode === 'count' ? 'The count becomes the final quantity. If 24 are recorded and you count 36, the movement is +12, not another +36 receipt.' : 'Received quantities are added to the latest balance only after this entry is saved.'}</p>
      <p>Your count is recorded in movement history. Items with an active approval workflow cannot be changed until that workflow is resolved.</p>
      <label className="stock-confirm-check"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} />I have checked the item details and confirm these physical quantities.</label>
    </section>}
    <footer className="stock-entry-footer"><div><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>{review && <button type="button" className="btn-secondary" disabled={saving} onClick={backToEntry}><ArrowLeft size={15} /> Back</button>}</div>
      <button type="button" className="btn-primary" disabled={saving || !scopeReady || !rows.length || (review && !confirmed)} onClick={review ? save : openReview}>{saving ? <><Loader2 size={16} className="animate-spin" /> Saving stock…</> : review ? (mode === 'count' ? 'Confirm stock count' : 'Save receipt') : `Review ${rows.length || ''} ${rows.length === 1 ? 'item' : 'items'}`}</button></footer>
    <Modal open={manualOpen} onClose={() => setManualOpen(false)} title="Add manual tyre / rim item" size="lg"><form onSubmit={addManual} className="stock-manual-form">
      <p>Use this when the item is not in MIS / ERP or DTR. Item details alone do not create a stock balance.</p>
      <label>Category<select value={manual.kind} onChange={e => setManual(r => ({ ...r, kind: e.target.value }))}>{Object.entries(STOCK_KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Description *<input required maxLength={500} value={manual.name} onChange={e => setManual(r => ({ ...r, name: e.target.value }))} /></label>
      <div className="stock-entry-context"><label>ERP item code (only if known)<input maxLength={100} value={manual.code} onChange={e => setManual(r => ({ ...r, code: e.target.value }))} /></label><label>Size<input maxLength={80} value={manual.size} onChange={e => setManual(r => ({ ...r, size: e.target.value }))} /></label><label>Brand (optional)<input maxLength={80} value={manual.brand} onChange={e => setManual(r => ({ ...r, brand: e.target.value }))} /></label><label>Unit *<select required value={manual.unit} onChange={e => setManual(r => ({ ...r, unit: e.target.value }))}><option value="">Confirm unit</option>{UNITS.map(u => <option key={u}>{u}</option>)}</select></label></div>
      <p className="stock-help">Without an ERP code this remains a manual item. It does not change financial classifications or historical expenses.</p><button type="submit" className="btn-primary">Add item to count</button>
    </form></Modal>
    <span className="sr-only">Stock entry for {profile?.full_name || 'current user'}</span>
  </div>
}
