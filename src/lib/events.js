/**
 * events.js — typed in-app event bus (roadmap #15: event-driven architecture).
 *
 * Pages publish typed business events at their mutation points; independent
 * consumers (monitoring breadcrumbs, outbound webhooks, future notifiers)
 * subscribe without the publisher knowing they exist — no module-to-module
 * coupling, no direct calls between features.
 *
 * Guarantees:
 *   • publish() NEVER throws and NEVER blocks the caller — dispatch is
 *     deferred with queueMicrotask, so a save handler returns before any
 *     consumer runs.
 *   • Each subscriber runs inside its own try/catch — one broken consumer
 *     can never break the others or the publisher.
 *   • Unknown event types are a console.warn + no-op (typo safety), never an
 *     error: publishing must always be safe to sprinkle into UI code.
 */

/**
 * Registry of every business event the app can publish.
 * `fields` documents the expected payload shape (informational — payloads are
 * not schema-enforced so emit points stay one-liners).
 */
export const EVENT_TYPES = Object.freeze({
  'inspection.completed': {
    label: 'Inspection completed',
    fields: 'asset_no, site, inspector, defects_count, inspection_id',
  },
  'workorder.created': {
    label: 'Work order created',
    fields: 'work_order_no, asset_no, work_type, priority, total_cost',
  },
  'workorder.status_changed': {
    label: 'Work order status changed',
    fields: 'id, work_order_no, from_status, to_status',
  },
  'workorder.deleted': {
    label: 'Work order deleted',
    fields: 'id | ids (bulk), work_order_no?',
  },
  'gatepass.issued': {
    label: 'Gate pass issued (cleared)',
    fields: 'asset_no, site, pass_date, inspection_id',
  },
  'gatepass.denied': {
    label: 'Gate pass denied',
    fields: 'asset_no, site, pass_date, denial_reason',
  },
  'accident.reported': {
    label: 'Accident reported',
    fields: 'asset_no, site, accident_date, severity',
  },
  'import.committed': {
    label: 'Data import committed',
    fields: 'batch_id, entity, row_count',
  },
  'import.reversed': {
    label: 'Data import reversed',
    fields: 'batch_id, entity, row_count',
  },
  'tyre.created': {
    label: 'Tyre created',
    fields: 'serial_no, brand, size, site',
  },
  'tyre.updated': {
    label: 'Tyre updated',
    fields: 'serial_no, changed_fields',
  },
})

const WILDCARD = '*'

// type (or '*') → Set<handler>
const subscribers = new Map()

function newEventId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Subscribe a handler to one event type, or to every event with `'*'`.
 * Returns an unsubscribe function. Handlers receive the full stamped event
 * `{ id, type, payload, occurred_at, actor? }`.
 *
 * @param {string} typeOrWildcard  a key of EVENT_TYPES, or '*'
 * @param {(event: object) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribe(typeOrWildcard, handler) {
  if (typeof handler !== 'function') return () => {}
  if (typeOrWildcard !== WILDCARD && !EVENT_TYPES[typeOrWildcard]) {
    console.warn(`[events] subscribe: unknown event type "${typeOrWildcard}" — handler will never fire.`)
  }
  let set = subscribers.get(typeOrWildcard)
  if (!set) {
    set = new Set()
    subscribers.set(typeOrWildcard, set)
  }
  set.add(handler)
  return () => { set.delete(handler) }
}

/**
 * Publish a typed business event. Fire-and-forget: validates the type,
 * stamps the envelope, and dispatches asynchronously to every subscriber
 * (exact-type + wildcard), each isolated in its own try/catch.
 *
 * @param {string} type    a key of EVENT_TYPES
 * @param {object} [payload]  event data (see EVENT_TYPES[type].fields)
 * @param {{ actor?: { id?: string, email?: string, role?: string } }} [options]
 * @returns {object|null} the stamped event (for tests/chaining), or null when
 *   the type is unknown.
 */
export function publish(type, payload = {}, options = undefined) {
  try {
    if (!EVENT_TYPES[type]) {
      console.warn(`[events] publish: unknown event type "${type}" — ignored. Register it in EVENT_TYPES.`)
      return null
    }
    const event = {
      id: newEventId(),
      type,
      payload: payload && typeof payload === 'object' ? payload : { value: payload },
      occurred_at: new Date().toISOString(),
    }
    if (options?.actor) event.actor = options.actor

    const handlers = [
      ...(subscribers.get(type) || []),
      ...(subscribers.get(WILDCARD) || []),
    ]
    // Always async: the publisher's save flow finishes before consumers run.
    queueMicrotask(() => {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (err) {
          // One bad consumer must never break the others.
          console.warn(`[events] subscriber failed for "${type}" (isolated):`, err?.message || err)
        }
      }
    })
    return event
  } catch (err) {
    console.warn('[events] publish failed (non-blocking):', err?.message || err)
    return null
  }
}

// ── Built-in consumers (wired once at module init) ───────────────────────────
// 1) Monitoring breadcrumb per event — addBreadcrumb is no-op safe without a
//    Sentry DSN, so this costs nothing when monitoring is off.
// 2) Outbound webhook dispatcher — loaded lazily so importing the bus never
//    drags in Supabase/network code (keeps publishers and tests lightweight).
import { addBreadcrumb } from './monitoring'

subscribe(WILDCARD, (event) => {
  addBreadcrumb('business-event', event.type, {
    event_id: event.id,
    occurred_at: event.occurred_at,
  })
})

subscribe(WILDCARD, (event) => {
  import('./webhooks')
    .then((m) => m.dispatchEvent(event))
    .catch(() => { /* webhook module unavailable — never break the bus */ })
})
