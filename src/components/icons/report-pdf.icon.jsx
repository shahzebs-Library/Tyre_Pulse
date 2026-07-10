/**
 * report-pdf — a document with a chart bar block (exported report). Registered as `report-pdf`.
 */
import IconBase from './IconBase'

export default function ReportPdfIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      {/* mini bar chart */}
      <path d="M9 17v-2.5M12 17v-4.5M15 17v-3.5" />
      <path d="M8.5 17h7" />
    </IconBase>
  )
}
