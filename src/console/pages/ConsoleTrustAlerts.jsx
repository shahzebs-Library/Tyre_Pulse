/**
 * ConsoleTrustAlerts.jsx - the data trust alert desk.
 *
 * The quality and reconciliation scans raise a breach when a number stops
 * being trustworthy. This page is where a person acknowledges each one and
 * marks it resolved, so a trust problem is never silently open.
 *
 * A scan is a deliberate press, not a background poll: running it here reruns
 * both scans and shows exactly how many alerts are open afterward.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BellRing, ShieldAlert, CheckCircle2, RefreshCw, Play, AlertTriangle, Clock,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Select, Toolbar,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState,
} from '../components/ui'
import { scanDataTrust, listTrustAlerts, ackTrustAlert } from '../../lib/api/lineageOps'
import { alertSummary, alertTone, ALERT_STATUSES } from '../../lib/lineageOps'
import { COUNTRIES } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'

const nf = new Intl.NumberFormat('en-US')

function fmtWhen(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const SOURCE_TONE = { quality: 'warning', reconciliation: 'info' }
const STATUS_TONE = { open: 'danger', ack: 'warning', resolved: 'good' }

const COUNTRY_OPTS = [{ value: 'all', label: 'All countries' }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]
const STATUS_OPTS = [{ value: 'all', label: 'All statuses' }, ...ALERT_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]

export default function ConsoleTrustAlerts() {
  const [state, setState] = useState({ loading: true, error: null, rows: [] })
  const [country, setCountry] = useState('all')
  const [status, setStatus] = useState('all')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState('')     // `${id}:${action}`
  const [flash, setFlash] = useState(null) // {tone, text}

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const rows = await listTrustAlerts({ status })
      setState({ loading: false, error: null, rows })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), rows: [] })
    }
  }, [status])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => alertSummary(state.rows), [state.rows])

  const runScan = async () => {
    setScanning(true)
    setFlash(null)
    try {
      const res = await scanDataTrust(country === 'all' ? null : country)
      const open = Number(res?.open_alerts ?? 0)
      const fresh = Number(res?.new_quality_alerts ?? 0)
      setFlash({ tone: 'ok', text: `Scan complete: ${nf.format(open)} open alerts, ${nf.format(fresh)} new.` })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setScanning(false)
    }
  }

  const decide = async (row, next) => {
    setBusy(`${row.id}:${next}`)
    try {
      await ackTrustAlert(row.id, next)
      setFlash({ tone: 'ok', text: `Alert ${next === 'resolved' ? 'resolved' : 'acknowledged'}.` })
      await load()
    } catch (e) {
      setFlash({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          icon={BellRing}
          title="Data Trust Alerts"
          subtitle="Breaches raised from the quality and reconciliation scans - acknowledge or resolve each."
          actions={(
            <Toolbar>
              <Select value={country} onChange={setCountry} options={COUNTRY_OPTS} className="w-40" />
              <Btn icon={Play} variant="primary" onClick={runScan} busy={scanning}>Run scan now</Btn>
              <Btn icon={RefreshCw} onClick={load}>Refresh</Btn>
            </Toolbar>
          )}
        />

        {flash && (
          <div className="px-4 pb-3">
            <Note icon={flash.tone === 'ok' ? CheckCircle2 : AlertTriangle} tone={flash.tone === 'ok' ? 'accent' : 'danger'}>
              {flash.text}
            </Note>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 pt-0">
          <StatTile label="Open" value={nf.format(summary.open)} tone={summary.open ? 'danger' : 'good'} icon={ShieldAlert} />
          <StatTile label="Quality" value={nf.format(summary.quality)} tone={summary.quality ? 'warning' : 'default'} />
          <StatTile label="Reconciliation" value={nf.format(summary.reconciliation)} tone={summary.reconciliation ? 'warning' : 'default'} />
          <StatTile label="Total" value={nf.format(summary.total)} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          icon={ShieldAlert}
          title="Raised alerts"
          subtitle="An open or acknowledged alert can be acknowledged or resolved. Resolving records that the breach was handled."
          actions={<Select value={status} onChange={setStatus} options={STATUS_OPTS} className="w-40" />}
        />

        {state.loading ? (
          <LoadingState label="Reading trust alerts" rows={5} />
        ) : state.error ? (
          <div className="p-4 pt-0"><ErrorState message={state.error} onRetry={load} /></div>
        ) : state.rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No alerts"
            reason={status === 'all'
              ? 'Nothing has been raised. Run a scan to check the quality and reconciliation rules now.'
              : `No alerts with status "${status}". Change the filter or run a scan.`}
            action={<Btn icon={Play} variant="primary" onClick={runScan} busy={scanning}>Run scan now</Btn>}
          />
        ) : (
          <Table>
            <THead>
              <Th>Source</Th>
              <Th>Ref</Th>
              <Th>Severity</Th>
              <Th>Country</Th>
              <Th>Message</Th>
              <Th>Status</Th>
              <Th>Raised</Th>
              <Th align="right">Actions</Th>
            </THead>
            <tbody>
              {state.rows.map((r) => {
                const acting = busy.startsWith(`${r.id}:`)
                const canAct = r.status === 'open' || r.status === 'ack'
                return (
                  <Tr key={r.id} tone={r.status === 'open' ? 'warning' : undefined}>
                    <Td>
                      <Badge tone={SOURCE_TONE[r.source] || 'default'}>
                        {r.source === 'reconciliation' ? 'Reconciliation' : r.source === 'quality' ? 'Quality' : (r.source || 'N/A')}
                      </Badge>
                    </Td>
                    <Td nowrap><span className="font-mono text-gray-400">{r.ref_key || 'N/A'}</span></Td>
                    <Td><Badge tone={alertTone(r.severity)}>{r.severity || 'N/A'}</Badge></Td>
                    <Td>{r.country || 'All'}</Td>
                    <Td className="text-gray-300">{r.message || 'N/A'}</Td>
                    <Td><Badge tone={STATUS_TONE[r.status] || 'default'}>{r.status || 'N/A'}</Badge></Td>
                    <Td nowrap>
                      <span className="inline-flex items-center gap-1 text-gray-500">
                        <Clock size={11} />{fmtWhen(r.created_at)}
                      </span>
                    </Td>
                    <Td align="right">
                      {canAct ? (
                        <Toolbar className="justify-end">
                          {r.status === 'open' && (
                            <Btn
                              onClick={() => decide(r, 'ack')}
                              busy={busy === `${r.id}:ack`}
                              disabled={acting}
                            >
                              Ack
                            </Btn>
                          )}
                          <Btn
                            variant="good"
                            icon={CheckCircle2}
                            onClick={() => decide(r, 'resolved')}
                            busy={busy === `${r.id}:resolved`}
                            disabled={acting}
                          >
                            Resolve
                          </Btn>
                        </Toolbar>
                      ) : (
                        <span className="text-gray-600">Done</span>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
