import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import * as XLSX from 'xlsx'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, X } from 'lucide-react'

const CANONICAL_FIELDS = [
  'sr', 'issue_date', 'description', 'brand', 'serial_no', 'qty',
  'job_card', 'mis_number', 'asset_no', 'site', 'remarks',
]

const FIELD_GUESSES = {
  sr: ['sr', 'no', 'sno', 's.no', '#'],
  issue_date: ['date', 'issue date', 'issue_date', 'issuance date'],
  description: ['description', 'desc', 'tyre description', 'type'],
  brand: ['brand', 'make', 'manufacturer'],
  serial_no: ['serial', 'serial no', 'serial_no', 'serial number', 's/n'],
  qty: ['qty', 'quantity', 'count'],
  job_card: ['job card', 'job_card', 'jc', 'work order', 'wo'],
  mis_number: ['mis', 'mis no', 'mis number', 'mis_number'],
  asset_no: ['asset', 'asset no', 'asset_no', 'asset number', 'equipment', 'vehicle'],
  site: ['site', 'location', 'area', 'camp'],
  remarks: ['remarks', 'notes', 'comment', 'comments'],
}

function guessMapping(headers) {
  const mapping = {}
  const lc = headers.map(h => h.toLowerCase().trim())
  CANONICAL_FIELDS.forEach(field => {
    const guesses = FIELD_GUESSES[field] ?? [field]
    const idx = lc.findIndex(h => guesses.some(g => h.includes(g)))
    if (idx !== -1) mapping[field] = headers[idx]
  })
  return mapping
}

export default function UploadData() {
  const { profile } = useAuth()
  const fileRef = useRef(null)
  const [step, setStep] = useState('idle') // idle | mapping | preview | uploading | done | error
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (data.length < 2) { setError('File is empty or has no data rows'); return }
        const hdrs = data[0].map(String)
        const dataRows = data.slice(1).filter(r => r.some(c => c !== ''))
        setHeaders(hdrs)
        setRows(dataRows)
        setMapping(guessMapping(hdrs))
        setStep('mapping')
      } catch (err) {
        setError('Failed to parse file: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
  }

  function buildPreview() {
    const prev = rows.slice(0, 5).map(row => {
      const obj = {}
      CANONICAL_FIELDS.forEach(f => {
        const srcCol = mapping[f]
        if (srcCol) {
          const idx = headers.indexOf(srcCol)
          if (idx !== -1) obj[f] = row[idx]
        }
      })
      return obj
    })
    setPreview(prev)
    setStep('preview')
  }

  function parseDate(val) {
    if (!val) return null
    if (val instanceof Date) return val.toISOString().split('T')[0]
    const s = String(val).trim()
    if (!s) return null
    const d = new Date(s)
    if (!isNaN(d)) return d.toISOString().split('T')[0]
    // Try DD/MM/YYYY
    const parts = s.split(/[\/\-]/)
    if (parts.length === 3) {
      const [a, b, c] = parts
      if (c.length === 4) return `${c}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`
    }
    return null
  }

  async function upload() {
    setStep('uploading')
    const records = rows.map(row => {
      const obj = { region: profile?.region ?? 'KSA', uploaded_by: profile?.id }
      CANONICAL_FIELDS.forEach(f => {
        const srcCol = mapping[f]
        if (srcCol) {
          const idx = headers.indexOf(srcCol)
          if (idx !== -1) {
            let val = row[idx]
            if (f === 'issue_date') val = parseDate(val)
            else if (f === 'qty') val = val ? +val || 1 : 1
            else val = val !== '' && val !== null && val !== undefined ? String(val).trim() : null
            obj[f] = val
          }
        }
      })
      return obj
    })

    const BATCH = 500
    let added = 0, skipped = 0
    const skipLog = []

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH)
      const { data, error: err } = await supabase.from('tyre_records').insert(batch).select('id')
      if (err) {
        skipped += batch.length
        skipLog.push({ batch: i / BATCH + 1, error: err.message })
      } else {
        added += (data ?? []).length
      }
    }

    // Log the upload
    await supabase.from('upload_history').insert({
      file_names: [fileName],
      records_added: added,
      records_skipped: skipped,
      skip_log: skipLog,
      mapping_used: mapping,
      region: profile?.region ?? 'KSA',
      uploaded_by: profile?.id,
    })

    setResult({ added, skipped, skipLog })
    setStep('done')
  }

  function reset() {
    setStep('idle')
    setFileName('')
    setHeaders([])
    setRows([])
    setMapping({})
    setPreview([])
    setResult(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Upload Data</h1>
        <p className="text-gray-400 text-sm mt-1">Import tyre records from Excel or CSV files</p>
      </div>

      {step === 'idle' && (
        <div
          className="card border-2 border-dashed border-gray-700 hover:border-blue-600 transition-colors cursor-pointer text-center py-16"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={40} className="text-gray-500 mx-auto mb-4" />
          <p className="text-lg font-medium text-white mb-1">Drop your Excel or CSV file here</p>
          <p className="text-sm text-gray-400">or click to browse — .xlsx, .xls, .csv supported</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
          {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
        </div>
      )}

      {step === 'mapping' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <FileSpreadsheet size={16} className="text-blue-400" />
            <span>{fileName}</span>
            <span>· {rows.length.toLocaleString()} rows detected</span>
          </div>
          <div className="card">
            <h2 className="text-base font-semibold text-white mb-4">Column Mapping</h2>
            <p className="text-xs text-gray-400 mb-4">Auto-detected based on column names. Adjust if needed.</p>
            <div className="grid grid-cols-2 gap-3">
              {CANONICAL_FIELDS.map(field => (
                <div key={field}>
                  <label className="label capitalize">{field.replace('_', ' ')}</label>
                  <select className="input" value={mapping[field] ?? ''} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value || undefined }))}>
                    <option value="">(skip)</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={buildPreview} className="btn-primary">Preview Data</button>
              <button onClick={reset} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-base font-semibold text-white mb-4">Preview (first 5 rows)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>{CANONICAL_FIELDS.filter(f => mapping[f]).map(f => <th key={f} className="table-header capitalize">{f.replace('_', ' ')}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>
                      {CANONICAL_FIELDS.filter(f => mapping[f]).map(f => (
                        <td key={f} className="table-cell">{String(row[f] ?? '—')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={upload} className="btn-primary flex items-center gap-2">
                <Upload size={16} /> Upload {rows.length.toLocaleString()} Records
              </button>
              <button onClick={() => setStep('mapping')} className="btn-secondary">Back</button>
              <button onClick={reset} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {step === 'uploading' && (
        <div className="card text-center py-16">
          <div className="animate-spin h-10 w-10 rounded-full border-2 border-gray-700 border-t-blue-500 mx-auto mb-4" />
          <p className="text-white font-medium">Uploading records…</p>
          <p className="text-gray-400 text-sm mt-1">This may take a moment for large files</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle size={24} className="text-green-400" />
            <h2 className="text-lg font-semibold text-white">Upload Complete</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
              <p className="text-green-400 text-2xl font-bold">{result.added.toLocaleString()}</p>
              <p className="text-green-300 text-sm">Records added</p>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-4">
              <p className="text-yellow-400 text-2xl font-bold">{result.skipped.toLocaleString()}</p>
              <p className="text-yellow-300 text-sm">Records skipped</p>
            </div>
          </div>
          {result.skipLog.length > 0 && (
            <details className="text-sm text-gray-400 mb-4">
              <summary className="cursor-pointer text-yellow-400">View skip log ({result.skipLog.length} batches)</summary>
              <pre className="mt-2 bg-gray-800 rounded p-3 text-xs overflow-auto">{JSON.stringify(result.skipLog, null, 2)}</pre>
            </details>
          )}
          <button onClick={reset} className="btn-primary">Upload Another File</button>
        </div>
      )}
    </div>
  )
}
