/**
 * Size Optimizer right panel: pick an asset, set the inputs, run. Scoring is
 * the pure runOptimization (sizes the same vehicle type actually runs plus
 * catalogue sizes for that type). Runs stay in this browser session only;
 * nothing is saved to the database.
 */
import { useMemo, useState, useEffect } from 'react'
import { Search, Play } from 'lucide-react'
import { Card, VehicleThumb } from '../commandCenter/kit'
import {
  APPLICATIONS, TERRAINS, LOAD_CONDITIONS, PRIORITIES, TARGETS, runOptimization,
} from '../../lib/sizeOptimizerView'
import { fmtSigned, fmtKm } from './sizeFormat'

function Chips({ label, options, value, onChange }) {
  return (
    <fieldset className="tsz-chips">
      <legend>{label}</legend>
      <div>
        {options.map((o) => (
          <button key={o} type="button" className="tsz-chip" aria-pressed={value === o} onClick={() => onChange(value === o ? '' : o)}>{o}</button>
        ))}
      </div>
    </fieldset>
  )
}

export default function OptimizePanel({ rows, records, label, fleet, catalogue, preselect, onResult, resetKey }) {
  const [query, setQuery] = useState('')
  const [assetId, setAssetId] = useState('')
  const [currentSize, setCurrentSize] = useState('')
  const [application, setApplication] = useState('')
  const [terrain, setTerrain] = useState('')
  const [load, setLoad] = useState('')
  const [priority, setPriority] = useState('cpk')
  const [target, setTarget] = useState(0)
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState(null)

  const asset = useMemo(() => rows.find((r) => r.id === assetId) || null, [rows, assetId])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return rows.filter((r) => [r.asset_no, r.vehicle_type, r.make, r.model].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 8)
  }, [rows, query])

  function pick(r) {
    setAssetId(r.id); setQuery(''); setCurrentSize(r.currentSize || ''); setApplication(r.application || ''); setResult(null)
  }
  useEffect(() => { if (preselect) pick(preselect) }, [preselect])
  useEffect(() => { setAssetId(''); setResult(null) }, [resetKey])

  function run() {
    if (!asset) return
    const res = runOptimization({ records, label, fleet, catalogue, asset, currentSize, application, terrain, load, priority, target: Number(target) })
    const out = { ...res, notes: notes.trim() || null, at: new Date().toISOString() }
    setResult(out)
    onResult?.(asset, out)
  }

  return (
    <Card title="Optimize Tyre Size" sub="Runs are kept in this browser session only." className="tsz-panel">
      <label className="cc-field tsz-full">
        <span>Vehicle / asset</span>
        <div className="cc-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search asset, type or model" aria-label="Search asset" />
        </div>
      </label>
      {matches.length > 0 && (
        <ul className="tsz-picker" role="listbox" aria-label="Matching assets">
          {matches.map((r) => (
            <li key={r.id}><button type="button" role="option" aria-selected={r.id === assetId} onClick={() => pick(r)}>
              <b>{r.asset_no}</b> <span>{[r.vehicle_type, r.country].filter(Boolean).join(' · ')}</span>
            </button></li>
          ))}
        </ul>
      )}
      {asset ? (
        <div className="tsz-asset">
          <VehicleThumb row={asset} size="sm" />
          <div><b>{asset.asset_no}</b><small>{[asset.vehicle_type || 'Type not recorded', asset.site, asset.country].filter(Boolean).join(' · ')}</small></div>
        </div>
      ) : <p className="tsz-hint">Pick an asset to start. Only assets with tyre history are listed.</p>}

      <label className="cc-field tsz-full">
        <span>Current tyre size</span>
        <input className="tsz-input" value={currentSize} onChange={(e) => setCurrentSize(e.target.value)} placeholder="From the latest tyre record" maxLength={40} />
      </label>
      <Chips label="Application" options={APPLICATIONS} value={application} onChange={setApplication} />
      <Chips label="Terrain" options={TERRAINS} value={terrain} onChange={setTerrain} />
      <Chips label="Load condition" options={LOAD_CONDITIONS} value={load} onChange={setLoad} />
      <div className="tsz-two">
        <label className="cc-field"><span>Priority</span>
          <select className="cc-select" value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        </label>
        <label className="cc-field"><span>Target KPI</span>
          <select className="cc-select" value={target} onChange={(e) => setTarget(Number(e.target.value))}>{TARGETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        </label>
      </div>
      <label className="cc-field tsz-full"><span>Notes</span>
        <textarea className="tsz-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Optional" />
      </label>
      <button type="button" className="cc-btn-primary tsz-run" onClick={run} disabled={!asset}><Play size={14} aria-hidden="true" /> Run Optimization</button>

      {result && (
        <div className="tsz-result" aria-live="polite">
          {!result.ok ? <p className="tsz-hint">{result.reason}</p> : (
            <>
              {result.best
                ? <p><b>Best size: {result.best.size}</b> ({fmtSigned(result.best.gainPct)} on the chosen priority{result.best.avgLife ? `, life ${fmtKm(result.best.avgLife)}` : ''})</p>
                : <p className="tsz-hint">{result.reason}</p>}
              {result.candidates.length > 0 && (
                <ol className="tsz-cands">
                  {result.candidates.slice(0, 5).map((c) => (
                    <li key={c.size}><span>{c.size}</span><span className="cc-na">{c.source === 'catalogue' ? 'catalogue only' : `${c.count} tyres`}</span><b>{fmtSigned(c.gainPct)}</b></li>
                  ))}
                </ol>
              )}
              <p className="tsz-sub-h">Inputs used</p>
              <ul className="tsz-list">{result.used.map((u) => <li key={u}>{u}</li>)}</ul>
              <p className="tsz-sub-h">Not used</p>
              <ul className="tsz-list muted">{result.unused.map((u) => <li key={u}>{u}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
