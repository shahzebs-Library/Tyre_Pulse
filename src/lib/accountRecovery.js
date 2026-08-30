import { supabase } from './supabase'

export const RECOVERY_GENERIC_MESSAGE =
  'If that verified recovery contact belongs to an eligible account, a 6-digit code is on its way.'

// Email is the safe launch default. SMS becomes visible only after Twilio is
// provisioned and the production operator explicitly enables the public flag.
export const RECOVERY_SMS_ENABLED =
  String(import.meta.env.VITE_RECOVERY_SMS_ENABLED || '').toLowerCase() === 'true'

export function isRecoveryChannelEnabled(channel) {
  return channel === 'email' || (channel === 'sms' && RECOVERY_SMS_ENABLED)
}

function functionError(error, fallback) {
  const context = error?.context
  const body = context?.body
  if (body && typeof body === 'object' && typeof body.error === 'string') return new Error(body.error)
  return new Error(error?.message || fallback)
}

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('account-recovery', { body })
  if (error) throw functionError(error, 'Account recovery is unavailable right now.')
  if (data?.error) throw new Error(data.error)
  return data ?? {}
}

export function normalizeRecoveryDestination(channel, value) {
  if (channel === 'email') return String(value ?? '').trim().toLowerCase()
  const raw = String(value ?? '').trim().replace(/[\s().-]/g, '')
  return raw.startsWith('00') ? `+${raw.slice(2)}` : raw
}

export function recoveryDestinationIsValid(channel, value) {
  const destination = normalizeRecoveryDestination(channel, value)
  if (channel === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination) && destination.length <= 254
  return /^\+[1-9]\d{7,14}$/.test(destination)
}

export async function requestPasswordRecovery({ channel, destination }) {
  if (!isRecoveryChannelEnabled(channel)) throw new Error('SMS recovery is not available yet. Use recovery email or contact support.')
  return invoke({ action: 'request_recovery', channel, destination: normalizeRecoveryDestination(channel, destination) })
}

export async function verifyPasswordRecovery({ channel, destination, challengeId, code }) {
  const result = await invoke({
    action: 'verify_recovery', channel, destination: normalizeRecoveryDestination(channel, destination), challengeId, code,
  })
  if (!result.actionLink) throw new Error('A recovery session could not be created.')
  return result.actionLink
}

export async function getRecoveryContacts() {
  const result = await invoke({ action: 'contact_status' })
  return result.contacts ?? {}
}

export async function requestRecoveryContactVerification({ channel, destination }) {
  return invoke({ action: 'request_contact', channel, destination: normalizeRecoveryDestination(channel, destination) })
}

export async function verifyRecoveryContact({ channel, destination, challengeId, code }) {
  return invoke({
    action: 'verify_contact', channel, destination: normalizeRecoveryDestination(channel, destination), challengeId, code,
  })
}

export async function removeRecoveryContact(channel) {
  return invoke({ action: 'remove_contact', channel })
}
