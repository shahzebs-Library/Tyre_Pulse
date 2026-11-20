/**
 * Inventory reports: Excel and PDF through the shared export engine
 * (exportUtils + loadAutoTable). Every file carries a report reference, the
 * filters it was run with and the snapshot time. Exports are bounded (with a
 * stated truncation) and go through the export policy + audit in exportUtils.
 */
import { useState } from 'react'
import { FileSpreadsheet, FileText } from 'lucide-react'
import DateField from '../ui/DateField'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import { loadReportRows, SNAPSHOT_MAX } from '../../lib/api/inventory'
import { REPORTS, reportByKey, makeReportRef, describeFilters, exportRowsFor } from '../../lib/inventory/reportCatalog'
import { toUserMessage } from '../../lib/inventory/errorText'
import { Denied, ErrorNote, Note, SectionCard, StatusPill, fmtDateTime } from './InvUi'

const STATUS_OPTIONS = {
  audits: ['draft', 'in_progress', 'reconciliation', 'approval', 'closed'],
  discrepancies: ['open', 'investigating', 'proposed', 'approved', 'posted', 'closed'],
}

export default function ReportsSection({ scope, can }) {
  const { t } = useLanguage()
  const { appSettings } = useSettings()
  const [key, setKey] = useState('register')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('all')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [last, setLast] = useState(null)
  const report = reportByKey(key)

  if (!can('export')) return <Denied capLabel={t('inventory.caps.export')} />

  const run = async (format) => {
    setBusy(format); setErr('')
    try {
      const filters = { country: scope.country || 'All', site: scope.site, status, from: report.dated ? from : '', to: report.dated ? to : '' }
      const res = await loadReportRows(report.source, filters)
      if (res.status === 'not_provisioned') { setErr(t('inventory.reports.notSetUp')); return }
      const now = new Date()
      const ref = makeReportRef(key, now)
      const filterText = describeFilters(filters)
      const snapshot = fmtDateTime(now)
      const rows = exportRowsFor(report, res.rows)
      const title = `${t(report.titleKey)} (${ref})`
      const { exportToExcel, exportToPdf, reportFileName } = await import('../../lib/exportUtils')
      const filename = reportFileName('Inventory', t(report.titleKey), ref)
      const keys = report.columns.map(([k]) => k)
      const headers = report.columns.map(([, h]) => h)
      const note = `${filterText} | Snapshot ${snapshot}${res.truncated ? ` | First ${SNAPSHOT_MAX} rows only` : ''}`
      if (format === 'xlsx') {
        await exportToExcel(rows, keys, headers, filename, 'Report', {
          title, company: appSettings?.company_name || '',
          meta: { 'Report reference': ref, Filters: filterText, 'Snapshot taken': snapshot, Truncated: res.truncated ? `Yes, first ${SNAPSHOT_MAX} rows` : 'No' },
        })
      } else {
        await exportToPdf(rows, keys.map((k, i) => ({ key: k, header: headers[i] })), title, filename, 'landscape', appSettings?.company_name || '', { subtitleNote: note })
      }
      setLast({ ref, rows: rows.length, truncated: res.truncated, snapshot, filterText, format })
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy('') }
  }

  return (
    <div className="inv-hub">
      <SectionCard title={t('inventory.reports.title')} sub={t('inventory.reports.sub')}>
        <div className="cc-filters">
          <label className="cc-field">
            <span>{t('inventory.reports.report')}</span>
            <select className="cc-select" value={key} onChange={(e) => { setKey(e.target.value); setStatus('all') }}>
              {REPORTS.map((r) => <option key={r.key} value={r.key}>{t(r.titleKey)}</option>)}
            </select>
          </label>
          {STATUS_OPTIONS[key] && (
            <label className="cc-field">
              <span>{t('inventory.common.status')}</span>
              <select className="cc-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">{t('inventory.common.all')}</option>
                {STATUS_OPTIONS[key].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
          )}
          {report.dated && (
            <>
              <label className="cc-field"><span>{t('inventory.common.from')}</span><DateField value={from} onChange={setFrom} /></label>
              <label className="cc-field"><span>{t('inventory.common.to')}</span><DateField value={to} onChange={setTo} /></label>
            </>
          )}
        </div>
        <p className="cc-card-sub" style={{ margin: '10px 0' }}>{t('inventory.reports.scope')}: {describeFilters({ country: scope.country || 'All', site: scope.site, status, from: report.dated ? from : '', to: report.dated ? to : '' })}</p>
        <div className="inv-actions">
          <button type="button" className="cc-btn-primary" disabled={!!busy} onClick={() => run('xlsx')}>
            <FileSpreadsheet size={14} aria-hidden="true" /> {busy === 'xlsx' ? t('inventory.reports.building') : t('inventory.actions.excel')}
          </button>
          <button type="button" className="cc-btn-ghost" disabled={!!busy} onClick={() => run('pdf')}>
            <FileText size={14} aria-hidden="true" /> {busy === 'pdf' ? t('inventory.reports.building') : t('inventory.actions.pdf')}
          </button>
        </div>
        {err && <ErrorNote error={err} />}
        {last && (
          <Note tone={last.truncated ? 'warn' : 'good'} title={t('inventory.reports.done', { ref: last.ref })}>
            {t('inventory.reports.doneBody', { rows: last.rows, snapshot: last.snapshot })}
            {last.truncated && <> <StatusPill value="truncated" tone="warning" label={t('inventory.reports.truncated', { max: SNAPSHOT_MAX })} /></>}
          </Note>
        )}
      </SectionCard>
      <Note>{t('inventory.reports.currencyRule')}</Note>
    </div>
  )
}
