/**
 * Tyre Fitment & Specification Policy - controlled governance document generator.
 *
 * Renders an organisation's APPROVED tyre specifications into a formal, numbered,
 * branded PDF that staff (Fleet / Workshop / Procurement / Drivers) must follow.
 *
 * Two exports:
 *   - buildPolicySections(...)      -> PURE array of numbered section objects.
 *   - renderTyreSpecPolicyPdf(...)  -> A4 portrait branded jsPDF document.
 *
 * RULES honoured here:
 *   - Output strings are ASCII-only: no em/en dashes, arrows, curly quotes or middle
 *     dots. Only "-", "to", "|", ":" separators. (The app sanitises these anyway.)
 *   - No fabricated data. The fitment-standards table is built strictly from the
 *     `specs` passed in; null fields render 'N/A'; an empty spec list renders an
 *     honest note row while the governance sections remain intact.
 */

import {
  resolvePdfBrand,
  pdfHeader,
  pdfFooter,
  pdfTableTheme,
  reportFileName,
} from './exportUtils'

// ── Tiny local reference tables (do NOT import tyreSpecCatalog.js) ─────────────
// Speed index -> maximum speed in km/h (truck/bus relevant subset).
const SPEED_INDEX_KMH = {
  F: 80, G: 90, J: 100, K: 110, L: 120, M: 130, N: 140,
  P: 150, Q: 160, R: 170, S: 180, T: 190, U: 200, H: 210,
  V: 240, W: 270, Y: 300,
}

// Ply rating / star rating meaning (load-carrying construction strength).
const PLY_MEANING = [
  ['12 PR', 'Star (*)', 'Light / medium duty'],
  ['14 PR', '2 Star (**)', 'Medium / heavy duty'],
  ['16 PR', '3 Star (***)', 'Heavy duty, common on drive/steer'],
  ['18 PR', '4 Star (****)', 'Extra heavy / high-load haulage'],
  ['20 PR', '4 Star plus', 'Severe duty, off-highway and mixers'],
]

// ── Helpers ────────────────────────────────────────────────────────────────
/** Render a possibly-null / array value as an ASCII-safe cell string. Never a dash. */
function cell(v) {
  if (v == null) return 'N/A'
  if (Array.isArray(v)) {
    const parts = v.map((x) => (x == null ? '' : String(x).trim())).filter(Boolean)
    return parts.length ? parts.join(', ') : 'N/A'
  }
  const s = String(v).trim()
  return s === '' ? 'N/A' : s
}

/** First non-null/non-empty field on `obj` from a list of candidate keys. */
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k]
    if (v != null && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0)) {
      return v
    }
  }
  return null
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return 'N/A'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`
}

const FITMENT_HEAD = [
  'Vehicle Type', 'Position', 'Approved Sizes', 'Approved Brands',
  'Ply', 'Load Idx', 'Speed', 'Pressure (PSI)', 'Min Tread (mm)',
]

/** Build one fitment-standards table row from a raw spec object (all cells ASCII-safe). */
function specRow(s) {
  const speed = pick(s, ['min_speed_index', 'speed_index', 'speed_rating', 'speed'])
  const speedCell = speed == null
    ? 'N/A'
    : (SPEED_INDEX_KMH[String(speed).toUpperCase()]
      ? `${String(speed).toUpperCase()} (${SPEED_INDEX_KMH[String(speed).toUpperCase()]} km/h)`
      : String(speed).toUpperCase())
  return [
    cell(pick(s, ['vehicle_type', 'vehicleType'])),
    cell(pick(s, ['position'])),
    cell(pick(s, ['approved_sizes', 'sizes', 'size', 'tyre_size'])),
    cell(pick(s, ['approved_brands', 'brands', 'brand'])),
    cell(pick(s, ['ply', 'ply_rating', 'star_rating'])),
    cell(pick(s, ['min_load_index', 'load_index', 'load_idx'])),
    speedCell,
    cell(pick(s, ['recommended_pressure', 'pressure', 'pressure_psi'])),
    cell(pick(s, ['min_tread_depth', 'min_tread', 'tread_min'])),
  ]
}

/** Sort specs by vehicle type then position (stable, ASCII-safe compare). */
function sortSpecs(specs) {
  return [...specs].sort((a, b) => {
    const vt = String(pick(a, ['vehicle_type', 'vehicleType']) || '').localeCompare(
      String(pick(b, ['vehicle_type', 'vehicleType']) || ''))
    if (vt !== 0) return vt
    return String(pick(a, ['position']) || '').localeCompare(String(pick(b, ['position']) || ''))
  })
}

/**
 * Build the ordered array of numbered policy sections.
 * PURE - no jsPDF, no DOM. Safe to unit-test and to reuse for other renderers.
 *
 * @returns {Array<{ n:string, title:string, body?:string[], table?:{head:string[],rows:string[][]} }>}
 */
export function buildPolicySections({
  specs = [],
  company = 'TyrePulse',
  country = null,
  generatedBy = '',
  date = new Date(),
} = {}) {
  const scope = country && String(country).trim() ? String(country).trim() : 'All Countries'
  const list = Array.isArray(specs) ? specs.filter(Boolean) : []
  const sorted = sortSpecs(list)

  // Section 4 table: honest rows, honest empty state.
  const fitmentRows = sorted.length
    ? sorted.map(specRow)
    : [['No approved specifications defined yet', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A']]

  const sections = [
    {
      n: '1',
      title: 'Purpose and Scope',
      body: [
        `This document defines the mandatory tyre fitment and specification standards for ${company}.`,
        `Scope of application: ${scope}.`,
        'It applies to every vehicle in the fleet and to all staff who select, purchase, fit,',
        'inspect or approve tyres. Adherence is mandatory. Any deviation requires documented',
        'engineering sign-off recorded against a work order.',
        'The objective is to protect safety, control cost per kilometre, ensure legal compliance',
        'and standardise procurement across all sites.',
      ],
    },
    {
      n: '2',
      title: 'Definitions',
      body: [
        'Load Index: a numeric code for the maximum load a single tyre can carry at the rated',
        '  pressure. A higher number means a higher permitted load. Never fit below the approved',
        '  minimum load index for the axle position.',
        'Speed Index (Speed Rating): a letter code for the maximum speed the tyre is rated for.',
        '  Reference (subset): J = 100 km/h, K = 110 km/h, L = 120 km/h, M = 130 km/h,',
        '  N = 140 km/h, P = 150 km/h, Q = 160 km/h. Fit at or above the approved minimum.',
        'Ply Rating / Star Rating: the load-carrying construction strength of the casing.',
        `  ${PLY_MEANING.map((p) => `${p[0]} = ${p[1]} (${p[2]})`).join('; ')}.`,
        '  Higher ply / star rating means a stronger casing for heavier or more severe duty.',
      ],
    },
    {
      n: '3',
      title: 'Roles and Responsibilities',
      body: [
        'Fleet / Engineering: owns this policy, sets and reviews approved standards, grants any',
        '  documented exception, and monitors CPK and failure trends.',
        'Workshop: fits only approved sizes, brands, load and speed ratings; verifies pressure and',
        '  tread at every service; records serials; raises a work order for any non-conformance.',
        'Procurement: purchases only approved-list brands and specifications; obtains engineering',
        '  sign-off before sourcing any off-list item; tracks vendor cost and reliability.',
        'Driver: performs daily walk-around checks, reports low pressure, visible damage, uneven',
        '  wear or vibration immediately, and does not operate a vehicle with a non-conforming tyre.',
      ],
    },
    {
      n: '4',
      title: 'Approved Fitment Standards',
      body: sorted.length
        ? [
            'The following fitments are approved for use. Fit only what is listed for each vehicle',
            'type and axle position. Values shown are the approved minimums or approved options.',
          ]
        : [
            'No approved specifications have been defined yet. Until standards are entered and',
            'approved, every fitment must be authorised by engineering against a work order.',
          ],
      table: { head: FITMENT_HEAD, rows: fitmentRows },
    },
    {
      n: '5',
      title: 'Load, Speed and Ply Rating Compliance Rules',
      body: [
        'Load index: the fitted tyre load index must be equal to or greater than the approved',
        '  minimum for the axle position. Never downgrade load capacity.',
        'Speed index: the fitted speed rating must be equal to or greater than the approved',
        '  minimum. Match or exceed the vehicle governed speed.',
        'Ply / star rating: fit at or above the approved rating for the duty cycle. Do not fit a',
        '  lighter casing on drive, steer or mixer positions.',
        'Mixed fitment: do not mix sizes, load indexes or brands across an axle. Both tyres on a',
        '  dual assembly must match in size and construction.',
        'Any tyre below the approved load, speed or ply rating is non-conforming and must be',
        '  removed from service.',
      ],
    },
    {
      n: '6',
      title: 'Approved Brand Governance',
      body: [
        'Purchase and fit only brands on the approved list for each vehicle type and position.',
        'The approved list includes premium brands and vetted value brands (including approved',
        '  value Chinese brands) that meet the required load, speed and ply ratings at a lower',
        '  cost per kilometre.',
        'No off-list brand may be fitted or purchased without written engineering sign-off recorded',
        '  against a work order.',
        'Vendor performance (cost, durability, failure frequency and CPK) is reviewed regularly and',
        '  may add or remove a brand from the approved list.',
      ],
    },
    {
      n: '7',
      title: 'Pressure and Tread Depth Minimums',
      body: [
        'Inflation pressure: maintain each position at the approved cold pressure (PSI) shown in',
        '  Section 4. Check cold, before running. Under-inflation and over-inflation are the leading',
        '  causes of premature wear and casing failure.',
        'Minimum tread depth: remove any tyre at or below the approved minimum tread (mm) in',
        '  Section 4. The legal minimum is a floor, not a target; replace at the approved minimum.',
        'Pressure and tread readings are recorded at every inspection and drive the compliance KPIs.',
      ],
    },
    {
      n: '8',
      title: 'Inspection and Verification Cadence',
      body: [
        'Daily: driver walk-around visual check for damage, low pressure and uneven wear.',
        'Weekly: workshop pressure verification across the fleet.',
        'At every service: full pressure and tread measurement, serial verification and fitment',
        '  conformance check against this policy.',
        'On fitment: record size, brand, load index, speed index, ply, pressure and serial so the',
        '  fitment can be audited against the approved standard.',
        'Missing, inconsistent or implausible readings are flagged as data quality issues for review.',
      ],
    },
    {
      n: '9',
      title: 'Non-Conformance and Escalation',
      body: [
        'When a non-conforming tyre is found (wrong size, brand, load, speed or ply, or below the',
        '  pressure / tread minimum), raise a work order immediately and record the finding.',
        'Grounding criteria (remove the vehicle from service until corrected):',
        '  - tread at or below the approved minimum on any position;',
        '  - visible casing damage, bulge, cut or exposed cords;',
        '  - a load or speed rating below the approved minimum;',
        '  - a mismatched pair on an axle or dual assembly.',
        'Escalate repeat or fleet-wide non-conformance to Fleet / Engineering for root cause analysis',
        '  and corrective action.',
      ],
    },
    {
      n: '10',
      title: 'Document Control and Revision',
      body: [
        'Version: 1.0',
        `Effective date: ${formatDate(date)}`,
        `Prepared by: ${generatedBy && String(generatedBy).trim() ? String(generatedBy).trim() : 'N/A'}`,
        'Approved by: Fleet / Engineering Manager',
        `Applies to: ${company} | Scope: ${scope}`,
        'Review cycle: this policy is reviewed at least annually or on any change to fleet',
        '  composition, regulation or approved vendor list. Superseded versions are retained for audit.',
        'This is a CONTROLLED DOCUMENT. Do not use printed copies beyond their effective revision.',
      ],
    },
  ]

  return sections
}

/**
 * Render the policy as an A4 portrait branded PDF (jsPDF).
 * ALWAYS returns the jsPDF doc so callers/tests can inspect without saving.
 */
export async function renderTyreSpecPolicyPdf({
  specs = [],
  company = 'TyrePulse',
  branding = null,
  country = null,
  generatedBy = '',
  filename = null,
  save = true,
} = {}) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const brand = await resolvePdfBrand(branding)
  const date = new Date()
  const scope = country && String(country).trim() ? String(country).trim() : 'All Countries'
  const sections = buildPolicySections({ specs, company, country, generatedBy, date })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const MX = 16
  const contentW = pageW - MX * 2
  const accent = Array.isArray(brand.accent) ? brand.accent : [79, 70, 229]

  // ── Cover page ──────────────────────────────────────────────────────────
  let cy = 26
  if (brand.logoData) {
    try {
      const fmt = /image\/jpe?g/i.test(brand.logoData) ? 'JPEG' : 'PNG'
      const logoW = 56
      let logoH = 26
      try {
        const props = doc.getImageProperties ? doc.getImageProperties(brand.logoData) : null
        if (props && props.width && props.height) logoH = (logoW * props.height) / props.width
      } catch { /* keep default height */ }
      doc.addImage(brand.logoData, fmt, (pageW - logoW) / 2, cy, logoW, logoH, undefined, 'FAST')
      cy += logoH + 10
    } catch { /* logo optional - continue without it */ }
  } else {
    cy += 6
  }

  doc.setDrawColor(...accent); doc.setLineWidth(0.8)
  doc.line(MX, cy, pageW - MX, cy)
  cy += 16

  doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(22)
  doc.text(doc.splitTextToSize('Tyre Fitment and Specification Policy', contentW), pageW / 2, cy, { align: 'center' })
  cy += 18

  doc.setFontSize(14); doc.setTextColor(...accent)
  doc.text(String(company), pageW / 2, cy, { align: 'center' })
  cy += 12

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(71, 85, 105)
  const coverLines = [
    'CONTROLLED DOCUMENT',
    `Scope: ${scope}`,
    'Version 1.0',
    `Generated: ${formatDate(date)}`,
    `Prepared by: ${generatedBy && String(generatedBy).trim() ? String(generatedBy).trim() : 'N/A'}`,
  ]
  for (const line of coverLines) {
    doc.text(line, pageW / 2, cy, { align: 'center' })
    cy += 8
  }

  doc.setDrawColor(...accent); doc.setLineWidth(0.4)
  doc.line(MX, pageH - 34, pageW - MX, pageH - 34)
  doc.setFontSize(8.5); doc.setTextColor(100, 116, 139)
  doc.text(
    'This is a controlled governance document. All staff must comply with the standards herein.',
    pageW / 2, pageH - 27, { align: 'center' },
  )
  pdfFooter(doc, 1, 1, company, brand)

  // ── Body sections ───────────────────────────────────────────────────────
  const headerTitle = 'Tyre Fitment and Specification Policy'
  const headerSub = `${company} | ${scope} | Version 1.0`
  const TOP = 30
  const BOTTOM = pageH - 18

  doc.addPage()
  pdfHeader(doc, headerTitle, headerSub, company, brand)
  let y = TOP

  const ensureSpace = (need) => {
    if (y + need > BOTTOM) {
      doc.addPage()
      pdfHeader(doc, headerTitle, headerSub, company, brand)
      y = TOP
    }
  }

  for (const sec of sections) {
    ensureSpace(16)
    // Section heading
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...accent)
    doc.text(`${sec.n}. ${sec.title}`, MX, y)
    y += 3
    doc.setDrawColor(...accent); doc.setLineWidth(0.3)
    doc.line(MX, y, pageW - MX, y)
    y += 6

    // Body lines
    if (Array.isArray(sec.body) && sec.body.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(51, 65, 85)
      for (const raw of sec.body) {
        const wrapped = doc.splitTextToSize(String(raw), contentW)
        for (const w of wrapped) {
          ensureSpace(6)
          doc.text(w, MX, y)
          y += 5
        }
      }
      y += 3
    }

    // Table (Approved Fitment Standards)
    if (sec.table && Array.isArray(sec.table.rows)) {
      ensureSpace(24)
      autoTable(doc, {
        ...pdfTableTheme(accent),
        startY: y,
        margin: { left: MX, right: MX, top: TOP },
        head: [sec.table.head],
        body: sec.table.rows,
        styles: { ...(pdfTableTheme(accent).styles || {}), fontSize: 7, cellPadding: 2 },
        headStyles: { ...(pdfTableTheme(accent).headStyles || {}), fontSize: 7 },
        didDrawPage: () => pdfHeader(doc, headerTitle, headerSub, company, brand),
      })
      y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 8
    }
  }

  // ── Approval / signature block ──────────────────────────────────────────
  ensureSpace(52)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...accent)
  doc.text('Approval', MX, y)
  y += 3
  doc.setDrawColor(...accent); doc.setLineWidth(0.3)
  doc.line(MX, y, pageW - MX, y)
  y += 12

  const colW = (contentW - 10) / 2
  const sigFields = [
    ['Prepared by', 'Approved by'],
    ['Effective date', 'Next review'],
  ]
  doc.setFontSize(9.5)
  for (const [left, right] of sigFields) {
    doc.setDrawColor(120, 130, 145); doc.setLineWidth(0.3)
    // underscore lines
    doc.line(MX, y, MX + colW, y)
    doc.line(MX + colW + 10, y, MX + colW + 10 + colW, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
    doc.text(left, MX, y + 5)
    doc.text(right, MX + colW + 10, y + 5)
    y += 20
  }

  // ── Footers on every page ───────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    pdfFooter(doc, p, totalPages, company, brand)
  }

  if (save) {
    doc.save(filename || `${reportFileName(company, 'Tyre Fitment Policy')}.pdf`)
  }
  return doc
}
