/**
 * Typed offline commands - the Step 1 foundation that will replace the current
 * `recordQueue.ts` (which inserts into an ARBITRARY, client-chosen table:
 * `supabase.from(table).insert(payload)`). A mobile client must never decide
 * which table to write to. Instead it enqueues a typed *intent* that the Go API
 * validates, authorizes, and persists.
 *
 * NOT yet wired: screens keep using the existing queue until the mobile-sync
 * cutover (Step 2). See docs/ADR/0004-offline-mobile-sync.md.
 */

/** The closed set of write intents the mobile app may express. */
export type CommandType =
  | 'CreateInspection'
  | 'SubmitTyreChange'
  | 'CreateWorkOrder'
  | 'ReportIssue'
  | 'SubmitRCA'
  | 'UploadAttachment'

export type CommandStatus = 'pending' | 'in_flight' | 'synced' | 'failed'

/** Scope travels with every command so the server can enforce tenancy. */
export interface CommandScope {
  organisationId?: string
  siteId?: string
  country?: string
}

/**
 * An offline command envelope. `idempotencyKey` makes retries safe: the server
 * replays the original result instead of applying the action twice. `version`
 * (where relevant) enables optimistic-concurrency conflict detection.
 */
export interface OfflineCommand<T = unknown> {
  commandId: string          // client-generated UUID
  idempotencyKey: string     // sent as Idempotency-Key to the API
  type: CommandType
  endpoint: string           // API path, e.g. '/inspections'
  payload: T                 // validated server-side against the command schema
  scope: CommandScope
  createdAt: string          // ISO timestamp
  status: CommandStatus
  retryCount: number
  error?: string | null
  attachments?: string[]     // local file URIs pending upload, if any
}

/** Maps each command type to the API endpoint that handles it. */
export const COMMAND_ENDPOINTS: Record<CommandType, string> = {
  CreateInspection: '/inspections',
  SubmitTyreChange: '/tyre-changes',
  CreateWorkOrder:  '/work-orders',
  ReportIssue:      '/corrective-actions',
  SubmitRCA:        '/rca',
  UploadAttachment: '/uploads',
}

function uuid(): string {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Build a well-formed command envelope ready to enqueue. */
export function buildCommand<T>(
  type: CommandType,
  payload: T,
  scope: CommandScope = {},
  attachments: string[] = [],
): OfflineCommand<T> {
  const id = uuid()
  return {
    commandId: id,
    idempotencyKey: id,
    type,
    endpoint: COMMAND_ENDPOINTS[type],
    payload,
    scope,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
    error: null,
    attachments,
  }
}
