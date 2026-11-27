/**
 * Driver Concerns (employee grievance): the pure rules.
 *
 * MIRRORS supabase/migrations/20261127191000_driver_concerns.sql
 * (private.dc_valid_subtype, dc_next_level, dc_level_rank, the command guards)
 * and the Flutter lib/features/driver_concerns/domain/driver_concern_rules.dart.
 * Change all three together. The server is the boundary: these rules only
 * decide what the screen OFFERS, never what is allowed.
 */

export const CONCERN_LANGS = ['en', 'ar', 'ur', 'hi', 'bn', 'ps', 'ne', 'tl']

export const LANG_NAMES = {
  en: 'English', ar: 'العربية', ur: 'اردو', hi: 'हिन्दी',
  bn: 'বাংলা', ps: 'پښتو', ne: 'नेपाली', tl: 'Tagalog',
}

/** Category -> subtypes. `icon` is a lucide-react component name. */
export const CATEGORIES = [
  { key: 'pay', icon: 'Wallet', subtypes: ['salary_late', 'salary_short', 'overtime_unpaid', 'wrong_deduction', 'allowance_missing', 'final_settlement'] },
  { key: 'housing', icon: 'Home', subtypes: ['accommodation', 'food', 'transport', 'utilities'] },
  { key: 'leave', icon: 'Plane', subtypes: ['annual_leave', 'ticket', 'emergency_leave', 'sick_leave'] },
  { key: 'documents', icon: 'FileText', subtypes: ['iqama_expiry', 'licence_renewal', 'passport_held', 'contract_visa', 'medical_card'] },
  { key: 'work', icon: 'Clock', subtypes: ['excess_hours', 'roster', 'route', 'workload'] },
  { key: 'safety', icon: 'ShieldAlert', subtypes: ['unsafe_vehicle', 'unsafe_site', 'injury', 'ppe'] },
  { key: 'treatment', icon: 'UserX', subtypes: ['supervisor_conduct', 'harassment', 'discrimination', 'threats'], sensitive: true },
  { key: 'other', icon: 'HelpCircle', subtypes: ['other'] },
]

const BY_KEY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]))

export function isValidSubtype(category, subtype) {
  return Boolean(BY_KEY[category]?.subtypes.includes(subtype))
}

/** Treatment is sensitive by RULE, server-side too. Nobody lowers it. */
export function isSensitiveCategory(category) {
  return category === 'treatment'
}

export const LEVELS = ['supervisor', 'incharge', 'manager', 'hr']

export function levelRank(level) {
  return { supervisor: 1, incharge: 2, hr: 2, manager: 3 }[level] ?? 99
}

export function nextLevel(level, sensitive) {
  if (sensitive) return level === 'hr' ? 'manager' : null
  if (level === 'supervisor') return 'incharge'
  if (level === 'incharge') return 'manager'
  return null
}

export const STATUSES = ['open', 'in_review', 'proposed', 'outcome_shared', 'accepted', 'not_accepted', 'withdrawn', 'closed']
export const TERMINAL = new Set(['accepted', 'not_accepted', 'withdrawn', 'closed'])

export const isTerminal = row => TERMINAL.has(row?.status)

/** Default SLA hours (owner decision). Settings table overrides per org. */
export const DEFAULT_SLA = { ack: 24, supervisor: 72, incharge: 72, manager: 120, hr_ack: 24, hr: 72, pay: 48, safety: 48 }

/** Hours allowed at a level for a category, shortest rule wins. */
export function slaHours(level, category, sla = DEFAULT_SLA) {
  let h = Number(sla[level] ?? 72)
  if (category === 'pay') h = Math.min(h, Number(sla.pay ?? h))
  if (category === 'safety') h = Math.min(h, Number(sla.safety ?? h))
  return h
}

/**
 * 'overdue' | 'due_soon' | 'ok' | null. A case past its acknowledge deadline
 * and not acknowledged is overdue even if the step deadline has not passed.
 * null for a closed case or one with no deadline: "no deadline" is not "on time".
 */
export function deadlineState(row, now = new Date()) {
  if (!row || isTerminal(row)) return null
  const t = now.getTime()
  const ack = row.ack_due_at ? new Date(row.ack_due_at).getTime() : null
  const due = row.due_at ? new Date(row.due_at).getTime() : null
  if (!row.acknowledged_at && ack !== null && ack < t) return 'overdue'
  if (due === null) return null
  if (due < t) return 'overdue'
  if (due - t < 12 * 3600 * 1000) return 'due_soon'
  return 'ok'
}

/** Hours left (negative when overdue), or null. */
export function hoursLeft(row, now = new Date()) {
  if (!row?.due_at) return null
  return Math.round((new Date(row.due_at).getTime() - now.getTime()) / 3600000)
}

/** The driver may reopen within the window after accepting / not accepting. */
export function canReopen(row, now = new Date()) {
  if (!row || !['accepted', 'not_accepted'].includes(row.status)) return false
  if (!row.reopen_deadline) return false
  return new Date(row.reopen_deadline).getTime() >= now.getTime()
}

/**
 * What the screen offers. `rank`: 0 none, 1 supervisor pool, 2 incharge / HR,
 * 3 manager. Same guards as driver_concern_command.
 */
export function allowedActions(row, { rank = 0, isDriver = false, now = new Date() } = {}) {
  const out = new Set()
  if (!row) return out
  const terminal = isTerminal(row)
  if (isDriver) {
    out.add('note')
    if (row.status === 'outcome_shared') {
      out.add('view_outcome')
      if (row.outcome_seen_at) out.add('sign')
    }
    if (!terminal) out.add('withdraw')
    if (canReopen(row, now)) out.add('reopen')
    return out
  }
  if (rank <= 0) return out
  out.add('note')
  out.add('link')
  if (terminal) return out
  const needed = Math.min(levelRank(row.level), 3)
  if (rank >= needed) {
    if (!row.acknowledged_at) out.add('acknowledge')
    out.add('assign')
    if (nextLevel(row.level, row.sensitive)) out.add('escalate')
    if (!['proposed', 'outcome_shared'].includes(row.status)) out.add('propose')
    if (!row.sensitive) out.add('reclassify')
  }
  if (rank >= 3 && row.status === 'proposed') {
    out.add('approve')
    out.add('return')
  }
  if (row.entered_verbally && row.status === 'outcome_shared') {
    out.add('view_outcome')
    if (row.outcome_seen_at) out.add('sign')
  }
  return out
}

/** Inbox order: overdue first, then nearest deadline, then newest. */
export function sortInbox(rows, now = new Date()) {
  const weight = r => ({ overdue: 0, due_soon: 1, ok: 2 }[deadlineState(r, now)] ?? 3)
  return [...(rows || [])].sort((a, b) => {
    const w = weight(a) - weight(b)
    if (w) return w
    const da = a.due_at ? new Date(a.due_at).getTime() : Infinity
    const db = b.due_at ? new Date(b.due_at).getTime() : Infinity
    if (da !== db) return da - db
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
}

export function filterConcerns(rows, { search = '', status = 'all', category = 'all', level = 'all', deadline = 'all', sensitive = 'all' } = {}, now = new Date()) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter(r => {
    if (status === 'open' && isTerminal(r)) return false
    if (status === 'closed' && !isTerminal(r)) return false
    if (!['all', 'open', 'closed'].includes(status) && r.status !== status) return false
    if (category !== 'all' && r.category !== category) return false
    if (level !== 'all' && r.level !== level) return false
    if (sensitive === 'yes' && !r.sensitive) return false
    if (sensitive === 'no' && r.sensitive) return false
    if (deadline !== 'all' && deadlineState(r, now) !== deadline) return false
    if (q) {
      const hay = [r.case_no, r.driver_name, r.site, r.country, r.subtype].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function summarize(rows, now = new Date()) {
  const open = (rows || []).filter(r => !isTerminal(r))
  return {
    total: (rows || []).length,
    open: open.length,
    overdue: open.filter(r => deadlineState(r, now) === 'overdue').length,
    awaitingApproval: open.filter(r => r.status === 'proposed').length,
    awaitingDriver: open.filter(r => r.status === 'outcome_shared').length,
    sensitive: open.filter(r => r.sensitive).length,
  }
}

/** Pick the translation for `lang` of a source, or null. Never the original. */
export function translationFor(translations, source, sourceId, lang) {
  return (translations || []).find(t => t.source === source && String(t.source_id || '') === String(sourceId || '') && t.target_lang === lang) || null
}

/** Storage path for an evidence photo: <org>/<uploader uid>/<client uuid>/<n>.jpg */
export function photoPath(orgId, userId, clientUuid, index, ext = 'jpg') {
  return `${orgId}/${userId}/${clientUuid}/${index}.${ext}`
}
