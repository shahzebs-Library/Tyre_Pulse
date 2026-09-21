import { useState } from 'react'
import { entryPerson } from '../../lib/washDetails'

export default function WashAdvancedFilters({ rows, value, onChange, userId, scope, includeArea = false, includeBasic = false }) {
  const [savedName, setSavedName] = useState(''), [message, setMessage] = useState(''), [revision, setRevision] = useState(0)
  const key = `wash-filters-v1:${scope}`
  let saved = []
  try { saved = JSON.parse(localStorage.getItem(key) || '[]'); if (!Array.isArray(saved)) saved = [] } catch { /* unavailable storage is reported on save */ }
  const set = (k,v) => onChange({ ...value, [k]: v })
  const select = (name,label,options) => <label key={name} className="text-xs">{label}<select className="input w-full" value={value[name] || 'All'} onChange={e => set(name,e.target.value)}><option value="All">All</option>{options.map(([id,label]) => <option value={id} key={id}>{label}</option>)}</select></label>
  const options = field => [...new Set(rows.map(r => r[field]).filter(Boolean))].sort().map(v => [v,v])
  const people = [...new Map(rows.map(r => [r.created_by || 'unknown', [r.created_by || 'unknown', entryPerson(r)]])).values()]
  return <details className="rounded border border-[var(--input-border)] p-3" open>
    <summary className="cursor-pointer font-medium">People, evidence and advanced filters</summary>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
      {includeBasic && <><label className="text-xs">Asset<input className="input w-full" value={value.assetNo || ''} onChange={e=>set('assetNo',e.target.value)} /></label>{select('site','Site',options('site'))}{select('status','Status',options('status'))}{select('type','Wash type',options('wash_type'))}</>}
      <label className="text-xs">Date basis<select className="input w-full" value={value.dateBasis || 'wash'} onChange={e => set('dateBasis',e.target.value)}><option value="wash">Wash date</option><option value="received">Received date (UTC)</option></select></label>
      {select('enteredBy','Entered by',people)}
      {select('correctedBy','Corrected by',[...new Set(rows.flatMap(r=>r.corrected_by_ids || []))].map(id=>[id,people.find(p=>p[0]===id)?.[1] || `User ${id}`]))}
      {select('corrections','Corrections',[['yes','Corrected records'],['no','No corrections']])}
      {select('country','Country',options('country'))}{select('region','Current vehicle region',options('region'))}
      {includeArea && select('area','Recorded area',options('area'))}
      {select('vehicleType','Vehicle type',options('vehicle_type'))}{select('bay','Wash bay',options('bay'))}{select('washedBy','Washed by',options('washed_by'))}
      <label className="text-xs">Registration<input className="input w-full" value={value.registration || ''} onChange={e => set('registration',e.target.value)} /></label>
      {select('photos','Photos',[['yes','With photos'],['no','Without photos']])}
      {select('chemicals','Chemicals',[['used','Chemical used'],['none','No chemical used'],['not_recorded','Not recorded']])}
      {select('checklist','Checklist',[['issues','Issues found'],['missing','Not checked / not recorded']])}
    </div>
    <div className="flex flex-wrap gap-2 items-center mt-3">
      {userId && <button className="btn-secondary" type="button" onClick={() => set('enteredBy',userId)}>My entries</button>}
      <input aria-label="Saved view name" className="input" maxLength={60} placeholder="Name this filter view" value={savedName} onChange={e => setSavedName(e.target.value)} />
      <button className="btn-secondary" type="button" disabled={!savedName.trim()} onClick={() => { try { localStorage.setItem(key,JSON.stringify([...saved.filter(s => s.name !== savedName.trim()),{name:savedName.trim(),filters:value}].slice(-20))); setRevision(revision+1); setMessage('View saved for this account and scope.') } catch { setMessage('Could not save this view on this browser.') } }}>Save view</button>
      <select aria-label="Load saved wash view" className="input" value="" onChange={e => { const s=saved.find(s => s.name === e.target.value); if(s?.filters) onChange(s.filters) }}><option value="">Load saved view</option>{saved.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
    </div>
    {message && <p role="status" className="text-xs mt-2">{message}</p>}
    <p className="text-xs text-[var(--text-muted)] mt-2">Active: {Object.entries(value).filter(([k,v]) => v && v !== 'All' && k !== 'dateBasis').map(([k,v]) => `${k}: ${k === 'enteredBy' ? people.find(p => p[0]===v)?.[1] || v : v}`).join(' · ') || 'All records in your permitted scope'}</p>
  </details>
}
