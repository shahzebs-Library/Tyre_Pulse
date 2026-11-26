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
import { useLanguage } from '../../contexts/LanguageContext'
import { useInvQuery, ErrorNote, Note, SectionCard, StatusPill, Field, alignNumeric } from '../inventory/InvUi'
import { listAssignablePeople } from '../../lib/api/inventory'
import { listLocationUtilisation } from '../../lib/api/warehouseAssets'
import { LOCATION_RESTRICTIONS, locationFindings } from '../../lib/warehouseClasses/specialClasses'
import { formatQty } from '../../lib/inventory/inventoryMoney'

const RESTRICTION_KEYS = new Set(LOCATION_RESTRICTIONS.map((r) => r.value))
const restrictionText = (t, v) => t(`wmsparts.loc.restriction.${RESTRICTION_KEYS.has(v || '') && v ? v : 'none'}`)

// Mirrors locationFindings() in lib/warehouseClasses/specialClasses.js, translated at render.
function findingTexts(row, t) {
  const out = []
  const pct = row?.pct_used === null || row?.pct_used === undefined || row?.pct_used === '' ? null : Number(row.pct_used)
  if (pct !== null && Number.isFinite(pct) && pct > 100) out.push({ tone: 'bad', text: t('wmsparts.loc.find.over', { pct }) })
  else if (pct !== null && Number.isFinite(pct) && pct >= 90) out.push({ tone: 'warn', text: t('wmsparts.loc.find.nearly', { pct }) })
  const br = Number(row?.restriction_breaches) || 0
  if (br > 0) out.push({ tone: 'bad', text: t(br === 1 ? 'wmsparts.loc.find.breachOne' : 'wmsparts.loc.find.breachMany', { n: br, rule: restrictionText(t, row.restriction) }) })
  if (row?.mixing_breach) out.push({ tone: 'bad', text: t('wmsparts.loc.find.mixing') })
  return out
}

export function LocationRulesFields({ draft, setDraft, errors = {} }) {
  const { t } = useLanguage()
  const [people, setPeople] = useState([])
  useEffect(() => {
    let live = true
    listAssignablePeople().then((r) => { if (live) setPeople(r) }).catch(() => { if (live) setPeople([]) })
    return () => { live = false }
  }, [])
  const set = (k) => (e) => { const v = e.target.value; setDraft((d) => ({ ...d, [k]: v })) }
  return (
    <div className="inv-form">
      <Field label={t('wmsparts.loc.responsiblePerson')} error={errors.responsible_user_id} full>
        <select className="cc-select" value={draft.responsible_user_id || ''} onChange={set('responsible_user_id')}>
          <option value="">{t('wmsparts.loc.nobody')}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username}{p.role ? ` (${p.role})` : ''}</option>)}
        </select>
      </Field>
      <Field label={t('wmsparts.loc.capacityOptional')} error={errors.capacity_qty}>
        <input className="inv-input" type="number" min="0" step="any" value={draft.capacity_qty ?? ''} onChange={set('capacity_qty')} />
      </Field>
      <Field label={t('wmsparts.loc.capacityUnit')} error={errors.capacity_uom}>
        <input className="inv-input" value={draft.capacity_uom || ''} onChange={set('capacity_uom')} maxLength={20} />
      </Field>
      <Field label={t('wmsparts.loc.storageRule')} full>
        <select className="cc-select" value={draft.restriction || ''} onChange={set('restriction')}>
          {LOCATION_RESTRICTIONS.map((r) => <option key={r.value} value={r.value}>{restrictionText(t, r.value)}</option>)}
        </select>
      </Field>
      {draft.restriction && (
        <Field label={t('wmsparts.loc.ruleNote')} full>
          <input className="inv-input" value={draft.restriction_note || ''} onChange={set('restriction_note')} maxLength={400} />
        </Field>
      )}
      {draft.location_type === 'service_van' && (
        <Field label={t('wmsparts.loc.van')} error={errors.van_asset_no} full>
          <input className="inv-input" value={draft.van_asset_no || ''} onChange={set('van_asset_no')} maxLength={60} />
        </Field>
      )}
    </div>
  )
}

export function LocationRulesSection({ scope, people = [] }) {
  const { t } = useLanguage()
  const q = useInvQuery(() => listLocationUtilisation(scope), [scope.country, scope.site])
  const [onlyIssues, setOnlyIssues] = useState(false)
  const personName = useMemo(() => new Map(people.map((p) => [p.id, p.full_name || p.username])), [people])
  const rows = useMemo(() => (q.data?.rows || [])
    .filter((r) => r.capacity_qty !== null || r.restriction || r.responsible_user_id || r.van_asset_no)
    .map((r) => ({ ...r, findings: locationFindings(r) }))
    .filter((r) => !onlyIssues || r.findings.length), [q.data, onlyIssues])

  if (q.data?.status === 'not_provisioned') {
    return (
      <Note tone="info" title={t('wmsparts.loc.notSetUpTitle')}>{t('wmsparts.loc.notSetUpBody')}</Note>
    )
  }
  return (
    <SectionCard title={t('wmsparts.loc.title')} sub={t('wmsparts.loc.sub')}
      action={(
        <label className="inv-check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> {t('wmsparts.loc.onlyProblems')}</label>
      )}>
      {q.error && <ErrorNote error={q.error} onRetry={q.retry} />}
      <div className="inv-scroll">
        <KitTable compact loading={q.loading && !q.data} rows={rows} empty={t('wmsparts.loc.empty')}
          columns={alignNumeric([
            { key: 'code', header: t('wmsparts.common.location'), cell: (r) => `${r.code}${r.name ? `: ${r.name}` : ''}` },
            { key: 'site', header: t('wmsparts.common.site') },
            { key: 'owner', header: t('wmsparts.loc.responsible'), cell: (r) => (r.responsible_user_id ? personName.get(r.responsible_user_id) || t('wmsparts.loc.namedPerson') : t('wmsparts.loc.nobody')) },
            { key: 'restriction', header: t('wmsparts.fitment.col.rule'), cell: (r) => restrictionText(t, r.restriction) },
            { key: 'van_asset_no', header: t('wmsparts.loc.vanCol'), cell: (r) => r.van_asset_no || '' },
            { key: 'qty_on_hand', header: t('wmsparts.common.onHand'), numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
            { key: 'capacity', header: t('wmsparts.loc.capacity'), numeric: true, cell: (r) => (r.capacity_qty === null ? t('wmsparts.loc.notSet') : `${formatQty(r.capacity_qty)} ${r.capacity_uom || ''}`) },
            { key: 'findings', header: t('wmsparts.queue.check'), cell: (r) => (r.findings.length
              ? findingTexts(r, t).map((f) => <StatusPill key={f.text} value={f.tone} tone={f.tone} label={f.text} />)
              : <StatusPill value="ok" tone="good" label={t('wmsparts.loc.ok')} />) },
          ])} />
      </div>
      <p className="cc-card-sub">{t('wmsparts.loc.foot')}</p>
    </SectionCard>
  )
}
