import { emptyWashDetails } from '../../lib/washDetails'

export default function WashDetailsForm({ value, onChange }) {
  const d = value || emptyWashDetails()
  const update = patch => onChange({ ...d, ...patch })
  const chemical = (i, key, value) => update({ chemicals: d.chemicals.map((c,n) => n === i ? { ...c, [key]: value } : c) })
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
  </div>
}
