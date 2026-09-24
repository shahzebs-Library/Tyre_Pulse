/**
 * ConsoleCompliance.jsx - the Compliance Center (/console/compliance).
 *
 * A live control catalogue mapped to SOC 2 and ISO/IEC 27001 Annex A. Every
 * control is evaluated from evidence that already exists (security posture,
 * scans, access reviews, audit seals, backups, console audit trail, system
 * configuration). A source that fails to load makes its controls "Could not
 * check", never a pass. Controls SQL cannot measure are attested by hand with a
 * note and an expiry, and fall back to "Needs attestation" when that lapses.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ClipboardCheck, RefreshCw, FileDown, FileSpreadsheet, CheckCircle2, AlertTriangle,
  XCircle, Hand, HelpCircle, Stamp, Undo2, Info, Layers, PieChart,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Segmented, SearchInput, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal, Code,
} from '../components/ui'
import { BarsChart, ShareChart, ScoreRing, STATUS, useChartTheme } from '../components/ui/charts'
import {
  loadComplianceEvidence, attestControl, withdrawAttestation,
} from '../../lib/api/compliance'
import {
  CONTROLS, evaluateControls, readinessScore, filterByFramework, sortResults, domainSummary,
  failedSources, evidencePackRows, activeAttestation, FRAMEWORKS, STATUS_LABEL, SOURCE_LABEL,
  EVIDENCE_COLUMNS, EVIDENCE_HEADERS,
} from '../../lib/complianceControls'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { loadPdf } from '../../lib/pdfEngine'

const STATUS_TONE = { pass: 'good', warn: 'warning', fail: 'danger', manual: 'info', unknown: 'quiet' }
const STATUS_ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle, manual: Hand, unknown: HelpCircle }
const STATUS_ORDER = ['fail', 'warn', 'manual', 'unknown', 'pass']
const DEFAULT_ATTEST_DAYS = 90
const MAX_ATTEST_DAYS = 400

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDay(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)
}

function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>{STATUS_LABEL[status] || status}</Badge>
}

/* ── evidence pack PDF ────────────────────────────────────────────────────── */

async function renderEvidencePackPdf({ results, readiness, framework, failed, attestations, generatedAt }) {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const fwLabel = FRAMEWORKS.find((f) => f.value === framework)?.label || 'All'
  doc.setFontSize(16)
  doc.text('Compliance evidence pack', 14, 16)
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(`Framework: ${fwLabel} | Generated ${fmtWhen(generatedAt)} | Tyre Pulse Compliance Center`, 14, 22)
  doc.setTextColor(20)
  doc.setFontSize(11)
  const c = readiness.counts
  doc.text(`Readiness score: ${readiness.score === null ? 'N/A' : `${readiness.score} of 100`}  (coverage ${readiness.coveragePct ?? 0}% of ${readiness.total} controls)`, 14, 31)
  doc.setFontSize(9)
  doc.text(`Passing ${c.pass} | Needs attention ${c.warn} | Failing ${c.fail} | Needs attestation ${c.manual} | Could not check ${c.unknown}`, 14, 37)
  let y = 42
  if (failed.length) {
    doc.setTextColor(160, 60, 0)
    doc.text(`Evidence sources that could not be loaded: ${failed.map((f) => f.label).join(', ')}. Their controls are marked Could not check.`, 14, y, { maxWidth: 268 })
    doc.setTextColor(20)
    y += 8
  }
  const rows = evidencePackRows(results, generatedAt)
  autoTable(doc, {
    startY: y,
    head: [EVIDENCE_HEADERS.slice(0, 8)],
    body: rows.map((r) => EVIDENCE_COLUMNS.slice(0, 8).map((k) => r[k])),
    styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [31, 41, 55], textColor: 255 },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 22 }, 2: { cellWidth: 18 }, 3: { cellWidth: 22 }, 4: { cellWidth: 38 }, 5: { cellWidth: 22 }, 6: { cellWidth: 90 }, 7: { cellWidth: 35 } },
    margin: { left: 10, right: 10 },
  })
  const live = attestations.filter((a) => !a.withdrawn_at)
  doc.addPage()
  doc.setFontSize(12)
  doc.text('Manual attestations', 14, 16)
  autoTable(doc, {
    startY: 21,
    head: [['Control', 'Note', 'Attested by', 'Attested', 'Expires', 'State']],
    body: live.length
      ? live.map((a) => [a.control_id, a.note, a.attested_by_email || 'N/A', fmtDay(a.attested_at), fmtDay(a.expires_at),
        new Date(a.expires_at).getTime() > Date.now() ? 'Active' : 'Expired'])
      : [['N/A', 'No attestations recorded', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
    headStyles: { fillColor: [31, 41, 55], textColor: 255 },
    columnStyles: { 1: { cellWidth: 120 } },
    margin: { left: 10, right: 10 },
  })
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.width - 30, doc.internal.pageSize.height - 6)
  }
  doc.save(`${reportFileName('Compliance Evidence Pack', fwLabel, generatedAt.slice(0, 10))}.pdf`)
}

/* ── control drawer ───────────────────────────────────────────────────────── */

function ControlDrawer({ control, evidence, attestations, onClose, onChanged }) {
  const [note, setNote] = useState('')
  const [expires, setExpires] = useState(isoDay(DEFAULT_ATTEST_DAYS))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => { setNote(''); setReason(''); setErr(null); setMsg(null); setExpires(isoDay(DEFAULT_ATTEST_DAYS)) }, [control?.id])

  if (!control) return null
  const current = control.manual ? activeAttestation(attestations, control.id) : null
  const history = attestations.filter((a) => a.control_id === control.id)

  async function submitAttest() {
    setBusy(true); setErr(null); setMsg(null)
    try {
      await attestControl(control.id, note, `${expires}T23:59:59Z`)
      setMsg('Attestation recorded.')
      setNote('')
      await onChanged()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not record the attestation.'))
    } finally { setBusy(false) }
  }

  async function submitWithdraw() {
    if (!current) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      await withdrawAttestation(current.id, reason)
      setMsg('Attestation withdrawn.')
      setReason('')
      await onChanged()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not withdraw the attestation.'))
    } finally { setBusy(false) }
  }

  return (
    <Modal open={!!control} onClose={onClose} width="max-w-3xl"
      title={`${control.id}: ${control.title}`}
      subtitle={`${control.domain} | SOC 2 ${control.soc2.join(', ') || 'N/A'} | ISO 27001 ${control.iso.join(', ') || 'N/A'}`}>
      <div className="space-y-4 text-xs">
        <div className="flex items-center gap-2"><StatusBadge status={control.status} />{control.manual && <Badge tone="info" icon={Hand}>Manual control</Badge>}</div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">What this control means</p>
          <p className="text-gray-300">{control.description}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Live evidence</p>
          <p className="text-gray-200">{control.detail || 'N/A'}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Evidence references</p>
          {control.evidenceRefs.length
            ? <div className="flex flex-wrap gap-1.5">{control.evidenceRefs.map((r) => <Code key={r}>{r}</Code>)}</div>
            : <p className="text-gray-500">None recorded for this result.</p>}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Sources this control reads</p>
          <div className="flex flex-wrap gap-1.5">
            {control.sources.map((s) => {
              const st = evidence?.[s]
              return <Badge key={s} tone={st?.ok ? 'good' : 'danger'}>{SOURCE_LABEL[s] || s}: {st?.ok ? 'loaded' : 'not loaded'}</Badge>
            })}
          </div>
        </div>

        {control.manual && (
          <Panel>
            <PanelHeader icon={Stamp} title="Attestation"
              subtitle="Name the evidence (a ticket, a document, a dashboard screenshot) and when it must be checked again." />
            {current ? (
              <div className="space-y-2">
                <p className="text-gray-300">Active: attested by {current.attested_by_email || 'a super admin'} on {fmtDay(current.attested_at)}, expires {fmtDay(current.expires_at)}.</p>
                <p className="text-gray-400">Note: {current.note}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex-1 min-w-[220px]">
                    <span className="block text-[11px] text-gray-500 mb-1">Reason to withdraw</span>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200" />
                  </label>
                  <Btn icon={Undo2} onClick={submitWithdraw} busy={busy} disabled={reason.trim().length < 3}>Withdraw</Btn>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block">
                  <span className="block text-[11px] text-gray-500 mb-1">Evidence note</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200" />
                </label>
                <div className="flex flex-wrap items-end gap-2">
                  <label>
                    <span className="block text-[11px] text-gray-500 mb-1">Expires on</span>
                    <input type="date" value={expires} min={isoDay(1)} max={isoDay(MAX_ATTEST_DAYS - 1)}
                      onChange={(e) => setExpires(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200" />
                  </label>
                  <Btn variant="primary" icon={Stamp} onClick={submitAttest} busy={busy}
                    disabled={note.trim().length < 3 || !expires}>Attest control</Btn>
                </div>
              </div>
            )}
            {history.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-2">{history.length} attestation{history.length === 1 ? '' : 's'} on record for this control.</p>
            )}
          </Panel>
        )}
        {err && <ErrorState message={err} />}
        {msg && <Note tone="accent" icon={CheckCircle2}>{msg}</Note>}
      </div>
    </Modal>
  )
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function ConsoleCompliance() {
  const theme = useChartTheme()
  const [evidence, setEvidence] = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [framework, setFramework] = useState('all')
  const [statusFilter, setStatusFilter] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)
  const [exporting, setExporting] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const ev = await loadComplianceEvidence()
      setEvidence(ev)
      setLoadedAt(new Date().toISOString())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load compliance evidence.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const allResults = useMemo(() => (evidence ? evaluateControls(evidence) : []), [evidence])
  const fwResults = useMemo(() => filterByFramework(allResults, framework), [allResults, framework])
  const readiness = useMemo(() => readinessScore(fwResults), [fwResults])
  const failed = useMemo(() => (evidence ? failedSources(evidence) : []), [evidence])
  const attestations = useMemo(() => (evidence?.attestations?.ok ? evidence.attestations.data : []), [evidence])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sortResults(fwResults.filter((r) =>
      (!statusFilter || r.status === statusFilter)
      && (!domainFilter || r.domain === domainFilter)
      && (!q || [r.id, r.title, r.domain, r.detail, ...r.soc2, ...r.iso].join(' ').toLowerCase().includes(q))))
  }, [fwResults, statusFilter, domainFilter, search])

  const shareParts = useMemo(() => {
    const color = { pass: STATUS[theme].good, warn: STATUS[theme].medium, fail: STATUS[theme].critical, manual: STATUS[theme].low, unknown: theme === 'light' ? '#9ca3af' : '#4b5563' }
    return STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], value: readiness.counts[s] || 0, color: color[s] }))
      .filter((p) => p.value > 0)
  }, [readiness, theme])

  const domainBars = useMemo(() => domainSummary(fwResults).map((d) => ({
    label: d.domain, value: d.passPct,
    color: d.fail ? STATUS[theme].critical : d.warn || d.manual ? STATUS[theme].medium : STATUS[theme].good,
  })), [fwResults, theme])

  const domainOptions = useMemo(() => [...new Set(fwResults.map((r) => r.domain))].sort().map((d) => ({ value: d, label: d })), [fwResults])
  const openControl = allResults.find((r) => r.id === openId) || null

  async function exportPdf() {
    setExporting('pdf'); setNotice(null)
    try {
      await renderEvidencePackPdf({ results: fwResults, readiness, framework, failed, attestations, generatedAt: loadedAt || new Date().toISOString() })
    } catch (e) {
      setNotice({ tone: 'danger', text: toUserMessage(e, 'Could not build the evidence pack PDF.') })
    } finally { setExporting(null) }
  }

  async function exportExcel() {
    setExporting('xlsx'); setNotice(null)
    try {
      const fwLabel = FRAMEWORKS.find((f) => f.value === framework)?.label || 'All'
      await exportToExcel(evidencePackRows(fwResults, loadedAt || new Date().toISOString()), EVIDENCE_COLUMNS, EVIDENCE_HEADERS,
        reportFileName('Compliance Evidence Pack', fwLabel, (loadedAt || new Date().toISOString()).slice(0, 10)), 'Controls')
    } catch (e) {
      setNotice({ tone: 'danger', text: toUserMessage(e, 'Could not build the evidence pack spreadsheet.') })
    } finally { setExporting(null) }
  }

  const manualControls = CONTROLS.filter((c) => c.manual)
  const fwOptions = FRAMEWORKS.map((f) => ({ key: f.value, label: f.label, count: filterByFramework(allResults, f.value).length }))

  if (loading && !evidence) return <div className="space-y-5 max-w-7xl"><LoadingState label="Gathering compliance evidence" rows={6} /></div>
  if (error && !evidence) return <div className="space-y-5 max-w-7xl"><ErrorState message={error} onRetry={load} /></div>

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <ClipboardCheck size={18} className="text-orange-400" /> Compliance Center
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {CONTROLS.length} controls mapped to SOC 2 and ISO 27001 Annex A, each read from live evidence. Last gathered {fmtWhen(loadedAt)}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn icon={FileSpreadsheet} onClick={exportExcel} busy={exporting === 'xlsx'} disabled={!fwResults.length}>Excel</Btn>
          <Btn icon={FileDown} onClick={exportPdf} busy={exporting === 'pdf'} disabled={!fwResults.length}>Evidence pack PDF</Btn>
          <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
        </div>
      </header>

      {notice && <Note tone={notice.tone} icon={Info}>{notice.text}</Note>}
      {error && evidence && <ErrorState message={error} onRetry={load} />}
      {failed.length > 0 && (
        <Note tone="warning" icon={AlertTriangle}>
          {failed.length} evidence source{failed.length === 1 ? '' : 's'} could not be loaded: {failed.map((f) => f.label).join(', ')}.
          Controls that read {failed.length === 1 ? 'it' : 'them'} show Could not check and are left out of the score.
        </Note>
      )}

      <Toolbar>
        <Segmented options={fwOptions} value={framework} onChange={setFramework} ariaLabel="Framework" />
      </Toolbar>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="flex flex-col justify-center gap-2">
          <ScoreRing score={readiness.score} label="Readiness" />
          <p className="text-[11px] text-gray-500">
            Measured {readiness.evaluated} of {readiness.total} controls ({readiness.coveragePct ?? 0}% coverage).
            Manual controls count as not yet evidenced until attested.
          </p>
        </Panel>
        <Panel>
          <PanelHeader icon={PieChart} title="Control status" subtitle="Share of controls in each state." />
          <ShareChart parts={shareParts} height={150}
            center={{ value: readiness.counts.pass, label: 'passing' }}
            summary={shareParts.map((p) => `${p.label} ${p.value}`).join(', ')} />
        </Panel>
        <Panel>
          <PanelHeader icon={Layers} title="Passing by domain" subtitle="Percent of each domain's controls passing." />
          <BarsChart bars={domainBars} valueFormat={(v) => `${v}%`}
            summary={domainBars.map((b) => `${b.label} ${b.value} percent`).join(', ')}
            emptyText="No domain has a passing control yet." />
        </Panel>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STATUS_ORDER.map((s) => (
          <StatTile key={s} label={STATUS_LABEL[s]} value={readiness.counts[s] ?? 0} icon={STATUS_ICON[s]}
            tone={s === 'pass' ? 'good' : s === 'fail' ? 'danger' : s === 'warn' ? 'warning' : 'muted'}
            active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)} />
        ))}
      </div>

      <Panel flush>
        <div className="p-4 pb-3">
          <PanelHeader icon={ClipboardCheck} title="Controls"
            subtitle={`${visible.length} of ${fwResults.length} shown. Click a control for its evidence.`} />
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search control, clause or evidence" className="w-72" />
            <Select value={statusFilter} onChange={setStatusFilter} placeholder="All statuses" className="w-44"
              options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            <Select value={domainFilter} onChange={setDomainFilter} placeholder="All domains" className="w-44" options={domainOptions} />
          </Toolbar>
        </div>
        {visible.length ? (
          <Table className="border-0 rounded-none border-t">
            <THead>
              <Th>Control</Th><Th>Domain</Th><Th>SOC 2</Th><Th>ISO 27001</Th><Th>Status</Th><Th>Evidence</Th>
            </THead>
            <tbody>
              {visible.map((r) => (
                <Tr key={r.id} onClick={() => setOpenId(r.id)}>
                  <Td>
                    <div className="text-gray-200">{r.title}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{r.id}</div>
                  </Td>
                  <Td><span className="text-gray-400">{r.domain}</span></Td>
                  <Td nowrap><span className="text-gray-400">{r.soc2.join(', ') || 'N/A'}</span></Td>
                  <Td nowrap><span className="text-gray-400">{r.iso.join(', ') || 'N/A'}</span></Td>
                  <Td nowrap><StatusBadge status={r.status} /></Td>
                  <Td><span className="text-gray-400 line-clamp-2">{r.detail}</span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No controls match" reason="No control in this framework matches the current search and filters." />
        )}
      </Panel>

      <Panel flush>
        <div className="p-4 pb-3">
          <PanelHeader icon={Stamp} title="Manual attestations"
            subtitle="Controls that cannot be read from the database. Each attestation needs a note and expires, so it cannot stay green forever." />
        </div>
        {!evidence?.attestations?.ok ? (
          <div className="px-4 pb-4"><ErrorState message={evidence?.attestations?.error || 'Attestations could not be loaded.'} onRetry={load} /></div>
        ) : (
          <Table className="border-0 rounded-none border-t">
            <THead><Th>Control</Th><Th>Status</Th><Th>Attested by</Th><Th>Expires</Th><Th>Note</Th><Th align="right">Action</Th></THead>
            <tbody>
              {manualControls.map((c) => {
                const res = allResults.find((r) => r.id === c.id)
                const a = activeAttestation(attestations, c.id)
                return (
                  <Tr key={c.id}>
                    <Td><div className="text-gray-200">{c.title}</div><div className="text-[10px] text-gray-500 font-mono">{c.id}</div></Td>
                    <Td nowrap>{res && <StatusBadge status={res.status} />}</Td>
                    <Td><span className="text-gray-400">{a ? (a.attested_by_email || 'Super admin') : 'N/A'}</span></Td>
                    <Td nowrap><span className="text-gray-400">{a ? fmtDay(a.expires_at) : 'N/A'}</span></Td>
                    <Td><span className="text-gray-400 line-clamp-2">{a ? a.note : 'Not attested'}</span></Td>
                    <Td align="right" nowrap><Btn size="xs" icon={Stamp} onClick={() => setOpenId(c.id)}>{a ? 'Review' : 'Attest'}</Btn></Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <ControlDrawer control={openControl} evidence={evidence} attestations={attestations}
        onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  )
}
