import React from 'react'
import {
  CheckCircle2, XCircle, Undo2, Ban, Clock, PlayCircle, ArrowUpCircle,
  MapPin, MessageSquare, PenLine, History,
} from 'lucide-react'
import { formatDateTime } from '../../lib/formatters'

/**
 * ApprovalTrail — immutable vertical timeline of workflow step events.
 *
 * Display-only. Nothing here is editable or deletable — it renders the append-only
 * audit history with the full digital signature block per event.
 *
 * Props:
 *   events - array of {
 *     action, step_name, actor_name, created_at, comment,
 *     printed_name, signature_data, gps, photo_urls
 *   }
 *   loading - optional; renders skeletons
 */

const ACTION_META = {
  approved:  { label: 'Approved',              icon: CheckCircle2,   dot: 'bg-green-600 border-green-400',  text: 'text-green-300' },
  rejected:  { label: 'Rejected',              icon: XCircle,        dot: 'bg-red-600 border-red-400',      text: 'text-red-300' },
  returned:  { label: 'Returned for Correction', icon: Undo2,        dot: 'bg-orange-600 border-orange-400', text: 'text-orange-300' },
  cancelled: { label: 'Cancelled',             icon: Ban,            dot: 'bg-gray-600 border-gray-400',    text: 'text-gray-300' },
  started:   { label: 'Started',               icon: PlayCircle,     dot: 'bg-blue-600 border-blue-400',    text: 'text-blue-300' },
  escalated: { label: 'Escalated',             icon: ArrowUpCircle,  dot: 'bg-amber-600 border-amber-400',  text: 'text-amber-300' },
  pending:   { label: 'Pending',               icon: Clock,          dot: 'bg-amber-600 border-amber-400',  text: 'text-amber-300' },
}

const UNKNOWN_ACTION = { label: 'Event', icon: History, dot: 'bg-gray-600 border-gray-400', text: 'text-gray-300' }

function metaFor(action) {
  const key = String(action || '').trim().toLowerCase()
  return ACTION_META[key] || { ...UNKNOWN_ACTION, label: action ? String(action) : 'Event' }
}

function TrailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="h-7 w-7 rounded-full bg-gray-800/60" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 rounded bg-gray-800/60" />
            <div className="h-3 w-24 rounded bg-gray-800/40" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center"
      style={{ borderColor: 'var(--border-dim)', color: 'var(--text-primary)' }}
    >
      <History size={22} className="text-gray-500" />
      <p className="text-sm font-medium">No approval history yet</p>
      <p className="text-xs text-gray-500">Actions will appear here as the document moves through the workflow.</p>
    </div>
  )
}

function SignatureBlock({ event }) {
  const meta = metaFor(event.action)
  const gps = event.gps && (event.gps.lat != null || event.gps.lng != null) ? event.gps : null
  const photos = Array.isArray(event.photo_urls) ? event.photo_urls.filter(Boolean) : []

  return (
    <div
      className="rounded-xl border p-3 space-y-2.5"
      style={{ borderColor: 'var(--border-dim)', background: 'var(--surface-1)', color: 'var(--text-primary)' }}
    >
      {/* Header line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`text-sm font-semibold ${meta.text}`}>{meta.label}</span>
        {event.step_name && (
          <span className="text-xs text-gray-500">· {event.step_name}</span>
        )}
      </div>

      {/* Actor / printed name */}
      <div className="text-xs text-gray-400">
        By <span className="font-medium text-gray-200">{event.actor_name || 'Unknown'}</span>
        {event.printed_name && event.printed_name !== event.actor_name && (
          <span> · Printed: <span className="text-gray-200">{event.printed_name}</span></span>
        )}
      </div>

      {/* Signature image */}
      {event.signature_data && (
        <div className="flex items-center gap-2">
          <PenLine size={13} className="text-gray-500" />
          <img
            src={event.signature_data}
            alt={`Signature by ${event.printed_name || event.actor_name || 'approver'}`}
            className="h-14 w-auto rounded border"
            style={{ borderColor: 'var(--border-dim)', background: '#fff' }}
          />
        </div>
      )}

      {/* Date + time */}
      {event.created_at && (
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Clock size={12} /> {formatDateTime(event.created_at)}
        </div>
      )}

      {/* GPS */}
      {gps && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <MapPin size={12} className="text-gray-500" />
          {Number(gps.lat).toFixed(5)}, {Number(gps.lng).toFixed(5)}
          {gps.accuracy != null && <span className="text-gray-600"> · ±{Math.round(gps.accuracy)}m</span>}
        </div>
      )}

      {/* Comment */}
      {event.comment && (
        <div className="flex items-start gap-1.5 text-xs">
          <MessageSquare size={12} className="mt-0.5 shrink-0 text-gray-500" />
          <p className="text-gray-300 whitespace-pre-wrap break-words">{event.comment}</p>
        </div>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((url, i) => (
            <img
              key={`${url}-${i}`}
              src={url}
              alt={`Attachment ${i + 1}`}
              className="h-14 w-14 rounded-lg border object-cover"
              style={{ borderColor: 'var(--border-dim)' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ApprovalTrail({ events, loading = false }) {
  if (loading) return <TrailSkeleton />

  const list = Array.isArray(events) ? events : []
  if (list.length === 0) return <EmptyState />

  return (
    <ol className="relative space-y-4">
      {/* connecting spine */}
      <span
        aria-hidden="true"
        className="absolute left-[13px] top-1 bottom-1 w-px"
        style={{ background: 'var(--border-dim)' }}
      />
      {list.map((event, idx) => {
        const meta = metaFor(event.action)
        const Icon = meta.icon
        return (
          <li key={event.id ?? `${event.action}-${event.created_at}-${idx}`} className="relative flex gap-3 pl-0">
            <span
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-white ${meta.dot}`}
            >
              <Icon size={14} aria-hidden="true" />
            </span>
            <div className="flex-1 min-w-0 pb-1">
              <SignatureBlock event={event} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
