import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  MapPin, Save, Loader2, Check, AlertTriangle, RotateCcw, Trash2,
  ChevronDown, Building2, Sparkles,
} from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { COUNTRIES, COUNTRY_LABEL } from '../contexts/SettingsContext'
import {
  listCountryAddresses, upsertCountryAddress, deleteCountryAddress,
  buildCountryAddressList, isBlankAddress, formatAddressLine,
  COUNTRY_ADDRESS_FIELDS,
} from '../lib/api/countryAddresses'
import { toUserMessage } from '../lib/safeError'

/**
 * CountryAddressPanel — admin editor for the per-country address book (V108).
 * Auto-lists the operating countries, pre-fills each from the organisation
 * branding address, and lets an admin override and save one country at a time.
 * Read-only for non-admins. Each country's saved address (or the org fallback)
 * is what documents resolve for that country's reports / gate passes / invoices.
 */
const FIELD_META = [
  { key: 'legal_name',     label: 'Registered legal name', placeholder: 'e.g. KSA Fleet Services LLC', full: true },
  { key: 'address_line',   label: 'Address (street / building)', placeholder: 'King Fahd Rd, Al Olaya', full: true },
  { key: 'city',           label: 'City',            placeholder: 'Riyadh' },
  { key: 'region',         label: 'Region / State',  placeholder: 'Riyadh Province' },
  { key: 'postal_code',    label: 'Postal code',     placeholder: '11564' },
  { key: 'tax_id',         label: 'Tax / VAT / CR no.', placeholder: '3001234567' },
  { key: 'contact_person', label: 'Contact person',  placeholder: 'Operations Manager' },
  { key: 'contact_email',  label: 'Contact email',   placeholder: 'ksa@company.com' },
  { key: 'contact_phone',  label: 'Contact phone',   placeholder: '+966 …' },
  { key: 'website',        label: 'Website',         placeholder: 'company.com' },
  { key: 'notes',          label: 'Notes',           placeholder: 'Internal note (optional)', full: true },
]

const keyOf = (c) => String(c ?? '').trim().toLowerCase()

export default function CountryAddressPanel({ canEdit }) {
  const { branding } = useTenant()
  const [rows, setRows]       = useState([])
  const [forms, setForms]     = useState({})     // { [country]: {fields…} }
  const [saved, setSaved]     = useState({})     // snapshot for dirty diffing
  const [meta, setMeta]       = useState({})     // { [country]: {saved, prefilled} }
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [open, setOpen]       = useState(null)   // expanded country
  const [savingC, setSavingC] = useState(null)   // country being saved
  const [okMsg, setOkMsg]     = useState('')

  // Snapshot of the last-persisted values, read inside the setForms updater to
  // decide which countries have unsaved edits worth preserving across a refresh.
  const savedRef = useRef({})
  const hydrate = useCallback((storedRows) => {
    const list = buildCountryAddressList(COUNTRIES, storedRows, branding)
    const s = {}, m = {}, fresh = {}
    for (const item of list) {
      const { country, saved: isSaved, prefilled, ...fields } = item
      s[country] = { ...fields }
      m[country] = { saved: isSaved, prefilled }
      fresh[country] = fields
    }
    setMeta(m)
    setSaved(s)
    // Preserve a country the user is mid-editing (dirty vs its previous saved
    // snapshot); refresh everything else. Prevents a save/branding refresh from
    // silently discarding unsaved input in another expanded country.
    setForms((prev) => {
      const out = {}
      for (const country of Object.keys(fresh)) {
        const pf = prev[country]
        const ps = savedRef.current[country]
        const dirty = pf && ps && COUNTRY_ADDRESS_FIELDS.some((k) => (pf[k] || '') !== (ps[k] || ''))
        out[country] = dirty ? pf : fresh[country]
      }
      return out
    })
    savedRef.current = s
  }, [branding])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await listCountryAddresses()
      setRows(data || [])
      hydrate(data || [])
    } catch (e) {
      setError(toUserMessage(e, 'Could not load country addresses.'))
    } finally {
      setLoading(false)
    }
  }, [hydrate])

  useEffect(() => { load() }, [load])
  // Re-hydrate prefills if branding arrives after the first load.
  useEffect(() => { if (!loading) hydrate(rows) }, [branding]) // eslint-disable-line

  const setField = (country, key, val) => {
    setOkMsg('')
    setForms((prev) => ({ ...prev, [country]: { ...prev[country], [key]: val } }))
  }

  const isDirty = useCallback((country) => {
    const a = forms[country] || {}, b = saved[country] || {}
    return COUNTRY_ADDRESS_FIELDS.some((k) => (a[k] || '') !== (b[k] || ''))
  }, [forms, saved])

  async function handleSave(country) {
    if (!canEdit || savingC) return
    setSavingC(country); setError(''); setOkMsg('')
    try {
      await upsertCountryAddress(country, forms[country])
      const data = await listCountryAddresses()
      setRows(data || [])
      hydrate(data || [])
      setOkMsg(`${COUNTRY_LABEL[country] || country} address saved.`)
    } catch (e) {
      setError(toUserMessage(e, 'Could not save the address.'))
    } finally {
      setSavingC(null)
    }
  }

  async function handleClear(country) {
    if (!canEdit || savingC) return
    setSavingC(country); setError(''); setOkMsg('')
    try {
      await deleteCountryAddress(country)
      const data = await listCountryAddresses()
      setRows(data || [])
      hydrate(data || [])
      setOkMsg(`${COUNTRY_LABEL[country] || country} reset to the organisation address.`)
    } catch (e) {
      setError(toUserMessage(e, 'Could not reset the address.'))
    } finally {
      setSavingC(null)
    }
  }

  function handleReset(country) {
    setForms((prev) => ({ ...prev, [country]: { ...saved[country] } }))
    setOkMsg('')
  }

  const countries = useMemo(() => Object.keys(forms), [forms])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg" style={{ background: 'rgba(16,185,129,0.12)' }}>
            <MapPin size={18} className="text-emerald-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Country Addresses</h3>
            <p className="text-xs text-gray-500">One registered address per operating country, used on that country's reports, gate passes and procurement documents.</p>
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} /> Read-only. Only an organisation admin can edit country addresses.
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2">
        <Sparkles size={13} className="text-emerald-400 mt-0.5 shrink-0" />
        <span>Countries are listed automatically. Any country without its own address inherits the organisation address (set in Report Branding) until you save one here.</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading country addresses…</div>
      ) : countries.length === 0 ? (
        <div className="text-center text-sm text-gray-500 py-10 border border-dashed border-white/10 rounded-xl">
          No operating countries are configured yet.
        </div>
      ) : (
        <div className="space-y-2">
          {countries.map((country) => {
            const form = forms[country] || {}
            const m = meta[country] || {}
            const dirty = isDirty(country)
            const expanded = open === country
            const preview = formatAddressLine(form) || 'No address, inherits organisation address'
            const badge = m.saved
              ? { text: 'Custom', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' }
              : { text: 'From org', cls: 'bg-slate-800/60 text-slate-300 border-slate-600/40' }
            return (
              <div key={country} className="rounded-xl border border-white/8 bg-white/[0.02] overflow-hidden">
                {/* Row header */}
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : country)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <Building2 size={15} className="text-gray-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-100">{COUNTRY_LABEL[country] || country}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
                      {dirty && <span className="text-[10px] text-amber-300">• unsaved</span>}
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">{preview}</p>
                  </div>
                  <ChevronDown size={16} className={`text-gray-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Editor */}
                {expanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-white/5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      {FIELD_META.map((f) => (
                        <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                          <label className="block text-xs font-medium text-gray-400 mb-1">{f.label}</label>
                          {f.key === 'notes' ? (
                            <textarea
                              rows={2}
                              value={form[f.key] || ''}
                              disabled={!canEdit}
                              onChange={(e) => setField(country, f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className="input text-sm w-full resize-y"
                            />
                          ) : (
                            <input
                              type="text"
                              value={form[f.key] || ''}
                              disabled={!canEdit}
                              onChange={(e) => setField(country, f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className="input text-sm w-full"
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-3 mt-1">
                      <button
                        type="button"
                        onClick={() => handleClear(country)}
                        disabled={!canEdit || savingC === country || !m.saved}
                        className="btn-secondary text-xs gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={m.saved ? 'Delete this country address (reverts to the org address)' : 'No custom address to reset'}
                      >
                        <Trash2 size={13} /> Reset to org
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleReset(country)}
                          disabled={!dirty || savingC === country}
                          className="btn-secondary text-xs gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <RotateCcw size={13} /> Undo
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSave(country)}
                          disabled={!canEdit || !dirty || savingC === country}
                          className="btn-primary text-xs gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {savingC === country ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                          {savingC === country ? 'Saving…' : 'Save address'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Status line */}
      {(error || okMsg) && (
        <div className="text-xs pt-1">
          {error
            ? <span className="text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</span>
            : <span className="text-green-400 flex items-center gap-1.5"><Check size={13} /> {okMsg}</span>}
        </div>
      )}
    </div>
  )
}
