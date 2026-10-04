/**
 * WebhookDeliveries - the webhooks panel of the API Monitor (console
 * /console/api-keys?tab=webhooks). Lists every webhook with its delivery counts
 * and the recent deliveries across companies, with Resend on a single
 * delivery (reason required, audited, see lib/api/webhookAdmin.js).
 *
 * Honest limits, stated on screen:
 *   - a webhook that turned itself off after repeated failures does not alert
 *     anyone yet;
 *   - Resend does not switch a webhook back on, so a resend on an off webhook
 *     waits until it is turned on (webhooks are managed in Integrations).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Webhook, RotateCcw, Info, AlertTriangle } from 'lucide-react'
import {
  Panel, PanelHeader, Note, Badge, Btn, Segmented, Table, THead, Th, Tr, Td,
  LoadingState, EmptyState, ErrorState, ConfirmImpactDialog, StatTile,
} from '../../components/ui'
import {
  listWebhooksAdmin, listWebhookDeliveriesAdmin, resendWebhookDelivery, resendMessage, DELIVERY_STATUS_META,
} from '../../../lib/api/webhookAdmin'
import { toUserMessage } from '../../../lib/safeError'
import ExportButtons from '../shared/ExportButtons'

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function WebhookDeliveries() {
  const [state, setState] = useState({ loading: true, error: null, hooks: [], rows: [], total: null })
  const [status, setStatus] = useState('all')
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState(null)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const [hooks, list] = await Promise.all([
        listWebhooksAdmin(),
        listWebhookDeliveriesAdmin({ limit: 100, status: status === 'all' ? null : status }),
      ])
      setState({ loading: false, error: null, hooks, rows: list.rows, total: list.total })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: toUserMessage(e, 'Could not load webhooks.') }))
    }
  }, [status])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => state.hooks.reduce((acc, h) => ({
    delivered: acc.delivered + (Number(h.delivered) || 0),
    pending: acc.pending + (Number(h.pending) || 0),
    failed: acc.failed + (Number(h.failed) || 0),
    off: acc.off + (h.active ? 0 : 1),
  }), { delivered: 0, pending: 0, failed: 0, off: 0 }), [state.hooks])

  const doResend = async ({ reason }) => {
    setBusy(true); setDialogError(null)
    try {
      const res = await resendWebhookDelivery(target.id, reason)
      setFlash(resendMessage(res))
      setTarget(null)
      await load()
    } catch (e) {
      setDialogError(toUserMessage(e, 'The delivery could not be resent.'))
    } finally { setBusy(false) }
  }

  if (state.loading && !state.hooks.length && !state.rows.length) return <LoadingState label="Loading webhooks" rows={4} />
  if (state.error) return <ErrorState message={state.error} onRetry={load} />

  return (
    <div className="space-y-4">
      {flash && <Note icon={Info} tone="accent">{flash}</Note>}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatTile label="Webhooks" value={state.hooks.length} sub={`${counts.off} turned off`} tone={counts.off ? 'warning' : 'default'} />
        <StatTile label="Delivered" value={counts.delivered} tone={counts.delivered ? 'good' : 'default'} />
        <StatTile label="Waiting" value={counts.pending} tone={counts.pending ? 'warning' : 'default'} sub="will not send while the webhook is off" />
        <StatTile label="Failed" value={counts.failed} tone={counts.failed ? 'danger' : 'default'} sub="gave up after 6 tries" />
      </div>

      {counts.off > 0 && (
        <Note icon={AlertTriangle} tone="warning">
          {counts.off} {counts.off === 1 ? 'webhook has turned itself' : 'webhooks have turned themselves'} off after 20 failures in a row. No alert fires when this happens yet, so check this list after any change on the receiving side.
        </Note>
      )}

      <Panel flush>
        <div className="p-4 pb-3">
          <PanelHeader icon={Webhook} title="Webhooks" subtitle="Only the address host is shown. The signing secret never leaves the database."
            actions={<span className="text-[11px] text-gray-500">Edit, turn on or delete a webhook in the main app, Integrations page.</span>} />
        </div>
        {state.hooks.length === 0 ? (
          <div className="p-4 pt-0"><EmptyState icon={Webhook} title="No webhooks" reason="No company has set up a webhook." /></div>
        ) : (
          <Table className="border-0 rounded-none">
            <THead><Th>Webhook</Th><Th>Company</Th><Th>State</Th><Th align="right">Failures in a row</Th><Th align="right">Delivered</Th><Th align="right">Waiting</Th><Th align="right">Failed</Th></THead>
            <tbody>
              {state.hooks.map((h) => (
                <Tr key={h.id}>
                  <Td><div className="text-gray-200">{h.name}</div><div className="text-[11px] text-gray-500">{h.host || 'N/A'}</div></Td>
                  <Td><span className="text-gray-400">{h.organisation_name || 'N/A'}</span></Td>
                  <Td>{h.active ? <Badge tone="good">On</Badge> : <Badge tone="danger" title={h.disabled_reason || ''}>Off</Badge>}</Td>
                  <Td align="right"><span className="tabular-nums">{h.consecutive_failures ?? 'N/A'}</span></Td>
                  <Td align="right"><span className="tabular-nums">{h.delivered}</span></Td>
                  <Td align="right"><span className="tabular-nums">{h.pending}</span></Td>
                  <Td align="right"><span className="tabular-nums">{h.failed}</span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel flush>
        <div className="p-4 pb-3 space-y-3">
          <PanelHeader icon={RotateCcw} title="Recent deliveries"
            subtitle={state.total == null ? 'Newest first.' : `${state.rows.length} of ${state.total} shown, newest first.`}
            actions={<ExportButtons rows={state.rows} title="Webhook deliveries" columns={[
              { key: 'id', header: 'Delivery' },
              { key: 'subscription_name', header: 'Webhook' },
              { key: 'event_type', header: 'Event' },
              { key: 'status', header: 'State', value: (r) => DELIVERY_STATUS_META[r.status]?.label || r.status },
              { key: 'attempts', header: 'Tries' },
              { key: 'response_status', header: 'HTTP answer', value: (r) => r.response_status ?? 'N/A' },
              { key: 'last_error', header: 'Last error', value: (r) => r.last_error || '' },
              { key: 'created_at', header: 'Created', value: (r) => fmtWhen(r.created_at) },
            ]} />} />
          <Segmented ariaLabel="Filter deliveries" value={status} onChange={setStatus} options={[
            { key: 'all', label: 'All' }, { key: 'failed', label: 'Failed' }, { key: 'pending', label: 'Waiting' }, { key: 'delivered', label: 'Delivered' },
          ]} />
        </div>
        {state.rows.length === 0 ? (
          <div className="p-4 pt-0"><EmptyState title="No deliveries" reason={status === 'all' ? 'No webhook event has been queued yet.' : 'No delivery is in this state.'} /></div>
        ) : (
          <Table className="border-0 rounded-none">
            <THead><Th>When</Th><Th>Webhook</Th><Th>Event</Th><Th>State</Th><Th align="right">Tries</Th><Th>Answer</Th><Th align="right">Action</Th></THead>
            <tbody>
              {state.rows.map((r) => {
                const meta = DELIVERY_STATUS_META[r.status] || { label: r.status, tone: 'quiet' }
                return (
                  <Tr key={r.id}>
                    <Td nowrap><span className="text-gray-400 tabular-nums">{fmtWhen(r.created_at)}</span></Td>
                    <Td><span className="text-gray-300">{r.subscription_name || 'N/A'}</span></Td>
                    <Td><span className="font-mono text-[11px] text-gray-300">{r.event_type}</span></Td>
                    <Td><Badge tone={meta.tone}>{meta.label}</Badge></Td>
                    <Td align="right"><span className="tabular-nums">{r.attempts}</span></Td>
                    <Td><span className="text-gray-400 text-xs" title={r.last_error || ''}>{r.response_status ? `HTTP ${r.response_status}` : r.attempts ? 'No answer' : 'Not tried yet'}</span></Td>
                    <Td align="right">
                      {r.status === 'delivered' ? <span className="text-gray-500 text-xs">None</span> : (
                        <Btn size="xs" icon={RotateCcw} onClick={() => { setDialogError(null); setTarget(r) }}>Resend</Btn>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <ConfirmImpactDialog open={!!target} title="Resend this delivery" confirmLabel="Resend" requireReason busy={busy} error={dialogError}
        onCancel={() => setTarget(null)} onConfirm={doResend}
        impact={target ? {
          what: `Send delivery ${target.id} (${target.event_type}) to ${target.subscription_name || 'its webhook'} once more.`,
          change: 'The delivery goes back in the queue for one more try. Its earlier answer stays until the new try answers.',
          who: target.subscription_active
            ? 'Only the receiving system of this webhook.'
            : 'Nobody yet: this webhook is off, so the delivery waits until it is turned back on in the main app (Integrations).',
          undo: 'A sent delivery cannot be called back. The resend and your reason are written to the console audit trail.',
          tone: 'warning',
        } : null} />
    </div>
  )
}
