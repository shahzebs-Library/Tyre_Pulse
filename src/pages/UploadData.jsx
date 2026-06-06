import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { batchClassify } from '../lib/tyreClassifier'
import { logAuditEvent } from '../lib/auditLogger'
import * as XLSX from 'xlsx'
import { Upload, FileSpreadsheet, CheckCircle, X, Wand2, BookOpen, AlertTriangle, Package } from 'lucide-react'

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

const STOCK_CANONICAL_FIELDS = [
  'item_code', 'description', 'brand', 'category', 'qty', 'unit_cost',
  'site', 'location', 'min_level', 'reorder_qty', 'supplier', 'notes',
]

const STOCK_FIELD_GUESSES = {
  item_code:   ['item code', 'item_code', 'code', 'part no', 'part number', 'sku', 'item no'],
  description: ['description', 'desc', 'item name', 'product name', 'item description'],
  brand:       ['brand', 'manufacturer', 'make'],
  category:    ['category', 'type', 'class', 'group'],
  qty:         ['qty', 'quantity', 'count', 'stock', 'on hand', 'balance'],
  unit_cost:   ['unit cost', 'unit_cost', 'price', 'cost', 'rate', 'unit price'],
  site:        ['site', 'warehouse', 'branch', 'store'],
  location:    ['location', 'bin', 'shelf', 'bin location', 'rack', 'bin no'],
  min_level:   ['min level', 'min_level', 'minimum', 'reorder level', 'min stock'],
  reorder_qty: ['reorder qty', 'reorder_qty', 'order qty', 'order quantity'],
  supplier:    ['supplier', 'vendor', 'vendor name'],
  notes:       ['notes', 'remarks', 'comment', 'comments'],
}

function guessMapping(headers, fieldGuesses = FIELD_GUESSES) {
  const mapping = {}
  const lc = headers.map(h => h.toLowerCase().trim())
  const fields = Object.keys(fieldGuesses)
  fields.forEach(field => {
    const guesses = fieldGuesses[field] ?? [field]
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

  const wbRef = useRef(null)

  const [step, setStep]       = useState('idle')  // idle|sheets|mapping|preview|uploading|done
  const [fileName, setFileName]       = useState('')
  const [headers, setHeaders]         = useState([])
  const [rows, setRows]               = useState([])
  const [mapping, setMapping]         = useState({})
  const [preview, setPreview]         = useState([])
  const [result, setResult]           = useState(null)
  const [error, setError]             = useState('')
  const [savedMappingId, setSavedMappingId] = useState(null)
  const [mappingSource, setMappingSource]   = useState('guess')
  const [uploadType, setUploadType] = useState('tyres') // 'tyres' | 'fleet' | 'stock' | 'auto'
  const [sheetOptions, setSheetOptions] = useState([])

  // ── Duplicate detection state ────────────────────────────────────────────────
  const [dupes, setDupes]             = useState([])   // existing serial_no matches
  const [skipDupes, setSkipDupes]     = useState(true)
  // Cross-user smart dedup
  const [dupCheck, setDupCheck]       = useState(null) // { exact: [], conflicts: [], reupload: bool }
  const [skipIds, setSkipIds]         = useState(new Set())
  const [dupReview, setDupReview]     = useState(false)

  // ── Upload progress ──────────────────────────────────────────────────────────
  const [progress, setProgress]       = useState({ done: 0, total: 0 })

  // ── Active field set based on upload type ────────────────────────────────────
  const activeFields  = uploadType === 'stock' ? STOCK_CANONICAL_FIELDS : CANONICAL_FIELDS
  const activeGuesses = uploadType === 'stock' ? STOCK_FIELD_GUESSES  : FIELD_GUESSES

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError('')
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true })
        wbRef.current = wb

        if (wb.SheetNames.length > 1) {
          const opts = wb.SheetNames.map(name => {
            const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[name])
            const allKeys = Object.keys(wb.Sheets[name]).filter(k => !k.startsWith('!'))
            const colCount = new Set(allKeys.map(k => k.replace(/\d+/, ''))).size
            const likelyPivot = sheetRows.length < 15 && colCount > 15
            return { name, rows: sheetRows.length, selected: !likelyPivot, likelyPivot }
          })
          setSheetOptions(opts)
          setFileName(file.name)
          setStep('sheets')
          return
        }

        // Single sheet — fall through to existing logic
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
      activeFields.forEach(f => {
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
    const built = buildRows(headers, rows, mapping)
    setPreview(built.slice(0, 5))
    setSkipIds(new Set())
    setDupCheck(null)

    const serials = [...new Set(built.map(r => r.serial_no).filter(Boolean))]
    if (serials.length > 0 && uploadType === 'tyres') {
      const BATCH = 500
      const existing = []
      for (let i = 0; i < serials.length; i += BATCH) {
        const { data } = await supabase
          .from('tyre_records')
          .select('serial_no, asset_no, issue_date, id')
          .in('serial_no', serials.slice(i, i + BATCH))
        existing.push(...(data ?? []))
      }
      const existingSet = new Set(existing.map(r => r.serial_no))
      setDupes([...existingSet])

      // Smart cross-user dedup
      if (existing.length > 0) {
        const bySerial = {}
        existing.forEach(e => { bySerial[e.serial_no] = e })

        const exactDups = [], conflicts = []
        built.forEach((row, idx) => {
          if (!row.serial_no) return
          const match = bySerial[row.serial_no]
          if (!match) return
          if (match.asset_no === row.asset_no && match.issue_date === row.issue_date) {
            exactDups.push({ idx, row, existing: match })
          } else if (match.asset_no && row.asset_no && match.asset_no !== row.asset_no) {
            conflicts.push({ idx, row, existing: match })
          }
        })

        const reupload = serials.length > 5 && exactDups.length / serials.length > 0.7

        if (exactDups.length > 0 || conflicts.length > 0 || reupload) {
          setDupCheck({ exact: exactDups, conflicts, reupload })
        }
      }
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

    const batchId = crypto.randomUUID()

    // ── Stock upload branch ───────────────────────────────────────────────────
    if (uploadType === 'stock') {
      const finalRows = buildRows(headers, rows, mapping)
      const stockRows = finalRows.map(row => ({
        item_code:   row.item_code   || null,
        description: row.description || null,
        brand:       row.brand       || null,
        category:    row.category    || null,
        qty:         parseFloat(row.qty)         || 0,
        unit_cost:   parseFloat(row.unit_cost)   || 0,
        site:        row.site     || activeCountry || null,
        location:    row.location || null,
        min_level:   parseFloat(row.min_level)   || 0,
        reorder_qty: parseFloat(row.reorder_qty) || 0,
        supplier:    row.supplier || null,
        notes:       row.notes    || null,
      }))
      const CHUNK = 500
      let added = 0
      for (let i = 0; i < stockRows.length; i += CHUNK) {
        const chunk = stockRows.slice(i, i + CHUNK)
        const { error } = await supabase.from('stock_records').insert(chunk)
        if (!error) added += chunk.length
      }
      await logAuditEvent({ action: 'upload_stock', table_name: 'stock_records', record_count: added, details: { file: fileName, batch_id: batchId } })
      setResult({ added, autoClassifiedCount: 0, needsReviewCount: 0, dupesSkipped: 0, skipLog: [] })
      setStep('done')
      return
    }

    await saveColumnMapping(fingerprintHeaders(headers))

    // Build all records — fall back to active country when not in spreadsheet
    const defaultCountry = activeCountry !== 'All' ? activeCountry : 'KSA'
    let records = buildRows(headers, rows, mapping).map(r => ({
      ...r,
      country: r.country || defaultCountry,
      region: profile?.region ?? defaultCountry,
      uploaded_by: profile?.id,
      upload_batch_id: batchId,
    }))

    // Filter out rows marked for skipping via smart dedup review
    if (skipIds.size > 0) {
      records = records.filter((_, idx) => !skipIds.has(idx))
    }

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
      batch_id: batchId,
    })

    // Audit log
    const skippedCount = skipped + (skipDupes ? dupes.length : 0)
    await logAuditEvent({
      action: 'UPLOAD',
      tableName: 'tyre_records',
      recordCount: added,
      details: { filename: fileName, rowCount: added, skippedCount, country: activeCountry, batch_id: batchId },
    })

    setResult({ added, skipped, skipLog, autoClassifiedCount, needsReviewCount, dupesSkipped: skipDupes ? dupes.length : 0 })
    setStep('done')
  }

  function reset() {
    setStep('idle'); setFileName(''); setHeaders([]); setRows([])
    setMapping({}); setPreview([]); setResult(null); setError('')
    setSavedMappingId(null); setMappingSource('guess'); setDupes([]); setSkipDupes(true)
    setDupCheck(null); setSkipIds(new Set()); setDupReview(false)
    setUploadType('tyres'); setSheetOptions([])
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
                { val: 'stock', label: 'Stock Records', desc: 'Inventory items and stock levels', icon: <Package size={20} /> },
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
                  {opt.icon && <div className="mb-1 opacity-70">{opt.icon}</div>}
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

      {/* ── Sheets picker ─────────────────────────────────────────────────── */}
      {step === 'sheets' && (
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-white">Select Sheets to Import</h2>
          <p className="text-sm text-gray-400">This workbook has {sheetOptions.length} sheets. Choose which to include — pivot and summary sheets are suggested to skip.</p>
          <div className="space-y-2">
            {sheetOptions.map((s, i) => (
              <label key={s.name} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                s.selected ? 'border-green-700/50 bg-green-900/10' : 'border-gray-700 bg-gray-800/30'
              }`}>
                <input type="checkbox" checked={s.selected}
                  onChange={() => setSheetOptions(prev => prev.map((x, j) => j === i ? {...x, selected: !x.selected} : x))}
                  className="accent-green-500" />
                <span className="text-white text-sm font-medium flex-1">{s.name}</span>
                {s.likelyPivot && <span className="text-xs text-yellow-400">looks like a pivot</span>}
                <span className="text-xs text-gray-500">{s.rows} rows</span>
              </label>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              disabled={!sheetOptions.some(s => s.selected)}
              onClick={async () => {
                const wb = wbRef.current
                const merged = []
                sheetOptions.filter(s => s.selected).forEach(s => {
                  merged.push(...XLSX.utils.sheet_to_json(wb.Sheets[s.name]))
                })
                const hdrs = merged.length > 0 ? Object.keys(merged[0]) : []
                setRows(merged)
                setHeaders(hdrs)
                const detectedType = guessFileType(hdrs)
                if (uploadType === 'auto') setUploadType(detectedType !== 'unknown' ? detectedType : 'tyres')
                const fp = fingerprintHeaders(hdrs)
                const { data: saved } = await supabase.from('column_mappings').select('id, mapping').eq('fingerprint', fp).single()
                if (saved?.mapping) { setMapping(saved.mapping); setSavedMappingId(saved.id); setMappingSource('memory') }
                else { setMapping(guessMapping(hdrs, activeGuesses)); setSavedMappingId(null); setMappingSource('auto') }
                setStep('mapping')
              }}
              className="btn-primary disabled:opacity-40">
              Import {sheetOptions.filter(s => s.selected).reduce((a, s) => a + s.rows, 0)} rows →
            </button>
            <button onClick={reset} className="btn-secondary">Cancel</button>
          </div>
        </div>
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
              {activeFields.map(field => (
                <div key={field}>
                  <label className="label capitalize">{field.replace(/_/g, ' ')}</label>
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
          {/* Smart cross-user duplicate check results */}
          {dupCheck && (
            <div className="card border-yellow-600/40">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={18} className="text-yellow-400" />
                <span className="font-semibold text-yellow-300">Duplicate Check Results</span>
              </div>
              {dupCheck.reupload && (
                <p className="text-yellow-300 text-sm mb-2">
                  This looks like data you have already uploaded — {dupCheck.exact.length} matching records found in the database.
                </p>
              )}
              <div className="flex gap-4 text-sm mb-3">
                {dupCheck.exact.length > 0 && (
                  <span className="text-red-300">{dupCheck.exact.length} exact duplicate{dupCheck.exact.length !== 1 ? 's' : ''}</span>
                )}
                {dupCheck.conflicts.length > 0 && (
                  <span className="text-orange-300">{dupCheck.conflicts.length} serial conflict{dupCheck.conflicts.length !== 1 ? 's' : ''} (same serial, different asset)</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {dupCheck.exact.length > 0 && (
                  <button className="btn-primary text-sm py-1.5 px-3"
                    onClick={() => setSkipIds(new Set(dupCheck.exact.map(d => d.idx)))}>
                    Skip duplicates ({dupCheck.exact.length})
                  </button>
                )}
                {(dupCheck.exact.length > 0 || dupCheck.conflicts.length > 0) && (
                  <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-600 text-gray-300 hover:text-white"
                    onClick={() => setDupReview(true)}>
                    Review individually
                  </button>
                )}
                <button className="px-3 py-1.5 text-sm rounded-lg border border-gray-600 text-gray-400 hover:text-white"
                  onClick={() => { setSkipIds(new Set()); setDupCheck(null) }}>
                  Upload all anyway
                </button>
              </div>
              {skipIds.size > 0 && (
                <p className="text-xs text-green-400 mt-2">{skipIds.size} row{skipIds.size !== 1 ? 's' : ''} will be skipped on upload</p>
              )}
            </div>
          )}

          {/* Per-row review modal */}
          {dupReview && dupCheck && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
              <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6">
                <h3 className="text-lg font-bold text-white mb-4">Review Duplicates</h3>
                <div className="space-y-3 mb-4">
                  {[...dupCheck.exact, ...dupCheck.conflicts].map(({ idx, row, existing, type }) => (
                    <div key={idx} className={`rounded-lg p-3 border ${skipIds.has(idx) ? 'border-red-800/50 bg-red-900/10 opacity-60' : 'border-gray-700 bg-gray-800/50'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-xs space-y-0.5">
                          <p className="text-white font-mono font-semibold">Row {idx + 1}: {row.serial_no}</p>
                          <p className="text-gray-400">
                            {type === 'serial_conflict' ? (
                              <span className="text-orange-400">Serial conflict: file has {row.asset_no}, DB has {existing.asset_no}</span>
                            ) : (
                              <span className="text-red-400">Exact duplicate (same serial + asset + date)</span>
                            )}
                          </p>
                          <p className="text-gray-500">File: {row.asset_no} · {row.issue_date} | DB: {existing.asset_no} · {existing.issue_date}</p>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button onClick={() => setSkipIds(s => { const n = new Set(s); n.add(idx); return n })}
                            className="text-xs px-2 py-1 rounded bg-red-900/30 text-red-400 border border-red-800/50 hover:bg-red-900/50">
                            Skip
                          </button>
                          <button onClick={() => setSkipIds(s => { const n = new Set(s); n.delete(idx); return n })}
                            className="text-xs px-2 py-1 rounded bg-green-900/30 text-green-400 border border-green-800/50 hover:bg-green-900/50">
                            Keep
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setDupReview(false)} className="btn-primary flex-1">Done</button>
                </div>
              </div>
            </div>
          )}

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
                  <tr>{activeFields.filter(f => mapping[f]).map(f => <th key={f} className="table-header capitalize">{f.replace(/_/g, ' ')}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i}>{activeFields.filter(f => mapping[f]).map(f => <td key={f} className="table-cell">{String(row[f] ?? '—')}</td>)}</tr>
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
