import { CHECK_RESULTS, emptyWashDetails } from '../../lib/washDetails'

export default function WashDetailsForm({ value, onChange }) {
  const d = value || emptyWashDetails()
  const update = patch => onChange({ ...d, ...patch })
  const chemical = (i, key, value) => update({ chemicals: d.chemicals.map((c,n) => n === i ? { ...c, [key]: value } : c) })
  const check = (i, key, value) => update({ checklist: d.checklist.map((c,n) => n === i ? { ...c, [key]: value } : c) })
  return <div className="space-y-4">
    <fieldset className="space-y-3"><legend className="font-semibold">Chemicals used</legend>
      <select aria-label="Chemical use" className="input" value={d.chemical_status} onChange={e => update({ chemical_status: e.target.value, chemicals: e.target.value === 'used' ? [{ name: '', manufacturer: '', quantity: '', unit: '', dilution: '', sds_url: '' }] : [] })}>
        <option value="not_recorded">Not recorded</option><option value="none">No chemical used</option><option value="used">Chemical used</option>
      </select>
      {d.chemicals.map((c,i) => <div key={i} className="grid sm:grid-cols-2 gap-2 rounded border border-[var(--input-border)] p-3">
        {[['name','Product name',160],['manufacturer','Manufacturer',160],['quantity','Quantity used',40],['unit','Unit (e.g. ml, L)',20],['dilution','Dilution used (from product instructions)',120],['sds_url','Safety data sheet HTTPS link',1000]].map(([key,label,max]) => <label key={key} className="text-sm">{label}<input className="input w-full" value={c[key] || ''} maxLength={max} onChange={e => chemical(i,key,e.target.value)} /></label>)}
        <button type="button" className="btn-secondary" onClick={() => update({ chemicals: d.chemicals.filter((_,n) => n !== i) })}>Remove product</button>
      </div>)}
      {d.chemical_status === 'used' && d.chemicals.length < 10 && <button type="button" className="btn-secondary" onClick={() => update({ chemicals: [...d.chemicals,{ name: '' }] })}>Add product</button>}
      <p className="text-xs text-[var(--text-muted)]">Record the actual product and dilution used. Follow its label and safety data sheet.</p>
    </fieldset>
    <fieldset className="space-y-3"><legend className="font-semibold">Wash checklist</legend>
      <p className="text-xs text-[var(--text-muted)]">Mark only items you checked. Use Not applicable for work outside this wash.</p>
      {d.checklist.map((c,i) => <div key={i} className="grid sm:grid-cols-2 gap-2">
        <label className="text-sm">{c.label}<select className="input w-full" value={c.result} onChange={e => check(i,'result',e.target.value)}>{Object.entries(CHECK_RESULTS).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <label className="text-sm">{c.result === 'fail' ? 'Issue details (required)' : 'Comment'}<input className="input w-full" value={c.note || ''} maxLength={1000} onChange={e => check(i,'note',e.target.value)} /></label>
      </div>)}
      {d.checklist.length < 30 && <label className="text-sm block">Add a checklist item<input className="input w-full" maxLength={200} placeholder="Type an item and press Enter" onKeyDown={e => { if(e.key === 'Enter') { e.preventDefault(); const label=e.currentTarget.value.trim(); if(label) { update({ checklist:[...d.checklist,{label,result:'not_checked',note:''}] }); e.currentTarget.value='' } } }} /></label>}
    </fieldset>
  </div>
}
