/**
 * SsoConfiguration (route /sso-configuration) — SSO Configuration. Manages the
 * tenant's single-sign-on identity-provider connections (SAML / OIDC / OAuth2)
 * so an organisation can federate authentication with its corporate IdP (Okta,
 * Azure AD / Entra, Google Workspace, PingFederate, …).
 *
 * Runs on the new `sso_connections` table (V200). Real data, KPI tiles, a
 * certificate-expiry attention strip, a by-protocol breakdown panel, filters,
 * search, create/edit modal, delete confirm, Excel/PDF export, and loading/
 * empty/error/not-provisioned states throughout. Certificate health, KPI
 * roll-ups and protocol breakdowns live in the pure `src/lib/ssoConfig.js`
 * helpers.
 *
 * SECURITY: only public connection metadata is captured here — the UI never
 * asks for private keys or client secrets. Writes are gated to Admin/Manager/
 * Director by RLS on the table.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ShieldCheck, KeyRound, Lock, Users, Fingerprint, ShieldAlert, Network,
  CalendarClock, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSsoConnections, createSsoConnection, updateSsoConnection, deleteSsoConnection,
} from '../lib/api/ssoConfig'
import { summariseSso, byProtocol, certStatus, certDaysRemaining, parseDomains } from '../lib/ssoConfig'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  connection_name: '', protocol: 'saml', idp_provider: '', idp_entity_id: '',
  sso_url: '', domains: '', default_role: '', enforce_sso: false,
  jit_provisioning: false, cert_expiry: '', status: 'draft', notes: '',
}

const PROTOCOL_OPTIONS = [
  { value: 'saml', label: 'SAML 2.0' },
  { value: 'oidc', label: 'OpenID Connect' },
  { value: 'oauth2', label: 'OAuth 2.0' },
]
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'error', label: 'Error' },
]

const PROTOCOL_BADGE = {
  saml: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  oidc: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  oauth2: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  unknown: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}
const STATUS_BADGE = {
  active: 'bg-green-500/15 text-green-300 border-green-500/30',
  draft: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  disabled: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  unknown: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}
const CERT_META = {
  valid: { label: 'Valid', cls: 'text-green-400', Icon: CheckCircle2 },
  expiring_soon: { label: 'Expiring soon', cls: 'text-amber-400', Icon: CalendarClock },
  expired: { label: 'Expired', cls: 'text-red-400', Icon: ShieldAlert },
  unknown: { label: 'No cert', cls: 'text-[var(--text-muted)]', Icon: CalendarClock },
}
const PROTOCOL_LABEL = { saml: 'SAML 2.0', oidc: 'OpenID Connect', oauth2: 'OAuth 2.0', unknown: 'Unspecified' }

const titleize = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '')

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

function Badge({ text, cls }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {text}
    </span>
  )
}

export default function SsoConfiguration() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [protocolFilter, setProtocolFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const nowMs = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listSsoConnections({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load SSO connections.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseSso(rows || [], nowMs), [rows, nowMs])
  const protocolBreakdown = useMemo(() => byProtocol(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  // Certificate attention list: expired first, then expiring soon, soonest first.
  const certAttention = useMemo(() => {
    return (rows || [])
      .map((r) => ({ row: r, status: certStatus(r, nowMs), days: certDaysRemaining(r, nowMs) }))
      .filter((x) => x.status === 'expired' || x.status === 'expiring_soon')
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
  }, [rows, nowMs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (protocolFilter && (r.protocol || 'unknown') !== protocolFilter) return false
      if (statusFilter && (r.status || 'unknown') !== statusFilter) return false
      if (countryFilter && r.country !== countryFilter) return false
      if (q) {
        const hay = `${r.connection_name || ''} ${r.idp_provider || ''} ${r.idp_entity_id || ''} ${r.sso_url || ''} ${r.domains || ''} ${r.default_role || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, protocolFilter, statusFilter, countryFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Connections', value: summary.totalConnections, icon: Network, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.activeCount, icon: ShieldCheck, tone: 'text-green-400' },
    { label: 'SSO enforced', value: summary.enforcedCount, icon: Lock, tone: 'text-indigo-400' },
    { label: 'Certs expiring', value: summary.expiringCertCount, icon: ShieldAlert, tone: summary.expiringCertCount > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]' },
    { label: 'JIT provisioning', value: summary.jitEnabledCount, icon: Users, tone: 'text-sky-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['connection_name', 'protocol', 'idp_provider', 'idp_entity_id', 'sso_url', 'domains', 'default_role', 'enforce_sso', 'jit_provisioning', 'status', 'cert_expiry', 'cert_status']
  const EXPORT_HEADERS = ['Connection', 'Protocol', 'IdP provider', 'Entity/Issuer ID', 'SSO URL', 'Domains', 'Default role', 'Enforced', 'JIT', 'Status', 'Cert expiry', 'Cert status']
  const exportRows = filtered.map((r) => ({
    connection_name: r.connection_name || '',
    protocol: PROTOCOL_LABEL[r.protocol || 'unknown'] || r.protocol || '',
    idp_provider: r.idp_provider || '',
    idp_entity_id: r.idp_entity_id || '',
    sso_url: r.sso_url || '',
    domains: parseDomains(r).join(', '),
    default_role: r.default_role || '',
    enforce_sso: r.enforce_sso ? 'Yes' : 'No',
    jit_provisioning: r.jit_provisioning ? 'Yes' : 'No',
    status: titleize(r.status || ''),
    cert_expiry: r.cert_expiry || '',
    cert_status: CERT_META[certStatus(r, nowMs)].label,
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      connection_name: r.connection_name || '', protocol: r.protocol || 'saml',
      idp_provider: r.idp_provider || '', idp_entity_id: r.idp_entity_id || '',
      sso_url: r.sso_url || '', domains: r.domains || '', default_role: r.default_role || '',
      enforce_sso: !!r.enforce_sso, jit_provisioning: !!r.jit_provisioning,
      cert_expiry: r.cert_expiry || '', status: r.status || 'draft', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.connection_name.trim()) { setFormError('A connection name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateSsoConnection(editing.id, payload)
      else await createSsoConnection(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the connection.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteSsoConnection(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the connection.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setProtocolFilter(''); setStatusFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = protocolFilter || statusFilter || countryFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="SSO Configuration"
        subtitle="Manage single-sign-on identity-provider connections (SAML, OIDC, OAuth2) for the tenant — federate authentication with your corporate IdP, enforce SSO, and govern JIT provisioning."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'sso_connections')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'SSO Configuration', 'sso_connections', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New connection
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">SSO Configuration isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V200_SSO_CONNECTIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load SSO connections.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Certificate attention strip */}
      {rows !== null && certAttention.length > 0 && (
        <div className="card border border-amber-800/40">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShieldAlert size={15} className="text-amber-400" /> Certificate attention required
            <span className="text-xs font-normal text-[var(--text-muted)]">({certAttention.length})</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {certAttention.slice(0, 12).map(({ row: r, status, days }) => {
              const meta = CERT_META[status]
              const MetaIcon = meta.Icon
              return (
                <button
                  key={r.id}
                  onClick={() => openEdit(r)}
                  className="text-left rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 hover:border-amber-600/60 transition-colors"
                >
                  <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                    <MetaIcon size={13} className={meta.cls} /> {r.connection_name}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${meta.cls}`}>
                    {status === 'expired'
                      ? `Expired ${Math.abs(days)}d ago`
                      : `Expires in ${days}d`} · {fmtDate(r.cert_expiry)}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* By-protocol breakdown */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Network size={15} /> Connections by protocol
        </h3>
        {rows === null ? (
          <div className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : protocolBreakdown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No connections configured yet.</p>
        ) : (
          <div className="space-y-2">
            {protocolBreakdown.map(({ protocol, count }) => {
              const pctv = summary.totalConnections > 0 ? Math.round((count / summary.totalConnections) * 100) : 0
              return (
                <div key={protocol} className="flex items-center gap-3">
                  <div className="w-32 shrink-0">
                    <Badge text={PROTOCOL_LABEL[protocol] || protocol} cls={PROTOCOL_BADGE[protocol] || PROTOCOL_BADGE.unknown} />
                  </div>
                  <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500/70" style={{ width: `${pctv}%` }} />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] w-20 text-right tabular-nums">{count} · {pctv}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search connection, provider, entity ID, domains…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={protocolFilter} onChange={(e) => setProtocolFilter(e.target.value)} aria-label="Protocol">
            <option value="">All protocols</option>
            {PROTOCOL_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalConnections}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Connection', 'Protocol', 'IdP provider', 'Domains', 'Enforcement', 'Status', 'Certificate', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No SSO connections yet — add your first identity-provider connection.' : 'No connections match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const cs = certStatus(r, nowMs)
                  const cm = CERT_META[cs]
                  const CIcon = cm.Icon
                  const domains = parseDomains(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          {r.enforce_sso && <Lock size={12} className="text-indigo-400" aria-label="SSO enforced" />}
                          {r.connection_name || '—'}
                        </div>
                        {r.idp_entity_id && <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[220px]">{r.idp_entity_id}</div>}
                      </td>
                      <td className="px-4 py-2.5"><Badge text={PROTOCOL_LABEL[r.protocol || 'unknown'] || r.protocol} cls={PROTOCOL_BADGE[r.protocol || 'unknown'] || PROTOCOL_BADGE.unknown} /></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.idp_provider || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {domains.length === 0 ? '—' : (
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {domains.slice(0, 3).map((d) => <span key={d} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)]">{d}</span>)}
                            {domains.length > 3 && <span className="text-[11px] text-[var(--text-muted)]">+{domains.length - 3}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className={r.enforce_sso ? 'text-indigo-300 inline-flex items-center gap-1' : 'text-[var(--text-muted)] inline-flex items-center gap-1'}>
                            <Lock size={11} /> {r.enforce_sso ? 'Enforced' : 'Optional'}
                          </span>
                          <span className={r.jit_provisioning ? 'text-sky-300 inline-flex items-center gap-1' : 'text-[var(--text-muted)] inline-flex items-center gap-1'}>
                            <Users size={11} /> {r.jit_provisioning ? 'JIT' : 'Manual'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5"><Badge text={titleize(r.status || 'unknown')} cls={STATUS_BADGE[r.status || 'unknown'] || STATUS_BADGE.unknown} /></td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${cm.cls}`}>
                          <CIcon size={13} /> {cm.label}
                        </span>
                        {r.cert_expiry && <div className="text-[11px] text-[var(--text-muted)]">{fmtDate(r.cert_expiry)}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Fingerprint size={18} className="text-indigo-400" /> {editing ? 'Edit SSO connection' : 'New SSO connection'}
              </h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Connection name</label>
                  <input className="input w-full" placeholder="e.g. Acme Corp Okta" value={form.connection_name} maxLength={200} onChange={(e) => set('connection_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Protocol</label>
                  <select className="input w-full" value={form.protocol} onChange={(e) => set('protocol', e.target.value)}>
                    {PROTOCOL_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">IdP provider</label>
                  <input className="input w-full" placeholder="Okta / Azure AD / Google…" value={form.idp_provider} maxLength={200} onChange={(e) => set('idp_provider', e.target.value)} />
                </div>
                <div>
                  <label className="label">Entity / Issuer ID</label>
                  <input className="input w-full" placeholder="urn:idp:entity or issuer URL" value={form.idp_entity_id} maxLength={500} onChange={(e) => set('idp_entity_id', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">SSO URL</label>
                <input className="input w-full" placeholder="https://idp.example.com/sso/saml" value={form.sso_url} maxLength={1000} onChange={(e) => set('sso_url', e.target.value)} />
              </div>
              <div>
                <label className="label">Email domains</label>
                <input className="input w-full" placeholder="acme.com, corp.acme.com" value={form.domains} maxLength={2000} onChange={(e) => set('domains', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Comma- or space-separated. Users with these email domains route to this connection.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Default role</label>
                  <input className="input w-full" placeholder="e.g. Viewer" value={form.default_role} maxLength={120} onChange={(e) => set('default_role', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Certificate expiry</label>
                  <input className="input w-full" type="date" value={form.cert_expiry} onChange={(e) => set('cert_expiry', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center gap-2.5 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.enforce_sso} onChange={(e) => set('enforce_sso', e.target.checked)} className="accent-indigo-500" />
                  <span className="text-sm text-[var(--text-primary)] flex items-center gap-1.5"><Lock size={14} className="text-indigo-400" /> Enforce SSO</span>
                </label>
                <label className="flex items-center gap-2.5 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.jit_provisioning} onChange={(e) => set('jit_provisioning', e.target.checked)} className="accent-sky-500" />
                  <span className="text-sm text-[var(--text-primary)] flex items-center gap-1.5"><Users size={14} className="text-sky-400" /> JIT provisioning</span>
                </label>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. Managed by IT security. SP metadata rotated 2026-01." value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)] bg-[var(--input-bg)]/40 border border-[var(--input-border)] rounded-lg px-3 py-2">
                <KeyRound size={13} className="mt-0.5 shrink-0 text-amber-400" />
                Never store private keys or client secrets here — this record holds public connection metadata only. Keep signing keys in your secrets manager.
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create connection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this SSO connection?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.connection_name || 'Connection'} · {PROTOCOL_LABEL[confirmDelete.protocol || 'unknown']}. Users on this connection will lose federated sign-in. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
