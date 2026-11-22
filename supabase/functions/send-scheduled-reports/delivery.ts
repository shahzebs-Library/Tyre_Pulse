// delivery.ts - one due schedule: render, send, log, advance (or back off).
//
// Extracted unchanged from the cron loop of index.ts so the same code path - and
// therefore the same retry behaviour - serves every report type, and so it can be
// tested without Deno. Behaviour:
//   * a rendered report that says shouldSend === false is skipped (no_alert);
//   * a successful send logs status 'sent' to report_send_log and advances next_run_at;
//   * any failure (render, provider, missing org / recipients / key) logs status
//     'failed' with the reason, marks the schedule failed and backs off ONE HOUR, so
//     the next cron run after that retries it (never every 15 minutes).
//   * attachments, when the renderer returns them, go in the Resend payload.

// deno-lint-ignore no-explicit-any
type Svc = any

export type Rendered = {
  subject: string
  html: string
  shouldSend?: boolean
  attachments?: Array<{ filename: string; content: string }>
}

export type DueSchedule = {
  id: string
  name: string
  report_type: string
  org_id: string | null
  recipients?: string[] | null
}

export const RETRY_BACKOFF_MS = 3_600_000

export async function deliverSchedule (args: {
  svc: Svc
  s: DueSchedule
  now: Date
  render: () => Promise<Rendered>
  fetchFn: typeof fetch
  resendKey: string | undefined
  fromEmail: string
  computeNextRun: () => string
  requireOrg: (org: string | null | undefined) => string
}): Promise<'sent' | 'skipped' | 'failed'> {
  const { svc, s, now } = args
  const recipients = (s.recipients ?? []).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
  try {
    args.requireOrg(s.org_id)
    if (!recipients.length) throw new Error('No valid recipients on the schedule')
    if (!args.resendKey) throw new Error('RESEND_API_KEY not configured for edge functions')
    const rendered = await args.render()
    if (rendered.shouldSend === false) {
      await svc.from('report_schedules')
        .update({ last_status: 'no_alert', last_error: null, next_run_at: args.computeNextRun(), updated_at: now.toISOString() })
        .eq('id', s.id)
      return 'skipped'
    }
    const payload: Record<string, unknown> = { from: args.fromEmail, to: recipients, subject: rendered.subject, html: rendered.html }
    if (rendered.attachments?.length) payload.attachments = rendered.attachments
    const res = await args.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${args.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
    await svc.from('report_schedules')
      .update({ last_sent_at: now.toISOString(), last_status: 'sent', last_error: null, next_run_at: args.computeNextRun(), updated_at: now.toISOString() })
      .eq('id', s.id)
    await svc.from('report_send_log').insert({
      schedule_id: s.id, schedule_name: s.name, report_type: s.report_type, recipients, status: 'sent',
    })
    return 'sent'
  } catch (e) {
    const errMsg = String((e as Error)?.message ?? e).slice(0, 500)
    await svc.from('report_schedules')
      .update({ last_status: 'failed', last_error: errMsg, next_run_at: new Date(now.getTime() + RETRY_BACKOFF_MS).toISOString(), updated_at: now.toISOString() })
      .eq('id', s.id)
    await svc.from('report_send_log').insert({
      schedule_id: s.id, schedule_name: s.name, report_type: s.report_type, recipients, status: 'failed', error: errMsg,
    })
    return 'failed'
  }
}
