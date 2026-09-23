import { exportToExcel, exportToPdf, reportFileName } from './exportUtils'
import { loadPdf } from './pdfEngine'
import { signatureImage } from './driverWorkspace'

const REGISTER_COLUMNS = ['notice_reference', 'driver_name', 'employee_id', 'asset_no', 'authority', 'incident_at', 'due_date', 'currency', 'amount', 'paid_amount', 'balance', 'status', 'response_status', 'review_stage', 'resolution', 'signed_at', 'last_reviewer', 'last_payment_reference', 'reminder_count']
const REGISTER_HEADERS = ['Notice', 'Driver', 'Employee ID', 'Vehicle', 'Authority', 'Incident', 'Due', 'Currency', 'Amount', 'Paid', 'Balance', 'Case status', 'Response', 'Review stage', 'Resolution', 'Signed at', 'Last reviewer', 'Payment reference', 'Reminders']

function registerRows(rows) {
  return rows.map(row => ({
    ...row,
    incident_at: row.incident_at ? new Date(row.incident_at).toLocaleString() : '',
    signed_at: row.signed_at ? new Date(row.signed_at).toLocaleString() : '',
  }))
}

export function exportDriverFineRegisterExcel(rows) {
  return exportToExcel(registerRows(rows), REGISTER_COLUMNS, REGISTER_HEADERS, reportFileName('Driver Fine Register'), 'Fine Register')
}

export function exportDriverFineRegisterPdf(rows) {
  const columns = REGISTER_COLUMNS.map((key, index) => ({ key, header: REGISTER_HEADERS[index] }))
  return exportToPdf(registerRows(rows), columns, 'Driver Fine Register', reportFileName('Driver Fine Register'), 'landscape')
}

function value(value) {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  return String(value)
}

async function signaturePng(signature) {
  const src = signatureImage(signature)
  if (src.startsWith('data:image/png')) return src
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(image.naturalWidth, 600)
      canvas.height = Math.max(image.naturalHeight, 180)
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('A recorded signature could not be rendered.'))
    image.src = src
  })
}

export async function exportDriverFineCasePdf({ driver, fine, events, signatures }) {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Traffic Fine Case Record', 14, 16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`Generated ${new Date().toLocaleString()} · Internal operational record`, 14, 22)
  autoTable(doc, {
    startY: 28,
    head: [['Field', 'Recorded value']],
    body: [
      ['Driver', `${value(driver.driver_name)} · ${value(driver.driver_id)}`], ['Site / country', `${value(fine.site)} · ${value(fine.country)}`],
      ['Notice / authority', `${value(fine.notice_reference)} · ${value(fine.authority)}`], ['Vehicle', value(fine.asset_no)],
      ['Incident', fine.incident_at ? new Date(fine.incident_at).toLocaleString() : 'Not recorded'], ['Due date', value(fine.due_date)],
      ['Amount', `${value(fine.currency)} ${value(fine.amount)}`], ['Paid / balance', `${value(fine.paid_amount)} / ${Number(fine.amount) - Number(fine.paid_amount)} ${value(fine.currency)}`],
      ['Status', `${value(fine.status)} · ${value(fine.response_status)} · ${value(fine.review_stage)}`], ['Notice version', value(fine.version)],
      ['Description', value(fine.description)], ['Assignment evidence', value(fine.assignment_reason)],
      ['Lineage', fine.supersedes_fine_id ? `Reassigned from ${fine.supersedes_fine_id}` : fine.superseded_by_fine_id ? `Reassigned to ${fine.superseded_by_fine_id}` : 'Original case'],
    ],
    styles: { fontSize: 8, cellPadding: 2 }, columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold' } },
  })
  let y = doc.lastAutoTable.finalY + 7
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Signed driver responses', 14, y); y += 4
  if (!(fine.responses || []).length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('No signed response recorded.', 14, y + 4); y += 10
  }
  for (const response of fine.responses || []) {
    autoTable(doc, { startY: y, head: [['Signed at', 'Version', 'Resolution', 'Statement', 'Explanation / payment']], body: [[
      new Date(response.signed_at).toLocaleString(), response.notice_version, value(response.resolution), `${value(response.statement_version)} · ${value(response.statement_language)}`, `${value(response.explanation)}${response.payment_reference ? ` · ${response.payment_reference}` : ''}`,
    ]], styles: { fontSize: 7.5, cellPadding: 1.8 } })
    y = doc.lastAutoTable.finalY + 3
    const signature = signatures.get(response.id)
    if (signature) {
      if (y > 245) { doc.addPage(); y = 18 }
      const png = await signaturePng(signature)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('Recorded signature', 14, y + 3)
      doc.addImage(png, 'PNG', 14, y + 5, 65, 20, undefined, 'FAST'); y += 29
    }
  }
  if (y > 235) { doc.addPage(); y = 18 }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Review and settlement decisions', 14, y); y += 4
  autoTable(doc, { startY: y, head: [['Time', 'Stage', 'Decision', 'Reviewer', 'Reason', 'Payment']], body: (fine.reviews || []).map(review => [new Date(review.created_at).toLocaleString(), value(review.stage), value(review.decision), value(review.reviewer_name), value(review.reason), review.details?.payment_reference ? `${review.details.payment_reference} · ${value(review.details.payment_amount)} ${value(fine.currency)}` : '']), styles: { fontSize: 7.5, cellPadding: 1.8 } })
  y = doc.lastAutoTable.finalY + 7
  if (y > 235) { doc.addPage(); y = 18 }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Evidence and reminders', 14, y); y += 4
  autoTable(doc, { startY: y, head: [['Type', 'File / date', 'Recorded by / recipients']], body: [
    ...(fine.evidence || []).map(item => [`Evidence · ${value(item.kind)}`, value(item.file_name), value(item.uploaded_by)]),
    ...(fine.reminders || []).map(item => [`Reminder · ${value(item.kind)}`, value(item.reminder_date), `${value(item.status)} · ${value(item.recipient_count)} recipient(s)`]),
  ], styles: { fontSize: 7.5, cellPadding: 1.8 } })
  y = doc.lastAutoTable.finalY + 7
  if (y > 230) { doc.addPage(); y = 18 }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Case activity history', 14, y); y += 4
  autoTable(doc, { startY: y, head: [['Time', 'Action', 'Actor', 'Details']], body: events.map(event => [new Date(event.created_at).toLocaleString(), value(event.action), value(event.actor_name || 'System'), value(event.details?.reason || event.details?.explanation || event.details?.kind)]), styles: { fontSize: 7.5, cellPadding: 1.8 } })
  doc.save(reportFileName(`Traffic Fine ${fine.notice_reference}`) + '.pdf')
}
