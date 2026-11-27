/**
 * Driver Concern outcome PDF: the original words, the machine translation (and
 * which model made it), the outcome, the driver's signature and the full
 * timeline. buildConcernDocument() is pure (tested); renderDriverConcernPdf()
 * lays it out on A4 and returns { blob, sha256 } so the hash can be stored
 * through driver_concern_set_pdf.
 *
 * Non-Latin scripts are drawn by the browser as images (jsPDF's built-in fonts
 * cannot shape Arabic, Urdu, Hindi, Bengali, Pashto or Nepali). If the browser
 * cannot draw them, a note says so rather than printing unreadable symbols.
 */
import { loadPdf } from './pdfEngine'
import { browserScriptTextToPng } from './driverChargePdf'
import { translationFor } from './driverConcerns'

const NON_LATIN = /[֐-ࣿऀ-෿ﭐ-﻿]/
const RTL = /[֐-ࣿﭐ-﻿]/
export const needsScriptImage = t => NON_LATIN.test(String(t || ''))
export const isRtlText = t => RTL.test(String(t || ''))

const fmt = v => {
  if (!v) return 'Not recorded'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

/**
 * @param detail payload of driver_concern_get
 * @param labels { category, subtype, status, event } label functions (English)
 */
export function buildConcernDocument(detail, { labels = {}, readerLang = 'en', generatedAt = new Date().toISOString() } = {}) {
  const c = detail?.concern || {}
  const lab = (fn, v) => (typeof fn === 'function' ? fn(v) : v) || v || 'Not recorded'
  const tr = translationFor(detail?.translations, 'concern', '', readerLang)
  const outcomeTr = translationFor(detail?.translations, 'outcome', '', readerLang)
  return {
    title: `Driver concern ${c.case_no || ''}`.trim(),
    generatedAt,
    facts: [
      ['Case', c.case_no || 'Not recorded'],
      ['Driver', detail?.driver_name || 'Not recorded'],
      ['Category', `${lab(labels.category, c.category)} / ${lab(labels.subtype, c.subtype)}`],
      ['Sensitive', c.sensitive ? 'Yes (handled by HR)' : 'No'],
      ['Site', [c.site, c.country].filter(Boolean).join(', ') || 'Not recorded'],
      ['Raised', fmt(c.created_at)],
      ['Logged for the driver', c.entered_verbally ? 'Yes, entered from what the driver said' : 'No'],
      ['Status', lab(labels.status, c.status)],
      ['Closed', fmt(c.closed_at)],
    ],
    original: { text: c.original_text || '', lang: c.original_lang || 'unknown' },
    translation: tr ? { text: tr.text, lang: tr.target_lang, model: tr.model, generatedAt: tr.generated_at } : null,
    outcome: c.outcome_text ? { text: c.outcome_text, translation: outcomeTr?.text || null, model: outcomeTr?.model || null } : null,
    decision: c.driver_decision ? {
      decision: c.driver_decision === 'accepted' ? 'Accepted' : 'Not accepted',
      seenAt: fmt(c.outcome_seen_at), signedAt: fmt(c.signed_at),
      inPerson: Boolean(c.signed_in_person_by), note: c.driver_decision_note || '',
      signature: c.driver_signature || null,
    } : null,
    labourOffice: 'The driver keeps the right to raise this matter with the labour office at any time.',
    timeline: (detail?.events || []).map(e => [fmt(e.created_at), lab(labels.event, e.event_type), e.actor_role || '', e.note || '']),
    chainOk: detail?.chain_ok !== false,
  }
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function renderDriverConcernPdf(detail, { labels, readerLang = 'en', save = true, scriptTextToPng = browserScriptTextToPng } = {}) {
  const model = buildConcernDocument(detail, { labels, readerLang })
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const margin = 14
  const width = doc.internal.pageSize.getWidth(); const bottom = doc.internal.pageSize.getHeight() - 18
  const ensure = (y, need) => (y + need > bottom ? (doc.addPage(), 18) : y)
  const para = (text, y, size = 9) => {
    if (needsScriptImage(text)) {
      const img = scriptTextToPng?.(text, { widthMm: width - margin * 2, rtl: isRtlText(text) })
      if (img?.dataUrl) {
        y = ensure(y, img.heightMm + 2)
        doc.addImage(img.dataUrl, 'PNG', margin, y, img.widthMm, img.heightMm, undefined, 'FAST')
        return y + img.heightMm + 2
      }
      text = 'This browser could not draw this language. Open the PDF from Chrome, Edge or Safari.'
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size)
    const lines = doc.splitTextToSize(String(text || ''), width - margin * 2)
    y = ensure(y, lines.length * size * 0.42 + 2)
    doc.text(lines, margin, y + size * 0.4)
    return y + lines.length * size * 0.42 + 2
  }
  const heading = (text, y) => {
    y = ensure(y, 9)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(text, margin, y + 4)
    return y + 7
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(model.title, margin, 18)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(`Generated ${fmt(model.generatedAt)}${model.chainOk ? '' : '  |  WARNING: the history chain did not verify'}`, margin, 23)
  autoTable(doc, { startY: 27, body: model.facts, theme: 'plain', styles: { fontSize: 9, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 48 } }, margin: { left: margin, right: margin } })
  let y = doc.lastAutoTable.finalY + 4

  y = heading(`What the driver wrote (original, ${model.original.lang})`, y)
  y = para(model.original.text, y)
  if (model.translation) {
    y = heading(`Machine translation (${model.translation.lang}, ${model.translation.model})`, y)
    y = para(model.translation.text, y)
  }
  if (model.outcome) {
    y = heading('Answer approved by the manager', y)
    y = para(model.outcome.text, y)
    if (model.outcome.translation) {
      y = heading(`Machine translation for the driver (${model.outcome.model || 'model'})`, y)
      y = para(model.outcome.translation, y)
    }
  }
  if (model.decision) {
    y = heading(`Driver decision: ${model.decision.decision}`, y)
    y = para(`Seen: ${model.decision.seenAt}   Signed: ${model.decision.signedAt}${model.decision.inPerson ? '   (signed in person on a handler device)' : ''}`, y)
    if (model.decision.note) y = para(model.decision.note, y)
    if (model.decision.signature?.startsWith('data:image/')) {
      y = ensure(y, 30)
      try { doc.addImage(model.decision.signature, 'PNG', margin, y, 60, 25) } catch { /* unreadable image: skip */ }
      y += 28
    }
  }
  y = para(model.labourOffice, y, 8)
  y = heading('Timeline', y)
  autoTable(doc, {
    startY: y, head: [['When', 'What', 'Role', 'Note']], body: model.timeline.map(r => r.map(v => (needsScriptImage(v) ? '(see app, non-Latin text)' : v))),
    styles: { fontSize: 8, cellPadding: 1.2 }, headStyles: { fillColor: [55, 65, 81] }, margin: { left: margin, right: margin },
  })

  const buffer = doc.output('arraybuffer')
  const sha256 = await sha256Hex(buffer)
  const blob = new Blob([buffer], { type: 'application/pdf' })
  if (save) doc.save(`Driver concern ${detail?.concern?.case_no || ''}.pdf`.replace(/\s+\.pdf$/, '.pdf'))
  return { blob, sha256 }
}
