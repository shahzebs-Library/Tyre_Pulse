import fs from 'node:fs';
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
edit('src/lib/checklist/fieldTypes.js',s=>s+`
/** Contradictory answers are preserved in history and surfaced for review. */
export function checklistReviewIssues(fields = [], answers = {}) {
  const faults = fields.filter(f => /^(not ok|not_ok|fail|failed)$/i.test(String(answers[f.id] ?? '').trim()))
  const fitness = fields.filter(f => /fit for (operation|service|use)/i.test(f.label || '') && /^(yes|true)$/i.test(String(answers[f.id] ?? '')))
  const issues = []
  if (faults.length && fitness.length) issues.push('Fitness certification conflicts with unresolved Not OK checks. Review and correct the answers before certifying the vehicle.')
  for (const f of fields) {
    if (f.type !== 'number' || !/(?:\\bkm\\b|odometer|hour.?meter|engine.?hours|kilomet)/i.test(f.label || '')) continue
    const value = answers[f.id]
    if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) issues.push((f.label || 'Meter reading') + ': invalid recorded meter value. An audited correction is required.')
  }
  return issues
}
`);
edit('src/pages/ChecklistRun.jsx',s=>s.replace('blankAnswer, validateSubmission,','blankAnswer, validateSubmission, checklistReviewIssues,').replace('    // The meter pair. Either reading',"    const reviewIssues = checklistReviewIssues(visibleFields(fields, answers), answers)\n    if (reviewIssues.length) { setSubmitError(reviewIssues.join(' ')); return }\n    // The meter pair. Either reading"));
edit('src/lib/checklistPdf.js',s=>s.replace("import { langMeta", "import { checklistReviewIssues } from './checklist/fieldTypes'\nimport { langMeta").replace('  const attention = allChecks.filter',`  const reviewIssues = checklistReviewIssues(fields, sub.answers || {})
  if (reviewIssues.length) {
    sectionBar('Record requires review')
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...FAULT)
    for (const issue of reviewIssues) {
      const lines = doc.splitTextToSize(issue, pw - MX * 2)
      need(lines.length * 4 + 3); doc.text(lines, MX, y); y += lines.length * 4 + 3
    }
  }
  const attention = allChecks.filter`).replace("? 'Nothing needed attention. Every check on this sheet was recorded OK or not applicable.'", "? (blankCount ? 'Some checks were not recorded. This sheet is incomplete.' : 'Nothing needed attention. Every check on this sheet was recorded OK or not applicable.')").replace('  sectionBar(`Photographs (${items.length})`)',"  need(26)\n  sectionBar(`Photographs (${items.length})`)\n  if (items.length) {\n    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED)\n    doc.text('Attachments as submitted. Verify the vehicle identity and the check shown in each photo.', MX, y)\n    y += 6\n  }").replace("  sectionBar('Signatures')","  need(sigs.length ? 47 : 18)\n  sectionBar('Signatures')").replace('margin: { left: MX, right: MX },','margin: { top: 30, bottom: 18, left: MX, right: MX },'));
