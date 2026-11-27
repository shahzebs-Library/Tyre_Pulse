/**
 * Who may NOT sign off a vehicle handover: "you cannot approve your own work".
 * The same three tests `decide_handover_approval` applies on the server, so a
 * supervisor who is a party is never offered a button the server would refuse.
 * The server stays the authority. Mirror of the Flutter
 * `features/handover/domain/handover_party.dart` - change both together.
 */

export const PARTY_CREATED = 'created'
export const PARTY_COLLECTED_SIGNATURE = 'collected_signature'
export const PARTY_IS_DRIVER = 'is_driver'

const NOTICE = {
  [PARTY_CREATED]: 'You created this handover, so another supervisor must sign it off.',
  [PARTY_COLLECTED_SIGNATURE]: 'You collected a signature on this handover, so another supervisor must sign it off.',
  [PARTY_IS_DRIVER]: 'You are one of the drivers on this handover, so another supervisor must sign it off.',
}

/**
 * @param {object} handover  handover_reports row
 * @param {{userId?: string|null, linkedDriverId?: string|null}} who
 * @returns {string|null} one of the PARTY_* reasons, or null when independent
 */
export function handoverPartyReason(handover, { userId, linkedDriverId } = {}) {
  if (!handover || !userId) return null
  const driver = String(linkedDriverId || '').trim()
  if (driver && (driver === handover.from_driver_id || driver === handover.to_driver_id)) return PARTY_IS_DRIVER
  if (userId === handover.from_signed_by || userId === handover.to_signed_by) return PARTY_COLLECTED_SIGNATURE
  if (userId === handover.created_by) return PARTY_CREATED
  return null
}

export function handoverPartyNotice(reason) {
  return NOTICE[reason] || null
}
