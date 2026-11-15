/**
 * Deterministic cache key for stored report PDFs.
 *
 * MIRROR: public.pdf_canonical_json / pdf_sha256_hex / pdf_cache_compose_key in
 * supabase/pending_migrations/20261117090000_report_pdf_cache.sql. Both sides are
 * replayed over src/test/fixtures/pdfCacheKeyCases.json. Change both together.
 *
 * The SERVER computes the authoritative key from the live source row (a client must
 * not be able to call an old file current). This module exists so that
 *   - the key rule is testable without a database,
 *   - the client can build the two inputs only it knows: the branding revision and
 *     the revision of client-derived content printed in the PDF.
 *
 * A file name is never part of a key.
 */

const KEY_PREFIX = 'tp-pdf-v1'

/** Compare strings by code point, which is the same order as UTF-8 bytes (Postgres COLLATE "C"). */
function byCodePoint(a, b) {
  const x = Array.from(a), y = Array.from(b)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0)
    if (d !== 0) return d
  }
  return x.length - y.length
}

/** A finite number as Postgres numeric prints it after trim_scale: no exponent, no trailing zeros. */
export function canonicalNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'null'
  if (n === 0) return '0'
  let s = String(n)
  if (!/e/i.test(s)) return s
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(s)
  if (!m) return s
  const [, sign, int, frac = '', expText] = m
  const exp = Number(expText)
  const digits = int + frac
  if (exp >= 0) {
    const pad = exp - frac.length
    s = pad >= 0 ? digits + '0'.repeat(pad) : digits.slice(0, 1 + exp) + '.' + digits.slice(1 + exp)
  } else {
    s = '0.' + '0'.repeat(-exp - 1) + digits
  }
  return sign + s
}

/** Canonical JSON text: keys sorted, no whitespace, undefined treated as null. */
export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return canonicalNumber(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort(byCodePoint)
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
  }
  return 'null'
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

function subtle() {
  const c = globalThis.crypto
  if (!c || !c.subtle) throw new Error('This browser cannot verify files (no secure hashing). Open the app over https.')
  return c.subtle
}

/** sha256 of UTF-8 text, lower-case hex. */
export async function sha256Hex(text) {
  return toHex(await subtle().digest('SHA-256', new TextEncoder().encode(String(text ?? ''))))
}

/** sha256 of raw bytes (ArrayBuffer, typed array or Blob), lower-case hex. */
export async function sha256HexOfBytes(data) {
  let buf = data
  if (typeof Blob !== 'undefined' && data instanceof Blob) buf = await data.arrayBuffer()
  else if (ArrayBuffer.isView(data)) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  return toHex(await subtle().digest('SHA-256', buf))
}

const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row?.[k] ?? null]))

/** Every inspection field the approved inspection report prints. No ERP state. */
export const INSPECTION_FIELDS = Object.freeze(['id', 'asset_no', 'site', 'country', 'vehicle_type', 'inspection_type',
  'title', 'inspection_date', 'completed_date', 'scheduled_date', 'status', 'approval_status', 'approved_at',
  'approved_by', 'approver_email', 'approver_signature', 'inspector', 'inspector_signature', 'findings', 'notes',
  'attendees', 'severity', 'odometer_km', 'hour_meter', 'pressure_reading', 'tyre_conditions', 'photo_data',
  'created_by', 'document_no'])

/** The inspection fields the observation report prints. */
export const OBSERVATION_FIELDS = Object.freeze(['id', 'asset_no', 'site', 'country', 'vehicle_type',
  'inspection_type', 'inspector', 'inspection_date', 'completed_date', 'created_at', 'status', 'approval_status',
  'tyre_conditions', 'findings', 'notes'])

export function inspectionProjection(row) {
  return pick(row, INSPECTION_FIELDS)
}

/**
 * Observation document = inspection fields + the corrective actions raised from it +
 * the ERP confirmation evidence of those actions. ERP state is in THIS key only.
 */
export function observationProjection(row, { actions = [], erpLinks = [] } = {}) {
  const sorted = (list, key) => [...list].sort((a, b) => byCodePoint(String(a[key]), String(b[key])))
  return {
    inspection: pick(row, OBSERVATION_FIELDS),
    actions: sorted(actions.map((a) => ({ id: a.id, status: a.status ?? null, source_detail: a.source_detail ?? null })), 'id'),
    erp: sorted(erpLinks.map((l) => ({
      action_id: l.action_id, source_job_card: l.source_job_card ?? null, reviewed_at: l.reviewed_at ?? null,
      reviewed_by: l.reviewed_by ?? null, snapshot_status: l.work_order_snapshot?.status ?? null,
      decision_note: l.decision_note ?? null,
    })), 'action_id'),
  }
}

export async function sourceHash(projection) {
  return sha256Hex(canonicalJson(projection))
}

/** The key. Same concatenation as public.pdf_cache_compose_key. */
export async function composeCacheKey({ org, type, sourceId, sourceHash: sh, evidenceRev = '', template, branding, clientRev = '' }) {
  return sha256Hex([KEY_PREFIX, String(org).toLowerCase(), type ?? '', String(sourceId).toLowerCase(), sh ?? '',
    evidenceRev ?? '', template ?? '', branding ?? '', clientRev ?? ''].join('|'))
}

/** A signed URL changes on every load; only its path identifies the image. */
function stableImageRef(v) {
  if (!v || typeof v !== 'string') return ''
  if (/^https?:/i.test(v)) return v.split('?')[0]
  return v
}

/**
 * Branding revision: logo, accent, footer wording, company name and diagram
 * background. A change to any of them makes every stored PDF of that tenant outdated.
 * Returned as a short token ("b-" + 24 hex) so it fits the server's length check.
 */
export async function brandingRevision({ branding = null, company = '', diagramBg = '' } = {}) {
  const doc = {
    logo: stableImageRef(branding?.logo_url || branding?.logoUrl || ''),
    accent: branding?.accent_color || branding?.primary_color || branding?.accent || '',
    footer: branding?.footer_text || branding?.footerText || '',
    name: branding?.company_name || '',
    company: company || '',
    diagramBg: diagramBg || '',
  }
  return 'b-' + (await sha256Hex(canonicalJson(doc))).slice(0, 24)
}

/**
 * Revision of content the browser derives and prints (for the observation report: each
 * finding's wording and whether the tyre was since replaced). '' when there is none.
 */
export async function clientRevision(value) {
  if (value === null || value === undefined || value === '') return ''
  return 'c-' + (await sha256Hex(canonicalJson(value))).slice(0, 24)
}
