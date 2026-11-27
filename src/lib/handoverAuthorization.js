/**
 * handoverAuthorization - the vehicle handover as an authorization paper.
 *
 * Pure helpers (no Supabase, no React) for the two driver signatures, the
 * location captured with them, and the freeze that follows. The database is the
 * authority (supabase/migrations/20261126171000_handover_authorization_paper.sql):
 * sign_handover() stamps the time and signer server side, a trigger refuses any
 * change to a signed record, and decide_handover_approval() refuses a decision
 * by either signing driver. Everything here only EXPLAINS that state so the web
 * and Flutter screens never surface a raw refusal.
 *
 * Parties:
 *   handing   = from_* columns  (signs first)
 *   receiving = to_*   columns  (signs second; the handover is then submitted)
 *
 * On a check-out the driver picked in the wizard RECEIVES the vehicle; on a
 * check-in the picked driver HANDS it back.
 */

export const PARTY_HANDING = 'handing'
export const PARTY_RECEIVING = 'receiving'

/** Which wizard role sits in which party for a handover type. */
export function partiesFor(handoverType) {
  const checkin = handoverType === 'checkin'
  return {
    driverParty: checkin ? PARTY_HANDING : PARTY_RECEIVING,
    otherParty: checkin ? PARTY_RECEIVING : PARTY_HANDING,
  }
}

const COLS = {
  [PARTY_HANDING]: { sig: 'from_signature', name: 'from_signed_name', at: 'from_signed_at', by: 'from_signed_by', driver: 'from_driver', driverId: 'from_driver_id', behalf: 'from_on_behalf' },
  [PARTY_RECEIVING]: { sig: 'to_signature', name: 'to_signed_name', at: 'to_signed_at', by: 'to_signed_by', driver: 'to_driver', driverId: 'to_driver_id', behalf: 'to_on_behalf' },
}

/** One party's signature as stored on the row. */
export function partySignature(row, party) {
  const c = COLS[party]
  if (!c || !row) return { party, signed: false, signature: null, name: null, at: null, by: null, driverName: null }
  return {
    party,
    signed: !!row[c.at],
    signature: row[c.sig] || null,
    name: row[c.name] || null,
    at: row[c.at] || null,
    by: row[c.by] || null,
    driverName: row[c.driver] || null,
    driverId: row[c.driverId] || null,
    onBehalf: row[c.behalf] === true,
  }
}

export const PARTY_LABEL = {
  [PARTY_HANDING]: 'Handing over',
  [PARTY_RECEIVING]: 'Receiving',
}

/** Both signatures, handing first. */
export function signatureLadder(row) {
  return [partySignature(row, PARTY_HANDING), partySignature(row, PARTY_RECEIVING)]
}

/** The party whose signature is due next, or null when both have signed. */
export function nextPartyToSign(row) {
  if (!row) return PARTY_HANDING
  if (!row.from_signed_at) return PARTY_HANDING
  if (!row.to_signed_at) return PARTY_RECEIVING
  return null
}

/**
 * True when the row carries the authorization columns at all. A row read from a
 * database that has not had the migration applied has none of them, and the
 * screen then keeps the legacy single signature path.
 */
export function hasAuthorizationColumns(row) {
  return !!row && Object.prototype.hasOwnProperty.call(row, 'to_signed_at')
}

/** A signed record is frozen: content can no longer change. */
export function isFrozen(row) {
  return !!(row && (row.frozen_at || row.from_signed_at || row.to_signed_at))
}

/** Fully signed by both drivers (the only state that can be approved). */
export function isFullySigned(row) {
  return !!(row && row.from_signed_at && row.to_signed_at)
}

/**
 * Sent back for correction: a supervisor returned it to draft, which clears both
 * driver signatures server side so the record can be fixed and signed again.
 * Legacy rows (before that change) carry approval_status 'rejected'.
 */
export function isSentBack(row) {
  if (!row) return false
  if (row.approval_status === 'rejected') return true
  return row.approval_status === 'draft' && !!String(row.review_note || '').trim() && !row.from_signed_at && !row.to_signed_at
}

/** Plain sentence for the signing state. */
export function signingSummary(row) {
  if (!hasAuthorizationColumns(row)) return { text: row?.signature_url ? 'Signed (single signature)' : 'Not signed', tone: row?.signature_url ? 'muted' : 'warn' }
  if (isSentBack(row) && !row.from_signed_at) return { text: 'Sent back for correction, sign again', tone: 'bad' }
  if (isFullySigned(row)) return { text: 'Signed by both drivers', tone: 'good' }
  if (row.from_signed_at) return { text: 'Waiting for the receiving driver', tone: 'warn' }
  return { text: 'Not signed yet', tone: 'warn' }
}

// ---------------------------------------------------------------- who signs

/**
 * The same signature shape the server accepts (handover_valid_signature, which
 * mirrors the driver charge module): a PNG data URL, or the static SVG the
 * SignatureCapture pad emits. CHANGE BOTH TOGETHER.
 */
const SIG_PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/
const SIG_SVG = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[0-9]+" height="[0-9]+" viewBox="[0-9 .]+">(<path d="[ML0-9 .-]+" fill="none" stroke="#[a-fA-F0-9]{6}" stroke-width="[0-9.]+" stroke-linecap="round" stroke-linejoin="round"\/>)+<\/svg>$/
export function isValidSignature(sig) {
  const s = String(sig || '')
  // Mirrors handover_valid_signature: a real PNG of some size, or the pad SVG
  // with at least 10 points.
  if (SIG_PNG.test(s)) return s.startsWith('data:image/png;base64,iVBORw0KGgo') && s.length >= 1400
  if (SIG_SVG.test(s)) return (s.length - s.replace(/L/g, '').length) >= 9
  return false
}

export const SIGN_SELF = 'self'
export const SIGN_ON_BEHALF = 'on_behalf'
export const SIGN_BLOCKED = 'blocked'
/** This account already gave the other signature; a different account must give this one. */
export const SIGN_OTHER_ACCOUNT = 'other_account'

/** Modes in which this account cannot sign the party now. */
export function cannotSignNow(mode) {
  return mode === SIGN_BLOCKED || mode === SIGN_OTHER_ACCOUNT
}

/**
 * How the signed-in account may sign for one party, mirroring sign_handover():
 *   self       the account is linked to that party's driver
 *   blocked    the account is linked to the OTHER driver on this handover, so
 *              it may not sign for this party at all
 *   on_behalf  anyone else; only a supervisor-level account is accepted by the
 *              server, and the screen must say so before sending the flag
 */
export function signingMode({ partyDriverId = null, otherDriverId = null, myDriverId = null } = {}) {
  if (myDriverId && partyDriverId && myDriverId === partyDriverId) return SIGN_SELF
  if (myDriverId && otherDriverId && myDriverId === otherDriverId) return SIGN_BLOCKED
  return SIGN_ON_BEHALF
}

/**
 * signingMode() for a party of a saved row. sign_handover() never lets one
 * account give both signatures, so the receiving party is `other_account` when
 * this account (myUserId) already gave the handing signature.
 */
export function rowSigningMode(row, party, myDriverId, myUserId = null) {
  const from = row?.from_driver_id || null
  const to = row?.to_driver_id || null
  if (party === PARTY_HANDING) return signingMode({ partyDriverId: from, otherDriverId: to, myDriverId })
  if (myUserId && row?.from_signed_by && row.from_signed_by === myUserId) return SIGN_OTHER_ACCOUNT
  return signingMode({ partyDriverId: to, otherDriverId: from, myDriverId })
}

/**
 * Both modes for the new-handover wizard, where one account holds the device.
 * The server refuses one account for both signatures, so when this account can
 * sign the handing party the receiving party is left for another account (the
 * receiving driver, or a different supervisor) to sign from the saved record.
 */
export function wizardSigningModes({ handingDriverId = null, receivingDriverId = null, myDriverId = null } = {}) {
  const handing = signingMode({ partyDriverId: handingDriverId, otherDriverId: receivingDriverId, myDriverId })
  let receiving = signingMode({ partyDriverId: receivingDriverId, otherDriverId: handingDriverId, myDriverId })
  if (!cannotSignNow(handing) && !cannotSignNow(receiving)) receiving = SIGN_OTHER_ACCOUNT
  return { [PARTY_HANDING]: handing, [PARTY_RECEIVING]: receiving }
}

/** The line the screen shows before an on-behalf signature is recorded. */
export function onBehalfPrompt(name) {
  return `I am signing on behalf of ${String(name || '').trim() || 'this person'}`
}

/**
 * Adjust the wizard's signature problems for the signing modes: a party this
 * account may not sign for now (blocked, or already signed by this account's
 * other signature) needs no signature now (it is collected later from the saved
 * record), and an on-behalf signature needs the explicit confirmation
 * box ticked. `base` is vehicleHandoverView.signatureProblems(form).
 */
export function wizardSigningProblems(base, form, modes = {}) {
  const missing = {
    [PARTY_HANDING]: 'The handing over signature is missing.',
    [PARTY_RECEIVING]: 'The receiving signature is missing.',
  }
  let errs = [...(base || [])]
  for (const party of [PARTY_HANDING, PARTY_RECEIVING]) {
    if (cannotSignNow(modes[party])) errs = errs.filter((e) => e !== missing[party])
    else if (modes[party] === SIGN_ON_BEHALF && !form?.[`behalf_${party}`]) {
      errs.push(`Confirm that you are signing on behalf of the ${party === PARTY_HANDING ? 'handing' : 'receiving'} party.`)
    }
  }
  return errs
}

/**
 * The site a new handover is saved under: the asset's fleet-register site, else
 * the one typed in the wizard, upper-cased. null when there is none. The
 * database's site isolation only protects a row that carries a site, so the
 * wizard refuses to save without one.
 */
export function resolveHandoverSite(assetRow, form) {
  const s = String(assetRow?.site || form?.site || '').trim().toUpperCase()
  return s || null
}

// ---------------------------------------------------------------- location

export const LOCATION_LABEL = {
  captured: 'Location recorded',
  denied: 'Location permission was refused',
  unavailable: 'Location could not be read',
}

/** Finite coordinates on the row, or null. */
export function rowLocation(row) {
  const lat = Number(row?.latitude)
  const lng = Number(row?.longitude)
  if (row?.latitude == null || row?.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  const acc = Number(row?.location_accuracy_m)
  return { lat, lng, accuracy: row?.location_accuracy_m != null && Number.isFinite(acc) ? acc : null }
}

/** "21.48580, 39.19250" */
export function formatCoords(loc) {
  if (!loc) return ''
  return `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`
}

/** Link that opens the point on openstreetmap.org (no API key needed). */
export function openStreetMapUrl(loc, zoom = 17) {
  if (!loc) return null
  const lat = loc.lat.toFixed(6)
  const lng = loc.lng.toFixed(6)
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`
}

/** Human line for a location reading or its absence. */
export function locationLine(row) {
  const loc = rowLocation(row)
  if (loc) {
    return loc.accuracy != null ? `${formatCoords(loc)} (within ${Math.round(loc.accuracy)} m)` : formatCoords(loc)
  }
  return LOCATION_LABEL[row?.location_status] || 'No location recorded'
}

/**
 * Read the device position once. Resolves (never rejects) to
 * { status: 'captured'|'denied'|'unavailable', lat, lng, accuracy, message }.
 * `geo` is injectable for tests; defaults to navigator.geolocation.
 */
export function captureLocation({ geo, timeoutMs = 15000 } = {}) {
  const g = geo !== undefined ? geo : (typeof navigator !== 'undefined' ? navigator.geolocation : null)
  if (!g || typeof g.getCurrentPosition !== 'function') {
    return Promise.resolve({ status: 'unavailable', lat: null, lng: null, accuracy: null, message: 'This device cannot report its location.' })
  }
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    const timer = setTimeout(() => finish({ status: 'unavailable', lat: null, lng: null, accuracy: null, message: 'The location took too long to read.' }), timeoutMs + 1000)
    try {
      g.getCurrentPosition(
        (pos) => {
          clearTimeout(timer)
          const lat = Number(pos?.coords?.latitude)
          const lng = Number(pos?.coords?.longitude)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            finish({ status: 'unavailable', lat: null, lng: null, accuracy: null, message: 'The location reading was not valid.' })
            return
          }
          const acc = Number(pos?.coords?.accuracy)
          finish({ status: 'captured', lat, lng, accuracy: Number.isFinite(acc) && acc >= 0 ? acc : null, message: '' })
        },
        (err) => {
          clearTimeout(timer)
          const denied = err && (err.code === 1 || err.code === err.PERMISSION_DENIED)
          finish({
            status: denied ? 'denied' : 'unavailable',
            lat: null, lng: null, accuracy: null,
            message: denied ? 'Location permission was refused. The handover is saved without a location.' : 'The location could not be read.',
          })
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
      )
    } catch {
      clearTimeout(timer)
      finish({ status: 'unavailable', lat: null, lng: null, accuracy: null, message: 'The location could not be read.' })
    }
  })
}

/** sign_handover() location arguments from a captureLocation() result. */
export function locationArgs(reading) {
  if (reading?.status === 'captured' && Number.isFinite(reading.lat) && Number.isFinite(reading.lng)) {
    return { latitude: reading.lat, longitude: reading.lng, accuracy: reading.accuracy ?? null, status: 'captured' }
  }
  return { latitude: null, longitude: null, accuracy: null, status: reading?.status === 'denied' ? 'denied' : 'unavailable' }
}

// ---------------------------------------------------------------- audit trail

const ACTION_LABEL = {
  created: 'Handover recorded',
  edited: 'Details changed',
  signed_handing: 'Handing driver signed',
  signed_receiving: 'Receiving driver signed',
  decision_pending_incharge: 'Supervisor signed off',
  decision_approved: 'Approved',
  decision_rejected: 'Sent back',
  sent_back: 'Sent back for correction, signatures cleared',
  decision_pending_supervisor: 'Submitted for sign-off',
  decision_draft: 'Returned to draft',
  deleted: 'Deleted',
}

export function eventLabel(action) {
  return ACTION_LABEL[action] || String(action || 'Change').replace(/_/g, ' ')
}

/** Changed field names of an audit event, excluding bookkeeping. */
export function eventFields(ev) {
  const c = ev?.changes
  if (!c || typeof c !== 'object' || ev.action === 'created' || ev.action === 'deleted') return []
  return Object.keys(c).filter((k) => k !== 'updated_at')
}
