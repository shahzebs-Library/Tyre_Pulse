/**
 * SsoConfiguration (route /sso-configuration): SSO Configuration. Manages the
 * tenant's single-sign-on identity-provider connections (SAML / OIDC / OAuth2)
 * so an organisation can federate authentication with its corporate IdP (Okta,
 * Azure AD / Entra, Google Workspace, PingFederate, and others).
 *
 * Runs on the `sso_connections` table (V200). Real data only: KPI strip, a
 * certificate-expiry attention strip, a by-protocol breakdown, filters +
 * search, a sortable paged EnterpriseTable, create/edit dialog, delete confirm,
 * Excel/PDF export of the whole filtered set, and loading / empty /
 * error+Retry / not-provisioned states. All calculation lives in the pure
 * `src/lib/ssoConfigurationAnalytics.js` engine (built on `src/lib/ssoConfig.js`).
 *
 * SECURITY: only public connection metadata is captured here; the UI never
 * asks for private keys or client secrets. Writes are gated to Admin/Manager/
 * Director by RLS on the table.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ShieldCheck, KeyRound, Lock, Users, Fingerprint, ShieldAlert, Network, Globe,
  CalendarClock, Search, X, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSsoConnections, createSsoConnection, updateSsoConnection, deleteSsoConnection,
} from '../lib/api/ssoConfig'
import {
  ssoKpis, byProtocol, certStatus, parseDomains, filterSso, certAttention,
  certAttentionLabel, ssoExportRows, EXPORT_COLS, EXPORT_HEADERS, PROTOCOL_OPTIONS,
  STATUS_OPTIONS, PROTOCOL_LABEL, CERT_LABEL, titleize,
} from '../lib/ssoConfigurationAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { categorical } from '../lib/reportColors'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  connection_name: '', protocol: 'saml', idp_provider: '', idp_entity_id: '',
  sso_url: '', domains: '', default_role: '', enforce_sso: false,
  jit_provisioning: false, cert_expiry: '', status: 'draft', notes: '',
}

const PROTOCOL_BADGE = {
  saml: 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30',
  oidc: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  oauth2: 'bg-violet-500/15 text-violet-500 border-violet-500/30',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}
const STATUS_BADGE = {
  active: 'bg-green-500/15 text-green-500 border-green-500/30',
  draft: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
  disabled: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  error: 'bg-red-500/15 text-red-500 border-red-500/30',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}
const CERT_META = {
  valid: { cls: 'text-green-500', Icon: CheckCircle2 },
  expiring_soon: { cls: 'text-amber-500', Icon: CalendarClock },
  expired: { cls: 'text-red-500', Icon: ShieldAlert },
  unknown: { cls: 'text-[var(--text-muted)]', Icon: CalendarClock },
}
const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

function Badge({ text, cls }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>{text}</span>
}

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function SsoConfiguration() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [protocolFilter, setProtocolFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [certFilter, setCertFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [nowMs] = useState(() => Date.now())

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listSsoConnections({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load SSO connections.'))
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(rows)
  const kpi = useMemo(() => (loaded ? ssoKpis(rows, nowMs) : null), [rows, loaded, nowMs])
  const protocolBreakdown = useMemo(() => byProtocol(rows || []), [rows])
  const attention = useMemo(() => certAttention(rows || [], nowMs), [rows, nowMs])
  const countryOptions = useMemo(() => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(
    () => filterSso(rows || [], { protocol: protocolFilter, status: statusFilter, country: countryFilter, cert: certFilter, search }, nowMs),
    [rows, protocolFilter, statusFilter, countryFilter, certFilter, search, nowMs],
  )
  const exportRows = useMemo(() => ssoExportRows(filtered, nowMs), [filtered, nowMs])
  const fileBase = () => reportFileName('TyrePulse SSO Connections', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())

  const doExport = async (kind) => {
    setActionError('')
    try {
      if (kind === 'xlsx') await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase(), 'SSO', { title: 'SSO Configuration' })
      else await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'SSO Configuration', fileBase(), 'landscape')
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      connection_name: r.connection_name || '', protocol: r.protocol || 'saml',
      idp_provider: r.idp_provider || '', idp_entity_id: r.idp_entity_id || '',
      sso_url: r.sso_url || '', domains: r.domains || '', default_role: r.default_role || '',
      enforce_sso: !!r.enforce_sso, jit_provisioning: !!r.jit_provisioning,
      cert_expiry: r.cert_expiry || '', status: r.status || 'draft', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.connection_name.trim()) { setFormError('A connection name is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
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
      setActionError(toUserMessage(err, 'Could not delete the connection.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setProtocolFilter(''); setStatusFilter(''); setCertFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = protocolFilter || statusFilter || certFilter || countryFilter || search
  const protoColors = categorical(Math.max(1, protocolBreakdown.length))

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Connection', accessorFn: (r) => r.connection_name || '', size: 220,
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="min-w-0">
            <div className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
              {r.enforce_sso && <Lock size={12} className="text-indigo-500" aria-hidden="true" />}
              <span className="truncate">{r.connection_name || 'N/A'}</span>
            </div>
            {r.idp_entity_id && <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[240px]" title={r.idp_entity_id}>{r.idp_entity_id}</div>}
          </div>
        )
      },
    },
    {
      id: 'protocol', header: 'Protocol', accessorFn: (r) => PROTOCOL_LABEL[r.protocol || 'unknown'] || r.protocol, size: 130, meta: { filterVariant: 'select' },
      cell: ({ row }) => <Badge text={PROTOCOL_LABEL[row.original.protocol || 'unknown'] || row.original.protocol} cls={PROTOCOL_BADGE[row.original.protocol || 'unknown'] || PROTOCOL_BADGE.unknown} />,
    },
    { id: 'provider', header: 'IdP provider', accessorFn: (r) => r.idp_provider || 'N/A', size: 140 },
    {
      id: 'domains', header: 'Domains', accessorFn: (r) => parseDomains(r).join(', '), size: 200,
      cell: ({ row }) => {
        const domains = parseDomains(row.original)
        return domains.length === 0 ? 'N/A' : (
          <div className="flex flex-wrap gap-1 max-w-[220px]">
            {domains.slice(0, 3).map((d) => <span key={d} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--input-bg)] text-[var(--text-secondary)]">{d}</span>)}
            {domains.length > 3 && <span className="text-[11px] text-[var(--text-muted)]">+{domains.length - 3}</span>}
          </div>
        )
      },
    },
    {
      id: 'enforcement', header: 'Enforcement', accessorFn: (r) => `${r.enforce_sso ? 'Enforced' : 'Optional'} ${r.jit_provisioning ? 'JIT' : 'Manual'}`, size: 150,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`inline-flex items-center gap-1 ${row.original.enforce_sso ? 'text-indigo-500' : 'text-[var(--text-muted)]'}`}>
            <Lock size={11} aria-hidden="true" /> {row.original.enforce_sso ? 'Enforced' : 'Optional'}
          </span>
          <span className={`inline-flex items-center gap-1 ${row.original.jit_provisioning ? 'text-sky-500' : 'text-[var(--text-muted)]'}`}>
            <Users size={11} aria-hidden="true" /> {row.original.jit_provisioning ? 'JIT' : 'Manual'}
          </span>
        </div>
      ),
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => titleize(r.status || 'unknown'), size: 110, meta: { filterVariant: 'select' },
      cell: ({ row }) => <Badge text={titleize(row.original.status || 'unknown')} cls={STATUS_BADGE[row.original.status || 'unknown'] || STATUS_BADGE.unknown} />,
    },
    {
      id: 'cert', header: 'Certificate', accessorFn: (r) => r.cert_expiry || '', size: 140,
      cell: ({ row }) => {
        const cs = certStatus(row.original, nowMs)
        const cm = CERT_META[cs]
        const CIcon = cm.Icon
        return (
          <div>
            <span className={`inline-flex items-center gap-1.5 text-xs ${cm.cls}`}><CIcon size={13} aria-hidden="true" /> {CERT_LABEL[cs]}</span>
            {row.original.cert_expiry && <div className="text-[11px] text-[var(--text-muted)]">{fmtDate(row.original.cert_expiry)}</div>}
          </div>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit connection ${row.original.connection_name || ''}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete connection ${row.original.connection_name || ''}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit, nowMs])

  return (
    <div className="space-y-6">
      <PageHeader
        title="SSO Configuration"
        subtitle="Manage single-sign-on identity-provider connections (SAML, OIDC, OAuth2) for the tenant: federate authentication with your corporate IdP, enforce SSO, and govern JIT provisioning."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('xlsx')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> New connection
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">SSO Configuration is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V200_SSO_CONNECTIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <div role="alert" className="card border border-red-500/40 flex items-start justify-between gap-3">
          <p className="text-sm text-red-500">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Connections" value={kpi ? kpi.totalConnections : 'N/A'} icon={Network} tone="text-[var(--text-primary)]" />
        <Kpi label="Active" value={kpi ? kpi.activeCount : 'N/A'} icon={ShieldCheck} tone="text-green-500" />
        <Kpi label="SSO enforced" value={kpi ? kpi.enforcedCount : 'N/A'} sub={kpi?.enforcementRate == null ? null : `${kpi.enforcementRate}% of connections`} icon={Lock} tone="text-indigo-500" />
        <Kpi label="Certs expiring" value={kpi ? kpi.expiringCertCount : 'N/A'} sub={kpi ? `${kpi.noCertCount} with no expiry recorded` : null} icon={ShieldAlert} tone={kpi && kpi.expiringCertCount > 0 ? 'text-amber-500' : 'text-[var(--text-primary)]'} />
        <Kpi label="JIT provisioning" value={kpi ? kpi.jitEnabledCount : 'N/A'} icon={Users} tone="text-sky-500" />
        <Kpi label="Domains covered" value={kpi ? kpi.domainsCovered : 'N/A'} icon={Globe} tone="text-violet-500" />
      </div>

      {/* Certificate attention strip */}
      {loaded && attention.length > 0 && (
        <section className="card border border-amber-500/40" aria-labelledby="sso-cert">
          <h2 id="sso-cert" className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShieldAlert size={15} className="text-amber-500" aria-hidden="true" /> Certificate attention required
            <span className="text-xs font-normal text-[var(--text-muted)]">({attention.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {attention.slice(0, 12).map(({ row: r, status, days }) => {
              const meta = CERT_META[status]
              const MetaIcon = meta.Icon
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => openEdit(r)}
                  className="text-left min-h-[44px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 hover:border-amber-500/60 transition-colors"
                >
                  <p className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5 truncate">
                    <MetaIcon size={13} className={meta.cls} aria-hidden="true" /> {r.connection_name}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${meta.cls}`}>{certAttentionLabel(status, days)}, {fmtDate(r.cert_expiry)}</p>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* By-protocol breakdown */}
      <section className="card" aria-labelledby="sso-proto">
        <h2 id="sso-proto" className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Fingerprint size={15} aria-hidden="true" /> Connections by protocol
        </h2>
        {!loaded && !error ? (
          <div className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : !loaded ? (
          <p className="text-sm text-[var(--text-muted)]">Unavailable until the connections load.</p>
        ) : protocolBreakdown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No connections configured yet.</p>
        ) : (
          <div className="space-y-2">
            {protocolBreakdown.map(({ protocol, count }, i) => {
              const pctv = kpi.totalConnections > 0 ? Math.round((count / kpi.totalConnections) * 100) : 0
              return (
                <div key={protocol} className="flex items-center gap-3">
                  <div className="w-32 shrink-0">
                    <Badge text={PROTOCOL_LABEL[protocol] || protocol} cls={PROTOCOL_BADGE[protocol] || PROTOCOL_BADGE.unknown} />
                  </div>
                  <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${pctv}%`, background: protoColors[i] }} />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] w-20 text-right tabular-nums">{count} ({pctv}%)</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="sso-search" className="sr-only">Search connections</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="sso-search" className="input pl-9 w-full min-h-[44px]" placeholder="Search connection, provider, entity ID, domains" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={protocolFilter} onChange={(e) => setProtocolFilter(e.target.value)} aria-label="Protocol">
            <option value="">All protocols</option>
            {PROTOCOL_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={certFilter} onChange={(e) => setCertFilter(e.target.value)} aria-label="Certificate status">
            <option value="">Any certificate</option>
            {Object.entries(CERT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto self-center" aria-live="polite">{filtered.length} of {kpi ? kpi.totalConnections : 'N/A'}</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={!loaded && !error}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        viewKey="sso-connections"
        emptyMessage={
          notProvisioned ? 'SSO connections are not provisioned yet.'
            : (rows || []).length === 0 ? 'No SSO connections yet. Add your first identity-provider connection.'
              : 'No connections match these filters.'
        }
      />

      {/* Create / Edit dialog */}
      <Modal
        open={showModal}
        onClose={closeModal}
        size="lg"
        closeOnBackdrop={!saving}
        title={editing ? 'Edit SSO connection' : 'New SSO connection'}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="sso-form" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create connection'}
            </button>
          </div>
        }
      >
        <form id="sso-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="sf-name">Connection name *</label>
              <input id="sf-name" className="input w-full" placeholder="e.g. Acme Corp Okta" value={form.connection_name} maxLength={200} onChange={(e) => set('connection_name', e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="sf-proto">Protocol</label>
              <select id="sf-proto" className="input w-full" value={form.protocol} onChange={(e) => set('protocol', e.target.value)}>
                {PROTOCOL_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="sf-provider">IdP provider</label>
              <input id="sf-provider" className="input w-full" placeholder="Okta / Azure AD / Google" value={form.idp_provider} maxLength={200} onChange={(e) => set('idp_provider', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="sf-entity">Entity / Issuer ID</label>
              <input id="sf-entity" className="input w-full" placeholder="urn:idp:entity or issuer URL" value={form.idp_entity_id} maxLength={500} onChange={(e) => set('idp_entity_id', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="sf-url">SSO URL</label>
            <input id="sf-url" className="input w-full" type="url" placeholder="https://idp.example.com/sso/saml" value={form.sso_url} maxLength={1000} onChange={(e) => set('sso_url', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="sf-domains">Email domains</label>
            <input id="sf-domains" className="input w-full" placeholder="acme.com, corp.acme.com" value={form.domains} maxLength={2000} onChange={(e) => set('domains', e.target.value)} aria-describedby="sf-domains-help" />
            <p id="sf-domains-help" className="text-[11px] text-[var(--text-muted)] mt-1">Comma or space separated. Users with these email domains route to this connection.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="sf-role">Default role</label>
              <input id="sf-role" className="input w-full" placeholder="e.g. Viewer" value={form.default_role} maxLength={120} onChange={(e) => set('default_role', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="sf-status">Status</label>
              <select id="sf-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sf-cert">Certificate expiry</label>
              <input id="sf-cert" className="input w-full" type="date" value={form.cert_expiry} onChange={(e) => set('cert_expiry', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2.5 min-h-[44px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={form.enforce_sso} onChange={(e) => set('enforce_sso', e.target.checked)} className="accent-indigo-500 w-4 h-4" />
              <span className="text-sm text-[var(--text-primary)] flex items-center gap-1.5"><Lock size={14} className="text-indigo-500" aria-hidden="true" /> Enforce SSO</span>
            </label>
            <label className="flex items-center gap-2.5 min-h-[44px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={form.jit_provisioning} onChange={(e) => set('jit_provisioning', e.target.checked)} className="accent-sky-500 w-4 h-4" />
              <span className="text-sm text-[var(--text-primary)] flex items-center gap-1.5"><Users size={14} className="text-sky-500" aria-hidden="true" /> JIT provisioning</span>
            </label>
          </div>
          <div>
            <label className="label" htmlFor="sf-notes">Notes (optional)</label>
            <textarea id="sf-notes" className="input w-full min-h-[70px] resize-y" placeholder="e.g. Managed by IT security. SP metadata rotated 2026-01." value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
            <KeyRound size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
            Never store private keys or client secrets here. This record holds public connection metadata only. Keep signing keys in your secrets manager.
          </div>
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => !deleting && setConfirmDelete(null)}
        size="sm"
        closeOnBackdrop={!deleting}
        title="Delete this SSO connection?"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            {confirmDelete.connection_name || 'Connection'} ({PROTOCOL_LABEL[confirmDelete.protocol || 'unknown']}). Users on this connection will lose federated sign-in. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
