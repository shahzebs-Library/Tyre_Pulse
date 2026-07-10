import React from 'react'
import {
  CheckCircle2, Clock, Eye, XCircle, Undo2, Ban, HelpCircle,
} from 'lucide-react'

/**
 * ApprovalStatusBadge — renders a themed pill for a workflow status.
 *
 * Supports the six spec statuses (case-insensitive); unknown → neutral.
 *   approved  🟢 green   · pending  🟡 amber
 *   in_review 🔵 blue    · rejected 🔴 red
 *   returned  🟠 orange  · cancelled ⚫ gray
 *
 * Props:
 *   status - one of approved | pending | in_review | rejected | returned | cancelled
 */

const STATUS_META = {
  approved: {
    label: 'Approved',
    icon: CheckCircle2,
    className: 'bg-green-900/40 text-green-300 border-green-700/50',
  },
  pending: {
    label: 'Pending',
    icon: Clock,
    className: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  },
  in_review: {
    label: 'In Review',
    icon: Eye,
    className: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  },
  rejected: {
    label: 'Rejected',
    icon: XCircle,
    className: 'bg-red-900/40 text-red-300 border-red-700/50',
  },
  returned: {
    label: 'Returned for Correction',
    icon: Undo2,
    className: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
  },
  cancelled: {
    label: 'Cancelled',
    icon: Ban,
    className: 'bg-gray-800/60 text-gray-400 border-gray-600/50',
  },
}

const UNKNOWN_META = {
  label: 'Unknown',
  icon: HelpCircle,
  className: 'bg-gray-800/60 text-gray-400 border-gray-600/50',
}

/** Normalise a raw status string to a canonical key. */
export function normalizeStatus(status) {
  if (!status) return ''
  return String(status).trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export default function ApprovalStatusBadge({ status }) {
  const key = normalizeStatus(status)
  const known = Object.prototype.hasOwnProperty.call(STATUS_META, key)
  const meta = known ? STATUS_META[key] : UNKNOWN_META
  const Icon = meta.icon
  const label = !known && status ? String(status) : meta.label

  return (
    <span
      role="status"
      data-status={known ? key : 'unknown'}
      title={label}
      className={`badge inline-flex items-center gap-1.5 border font-medium ${meta.className}`}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  )
}
