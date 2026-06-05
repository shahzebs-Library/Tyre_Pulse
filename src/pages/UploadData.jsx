import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { batchClassify } from '../lib/tyreClassifier'
import { logAuditEvent } from '../lib/auditLogger'
import * as XLSX from 'xlsx'
import { Upload, FileSpreadsheet, CheckCircle, X, Wand2, BookOpen, AlertTriangle } from 'lucide-react'

const CANONICAL_FIELDS = [
  'sr', 'issue_date', 'description', 'brand', 'serial_no', 'qty',
  'job_card', 'mis_number', 'asset_no', 'site', 'country', 'remarks',
]

const FIELD_GUESSES = {
  sr: ['sr', 'no', 'sno', 's.no', '#'],
  issue_date: ['date', 'issue date', 'issue_date', 'issuance date'],
  description: ['description', 'desc', 'tyre description', 'type'],
  // 'make', 'vehicle make', 'model' intentionally excluded — those are vehicle/fleet fields, not tyre brand
  brand: ['brand', 'tyre brand', 'tyre_brand', 'manufacturer'],
  serial_no: ['serial', 'serial no', 'serial_no', 'serial number', 's/n'],
  qty: ['qty', 'quantity', 'count'],
  job_card: ['job card', 'job_card', 'jc', 'work order', 'wo'],
  mis_number: ['mis', 'mis no', 'mis number', 'mis_number'],
  asset_no: ['asset', 'asset no', 'asset_no', 'asset number', 'equipment', 'vehicle'],
  site: ['site', 'location', 'area', 'camp'],
  country: ['country', 'nation', 'region country'],
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

function fingerprintHeaders(headers) {
  return [...headers].sort().join('|').toLowerCase()
}

function parseDate(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().split('T')[0]
  const s = String(val).trim()
  if (!s) return null
  const d = new Date(s)
  if (!isNaN(d)) return d.toISOString().split('T')[0]
  const parts = s.split(/[\/\-]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (c.length === 4) return `${c}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`
  }
  return null
}

function guessFileType(headers) {
  const h = headers.map(x => String(x).toLowerCase())
  const fleetSignals = ['make', 'model', 'vehicle_type', 'fleet_number', 'fleet number', 'vehicle type', 'operator']
  const tyreSignals = ['serial_no', 'serial no', 'description', 'remarks', 'job_card', 'job card', 'mis_number', 'mis number']
  const fleetScore = fleetSignals.filter(s => h.some(x => x.includes(s))).length
  const tyreScore = tyreSignals.filter(s => h.some(x => x.includes(s))).length
  if (fleetScore >= 2 && fleetScore > tyreScore) return 'fleet'
  if (tyreScore >= 2) return 'tyres'
  return 'unknown'
}

export default function UploadData() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const navigate    = useNavigate()
  const fileRef     = useRef(null)

  const [step, setStep]       = useState('idle')  // idle|mapping|preview|uploading|done
  const [fileName, setFileName]       = useState('')
  const [headers, setHeaders]         = useState([])
  const [rows, setRows]               = useState([])
  const [mapping, setMapping]         = useState({})
  const [preview, setPreview]         = useState([])
  const [result, setResult]           = useState(null)
  const [error, setError]             = useState('')
  const [savedMappingId, setSavedMappingId] = useState(null)
  const [mappingSource, setMappingSource]   = useState('guess')
  const [uploadType, setUploadType] = useState('tyres') // 'tyres' | 'fleet' | 'auto'

  // ── Duplicate detection state ────────────────────────────────────────────────
  const [dupes, setDupes]             = useState([])   // existing serial_no matches
  const [skipDupes, setSkipDupes]     = useState(true)

  // ── Upload progress ──────────────────────────────────────────────────────────
  const [progress, setProgress]       = useState({ done: 0, total: 0 })

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (data.length < 2) { setError('File is empty or has no data rows'); return }
        const hdrs = data[0].map(String)
        const dataRows = data.slice(1).filter(r => r.some(c => c !== ''))
        setHeaders(hdrs)
        setRows(dataRows)

        // After parsing headers from file:
        if (uploadType === 'auto') {
          const detected = guessFileType(hdrs)
          if (detected === 'fleet') {
            setUploadType('fleet')
            // Don't proceed to mapping step — show fleet redirect notice
            return
          }
          setUploadType('tyres')
        }

        // Recall saved mapping
        const fp = fingerprintHeaders(hdrs)
        const { data: saved } = await supabase.from('column_mappings').select('id, mapping').eq('fingerprint', fp).single()
        if (saved?.mapping) { setMapping(saved.mapping); setSavedMappingId(saved.id); setMappingSource('memory') }
        else { setMapping(guessMapping(hdrs)); setSavedMappingId(null); setMappingSource('guess') }

        setStep('mapping')
      } catch (err) {
        setError('Failed to parse file: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
  }

  function buildRows(hdrs, rows, map) {
    // Which Excel headers are already mapped to a canonical field?
    const mappedHeaders = new Set(Object.values(map).filter(Boolean))
    // Remaining headers become extra_fields
    const unmapped = hdrs.filter(h => !mappedHeaders.has(h))

    return rows.map(row => {
      const obj = {}
      CANONICAL_FIELDS.forEach(f => {
        const srcCol = map[f]
        if (!srcCol) return
        const idx = hdrs.indexOf(srcCol)
        if (idx === -1) return
        let val = row[idx]
        if (f === 'issue_date') val = parseDate(val)
        else if (f === 'qty')   val = val ? +val || 1 : 1
        else val = val !== '' && val !== null && val !== undefined ? String(val).trim() : null
        obj[f] = val
      })

      // Capture any unmapped columns (extra Excel data not in schema)
      if (unmapped.length > 0) {
        const extras = {}
        unmapped.forEach(h => {
          const idx = hdrs.indexOf(h)
          const val = row[idx]
          if (val !== '' && val !== null && val !== undefined) {
            extras[h] = String(val).trim()
          }
        })
        if (Object.keys(extras).length > 0) obj.extra_fields = extras
      }

      return obj
    })
  }

  async function buildPreview() {
    // Build partial records for preview
    const built = buildRows(headers, rows, mapping)
    setPreview(built.slice(0, 5))

    // ── Duplicate detection: check serial_no values against DB ────────────────
    const serials = [...new Set(built.map(r => r.serial_no).filter(Boolean))]
    if (serials.length > 0) {
      const BATCH = 500
      const existing = []
      for (let i = 0; i < serials.length; i += BATCH) {
        const { data } = await supabase.from('tyre_records').select('serial_no').in('serial_no', serials.slice(i, i + BATCH))
        existing.push(...(data ?? []))
      }
      const existingSet = new Set(existing.map(r => r.serial_no))
      setDupes([...existingSet])
    } else {
      setDupes([])
    }

    setStep('preview')
  }

  async function saveColumnMapping(fp) {
    if (savedMappingId) {
      await supabase.from('column_mappings').update({ mapping, last_used_at: new Date().toISOString() }).eq('id', savedMappingId)
    } else {
      await supabase.from('column_mappings').upsert({ fingerprint: fp, mapping, file_name: fileName, confirmed_by: profile?.id, use_count: 1, last_used_at: new Date().toISOString() }, { onConflict: 'fingerprint' })
    }
  }

  async function upload() {
    setStep('uploading')
    setProgress({ done: 0, total: rows.length })

    await saveColumnMapping(fingerprintHeaders(headers))

    // Build all records — fall back to active country when not in spreadsheet
    const defaultCountry = activeCountry !== 'All' ? activeCountry : 'KSA'
    let records = buildRows(headers, rows, mapping).map(r => ({
      ...r,
      country: r.country || defaultCountry,
      region: profile?.region ?? defaultCountry,
      uploaded_by: profile?.id,
    }))

    // Filter duplicates if requested
    if (skipDupes && dupes.length > 0) {
      const dupeSet = new Set(dupes)
      records = records.filter(r => !r.serial_no || !dupeSet.has(r.serial_no))
    }

    // ── Auto-classify using rule-based engine ─────────────────────────────────
    const classified = batchClassify(records.map((r, i) => ({ id: i, description: r.description, remarks: r.remarks })))
    const classMap   = Object.fromEntries(classified.map(c => [c.id, c]))

    const classified_log = []
    records = records.map((r, i) => {
      const c = classMap[i]
      const autoClean = c && c.confidence !== 'Low'
      if (autoClean) {
        classified_log.push({ original_text: [r.description, r.remarks].filter(Boolean).join(' | '), cleaned_text: c.remarks_cleaned, category: c.category, confidence: c.confidence, cleaned_by_model: 'rule-based-v1' })
      }
      return {
        ...r,
        category:       c?.category       ?? null,
        risk_level:     c?.risk_level      ?? null,
        remarks_cleaned: c?.remarks_cleaned ?? null,
        cleaned:        autoClean,
      }
    })

    const autoClassifiedCount = classified_log.length
    const needsReviewCount    = records.length - autoClassifiedCount

    // Insert in batches
    const BATCH = 500
    let added = 0, skipped = 0
    const skipLog = []
    const insertedIds = []

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH)
      const { data, error: err } = await supabase.from('tyre_records').insert(batch).select('id')
      if (err) {
        skipped += batch.length
        skipLog.push({ batch: Math.floor(i / BATCH) + 1, error: err.message })
      } else {
        added += (data ?? []).length
        insertedIds.push(...(data ?? []).map(r => r.id))
      }
      setProgress({ done: Math.min(i + BATCH, records.length), total: records.length })
    }

    // Write cleaning log (link to inserted IDs where possible)
    if (classified_log.length > 0) {
      await supabase.from('cleaning_log').insert(classified_log.map((entry, i) => ({ ...entry, tyre_record_id: insertedIds[i] ?? null })))
    }

    // Upload history
    await supabase.from('upload_history').insert({
      file_names: [fileName], records_added: added, records_skipped: skipped + (skipDupes ? dupes.length : 0),
      skip_log: skipLog, mapping_used: mapping, region: profile?.region ?? defaultCountry, uploaded_by: profile?.id,
    })

    // Audit log
    const skippedCount = skipped + (skipDupes ? dupes.length : 0)
    await logAuditEvent({
      action: 'UPLOAD',
      tableName: 'tyre_records',
      recordCount: added,
      details: { filename: fileName, rowCount: added, skippedCount, country: activeCountry },
    })

    setResult({ added, skipped, skipLog, autoClassifiedCount, needsReviewCount, dupesSkipped: skipDupes ? dupes.length : 0 })
    setStep('done')
  }

  function reset() {
    setStep('idle'); setFileName(''); setHeaders([]); setRows([])
    setMapping({}); setPreview([]); setResult(null); setError('')
    setSavedMappingId(null); setMappingSource('guess'); setDupes([]); setSkipDupes(true)
    setUploadType('tyres')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Upload Data</h1>
        <p className="text-gray-400 text-sm mt-1">Import tyre records from Excel or CSV — auto-classifies on insert</p>
      </div>

      {/* ── Idle ──────────────────────────────────────────────────────────── */}
      {step === 'idle' && (
        <>
          {/* Upload type selector */}
          <div className="card mb-4">
            <p className="text-sm font-medium text-gray-300 mb-3">What are you uploading?</p>
            <div className="flex flex-wrap gap-2">
              {[
                { val: 'tyres', label: 'Tyre Records', desc: 'Issue records, replacements, costs' },
                { val: 'fleet', label: 'Fleet / Vehicle Data', desc: 'Vehicle registry, asset specs' },
                { val: 'auto', label: 'Auto-detect', desc: 'We will figure it out from column names' },
              ].map(opt => (
                <button
                  key={opt.val}
                  onClick={() => setUploadType(opt.val)}
                  className={`flex-1 min-w-[140px] px-4 py-3 rounded-lg border text-left transition-colors ${
                    uploadType === opt.val
                      ? 'border-green-500/60 bg-green-900/20 text-green-300'
                      : 'border-white/10 text-gray-400 hover:border-white/20'
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {uploadType === 'fleet' && (
            <div className="card mb-4 border-yellow-700/40 bg-yellow-900/10">
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 text-lg">&#9888;</span>
                <div>
                  <p className="text-sm font-semibold text-yellow-300">Fleet / Vehicle Data</p>
                  <p className="text-sm text-gray-400 mt-1">
                    To upload vehicle/fleet data, use the <strong className="text-white">Fleet Master</strong> page which has a dedicated vehicle import with the correct column mapping.
                  </p>
                  <a href="/fleet-master" className="inline-block mt-2 text-sm text-green-400 underline hover:text-green-300">Go to Fleet Master &rarr;</a>
                </div>
              </div>
            </div>
          )}

          <div className="card border-2 border-dashed border-gray-700 hover:border-blue-600 transition-colors cursor-pointer text-center py-16"
            onClick={() => fileRef.current?.click()}>
            <Upload size={40} className="text-gray-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-white mb-1">Drop your Excel or CSV file here</p>
            <p className="text-sm text-gray-400">or click to browse — .xlsx, .xls, .csv supported</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
            {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
          </div>
        </>
      )}

      {/* ── Mapping ───────────────────────────────────────────────────────── */}
      {step === 'mapping' && (
        <div className="space-y-4">
          {uploadType === 'fleet' && (
            <div className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 rounded px-3 py-1.5 mb-3">
              This looks like vehicle/fleet data. For best results, use Fleet Master for vehicle uploads.
            </div>
          )}
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <FileSpreadsheet size={16} className="text-blue-400" />
            <span>{fileName}</span>
            <span>· {rows.length.toLocaleString()} rows</span>
            {mappingSource === 'memory' && (
              <span className="badge bg-green-900/50 text-green-300 border border-green-700/50 flex items-center gap-1">
                <BookOpen size={11} /> Recalled from memory
              </span>
            )}
          </div>
          <div className="card">
            <h2 className="text-base font-semibold text-white mb-1">Column Mapping</h2>
            <p className="text-xs text-gray-400 mb-4">{mappingSource === 'memory' ? 'Loaded from a previously saved mapping.' : 'Auto-detected. Adjust if needed.'}</p>
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
              <button onClick={buildPreview} className="btn-primary">Preview & Check Duplicates</button>
              <button onClick={reset} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview ───────────────────────────────────────────────────────── */}
      {step === 'preview' && (
        <div className="space-y-4">
          {/* Duplicate warning */}
          {dupes.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-yellow-300 font-medium">
                    {dupes.length} potential duplicate serial number{dupes.length !== 1 ? 's' : ''} detected
                  </p>
                  <p className="text-yellow-400/70 text-sm mt-0.5">
                    These serial numbers already exist in the database.
                  </p>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input type="checkbox" className="rounded border-yellow-700 bg-yellow-900/30"
                      checked={skipDupes} onChange={e => setSkipDupes(e.target.checked)} />
                    <span className="text-sm text-yellow-300">Skip duplicate records ({dupes.length} rows)</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Auto-classify note */}
          <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl px-4 py-3 flex gap-3">
            <Wand2 size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-300">
              Records will be auto-classified on upload using the rule-based engine. High/Medium confidence results are marked as cleaned instantly. Low confidence records are flagged for manual review in Data Cleaning.
            </p>
          </div>

          <div className="card">
            <h2 className="text-base font-semibold text-white mb-4">Preview (first 5 rows)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>{CANONICAL_FIELDS.filter(f => mapping[f]).map(f => <th key={f} className="table-header capitalize">{f.replace('_', ' ')}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>{CANONICAL_FIELDS.filter(f => mapping[f]).map(f => <td key={f} className="table-cell">{String(row[f] ?? '—')}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={upload} className="btn-primary flex items-center gap-2">
                <Upload size={16} /> Upload {(skipDupes ? rows.length - dupes.length : rows.length).toLocaleString()} Records
              </button>
              <button onClick={() => setStep('mapping')} className="btn-secondary">Back</button>
              <button onClick={reset} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Uploading ─────────────────────────────────────────────────────── */}
      {step === 'uploading' && (
        <div className="card text-center py-16">
          <div className="animate-spin h-10 w-10 rounded-full border-2 border-gray-700 border-t-blue-500 mx-auto mb-4" />
          <p className="text-white font-medium">Uploading & auto-classifying…</p>
          {progress.total > 0 && (
            <div className="mt-4 max-w-xs mx-auto">
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <p className="text-gray-500 text-xs mt-1">{progress.done.toLocaleString()} / {progress.total.toLocaleString()}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Done ──────────────────────────────────────────────────────────── */}
      {step === 'done' && result && (
        <div className="card">
          <div className="flex items-center gap-3 mb-5">
            <CheckCircle size={24} className="text-green-400" />
            <h2 className="text-lg font-semibold text-white">Upload Complete</h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Tile label="Records Added"     value={result.added}               color="green" />
            <Tile label="Auto-Classified"   value={result.autoClassifiedCount} color="blue" />
            <Tile label="Need Review"       value={result.needsReviewCount}    color="yellow" />
            <Tile label="Dupes Skipped"     value={result.dupesSkipped}        color="gray" />
          </div>

          {result.needsReviewCount > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-xl p-4 mb-4">
              <div className="flex items-start gap-3">
                <Wand2 size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-white font-medium">{result.needsReviewCount.toLocaleString()} records need manual classification</p>
                  <p className="text-sm text-gray-400 mt-0.5">Low-confidence matches were flagged for review. Open Data Cleaning to approve or adjust them.</p>
                  <button onClick={() => navigate('/cleaning')} className="btn-primary mt-3 text-sm flex items-center gap-2">
                    <Wand2 size={14} /> Go to Data Cleaning
                  </button>
                </div>
              </div>
            </div>
          )}

          {result.skipLog.length > 0 && (
            <details className="text-sm text-gray-400 mb-4">
              <summary className="cursor-pointer text-yellow-400">View error log ({result.skipLog.length} batches failed)</summary>
              <pre className="mt-2 bg-gray-800 rounded p-3 text-xs overflow-auto">{JSON.stringify(result.skipLog, null, 2)}</pre>
            </details>
          )}

          <button onClick={reset} className="btn-secondary">Upload Another File</button>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, color }) {
  const colors = { green: 'text-green-400 border-green-800 bg-green-900/20', blue: 'text-blue-400 border-blue-800 bg-blue-900/20', yellow: 'text-yellow-400 border-yellow-800 bg-yellow-900/20', gray: 'text-gray-400 border-gray-700 bg-gray-800/50' }
  return (
    <div className={`border rounded-lg p-3 ${colors[color]}`}>
      <p className={`text-2xl font-bold ${colors[color].split(' ')[0]}`}>{String(value ?? 0)}</p>
      <p className="text-xs mt-0.5 opacity-80">{label}</p>
    </div>
  )
}
