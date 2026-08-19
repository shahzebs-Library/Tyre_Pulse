/**
 * The checklist as it comes out of the printer.
 *
 * There is ONE renderer because there is one sheet. The workshop already uses a
 * paper form - numbered lines, a status box, a REMARKS column beside every line,
 * a legend of the six statuses, and a block of signatures at the bottom - and
 * what we print has to be that form. Anything the screen shows and the paper
 * omits is evidence that quietly went missing.
 *
 * It reads the submission through checklistView.js, exactly as the on-screen
 * reader does, so the two cannot disagree about what was recorded.
 *
 * SCRIPT SUPPORT, STATED PLAINLY. jsPDF ships only the 14 standard PDF fonts,
 * all of them Latin. Handing Arabic, Urdu or Hindi text to those fonts does not
 * fail - it silently emits the wrong glyphs, so the page LOOKS printed and is
 * unreadable. Arabic and Urdu additionally need contextual shaping and a
 * right-to-left run, which jsPDF does not do even with an embedded font. So this
 * renderer checks every string before it draws it: anything the font cannot
 * carry falls back to the English wording, and the document says so in a banner
 * on page one. An honest English sheet beats a page of broken glyphs.
 */

import { loadPdf } from './pdfEngine'
import {
  resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme, PDF_COLORS,
} from './exportUtils'
import {
  submissionSections, submissionSignatures, legendOptions, templateTitle, documentNo,
  templateFieldsOf, templateFromSubmission,
} from './checklistView'
import { gridFields, monthlySummary, cellText, isNotOk } from './checklistMonthly'
import { langMeta, normalizeLang } from './checklist/checklistI18n'

const MX = 12                 // page margin, mm
const MAX_PHOTOS = 40
const INK = [15, 23, 42]
const MUTED = [100, 116, 139]
const LINE = [203, 213, 225]
const PAPER = [248, 250, 252]
const FAULT = [190, 24, 93]

/**
 * Can the standard PDF fonts actually draw this string?
 *
 * Deliberately conservative: ASCII plus the Latin-1 supplement, which is what
 * jsPDF's WinAnsi encoding covers. Anything else - Arabic, Devanagari, an
 * Urdu-specific form - is refused rather than mangled.
 */
export function canRenderText(value) {
  const s = value == null ? '' : String(value)
  if (!s) return true
  return /^[\t\n\r\x20-\x7E\u00A0-\u00FF]*$/.test(s)
}

/**
 * A string the PDF can carry: the translation when it is renderable, otherwise
 * the English original. Records that a substitution happened so the reader is
 * told rather than left to wonder why the sheet is in English.
 */
function pick(translated, english, state) {
  const t = translated == null ? '' : String(translated)
  const e = english == null ? '' : String(english)
  if (t && canRenderText(t)) {
    // A string that is byte-identical to the English is not evidence that a
    // translation exists - it is the fallback checklistI18n already applied.
    if (t !== e) state.translated = true
    return t
  }
  if (t) state.fellBack = true
  return canRenderText(e) ? e : ''
}

// The language list, its names and its direction live in checklistI18n - a
// second copy here would be the drift this codebase keeps paying for.
function langName(code) { return langMeta(code)?.label || String(code || 'English') }

/**
 * The name the file lands under in the operator's Downloads folder.
 *
 * The old name was `Checklist TM514 English.pdf` for every sheet that machine
 * ever produced, so a folder of them sorted into an indistinguishable pile and
 * the only way to tell two apart was to open both. A checklist already has a
 * unique identity - V594 mints a document number on insert (WDC-TM514-2026-0001)
 * - and that number is what the workshop files the paper copy under, so the
 * download should carry it too.
 *
 * HYPHENS ARE DELIBERATELY KEPT. `reportFileName` strips every non-alphanumeric,
 * which turns WDC-TM514-2026-0001 into "WDC TM514 2026 0001" - four fragments
 * that no longer match the number printed on the sheet or stored in the
 * register. Hyphens are safe in a filename on every platform this ships to, so
 * this sanitises locally rather than routing through that helper.
 *
 * "English" is not appended: the overwhelming majority of sheets are English and
 * a suffix that is true of nearly every file distinguishes nothing. A non-English
 * sheet does say so, because that one IS worth telling apart.
 */
export function checklistFileName(parts, { lang = 'en' } = {}) {
  const clean = (v) => String(v == null ? '' : v)
    .replace(/[^A-Za-z0-9 ()\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const out = (Array.isArray(parts) ? parts : [parts]).map(clean).filter(Boolean)
  const code = normalizeLang(lang)
  if (code && code !== 'en') out.push(clean(langName(code)))
  return out.join(' ').slice(0, 120) || 'Checklist'
}

/** The date a sheet belongs to, as YYYY-MM-DD. Blank when nothing was recorded. */
function fileDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function fmtDateTime(v) {
  if (!v) return 'Not recorded'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

/**
 * Fetch an image to a data URL. Never throws: a blocked, slow or oversized image
 * is skipped and the slot says so, because one bad URL must not cost the report.
 */
async function fetchImage(url) {
  if (!url || typeof url !== 'string') return null
  if (/^data:image\//i.test(url)) return { dataUrl: url, fmt: /png/i.test(url) ? 'PNG' : 'JPEG' }
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return null
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctrl && typeof setTimeout === 'function' ? setTimeout(() => ctrl.abort(), 12000) : null
    let res
    try { res = await fetch(url, { mode: 'cors', signal: ctrl ? ctrl.signal : undefined }) }
    finally { if (timer && typeof clearTimeout === 'function') clearTimeout(timer) }
    if (!res || !res.ok) return null
    const blob = await res.blob()
    if (!blob.type || !blob.type.startsWith('image/') || blob.size > 8000000) return null
    const fmt = /png/i.test(blob.type) ? 'PNG' : /webp/i.test(blob.type) ? 'WEBP' : 'JPEG'
    const dataUrl = await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
    return dataUrl ? { dataUrl, fmt } : null
  } catch { return null }
}

/**
 * The sheet's brand: a big logo, the company green, and no company name in text.
 *
 * THREE THINGS, and each was a real gap:
 *
 * 1. THE LOGO WAS USUALLY ABSENT. `resolvePdfBrand` reads `branding.logo_url`
 *    from tenant branding, but the org logo is actually administered in
 *    Console -> Report Colors, which stores it in `system_config.company_logo`.
 *    Inspections.jsx already carried a private `brandingForPdf` fallback for
 *    exactly this; the checklist had no such fallback, so it printed no logo at
 *    all unless a tenant-branding row happened to exist. Same fallback, applied
 *    once here so all three checklist surfaces inherit it.
 *
 * 2. THE LOGO WAS SMALL. `pdfHeader` defaulted to 14 mm and had no route to pass
 *    anything else. 18 mm reads across a desk and still clears the hairline
 *    that closes the 23 mm header band (a 20 mm mark lands exactly on it).
 *
 * 3. THE COMPANY NAME WAS SET IN TYPE ABOVE THE TITLE. On a sheet that already
 *    carries the logo, the uppercase eyebrow was redundant, and the owner asked
 *    for it gone. The logo carries the identity now.
 *
 * The accent falls back to the brand green rather than the app-wide indigo, so
 * the header rule, the title underline and the table headers all match the mark
 * in the logo. A tenant that has set its own `primary_color` still wins.
 */
async function checklistBrand(branding) {
  let b = branding
  if (!b?.logo_url) {
    try {
      const { getCompanyLogo } = await import('./api/brandLogo')
      const logo = await getCompanyLogo()
      if (logo) b = { ...(branding || {}), logo_url: logo }
    } catch { /* a missing logo must never cost the sheet */ }
  }
  const brand = await resolvePdfBrand(b)
  if (!branding?.primary_color) brand.accent = PDF_COLORS.green
  return brand
}

/** Header options shared by both checklist documents. */
const CHECKLIST_HEADER = { logoSize: 18, hideEyebrow: true }

/** Table theme with the logo green in the header row. */
function checklistTheme(brand) {
  return pdfTableTheme(brand.accent, { headFill: PDF_COLORS.green })
}

/**
 * Render one completed checklist.
 *
 * @param {object}  opts
 * @param {object}  opts.submission  the submission row (answers, photos, notes, signatures)
 * @param {object}  [opts.template]  the template row (fields, option sets, translated names)
 * @param {string}  [opts.lang]      'en' | 'ar' | 'hi' | 'ur'
 * @param {object}  [opts.branding]  tenant branding for the header logo
 * @param {string}  [opts.company]   printed in the footer
 * @param {boolean} [opts.save]      true (default) saves the file; false returns the doc
 * @returns {Promise<{doc, filename, fellBack:boolean, language:string}>}
 */
export async function renderChecklistPdf({
  submission, template: templateArg = null, lang = 'en', branding = null, company = '',
  filename = null, save = true,
} = {}) {
  const sub = submission || {}
  // A loaded submission already carries its fields and its template's
  // translations, so a caller does not have to fetch the template a second time.
  const template = templateArg || templateFromSubmission(sub)
  const language = normalizeLang(lang)
  const state = { fellBack: false, translated: false }

  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.width
  const ph = doc.internal.pageSize.height
  const brand = await checklistBrand(branding)
  const theme = checklistTheme(brand)

  const titleTranslated = templateTitle(template, sub, language)
  const titleEnglish = String(template?.name || sub.template_name || 'Checklist')
  const title = pick(titleTranslated, titleEnglish, state)

  const header = () => pdfHeader(doc, title, sub.asset_no ? `Asset: ${sub.asset_no}` : '', company, brand, CHECKLIST_HEADER)
  header()
  let y = 30

  const need = (h) => { if (y + h > ph - 18) { doc.addPage(); header(); y = 30 } }

  const sectionBar = (label) => {
    need(12)
    doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
    doc.rect(MX, y, pw - MX * 2, 7, 'FD')
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK)
    doc.text(label, MX + 3, y + 4.8)
    y += 9
  }

  // ── Identification block ──────────────────────────────────────────────────
  const fields = templateFieldsOf(sub, template) || []
  const checkIds = new Set(gridFields(fields).map((f) => f.id))
  const sections = submissionSections(sub, { template, lang: language, includeUnanswered: true })

  // The paper sheet numbers its CHECKS 1..N and runs that count across its
  // sections; the identification fields above them are not numbered lines. So
  // the printed number is computed over the check rows only.
  const checkNo = new Map()
  {
    let n = 0
    for (const s of sections) {
      for (const r of s.rows) {
        if (!checkIds.has(r.id)) continue
        n += 1
        checkNo.set(r.id, n)
      }
    }
  }

  const meta = []
  for (const s of sections) {
    for (const r of s.rows) {
      if (checkIds.has(r.id)) continue
      if (!r.answered) continue
      meta.push([pick(r.label, r.englishLabel, state), pick(r.text, r.text, state) || 'Not recorded'])
    }
  }
  // The document number leads the identification block: it is the reference the
  // filed sheet is known by. Absent when the template mints none, in which case
  // nothing is printed rather than a placeholder somebody would go on to quote.
  const docRef = documentNo(sub)
  if (docRef) meta.unshift(['Document no', docRef])
  meta.push(['Submitted', fmtDateTime(sub.submitted_at || sub.created_at)])
  if (sub.site) meta.push(['Site', String(sub.site)])
  if (sub.country) meta.push(['Country', String(sub.country)])

  sectionBar('Identification')
  {
    const half = (pw - MX * 2) / 2
    for (let i = 0; i < meta.length; i += 2) {
      need(9)
      const pair = [meta[i], meta[i + 1]]
      pair.forEach((cell, col) => {
        if (!cell) return
        const x = MX + col * half
        doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED)
        doc.text(doc.splitTextToSize(String(cell[0]), half - 6)[0] || '', x, y)
        doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK)
        doc.text(doc.splitTextToSize(String(cell[1]), half - 6)[0] || '', x, y + 4.4)
        doc.setDrawColor(...LINE); doc.setLineWidth(0.2)
        doc.line(x, y + 6.2, x + half - 5, y + 6.2)
      })
      y += 9
    }
  }
  y += 2

  // ── The checks, section by section, with the remarks column ───────────────
  let printedChecks = 0
  for (const s of sections) {
    const rows = s.rows.filter((r) => checkIds.has(r.id))
    if (!rows.length) continue
    sectionBar(pick(s.label, s.label, state))
    const body = rows.map((r) => [
      String(checkNo.get(r.id) ?? r.line),
      pick(r.label, r.englishLabel, state),
      r.text ? pick(r.text, r.text, state) : 'Not recorded',
      r.note ? pick(r.note, r.note, state) : '',
    ])
    printedChecks += rows.length
    autoTable(doc, {
      ...theme,
      startY: y,
      head: [['#', 'Check', 'Status', 'Remarks']],
      body,
      margin: { left: MX, right: MX },
      styles: { ...theme.styles, fontSize: 7.5, cellPadding: 1.4, overflow: 'linebreak' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 88 },
        2: { cellWidth: 26 },
        3: { cellWidth: 'auto' },
      },
      // A reported fault is the reason anyone reads this sheet, so it is marked
      // in the printed copy and not left to look like every other line.
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const status = body[data.row.index]?.[2]
        if (isNotOk(rows[data.row.index]?.value) || /^not ok$/i.test(String(status))) {
          data.cell.styles.textColor = FAULT
          if (data.column.index === 2) data.cell.styles.fontStyle = 'bold'
        }
      },
      didDrawPage: (data) => { if (data.pageNumber > 1) header() },
    })
    y = (doc.lastAutoTable?.finalY ?? y) + 5
  }

  if (!printedChecks) {
    need(14)
    doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED)
    doc.text('This checklist recorded no inspection lines.', MX, y)
    y += 8
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  const legend = legendOptions(template, language)
  if (legend.length) {
    sectionBar('Status legend')
    const text = legend
      .map((o) => `${o.value}${o.label !== o.value && canRenderText(o.label) ? ` (${o.label})` : ''}`)
      .join('   |   ')
    const lines = doc.splitTextToSize(text, pw - MX * 2 - 4)
    need(lines.length * 4 + 4)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK)
    doc.text(lines, MX + 2, y + 1)
    y += lines.length * 4 + 4
    if (legend.some((o) => o.label !== o.value && !canRenderText(o.label))) state.fellBack = true
  }

  // ── Photographs, labelled by the line they belong to ──────────────────────
  const items = []
  for (const s of sections) {
    for (const r of s.rows) {
      for (const url of r.photos) {
        if (typeof url === 'string' && url) {
          const n = checkNo.get(r.id)
          const lead = n ? `${n}. ` : ''
          items.push({ label: `${lead}${pick(r.label, r.englishLabel, state)}`, url })
        }
      }
    }
  }

  sectionBar(`Photographs (${items.length})`)
  if (!items.length) {
    doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED)
    doc.text('No photographs were captured with this checklist.', MX + 2, y + 1)
    y += 7
  } else {
    const shown = items.slice(0, MAX_PHOTOS)
    const cols = 3
    const gap = 5
    const boxW = (pw - MX * 2 - gap * (cols - 1)) / cols
    const imgH = boxW * 0.72
    const boxH = imgH + 9
    let col = 0
    let top = y
    for (const item of shown) {
      if (col === 0) { need(boxH + 4); top = y }
      const x = MX + col * (boxW + gap)
      doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
      doc.rect(x, top, boxW, boxH, 'FD')
      let drawn = false
      const got = await fetchImage(item.url)
      if (got) {
        try {
          let dW = boxW - 4; let dH = imgH - 4; let ox = x + 2; let oy = top + 2
          try {
            const p = doc.getImageProperties ? doc.getImageProperties(got.dataUrl) : null
            if (p && p.width && p.height) {
              const ar = p.width / p.height
              if (ar > dW / dH) { dH = dW / ar; oy = top + 2 + (imgH - 4 - dH) / 2 }
              else { dW = dH * ar; ox = x + 2 + (boxW - 4 - dW) / 2 }
            }
          } catch { /* fall back to box-fill sizing */ }
          doc.addImage(got.dataUrl, got.fmt, ox, oy, dW, dH, undefined, 'FAST')
          drawn = true
        } catch { drawn = false }
      }
      if (!drawn) {
        doc.setFontSize(6.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED)
        doc.text('image unavailable', x + boxW / 2, top + imgH / 2, { align: 'center' })
      }
      doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK)
      doc.text(doc.splitTextToSize(item.label, boxW - 4)[0] || '', x + 2, top + imgH + 5)
      col += 1
      if (col >= cols) { col = 0; y = top + boxH + gap }
    }
    if (col !== 0) y = top + boxH + gap
    if (items.length > shown.length) {
      need(8)
      doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED)
      doc.text(`${items.length - shown.length} further photograph(s) not printed.`, MX, y)
      y += 6
    }
  }

  // ── Signatures: every one of them ─────────────────────────────────────────
  const sigs = submissionSignatures(sub, { template, lang: language })
  sectionBar('Signatures')
  if (!sigs.length) {
    doc.setFontSize(7.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED)
    doc.text('This checklist carries no signature.', MX + 2, y + 1)
    y += 7
  } else {
    const cols = Math.min(3, sigs.length)
    const gap = 6
    const boxW = (pw - MX * 2 - gap * (cols - 1)) / cols
    const boxH = 34
    let col = 0
    let top = y
    for (const s of sigs) {
      if (col === 0) { need(boxH + 4); top = y }
      const x = MX + col * (boxW + gap)
      doc.setDrawColor(...LINE); doc.setLineWidth(0.3)
      doc.setFillColor(255, 255, 255)
      doc.rect(x, top, boxW, boxH, 'FD')
      if (s.data && /^data:image\//i.test(s.data)) {
        try { doc.addImage(s.data, /png/i.test(s.data) ? 'PNG' : 'JPEG', x + 2, top + 2, boxW - 4, 16, undefined, 'FAST') }
        catch { /* a malformed data url just leaves the box empty */ }
      } else {
        doc.setFontSize(6.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED)
        doc.text('Not signed', x + boxW / 2, top + 11, { align: 'center' })
      }
      doc.setDrawColor(...LINE); doc.line(x + 2, top + 19, x + boxW - 2, top + 19)
      doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED)
      doc.text(doc.splitTextToSize(pick(s.label, s.label, state), boxW - 4)[0] || '', x + 2, top + 23)
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK)
      doc.text(doc.splitTextToSize(s.printedName || 'Name not recorded', boxW - 4)[0] || '', x + 2, top + 28.5)
      col += 1
      if (col >= cols) { col = 0; y = top + boxH + gap }
    }
    if (col !== 0) y = top + boxH + gap
  }

  // ── The language notice, drawn last so it can tell the truth ──────────────
  // Two different reasons produce an English page, and they call for different
  // actions: one is a limit of this engine, the other is a translation nobody
  // has written yet. Reporting them as one message would send someone to fix
  // the wrong thing.
  if (language !== 'en') {
    doc.setPage(1)
    const name = langName(language)
    doc.setFontSize(6.8); doc.setTextColor(...MUTED)
    let msg
    if (state.fellBack) {
      doc.setFont('helvetica', 'italic')
      msg = `${name} was requested. This PDF engine can print Latin characters only, so the ${name} wording could not be drawn and the English text is printed in its place.`
    } else if (!state.translated) {
      doc.setFont('helvetica', 'italic')
      msg = `${name} was requested, but this checklist carries no ${name} translation. The English wording is printed.`
    } else {
      doc.setFont('helvetica', 'normal')
      msg = `Language: ${name}`
    }
    doc.text(msg, MX, 26, { maxWidth: pw - MX * 2 })
  }

  const total = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p)
    // No company name in text: the logo identifies the sheet (see checklistBrand).
    pdfFooter(doc, p, total, '', { ...brand, footerText: brand.footerText || 'Confidential, for internal distribution only' })
  }

  // The document number identifies the sheet on its own, so the asset code is
  // only added when there is no number to carry it (it is already inside one).
  const docRefName = documentNo(sub)
  const name = filename || checklistFileName(
    [title, docRefName || sub.asset_no || sub.id, fileDate(sub.submitted_at || sub.created_at)],
    { lang: language },
  )
  if (save) doc.save(`${name}.pdf`)
  return { doc, filename: `${name}.pdf`, fellBack: state.fellBack, translated: state.translated, language }
}

/**
 * The month grid as the paper sheet: checks down, days across, landscape.
 * An empty cell is a day nobody recorded, and the summary says how many.
 */
export async function renderMonthlyGridPdf({
  grid, template = null, assetNo = '', lang = 'en', branding = null, company = '',
  today = null, filename = null, save = true,
} = {}) {
  const language = normalizeLang(lang)
  const state = { fellBack: false, translated: false }
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.width
  const brand = await checklistBrand(branding)
  const theme = checklistTheme(brand)

  const title = pick(templateTitle(template, {}, language), String(template?.name || 'Checklist'), state)
  const monthLabel = grid
    ? new Date(Date.UTC(grid.year, grid.month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : ''
  const head = () => pdfHeader(doc, title, [assetNo, monthLabel].filter(Boolean).join('  |  '), company, brand, CHECKLIST_HEADER)
  head()
  let y = 30

  const summary = monthlySummary(grid, { today })
  const tiles = [
    ['Days recorded', String(summary.submitted)],
    ['Days missed', String(summary.missed)],
    ['Not yet due', String(summary.pending)],
    ['Lines not OK', String(summary.notOk)],
    ['Coverage', summary.coveragePct == null ? 'Not yet measurable' : `${summary.coveragePct}%`],
  ]
  const tw = (pw - MX * 2) / tiles.length
  tiles.forEach(([label, value], i) => {
    const x = MX + i * tw
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED)
    doc.text(label, x, y)
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK)
    doc.text(value, x, y + 6)
  })
  y += 12

  if (!grid || !grid.rows.length) {
    doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(...MUTED)
    doc.text('This checklist has no daily check lines to plot.', MX, y)
  } else {
    const days = grid.days
    autoTable(doc, {
      ...theme,
      startY: y,
      head: [['#', 'Check', ...days.map(String)]],
      body: grid.rows.map((r, i) => [
        String(i + 1),
        pick(r.label, String(r.field?.label || r.id), state),
        ...days.map((d) => cellText(r.byDay[d])),
      ]),
      margin: { left: MX, right: MX },
      styles: { ...theme.styles, fontSize: 5.6, cellPadding: 0.6, halign: 'center', overflow: 'linebreak' },
      headStyles: { ...theme.headStyles, fontSize: 5.6 },
      columnStyles: {
        0: { cellWidth: 6 },
        1: { cellWidth: 62, halign: 'left', fontSize: 6 },
      },
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index < 2) return
        const day = days[data.column.index - 2]
        if (grid.missingDays.includes(day)) data.cell.styles.fillColor = [254, 242, 242]
        if (String(data.cell.raw) === 'X') { data.cell.styles.textColor = FAULT; data.cell.styles.fontStyle = 'bold' }
      },
      didDrawPage: (data) => { if (data.pageNumber > 1) head() },
    })
    y = (doc.lastAutoTable?.finalY ?? y) + 6
  }

  // Missed days are named, not merely counted: "12 missed" does not tell anyone
  // which machine sat unchecked over a weekend.
  if (grid && grid.missingDays.length) {
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...FAULT)
    doc.text(`Days with no checklist: ${grid.missingDays.join(', ')}`, MX, y, { maxWidth: pw - MX * 2 })
    y += 7
  }

  if (grid && grid.remarks.length) {
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK)
    doc.text('Remarks', MX, y); y += 3
    autoTable(doc, {
      ...theme,
      startY: y,
      head: [['Day', 'Line', 'Remark']],
      body: grid.remarks.map((r) => [String(r.day), pick(r.label, r.label, state), pick(r.note, r.note, state)]),
      margin: { left: MX, right: MX },
      styles: { ...theme.styles, fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 12 }, 1: { cellWidth: 70 } },
      didDrawPage: (data) => { if (data.pageNumber > 1) head() },
    })
  }

  const total = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p)
    // No company name in text: the logo identifies the sheet (see checklistBrand).
    pdfFooter(doc, p, total, '', { ...brand, footerText: brand.footerText || 'Confidential, for internal distribution only' })
  }

  const name = filename || checklistFileName([title, assetNo, monthLabel], { lang: language })
  if (save) doc.save(`${name}.pdf`)
  return { doc, filename: `${name}.pdf`, fellBack: state.fellBack, translated: state.translated, language }
}

export default { renderChecklistPdf, renderMonthlyGridPdf, canRenderText }
