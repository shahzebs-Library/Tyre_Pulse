/**
 * closureText - turns a closure workflow sentence into the reader's language.
 *
 * The rules in closureWorkflow.js, the service in api/closureReview.js and the
 * database writers all speak plain English (their tests and the Audit Pack depend
 * on it). The two panels pass what they show through here. A sentence that is not
 * in the table is returned as it came: safe English, never a raw key.
 *
 * Same idea as workforceErrorText.js. Keys live under `closure.msg` in
 * src/locales/<lang>/closure.json; closureText.test.js checks every key exists in
 * English and Arabic.
 */
import { ACK_ACTION_REQUIRED } from './closureWorkflow'

/** English sentence -> key under closure.msg. */
export const MESSAGE_KEYS = Object.freeze({
  // review state labels
  'Waiting for review': 'waitingReview',
  'Returned for correction': 'returned',
  'Closed by exception': 'closedByException',
  'Closure approved': 'closureApproved',
  'Closed before reviews were recorded': 'closedBefore',
  'Exception requested, waiting for a decision': 'exceptionWaiting',
  // local checks
  'Describe what was done to complete this action.': 'describe',
  'Attach at most 6 photographs.': 'maxPhotos',
  'Attach at least one photograph as completion evidence.': 'onePhoto',
  'Say what has to be corrected before returning the action.': 'sayCorrected',
  'An exception needs a written reason of at least 10 characters.': 'exceptionReasonShort',
  'Say why the exception is refused.': 'sayRefused',
  'Closure review is not switched on for this system yet.': 'notOn',
  'That file is not a photograph.': 'notPhoto',
  // refusals from the database writers
  'You submitted this action, so another reviewer has to decide it.': 'selfReview',
  'You submitted this action, so another reviewer has to close it.': 'selfClose',
  'You asked for this exception, so another authorised person has to decide it.': 'selfExceptionAsked',
  'You submitted this action, so another authorised person has to decide its exception.': 'selfExceptionSubmitted',
  'Only the person this action is assigned to can update it.': 'onlyAssigneeUpdate',
  'Only the person this action is assigned to can submit it for review.': 'onlyAssigneeSubmit',
  'Your role is not set up to review corrective actions in this company.': 'notReviewerRole',
  'Your role is not authorised to decide an exception.': 'notExceptionRole',
  'This action is already closed.': 'alreadyClosed',
  'This action is closed.': 'closed',
  'This action has already been submitted and is waiting for review.': 'alreadySubmitted',
  'Nothing has been submitted for review on this action yet.': 'nothingSubmitted',
  'An exception has already been requested on this action and is waiting for a decision.': 'exceptionAlready',
  'No exception has been requested on this action.': 'noException',
  'That action does not exist or is outside your company, country or sites.': 'outsideScope',
  'Closing an action needs a reviewer. Submit your completion evidence and a reviewer will close it.': 'needsReviewer',
  'An exception has been requested on this action. Approve or refuse the exception first.': 'exceptionPendingClose',
  // checklist acknowledge
  'This checklist is not waiting for a signature.': 'notWaitingSignature',
  'This checklist is routed through an approval policy. Decide it in the approval queue.': 'policyRouted',
  'This checklist has no recorded fault. Approve it in the normal way.': 'noFault',
  'You submitted this checklist, so another signer has to acknowledge it.': 'selfAck',
  'Give the supervisor signature first. The final signer then acknowledges the fault.': 'supervisorFirst',
  'Only a final signer can acknowledge this checklist.': 'finalSignerOnly',
  'You do not have permission to sign this checklist.': 'noSignPermission',
  'A signature is required to acknowledge this checklist.': 'signatureRequired',
  'The server did not confirm the acknowledgement. Refresh before retrying.': 'notConfirmed',
  'That checklist does not exist or is outside your company, country or sites.': 'sheetOutsideScope',
  // acknowledged sheet labels
  [ACK_ACTION_REQUIRED]: 'ackActionRequired',
  'Acknowledged, compliant by exception': 'ackException',
  'Acknowledged, faults resolved': 'ackResolved',
})

/** The photograph-count sentence carries a number, so it is matched by shape. */
const SOME_PHOTOS = /^Attach at least \d+ photograph/

/**
 * A closure sentence in the reader's language.
 * @param {(key:string, vars?:object)=>string} t  from useLanguage()
 * @param {string} text  English sentence
 */
export function closureText(t, text) {
  const raw = String(text ?? '').trim()
  if (!raw || typeof t !== 'function') return raw
  const key = MESSAGE_KEYS[raw] || (SOME_PHOTOS.test(raw) ? 'somePhotos' : null)
  if (!key) return raw
  const out = t(`closure.msg.${key}`)
  // A dictionary that has not loaded yet answers with a stand-in: keep the English.
  return typeof out === 'string' && out && !out.startsWith('closure.') ? out : raw
}
