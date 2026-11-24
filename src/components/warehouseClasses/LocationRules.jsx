/**
 * Location responsibility, capacity and storage rules.
 *
 * LocationRulesFields: the extra form fields (owner, capacity, restriction,
 * service-van vehicle) used inside the Locations add/edit form.
 * LocationRulesSection: on-hand vs capacity and rule breaches per location
 * (v_inv_location_utilisation, migration 20261124133000, NOT APPLIED). Breaches
 * are reported, not blocked.
 */
import { useEffect, useMemo, useState } from 'react'
import { KitTable } from '../commandCenter/kit'
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill, Field, alignNumeric } from '../inventory/InvUi'
import { listAssignablePeople } from '../../lib/api/inventory'
import { listLocationUtilisation } from '../../lib/api/warehouseAssets'
import { LOCATION_RESTRICTIONS, restrictionLabel, locationFindings } from '../../lib/warehouseClasses/specialClasses'
import { formatQty } from '../../lib/inventory/inventoryMoney'

export function LocationRulesFields({ draft, setDraft, errors = {} }) {
  const [people, setPeople] = useState([])
  useEffect(() => {
    let live = true
    listAssignablePeople().then((r) => { if (live) setPeople(r) }).catch(() => { if (live) setPeople([]) })
    return () => { live = false }
  }, [])
  const set = (k) => (e) => { const v = e.target.value; setDraft((d) => ({ ...d, [k]: v })) }
  return (
    <div className="inv-form">
      <Field label="Responsible person" error={errors.responsible_user_id} full>
        <select className="cc-select" value={draft.responsible_user_id || ''} onChange={set('responsible_user_id')}>
          <option value="">Nobody named</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username}{p.role ? ` (${p.role})` : ''}</option>)}
        </select>
      </Field>
      <Field label="Capacity (optional)" error={errors.capacity_qty}>
        <input className="inv-input" type="number" min="0" step="any" value={draft.capacity_qty ?? ''} onChange={set('capacity_qty')} />
      </Field>
      <Field label="Capacity unit (EA, L, KG, PALLET)" error={errors.capacity_uom}>
        <input className="inv-input" value={draft.capacity_uom || ''} onChange={set('capacity_uom')} maxLength={20} />
      </Field>
      <Field label="Storage rule" full>
        <select className="cc-select" value={draft.restriction || ''} onChange={set('restriction')}>
          {LOCATION_RESTRICTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </Field>
      {draft.restriction && (
        <Field label="Rule note" full>
          <input className="inv-input" value={draft.restriction_note || ''} onChange={set('restriction_note')} maxLength={400} />
        </Field>
      )}
      {draft.location_type === 'service_van' && (
        <Field label="Van (fleet asset number)" error={errors.van_asset_no} full>
          <input className="inv-input" value={draft.van_asset_no || ''} onChange={set('van_asset_no')} maxLength={60} />
        </Field>
      )}
    </div>
  )
}

export function LocationRulesSection({ scope, people = [] }) {
  const q = useInvQuery(() => listLocationUtilisation(scope), [scope.country, scope.site])
  const [onlyIssues, setOnlyIssues] = useState(false)
  const personName = useMemo(() => new Map(people.map((p) => [p.id, p.full_name || p.username])), [people])
  const rows = useMemo(() => (q.data?.rows || [])
    .filter((r) => r.capacity_qty !== null || r.restriction || r.responsible_user_id || r.van_asset_no)
    .map((r) => ({ ...r, findings: locationFindings(r) }))
    .filter((r) => !onlyIssues || r.findings.length), [q.data, onlyIssues])

  if (q.data?.status === 'not_provisioned') {
    return (
      <Note tone="info" title="Capacity and storage rules are not set up yet">
        Capacity, storage rules, service vans and the utilisation report need migration 20261124133000 (not applied).
        The responsible person can already be named on each location.
      </Note>
    )
  }
  return (
    <SectionCard title="Capacity, rules and owners" sub="Locations with a capacity, a storage rule, a named owner or a van. Breaches are reported, not blocked."
      action={(
        <label className="inv-check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only problems</label>
      )}>
      {q.error && <ErrorNote error={q.error} onRetry={q.retry} />}
      <div className="inv-scroll">
        <KitTable compact loading={q.loading && !q.data} rows={rows} empty="No location has a capacity, rule or owner yet."
          columns={alignNumeric([
            { key: 'code', header: 'Location', cell: (r) => `${r.code}${r.name ? `: ${r.name}` : ''}` },
            { key: 'site', header: 'Site' },
            { key: 'owner', header: 'Responsible', cell: (r) => (r.responsible_user_id ? personName.get(r.responsible_user_id) || 'Named person' : 'Nobody named') },
            { key: 'restriction', header: 'Rule', cell: (r) => restrictionLabel(r.restriction) },
            { key: 'van_asset_no', header: 'Van', cell: (r) => r.van_asset_no || '' },
            { key: 'qty_on_hand', header: 'On hand', numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
            { key: 'capacity', header: 'Capacity', numeric: true, cell: (r) => (r.capacity_qty === null ? 'Not set' : `${formatQty(r.capacity_qty)} ${r.capacity_uom || ''}`) },
            { key: 'findings', header: 'Check', cell: (r) => (r.findings.length
              ? r.findings.map((f) => <StatusPill key={f.text} value={f.tone} tone={f.tone} label={f.text} />)
              : <StatusPill value="ok" tone="good" label="OK" />) },
          ])} />
      </div>
      <p className="cc-card-sub">Capacity compares the quantity on hand in the location&apos;s own unit; mixed units in one location are not converted.</p>
    </SectionCard>
  )
}
