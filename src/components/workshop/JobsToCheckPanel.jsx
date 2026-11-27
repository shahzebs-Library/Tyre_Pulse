/**
 * Jobs to check (web): the completions technicians sent from the phone, with
 * everything they handed over, and Pass / Return for the supervisor. Same RPC
 * and rules as the Flutter "Jobs to check" screen (decide_job_completion):
 * never your own job, one decision only, a reason on every return. A returned
 * job keeps its assignment and is listed under Returned for the data desk.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { Card, CardState, Tabs } from '../commandCenter/kit'
import { COMPLETION_QUEUES, decideJobCompletion, listJobCompletions } from '../../lib/api/jobCompletions'
import { resolveStorageUrlMap } from '../../lib/storageRefs'
import { safeImageSrc } from '../../lib/safeUrl'
import { toUserMessage } from '../../lib/safeError'

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const two = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : ''
}

export default function JobsToCheckPanel({ onDecided }) {
  const { t } = useLanguage()
  const L = useCallback((k) => t(`jobcheck.${k}`), [t])
  const [queue, setQueue] = useState(COMPLETION_QUEUES.toCheck)
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [provisioned, setProvisioned] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState(null)
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { rows, provisioned: ok } = await listJobCompletions(queue)
      if (mine !== seq.current) return
      setProvisioned(ok)
      setState({ loading: false, error: null, data: rows })
    } catch (e) {
      if (mine !== seq.current) return
      setState({ loading: false, error: toUserMessage(e, L('loadError')), data: null })
    }
  }, [queue, L])

  useEffect(() => { load() }, [load])

  const rows = state.data || []
  const open = rows.find((r) => r.id === openId) || null

  useEffect(() => {
    if (!open) return
    const refs = [...(open.before_photos || []), ...(open.after_photos || [])]
    if (!refs.length) return
    let alive = true
    resolveStorageUrlMap(refs).then((m) => { if (alive) setUrls((u) => ({ ...u, ...m })) }).catch(() => {})
    return () => { alive = false }
  }, [open])

  const decide = async (row, decision, reason) => {
    if (busy) return
    setBusy(true)
    try {
      const answer = await decideJobCompletion(row.id, decision, reason)
      if (answer.ok) {
        setFlash({ type: 'ok', msg: decision === 'pass' ? L('passed') : L('returnedOk') })
        setReturning(null)
        setNote('')
        setOpenId(null)
        await load()
        onDecided?.()
      } else {
        setFlash({ type: 'err', msg: answer.reason || L('decideError') })
      }
    } catch (e) {
      setFlash({ type: 'err', msg: toUserMessage(e, L('decideError')) })
    } finally {
      setBusy(false)
    }
  }

  const photos = (refs) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {(refs || []).map((r) => {
        const src = safeImageSrc(urls[r] || '')
        return src
          ? <img key={r} src={src} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />
          : <div key={r} className="cc-muted" style={{ width: 96, height: 96, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 12, background: 'var(--cc-surface-2, rgba(127,127,127,.12))', textAlign: 'center' }}>{L('photoMissing')}</div>
      })}
    </div>
  )

  return (
    <Card title={L('title')} sub={L('sub')}>
      <Tabs
        label={L('title')}
        value={queue}
        onChange={(v) => { setQueue(v); setOpenId(null); setReturning(null) }}
        tabs={[
          { key: COMPLETION_QUEUES.toCheck, label: L('toCheck'), count: queue === COMPLETION_QUEUES.toCheck ? rows.length : undefined },
          { key: COMPLETION_QUEUES.returned, label: L('returned'), count: queue === COMPLETION_QUEUES.returned ? rows.length : undefined },
        ]}
      />
      {flash && <p role={flash.type === 'err' ? 'alert' : 'status'} className={`wl-strip-note${flash.type === 'err' ? ' is-err' : ''}`}>{flash.msg}</p>}
      <CardState
        state={{ ...state, retry: load }}
        empty={rows.length === 0 && !state.loading
          ? (!provisioned ? L('notProvisioned') : (queue === COMPLETION_QUEUES.toCheck ? L('empty') : L('emptyReturned')))
          : null}
        lines={3}
      >
        {(
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {rows.map((r) => {
              const isOpen = r.id === openId
              const waiting = r.status === 'submitted' && r.kind !== 'extra'
              return (
                <li key={r.id} className="cc-card" style={{ padding: 12 }}>
                  <button type="button" className="cc-link cc-link-btn" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : r.id)} style={{ width: '100%', textAlign: 'start' }}>
                    <strong>{r.work_order_no || r.job_id}</strong>{' '}
                    <span className="cc-muted">
                      {[r.asset_no, r.site, r.technician_name, when(r.completed_at)].filter(Boolean).join(' | ')}
                    </span>{' '}
                    {r.kind === 'extra' && <span className="cc-count">{L('extra')}</span>}
                  </button>
                  <div className="cc-muted" style={{ marginTop: 4 }}>
                    {r.status === 'returned' && r.decision_note ? `${L('returnedBecause')} ${r.decision_note}` : r.work_done}
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                      <div><b>{L('workDone')}</b><div>{r.work_done}</div></div>
                      <div>
                        <b>{L('parts')}</b>
                        {Array.isArray(r.parts_used) && r.parts_used.length
                          ? <ul style={{ margin: 0 }}>{r.parts_used.map((p, i) => <li key={i}>{p.name} x{num(p.qty) || 1}</li>)}</ul>
                          : <div className="cc-muted">{L('noParts')}</div>}
                      </div>
                      {(r.km != null || r.engine_hours != null) && (
                        <div><b>{L('meters')}</b><div>{[r.km != null && `${L('km')}: ${num(r.km)}`, r.engine_hours != null && `${L('hours')}: ${num(r.engine_hours)}`].filter(Boolean).join('   ')}</div></div>
                      )}
                      {r.before_photos?.length > 0 && <div><b>{L('before')}</b>{photos(r.before_photos)}</div>}
                      <div><b>{L('after')}</b>{photos(r.after_photos)}</div>
                      {safeImageSrc(r.signature || '') && (
                        <div><b>{L('signature')}</b><div><img src={safeImageSrc(r.signature)} alt="" style={{ maxHeight: 80, background: '#fff', borderRadius: 8 }} /></div></div>
                      )}
                      {waiting && (returning === r.id ? (
                        <div style={{ display: 'grid', gap: 6 }}>
                          <label htmlFor={`jc-note-${r.id}`}><b>{L('returnReason')}</b></label>
                          <textarea id={`jc-note-${r.id}`} rows={3} maxLength={1000} value={note} placeholder={L('returnPlaceholder')} onChange={(e) => setNote(e.target.value)} />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" className="cc-btn" disabled={busy || note.trim().length < 3} onClick={() => decide(r, 'return', note)}>{L('sendReturn')}</button>
                            <button type="button" className="cc-btn ghost" disabled={busy} onClick={() => { setReturning(null); setNote('') }}>{L('cancel')}</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className="cc-btn" disabled={busy} onClick={() => decide(r, 'pass')}>{L('pass')}</button>
                          <button type="button" className="cc-btn ghost" disabled={busy} onClick={() => { setReturning(r.id); setNote('') }}>{L('return')}</button>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardState>
    </Card>
  )
}
