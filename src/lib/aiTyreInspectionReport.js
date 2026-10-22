/**
 * Safe, printable AI review appendix. This is a representation of existing
 * reviewed data, not a trigger for model inference.
 */
import { inspectionReviewSummary,reportableFinding,reportableMeasurement } from './aiTyreInspectionDomain'
const esc = value => String(value??'').replace(/[&<>"']/g,character=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
})[character])
const cell = value => '<td>'+esc(value == null || value==='' ? 'Not recorded':value)+'</td>'
const row = values => '<tr>'+values.map(cell).join('')+'</tr>'
function table(headers,records) {
  const thead='<thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead>'
  const tbody='<tbody>'+records.join('')+'</tbody>'
  return '<table>'+thead+tbody+'</table>'
}
function defectText(analysis) {
  if(!analysis.assessable)return 'Unable to assess: '+(analysis.reason||'Insufficient evidence')
  if(!analysis.defects.length)return 'No distinct visible defect confidently identified'
  return analysis.defects.map(d=>d.type.replace(/_/g,' ')+': '+d.description).join('; ')
}
export function buildInspectionAiAppendix({inspection,jobs=[],measurements=[],reviewer=''}) {
  const summary=inspectionReviewSummary(inspection,jobs,measurements)
  const findings=jobs.map(reportableFinding).filter(Boolean)
  const readings=measurements.map(reportableMeasurement).filter(Boolean)
  const findingRows=findings.map(item=>row([
    item.position,defectText(item.analysis),item.analysis.recommendation,
    item.reviewStatus,item.reviewerNote,item.modelVersion,
  ]))
  const measurementRows=readings.map(item=>row([
    item.position,item.tyreSerial,item.source,item.measuredAt,
    item.innerMm,item.centerMm,item.outerMm,item.worstMm,
    item.remainingMm,item.remainingPercent+'%',
    item.unevenDepthWarning?'Check uneven wear':'',
  ]))
  const status=summary.pending>0?'Analysis pending':
    summary.failed>0?'Some analysis failed':
    summary.queued===0?'AI analysis not requested':
    summary.complete?'Reviewed':'Awaiting human review'
  return [
    '<section class="ai-inspection-appendix">',
    '<h2>AI Inspection Analysis</h2>',
    '<p><strong>Vehicle:</strong> '+esc(inspection?.asset_no || 'Not recorded')+'</p>',
    '<p><strong>Inspection:</strong> '+esc(inspection?.id || 'Not recorded')+'</p>',
    '<p><strong>Site:</strong> '+esc(inspection?.site || 'Not recorded')+'</p>',
    '<p><strong>AI status:</strong> '+esc(status)+'</p>',
    '<p>Damage evidence photographs: '+summary.defectPhotos+
      '; abnormal tyre positions without linked photographs: '+
      summary.abnormalPositionsMissingPhotos.length+'.</p>',
    '<h3>Visual observations</h3>',
    findingRows.length?table(['Position','Suspected visual finding','Recommended follow-up',
      'Human review','Reviewer note','Model version'],findingRows):
      '<p>No finished AI observations are available for this inspection.</p>',
    '<h3>Physical tread measurements</h3>',
    measurementRows.length?table(['Position','Serial','Source','Measured at','Inner mm',
      'Centre mm','Outer mm','Worst mm','Usable mm','Usable remaining','Wear flag'],measurementRows):
      '<p>No verified physical gauge measurements are recorded.</p>',
    '<p><strong>Reviewer:</strong> '+esc(reviewer||'Not reviewed')+'</p>',
    '<p class="notice">AI observations are advisory and do not certify tyre serviceability. '+
      'Millimetre figures come from physical measurements, not ordinary photographs. '+
      'Final safety decisions must be made by qualified personnel.</p>',
    '</section>',
  ].join('')
}
export const INSPECTION_AI_PRINT_STYLES = `
.ai-inspection-appendix { font-family: Arial, sans-serif; font-size: 10px; color:#18212c; }
.ai-inspection-appendix h2 { font-size:17px; border-bottom:2px solid #16803e; padding-bottom:7px; }
.ai-inspection-appendix h3 { font-size:13px; margin-top:18px; }
.ai-inspection-appendix table { width:100%; border-collapse:collapse; table-layout:fixed; }
.ai-inspection-appendix th { background:#ebf5ee; text-align:left; font-weight:700; }
.ai-inspection-appendix th, .ai-inspection-appendix td {
 border:1px solid #d8e0dd; padding:6px; overflow-wrap:anywhere; vertical-align:top;
}
.ai-inspection-appendix .notice { margin-top:14px; border-left:3px solid #c58b14;
 padding:9px; background:#fff9e9; }
`
