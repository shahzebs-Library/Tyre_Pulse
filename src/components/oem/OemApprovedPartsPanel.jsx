/**
 * Approved OEM parts: every oem_part_references row a SECOND person approved.
 * Select a row for its detail (OemPartDetail). Tick several rows to raise DRAFT
 * requisitions, one per part, through the existing requisitions service with the
 * ERP item set (item_id). Nothing is created as a new material, and a draft
 * still goes through the normal requisition approval.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, ClipboardList } from 'lucide-react'
import { KitTable } from '../commandCenter/kit'
import { listApprovedOemParts, createRequisitionsForParts } from '../../lib/api/materialLinks'
import { toUserMessage } from '../../lib/inventory/errorText'
import { formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, SearchBox, Field, fmtDate } from '../inventory/InvUi'
import OemPartDetail from './OemPartDetail'

export default function OemApprovedPartsPanel({ scope, can }) {
  const country = scope?.country && scope.country !== 'All' ? scope.country : undefined
  const q = useInvQuery(() => listApprovedOemParts({ country }), [country])
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [form, setForm] = useState({ quantity: '1', neededBy: '', site: scope?.site || '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const canRequest = typeof can === 'function' ? (can('procure') || can('issue') || can('view')) : false

  const rows = useMemo(() => {
    const all = q.data?.rows || []
    const s = search.trim().toLowerCase()
    if (!s) return all
    return all.filter((r) => [r.oem_part_no, r.manufacturer, r.item_code, r.item_name].some((v) => String(v || '').toLowerCase().includes(s)))
  }, [q.data, search])

  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selection = (q.data?.rows || []).filter((r) => picked.has(r.id))
  const open = (q.data?.rows || []).find((r) => r.id === openId) || null

  const raise = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      const res = await createRequisitionsForParts(
        selection.map((r) => ({ item_id: r.item_id, item_code: r.item_code, item_name: r.item_name, oem_part_no: r.oem_part_no, country: r.item_country || r.country })),
        { quantity: form.quantity, neededBy: form.neededBy || null, site: form.site || null, notes: form.notes || null },
      )
      setResult(res)
      if (res.created.length) setPicked(new Set())
    } catch (err) {
      setError(toUserMessage(err))
    } finally { setBusy(false) }
  }

  const columns = [
    { key: 'pick', header: '', sortable: false, cell: (r) => (
      <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()}
        aria-label={`Select OEM ${r.oem_part_no}`} />
    ) },
    { key: 'oem_part_no', header: 'OEM number', cell: (r) => <strong>{r.oem_part_no}</strong> },
    { key: 'manufacturer', header: 'Manufacturer', cell: (r) => r.manufacturer || <span className="cc-na">Not recorded</span> },
    { key: 'item_code', header: 'ERP item', cell: (r) => <span>{r.item_code || 'Unknown'} <span className="cc-card-sub" style={{ display: 'block' }}>{r.item_name || ''}</span></span> },
    { key: 'country', header: 'Country', cell: (r) => r.country || r.item_country || <span className="cc-na">Not recorded</span> },
    { key: 'approved_at', header: 'Approved', cell: (r) => (r.approved_at ? fmtDate(r.approved_at) : <span className="cc-na">Not recorded</span>) },
  ]

  return (
    <div className="inv-hub">
      <SectionCard
        title={`Approved OEM parts${q.data ? ` (${formatQty(q.data.rows.length)})` : ''}`}
        sub="Only links approved by a second person. Select a row for details; tick rows to request them."
        action={(
          <button type="button" className="cc-btn-ghost" onClick={q.retry} disabled={q.loading}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        )}>
        {q.error ? <ErrorNote error={q.error} onRetry={q.retry} />
          : q.data?.status === 'not_provisioned' ? <NotSetUp what="Approved OEM parts" />
            : (
              <>
                {q.data?.truncated && <Note tone="warn">Not every link was read. Narrow the country to see the rest.</Note>}
                <div className="inv-toolbar">
                  <SearchBox value={search} onChange={setSearch} placeholder="OEM number, manufacturer or item" label="Search approved parts" />
                </div>
                <div className="inv-scroll">
                  <KitTable compact scroll columns={columns} rows={rows} loading={q.loading && !q.data}
                    empty={q.data?.rows?.length
                      ? 'No approved part matches the search.'
                      : 'No OEM link has been approved yet. Links are proposed in the OEM cross-reference review and approved by a second person.'}
                    onRowClick={(r) => setOpenId(r.id === openId ? null : r.id)} />
                </div>
              </>
            )}
      </SectionCard>

      {selection.length > 0 && (
        <SectionCard title={`Request ${selection.length} part${selection.length === 1 ? '' : 's'}`}
          sub="Creates one draft requisition per part. It still needs the normal approval.">
          {!canRequest ? <Note tone="warn">You do not have permission to raise requisitions.</Note> : (
            <>
              <div className="inv-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                <Field label="Quantity each">
                  <input className="inv-input" type="number" min="1" step="1" value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
                </Field>
                <Field label="Needed by">
                  <input className="inv-input" type="date" value={form.neededBy} onChange={(e) => setForm((f) => ({ ...f, neededBy: e.target.value }))} />
                </Field>
                <Field label="Site">
                  <input className="inv-input" value={form.site} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} />
                </Field>
                <Field label="Note" full>
                  <input className="inv-input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </Field>
              </div>
              <div className="inv-actions" style={{ marginTop: 10 }}>
                <button type="button" className="inv-btn-accent" disabled={busy} onClick={raise}>
                  <ClipboardList size={14} aria-hidden="true" /> {busy ? 'Creating...' : 'Create draft requisitions'}
                </button>
                <button type="button" className="cc-btn-ghost" onClick={() => setPicked(new Set())}>Clear selection</button>
              </div>
            </>
          )}
          {error && <ErrorNote error={error} />}
        </SectionCard>
      )}
      {result && (
        <Note tone={result.failed.length ? 'warn' : 'good'}
          action={result.created.length ? <Link className="cc-btn-ghost" to="/requisitions">Open requisitions</Link> : null}>
          {`${result.created.length} draft requisition${result.created.length === 1 ? '' : 's'} created.`}
          {result.failed.length ? ` ${result.failed.length} could not be created: ${result.failed.map((f) => `${f.item} (${toUserMessage(f.error)})`).join('; ')}` : ''}
        </Note>
      )}

      {open && <OemPartDetail reference={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
