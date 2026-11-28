// Dispatcher core, kept pure so it can be unit-tested without Deno or a database.
import { renderEmail } from './render.ts'
import type { EmailProvider } from './provider.ts'
import type { Audience } from './templates.ts'

export type OutboxRow = {
  id: number; organisation_id: string | null; event_key: string; template_key: string; locale: string
  audience: Audience; to_address: string; entity_type: string | null; entity_id: string | null
  data: Record<string, unknown>; dedupe_key: string; attempts: number
}
export type Report = { id: number; outcome: 'sent' | 'dry_run' | 'transient' | 'permanent'; provider?: string; providerId?: string | null; error?: string; retryAfter?: number }

export type DispatchOptions = {
  mode: 'live' | 'dry_run'
  provider: EmailProvider | null
  appStoreUrl?: string | null
  baseUrl?: string | null
  /** Pause between sends; Resend allows 2 requests per second. */
  paceMs?: number
  sleep?: (ms: number) => Promise<void>
}

export async function dispatchRows(rows: OutboxRow[], opts: DispatchOptions): Promise<Report[]> {
  const out: Report[] = []
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)))
  const pace = opts.paceMs ?? 550
  let first = true
  for (const row of rows) {
    let rendered
    try {
      rendered = renderEmail({
        template: row.template_key, locale: row.locale, data: row.data, entityType: row.entity_type,
        entityId: row.entity_id, audience: row.audience, appStoreUrl: opts.appStoreUrl, baseUrl: opts.baseUrl,
      })
    } catch (err) {
      out.push({ id: row.id, outcome: 'permanent', error: `render: ${err instanceof Error ? err.message : 'failed'}` })
      continue
    }
    if (opts.mode !== 'live') { out.push({ id: row.id, outcome: 'dry_run' }); continue }
    if (!opts.provider) { out.push({ id: row.id, outcome: 'transient', error: 'no email provider configured', retryAfter: 3600 }); continue }
    if (!first) await sleep(pace)
    first = false
    const headers: Record<string, string> = { 'X-Entity-Ref-ID': row.dedupe_key.slice(0, 120) }
    const res = await opts.provider.send({
      to: row.to_address, subject: rendered.subject, html: rendered.html, text: rendered.text,
      idempotencyKey: `tp-${row.id}`, headers,
    })
    if (res.ok) out.push({ id: row.id, outcome: 'sent', provider: opts.provider.name, providerId: res.providerId })
    else out.push({ id: row.id, outcome: res.kind, provider: opts.provider.name, error: res.error, retryAfter: res.retryAfterSeconds })
  }
  return out
}
