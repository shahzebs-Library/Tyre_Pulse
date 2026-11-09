/**
 * One place that turns a workforce error, refusal or day-accounting warning into the reader's
 * language. Services keep throwing English (their tests and other callers depend on it); the screens
 * pass what they catch through here. Anything not recognised falls back to the safe English text,
 * never to a raw key.
 */
import { toUserMessage } from './safeError'
import { reasonMessage, MESSAGES, NOT_INSTALLED } from './workforceTransitions'

/** English service message -> key under workforce.errors. */
export const ERROR_KEYS = Object.freeze({
  [NOT_INSTALLED]: 'notInstalled',
  'Employee and task title required': 'titleRequired',
  'Choose the operational record to link': 'chooseRecord',
  'Unable to load a complete employee directory': 'directoryIncomplete',
  'Choose two different assignments': 'twoAssignments',
  'Valid standard and time required': 'standardRequired',
  'Sign in required': 'signIn',
  'Sign in to view daily work': 'signIn',
  'The employee directory is larger than can be shown here. Narrow it first.': 'directoryTooLarge',
  'Choose the employee account': 'chooseEmployee',
  'Designation is required': 'designationRequired',
  'An employee cannot supervise themselves': 'selfSupervisor',
  'Shift start and end cannot be the same time': 'shiftSame',
  'This supervisor would create a reporting loop.': 'reportingLoop',
  'There are more certificates than can be shown here.': 'certsTooMany',
  'Employee and certificate type are required': 'certRequired',
  'Expiry cannot be before the issue date': 'expiryBeforeIssue',
  'Task type is required': 'taskTypeRequired',
  'A safety-critical task must name the required skill or certificate': 'safetyNeedsRequirement',
  'Choose a file': 'chooseFile',
  'Only JPG, PNG or PDF files are accepted': 'fileType',
  'Files must be under 10 MB': 'fileSize',
  'Cannot load daily report': 'dailyLoadFailed',
  'Report is locked for review': 'reportLocked',
  'Activity title required': 'activityTitle',
  'Report is not editable': 'reportNotEditable',
  'Activity and a summary are required': 'summaryRequired',
  'Incomplete activity interval': 'intervalIncomplete',
  'Nothing to correct': 'nothingToCorrect',
  'A correction reason is required': 'correctionReason',
  'Could not save the correction': 'correctionFailed',
  'The start date must be on or before the end date': 'dateOrder',
})

/** Qualification reason codes, and the English text the service writes for each. */
export const QUALIFICATION_CODES = Object.freeze({
  skill_missing: 'required skill level not recorded',
  certification_invalid: 'no valid certificate',
  site_not_assigned: 'not assigned to this site',
  temporarily_unavailable: 'temporarily unavailable',
  account_inactive: 'account not active',
  employee_inactive: 'employee inactive',
  no_employee_record: 'no employee record yet',
})
const CODE_BY_TEXT = Object.fromEntries(Object.entries(QUALIFICATION_CODES).map(([k, v]) => [v, k]))

/** A qualification reason code (or the English text for one) in the reader's language. */
export function qualificationReason (codeOrText, t) {
  const raw = String(codeOrText ?? '').trim()
  const code = QUALIFICATION_CODES[raw] ? raw : CODE_BY_TEXT[raw]
  if (code && typeof t === 'function') return t(`workforce.qualification.${code}`)
  return code ? QUALIFICATION_CODES[code] : raw.replace(/_/g, ' ')
}

const QUAL_PREFIX = [
  [/^Not qualified for this safety-critical work:\s*(.+)$/, 'notQualified'],
  [/^A manager override reason is required:\s*(.+)$/, 'overrideNeeded'],
]

/** Translate a caught workforce error. `fallback` is already in the reader's language. */
export function workforceErrorText (err, t, fallback) {
  const message = toUserMessage(err, fallback)
  if (typeof t !== 'function') return message
  const code = err?.code
  if (code && MESSAGES[code]) return reasonMessage(code, null, t)
  const key = ERROR_KEYS[err?.message] || ERROR_KEYS[message]
  if (key) return t(`workforce.errors.${key}`)
  const text = String(err?.message ?? '')
  if (/^The selected employee account is not active/.test(text)) return t('workforce.errors.accountInactive')
  if (/^The selected employee is not in this organisation/.test(text)) return t('workforce.errors.notInOrg')
  for (const [re, k] of QUAL_PREFIX) {
    const m = re.exec(text)
    if (m) return t(`workforce.errors.${k}`, { reasons: m[1].split(',').map(x => qualificationReason(x, t)).join(', ') })
  }
  return message
}

/** A day-accounting warning in the reader's language (falls back to its English message). */
export function dayWarningText (w, t) {
  if (!w || typeof t !== 'function') return w?.message ?? ''
  const known = ['invalid_shift', 'invalid_entry', 'duplicate_entry', 'unknown_category', 'invalid_interval', 'too_long',
    'future', 'reason_missing', 'overlap', 'not_recorded', 'assignment_time_mismatch', 'invalid_assignment_minutes']
  return known.includes(w.type) ? t(`workforce.dayWarning.${w.type}`, { minutes: w.minutes ?? '' }) : w.message
}
