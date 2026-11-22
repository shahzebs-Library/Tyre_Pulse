/**
 * 3D layout of one store: containers and small rooms with their wall racks,
 * shelves and bins, each bin coloured by real stock. The three.js canvas is a
 * dynamic import (own chunk), so this panel costs nothing until it is opened.
 *
 * Data: inventory_locations + v_inv_balances + today's physical-inventory
 * captures. Live: stock_records changes (realtime) pulse the changed bin; the
 * panel also re-reads every 60 s so a capture shows even when that table is
 * not in the realtime publication.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, RefreshCw, X } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { listSites } from '../../lib/api/sites'
import { loadStoreLayoutData, subscribeStoreChanges } from '../../lib/api/physicalInventory'
import { buildStoreLayout, binFacts, statusCounts, BIN_STATUSES } from '../../lib/inventory/storeLayout3d'
import { toUserMessage } from '../../lib/inventory/errorText'
import { ErrorNote, Note, SectionCard, fmtDateTime } from './InvUi'

const Store3DCanvas = lazy(() => import('./Store3DCanvas'))
const COLORS = { empty: '#71717a', stock: '#22c55e', low: '#f59e0b', counted: '#38bdf8' }
const POLL_MS = 60000

function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const m = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null
    if (!m) return undefined
    const h = () => setR(m.matches)
    m.addEventListener?.('change', h)
    return () => m.removeEventListener?.('change', h)
  }, [])
  return r
}

/** 'light' when the app runs the light theme (html.light), kept in sync live. */
function useAppTheme() {
  const read = () => (typeof document !== 'undefined' && document.documentElement.classList.contains('light') ? 'light' : 'dark')
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch { return false }
}

export default function Store3DPanel({ scope, initialSite = '' }) {
  const { t } = useLanguage()
  const reducedMotion = useReducedMotion()
  const theme = useAppTheme()
  const [stores, setStores] = useState([])
  const [site, setSite] = useState(() => initialSite || (scope?.site && scope.site !== 'all' ? scope.site : ''))
  const [state, setState] = useState({ loading: false, error: '', data: null, at: null })
  const [picked, setPicked] = useState(null)
  const [pulses, setPulses] = useState(() => new Map())
  const [live, setLive] = useState(null)
  const seq = useRef(0)
  const gl = useMemo(() => (typeof document === 'undefined' ? false : webglAvailable()), [])

  useEffect(() => {
    let on = true
    listSites({ country: scope?.country, activeOnly: true })
      .then((r) => { if (on) setStores(r.map((s) => s.name).filter(Boolean)) })
      .catch(() => { if (on) setStores([]) })
    return () => { on = false }
  }, [scope?.country])

  useEffect(() => {
    if (scope?.site && scope.site !== 'all') setSite(scope.site)
  }, [scope?.site])

  const load = useCallback(async (quiet = false) => {
    if (!site) return
    const id = ++seq.current
    if (!quiet) setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const data = await loadStoreLayoutData({ country: scope?.country, site })
      if (id === seq.current) setState({ loading: false, error: '', data, at: new Date() })
    } catch (err) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error: toUserMessage(err) }))
    }
  }, [site, scope?.country])

  useEffect(() => { setPicked(null); load() }, [load])
  useEffect(() => {
    if (!site) return undefined
    const timer = setInterval(() => load(true), POLL_MS)
    const off = subscribeStoreChanges(site, ({ table, locationId }) => {
      setLive({ table, at: new Date() })
      if (locationId) setPulses((m) => new Map(m).set(locationId, Date.now()))
      load(true)
    })
    return () => { clearInterval(timer); off() }
  }, [site, load])

  const layout = useMemo(() => {
    if (!state.data || !site) return null
    const facts = binFacts(state.data.balances, state.data.captures)
    return buildStoreLayout(state.data.locations, site, facts)
  }, [state.data, site])
  const counts = layout ? statusCounts(layout) : null

  return (
    <SectionCard title={t('inventory.store3d.title')} sub={t('inventory.store3d.sub')}
      action={site && (
        <button type="button" className="cc-btn-ghost" onClick={() => load()} disabled={state.loading}>
          <RefreshCw size={14} aria-hidden="true" /> {t('inventory.actions.retry')}
        </button>
      )}>
      <div className="inv-3d-bar">
        <label className="cc-field">
          <span>{t('inventory.locations.store')}</span>
          <select className="cc-select" value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">{t('inventory.common.choose')}</option>
            {stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {counts && (
          <ul className="inv-3d-legend" aria-label={t('inventory.store3d.legend')}>
            {BIN_STATUSES.map((k) => (
              <li key={k}><span className="inv-3d-swatch" style={{ background: COLORS[k] }} aria-hidden="true" />{t(`inventory.store3d.status.${k}`)} <b>{counts[k]}</b></li>
            ))}
          </ul>
        )}
      </div>
      {live && <p className="cc-card-sub" role="status">{t('inventory.store3d.live', { when: fmtDateTime(live.at) })}</p>}

      {!site && <Note>{t('inventory.store3d.pickStore')}</Note>}
      {state.error && <ErrorNote error={state.error} onRetry={() => load()} />}
      {site && state.loading && !state.data && <div className="cc-skel" style={{ height: 360 }} aria-busy="true" />}
      {state.data?.status === 'not_provisioned' && <Note tone="warn">{t('inventory.state.notSetUpBody')}</Note>}
      {layout && layout.empty && state.data?.status !== 'not_provisioned' && (
        <Note tone="warn" icon={Box} title={t('inventory.store3d.emptyTitle', { site })}>{t('inventory.store3d.emptyBody')}</Note>
      )}
      {layout && !layout.empty && (
        <div className="inv-3d-wrap">
          <div className="inv-3d-stage">
            {gl ? (
              <Suspense fallback={<div className="cc-skel" style={{ height: '100%' }} aria-busy="true" />}>
                <Store3DCanvas layout={layout} selectedId={picked?.id || null} pulses={pulses} reducedMotion={reducedMotion}
                  onPick={setPicked} label={t('inventory.store3d.canvasLabel', { site })} theme={theme} />
              </Suspense>
            ) : <Note tone="warn">{t('inventory.store3d.noWebgl')}</Note>}
          </div>
          <aside className="inv-3d-detail" aria-live="polite">
            {picked ? (
              <>
                <div className="inv-3d-detail-head">
                  <b className="inv-mono" dir="ltr">{picked.code}</b>
                  <button type="button" className="cc-icon-btn" aria-label={t('inventory.actions.close')} onClick={() => setPicked(null)}><X size={14} aria-hidden="true" /></button>
                </div>
                <p className="cc-card-sub">{t(`inventory.store3d.status.${picked.status}`)} · {t('inventory.store3d.onHand', { n: picked.qty })}</p>
                {picked.lines.length ? (
                  <ul className="inv-pi-list">
                    {picked.lines.map((l) => <li key={l.id}><span>{l.code} {l.description || ''}</span><strong>{l.qty}{l.uom ? ` ${l.uom}` : ''}</strong></li>)}
                  </ul>
                ) : <p className="cc-na">{t('inventory.store3d.noItems')}</p>}
              </>
            ) : <p className="cc-card-sub">{t('inventory.store3d.clickBin')}</p>}
            <details className="inv-3d-list">
              <summary>{t('inventory.store3d.listView', { n: layout.bins })}</summary>
              <ul>
                {layout.zones.flatMap((z) => z.racks.flatMap((r) => r.bins)).map((b) => (
                  <li key={b.id}>
                    <button type="button" className="inv-side-link" onClick={() => setPicked(b)}>
                      <span className="inv-3d-swatch" style={{ background: COLORS[b.status] }} aria-hidden="true" />
                      <span dir="ltr" className="inv-mono">{b.code}</span> {t(`inventory.store3d.status.${b.status}`)}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </aside>
        </div>
      )}
      {state.data?.truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}
    </SectionCard>
  )
}
