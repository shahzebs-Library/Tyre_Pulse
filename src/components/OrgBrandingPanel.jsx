import { useEffect, useState, useCallback } from 'react'
import { Palette, Save, Loader2, Check, AlertTriangle, RotateCcw, Building2, Image as ImageIcon, Sun, Moon } from 'lucide-react'
import { listOrganisations } from '../lib/api/users'
import { getOrgBranding, setOrgBranding, withBrandingDefaults, BRANDING_FIELDS } from '../lib/api/branding'
import { safeImageSrc } from '../lib/safeUrl'
import { useTenant } from '../contexts/TenantContext'

/**
 * OrgBrandingPanel — admin editor for per-organisation report branding.
 * Super admins / Admins pick an organisation and set its legal name, colours,
 * logo, report theme, footer, disclaimer and contact block. A live preview
 * mirrors how the identity appears on generated reports. Saves through the
 * Admin-gated `set_org_branding` RPC (V68); non-admin viewers are read-only.
 */
const HEX_RE = /^#[0-9A-Fa-f]{6}$/

const TEXT_FIELDS = [
  { key: 'legal_name',    label: 'Registered legal name', placeholder: 'e.g. KSA Fleet Services LLC', hint: 'Appears on the report cover and footer.' },
  { key: 'display_name',  label: 'Display / brand name',  placeholder: 'e.g. KSA Fleet', hint: 'Short name shown in headers.' },
  { key: 'logo_url',      label: 'Logo URL',              placeholder: 'https://…/logo.png', hint: 'Public or signed image URL, used on reports.' },
  { key: 'website',       label: 'Website',               placeholder: 'https://…' },
  { key: 'contact_email', label: 'Contact email',         placeholder: 'reports@company.com' },
  { key: 'contact_phone', label: 'Contact phone',         placeholder: '+966 …' },
  { key: 'address',       label: 'Address',               placeholder: 'Street, City, Country', textarea: true },
  { key: 'footer_text',   label: 'Report footer',         placeholder: 'Confidential: for internal use only', textarea: true },
  { key: 'disclaimer',    label: 'Legal disclaimer',      placeholder: 'This report is generated from…', textarea: true },
]

const COLOR_FIELDS = [
  { key: 'primary_color',   label: 'Primary' },
  { key: 'secondary_color', label: 'Secondary' },
  { key: 'accent_color',    label: 'Accent' },
]

export default function OrgBrandingPanel({ canEdit }) {
  const { refreshBranding } = useTenant()
  const [orgs, setOrgs]       = useState([])
  const [orgId, setOrgId]     = useState('')
  const [form, setForm]       = useState(() => withBrandingDefaults(null))
  const [saved, setSaved]     = useState(() => withBrandingDefaults(null))
  const [loading, setLoading] = useState(true)
  const [loadingBrand, setLoadingBrand] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [msg, setMsg]         = useState('')

  // Load the organisation list once.
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true); setError('')
      try {
        const list = await listOrganisations()
        if (!alive) return
        setOrgs(list || [])
        setOrgId((prev) => prev || list?.[0]?.id || '')
      } catch (e) {
        if (alive) setError(e.message || 'Could not load organisations.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Load branding whenever the selected org changes.
  const loadBrand = useCallback(async (id) => {
    if (!id) return
    setLoadingBrand(true); setError(''); setMsg('')
    try {
      const raw = await getOrgBranding(id)
      const merged = withBrandingDefaults(raw)
      setForm(merged); setSaved(merged)
    } catch (e) {
      setError(e.message || 'Could not load branding.')
    } finally {
      setLoadingBrand(false)
    }
  }, [])
  useEffect(() => { if (orgId) loadBrand(orgId) }, [orgId, loadBrand])

  const setField = (k, v) => { setMsg(''); setForm((f) => ({ ...f, [k]: v })) }

  const dirty = BRANDING_FIELDS.some((k) => (form[k] || '') !== (saved[k] || ''))
  const badColors = COLOR_FIELDS.filter((c) => form[c.key] && !HEX_RE.test(form[c.key])).map((c) => c.label)

  async function handleSave() {
    if (!canEdit || !orgId || !dirty || badColors.length) return
    setSaving(true); setError(''); setMsg('')
    try {
      const stored = await setOrgBranding(orgId, form)
      const merged = withBrandingDefaults(stored)
      setForm(merged); setSaved(merged)
      setMsg('Branding saved.')
      // Refresh the app-wide tenant branding if we edited our own org.
      refreshBranding?.()
    } catch (e) {
      setError(e.message || 'Save failed. Check your permissions and try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() { setForm(saved); setMsg(''); setError('') }

  if (loading) {
    return <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading organisations…</div>
  }

  const selectedOrg = orgs.find((o) => o.id === orgId)

  return (
    <div className="space-y-5">
      {/* Header + org selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg" style={{ background: 'rgba(147,51,234,0.12)' }}>
            <Palette size={18} className="text-purple-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Report Branding</h3>
            <p className="text-xs text-gray-500">Identity applied to every generated PDF & PowerPoint report.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Building2 size={15} className="text-gray-400" />
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="input text-sm min-w-[200px]"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}{o.country ? ` · ${o.country}` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {!canEdit && (
        <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} /> Read-only. Only an organisation admin can edit branding.
        </div>
      )}

      {loadingBrand ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading branding…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── Form ── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Colours */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Brand colours</label>
              <div className="grid grid-cols-3 gap-3">
                {COLOR_FIELDS.map((c) => {
                  const val = form[c.key] || ''
                  const invalid = val && !HEX_RE.test(val)
                  return (
                    <div key={c.key}>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={HEX_RE.test(val) ? val : '#000000'}
                          disabled={!canEdit}
                          onChange={(e) => setField(c.key, e.target.value.toUpperCase())}
                          className="h-9 w-10 rounded border border-white/10 bg-transparent cursor-pointer disabled:cursor-not-allowed"
                          aria-label={`${c.label} colour`}
                        />
                        <input
                          type="text"
                          value={val}
                          disabled={!canEdit}
                          onChange={(e) => setField(c.key, e.target.value)}
                          placeholder="#RRGGBB"
                          className={`input text-xs flex-1 ${invalid ? 'border-red-500/60' : ''}`}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 mt-1 block">{c.label}</span>
                    </div>
                  )
                })}
              </div>
              {badColors.length > 0 && (
                <p className="text-[11px] text-red-400 mt-1.5">Enter valid #RRGGBB hex for: {badColors.join(', ')}.</p>
              )}
            </div>

            {/* Report theme */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Report theme</label>
              <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
                {[{ v: 'light', Icon: Sun }, { v: 'dark', Icon: Moon }].map(({ v, Icon }) => (
                  <button
                    key={v}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setField('report_theme', v)}
                    className={`flex items-center gap-1.5 px-4 py-1.5 text-xs capitalize transition-colors ${
                      form.report_theme === v ? 'bg-purple-600/30 text-purple-200' : 'text-gray-400 hover:text-gray-200'
                    } disabled:cursor-not-allowed`}
                  >
                    <Icon size={13} /> {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Text fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TEXT_FIELDS.map((f) => (
                <div key={f.key} className={f.textarea ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{f.label}</label>
                  {f.textarea ? (
                    <textarea
                      rows={2}
                      value={form[f.key] || ''}
                      disabled={!canEdit}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="input text-sm w-full resize-y"
                    />
                  ) : (
                    <input
                      type="text"
                      value={form[f.key] || ''}
                      disabled={!canEdit}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="input text-sm w-full"
                    />
                  )}
                  {f.hint && <span className="text-[10px] text-gray-500 mt-0.5 block">{f.hint}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* ── Live preview ── */}
          <div className="lg:col-span-1">
            <label className="block text-xs font-medium text-gray-400 mb-2">Report cover preview</label>
            <div
              className="rounded-xl overflow-hidden border shadow-lg"
              style={{
                background: form.report_theme === 'dark' ? '#0F172A' : '#FFFFFF',
                borderColor: 'rgba(255,255,255,0.1)',
              }}
            >
              <div style={{ height: 6, background: form.primary_color || '#16A34A' }} />
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  {safeImageSrc(form.logo_url) ? (
                    <img
                      src={safeImageSrc(form.logo_url)}
                      alt="logo"
                      className="h-10 w-10 rounded object-contain bg-white/5"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <div className="h-10 w-10 rounded flex items-center justify-center" style={{ background: form.accent_color || '#22C55E' }}>
                      <ImageIcon size={16} className="text-white/90" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: form.report_theme === 'dark' ? '#F8FAFC' : '#0F172A' }}>
                      {form.display_name || form.legal_name || selectedOrg?.name || 'Organisation'}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: form.report_theme === 'dark' ? '#94A3B8' : '#64748B' }}>
                      {form.legal_name || 'Fleet Intelligence Report'}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] font-semibold" style={{ color: form.primary_color || '#16A34A' }}>
                  Tyre Performance Report
                </div>
                <div className="space-y-1">
                  <div className="h-1.5 rounded w-full" style={{ background: form.report_theme === 'dark' ? '#1E293B' : '#E2E8F0' }} />
                  <div className="h-1.5 rounded w-4/5" style={{ background: form.report_theme === 'dark' ? '#1E293B' : '#E2E8F0' }} />
                  <div className="h-1.5 rounded w-3/5" style={{ background: form.secondary_color || '#0F172A', opacity: 0.4 }} />
                </div>
                {(form.footer_text || form.contact_email) && (
                  <div className="pt-2 border-t text-[9px] truncate" style={{ borderColor: form.report_theme === 'dark' ? '#1E293B' : '#E2E8F0', color: form.report_theme === 'dark' ? '#64748B' : '#94A3B8' }}>
                    {form.footer_text || form.contact_email}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/5">
        <div className="text-xs">
          {error && <span className="text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</span>}
          {msg && !error && <span className="text-green-400 flex items-center gap-1.5"><Check size={13} /> {msg}</span>}
          {!error && !msg && dirty && <span className="text-amber-300">Unsaved changes</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty || saving}
            className="btn-secondary text-xs gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={13} /> Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canEdit || !dirty || saving || badColors.length > 0}
            className="btn-primary text-xs gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : 'Save branding'}
          </button>
        </div>
      </div>
    </div>
  )
}
