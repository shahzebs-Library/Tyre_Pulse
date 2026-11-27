/**
 * IntakeSheetGrid - the shared "sheet" for adding vehicles to the workshop.
 *
 * Works like a small spreadsheet: always one empty row at the bottom, Enter
 * and the arrow keys move between cells, a block copied from Excel / Google
 * Sheets can be pasted into any cell (a header row is mapped by name), plate
 * and vehicle type fill in from the fleet register, and each cell shows its
 * own problem. Nothing is sent until "Send to supervisor"; drafts are kept on
 * this device per country so a closed tab loses nothing. The server checks
 * every row again and skips rows that did not change.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Send, Trash2, AlertTriangle, CheckCircle2, ClipboardPaste } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import {
  SHEET_COLUMNS, blankRow, parsePastedTable, validateRow, isSendable, toPayload, assetKey,
} from '../../lib/workshopStatus/intake'
import { lookupFleet, upsertIntakeRows } from '../../lib/api/workshopIntake'

const draftKey = (country) => `tp.workshopIntake.draft.${country || 'none'}`

function loadDraft(country) {
  try {
    const raw = window.localStorage.getItem(draftKey(country))
    const rows = raw ? JSON.parse(raw) : null
    return Array.isArray(rows) && rows.length ? rows : [blankRow()]
  } catch {
    return [blankRow()]
  }
}

export default function IntakeSheetGrid({ country, listed, onSent }) {
  const { t } = useLanguage()
  const g = useCallback((k, v) => t(`workshopStatusIntake.sheet.${k}`, v), [t])
  const [rows, setRows] = useState(() => loadDraft(country))
  const [fleet, setFleet] = useState(() => new Map())
  const [fleetState, setFleetState] = useState('idle') // idle | loading | error
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [pasteNote, setPasteNote] = useState('')
  const tableRef = useRef(null)

  useEffect(() => { setRows(loadDraft(country)); setResult(null); setError('') }, [country])

  // Keep exactly one empty row at the bottom, and save the draft on this device.
  useEffect(() => {
    const last = rows[rows.length - 1]
    if (!last || last.asset_no) { setRows((r) => [...r, blankRow()]); return }
    try { window.localStorage.setItem(draftKey(country), JSON.stringify(rows.filter((r) => r.asset_no || r.complaint))) } catch { /* private mode */ }
  }, [rows, country])

  // Look up the asset codes typed so far (debounced).
  const assets = useMemo(() => rows.map((r) => assetKey(r.asset_no)).filter(Boolean).join(','), [rows])
  useEffect(() => {
    if (!country || !assets) return undefined
    const missing = assets.split(',').filter((a) => !fleet.has(a))
    if (!missing.length) return undefined
    const id = setTimeout(async () => {
      setFleetState('loading')
      try {
        const found = await lookupFleet({ country, assets: missing })
        setFleet((prev) => {
          const next = new Map(prev)
          for (const a of missing) next.set(a, found.get(a) || null)
          return next
        })
        setFleetState('idle')
      } catch {
        setFleetState('error')
      }
    }, 400)
    return () => clearTimeout(id)
  }, [assets, country, fleet])

  const knownFleet = useMemo(() => {
    const m = new Map()
    for (const [k, v] of fleet) if (v) m.set(k, v)
    return { has: (k) => !fleet.has(k) || m.has(k), get: (k) => m.get(k) }
  }, [fleet])

  const checked = useMemo(() => rows.map((r) => {
    if (!r.asset_no && !r.complaint && !r.job_card_ref) return { row: r, errors: {}, empty: true }
    const errors = validateRow(r, { fleet: knownFleet, listed })
    return { row: r, errors, empty: false }
  }), [rows, knownFleet, listed])

  const ready = checked.filter((c) => !c.empty && isSendable(c.row, c.errors))
  const problems = checked.filter((c) => !c.empty && !isSendable(c.row, c.errors)).length

  const setCell = (i, key, value) => setRows((list) => list.map((r, j) => (j === i ? { ...r, [key]: value } : r)))
  const removeRow = (i) => setRows((list) => (list.length === 1 ? [blankRow()] : list.filter((_, j) => j !== i)))

  const focusCell = (row, col) => {
    const el = tableRef.current?.querySelector(`[data-cell="${row}:${col}"]`)
    if (el) el.focus()
  }

  const onKeyDown = (e, i, col) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.target.tagName !== 'SELECT')) {
      e.preventDefault(); focusCell(Math.min(i + 1, rows.length - 1), col)
    } else if (e.key === 'ArrowUp' && e.target.tagName !== 'SELECT') {
      e.preventDefault(); focusCell(Math.max(i - 1, 0), col)
    }
  }

  const onPaste = (e, i, key) => {
    const text = e.clipboardData?.getData('text/plain') || ''
    if (!text.includes('\t') && !text.includes('\n')) return // a single value: normal paste
    e.preventDefault()
    const { rows: pasted, header } = parsePastedTable(text, { startKey: key })
    if (!pasted.length) return
    setRows((list) => {
      const next = list.filter((r, j) => j < i || r.asset_no || r.complaint)
      const at = Math.min(i, next.length)
      const target = next.slice(0, at)
      const fresh = pasted.map((p) => ({ ...blankRow(), ...p }))
      return [...target, ...fresh, ...next.slice(at)]
    })
    setPasteNote(g(header ? 'pastedWithHeader' : 'pasted', { n: pasted.length }))
  }

  const send = async () => {
    if (!ready.length || sending) return
    setSending(true); setError(''); setResult(null)
    try {
      const res = await upsertIntakeRows({ country, source: 'manual', rows: toPayload(ready.map((c) => c.row)) })
      setResult(res)
      const done = new Set(res.rows.filter((x) => ['new', 'updated', 'unchanged'].includes(x.outcome)).map((x) => x.source_key))
      setRows((list) => {
        const keep = list.filter((r) => !done.has(r.source_key))
        return keep.length ? keep : [blankRow()]
      })
      onSent?.(res)
    } catch (err) {
      setError(toUserMessage(err, g('sendError')))
    } finally {
      setSending(false)
    }
  }

  const outcomeOf = useMemo(() => new Map((result?.rows || []).map((x) => [x.source_key, x])), [result])

  if (!country) {
    return <div className="wks-banner warn" role="status"><AlertTriangle size={17} aria-hidden="true" /><p>{g('pickCountry')}</p></div>
  }

  return (
    <div className="wks-intake-sheet">
      <div className="wks-intake-toolbar">
        <p className="wks-muted"><ClipboardPaste size={14} aria-hidden="true" /> {g('hint')}</p>
        <div className="wks-av-tools">
          <button type="button" className="cc-btn-ghost wks-tap" onClick={() => setRows((r) => [...r, blankRow()])}>
            <Plus size={14} aria-hidden="true" /> {g('addRow')}
          </button>
          <button type="button" className="cc-btn wks-tap" onClick={send} disabled={!ready.length || sending}>
            {sending ? <Loader2 size={14} className="wks-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
            {' '}{g('send', { n: ready.length })}
          </button>
        </div>
      </div>
      {pasteNote && <p className="wks-muted" role="status">{pasteNote}</p>}
      {problems > 0 && <p className="wks-intake-warn" role="status">{g('problems', { n: problems })}</p>}
      {fleetState === 'error' && <p className="wks-intake-warn" role="status">{g('fleetError')}</p>}
      {error && (
        <div className="wks-banner bad" role="alert"><AlertTriangle size={17} aria-hidden="true" /><p>{error}</p></div>
      )}
      {result && (
        <div className="wks-banner ok" role="status">
          <CheckCircle2 size={17} aria-hidden="true" className="wks-ico-good" />
          <p>{g('result', { added: result.new, updated: result.updated, same: result.unchanged, listed: result.already_listed, bad: result.invalid })}</p>
        </div>
      )}

      <div className="wks-intake-wrap" ref={tableRef}>
        <table className="wks-intake-grid" aria-label={g('title')}>
          <thead>
            <tr>
              <th scope="col" className="wks-intake-n">#</th>
              {SHEET_COLUMNS.map((c) => (
                <th key={c.key} scope="col">{g(`cols.${c.key}`)}{c.required ? ' *' : ''}</th>
              ))}
              <th scope="col"><span className="wks-sr">{g('actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {checked.map(({ row, errors, empty }, i) => {
              const f = knownFleet.get(assetKey(row.asset_no))
              const out = outcomeOf.get(row.source_key)
              return (
                <tr key={row.source_key} className={empty ? 'is-empty' : ''}>
                  <td className="wks-intake-n">{i + 1}</td>
                  {SHEET_COLUMNS.map((c, ci) => {
                    if (c.auto) {
                      const v = c.key === 'reg_no' ? f?.registration_no : f?.vehicle_type
                      return <td key={c.key} className="wks-intake-auto">{v || ''}</td>
                    }
                    const err = errors[c.key]
                    const id = `wks-in-${i}-${c.key}`
                    const common = {
                      id,
                      'data-cell': `${i}:${ci}`,
                      value: row[c.key] || '',
                      'aria-label': `${g(`cols.${c.key}`)} ${i + 1}`,
                      'aria-invalid': err ? 'true' : undefined,
                      'aria-describedby': err ? `${id}-e` : undefined,
                      onChange: (e) => setCell(i, c.key, e.target.value),
                      onKeyDown: (e) => onKeyDown(e, i, ci),
                      onPaste: (e) => onPaste(e, i, c.key),
                      className: `wks-intake-cell ${err ? 'has-err' : ''}`,
                    }
                    return (
                      <td key={c.key}>
                        {c.options ? (
                          <select {...common}>
                            <option value="">{''}</option>
                            {c.options.map((o) => <option key={o} value={o}>{g(`opt.${o}`)}</option>)}
                          </select>
                        ) : (
                          <input
                            {...common}
                            type={c.type === 'datetime' ? 'datetime-local' : 'text'}
                            placeholder={c.key === 'site' && f?.site ? f.site : undefined}
                          />
                        )}
                        {err && <span id={`${id}-e`} className="wks-intake-err">{g(`err.${err}`)}</span>}
                      </td>
                    )
                  })}
                  <td className="wks-intake-act">
                    {out && <span className={`wks-chip is-${out.outcome}`}>{g(`out.${out.outcome}`)}</span>}
                    {!empty && (
                      <button type="button" className="cc-btn-ghost wks-tap" onClick={() => removeRow(i)} aria-label={g('remove', { n: i + 1 })}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
