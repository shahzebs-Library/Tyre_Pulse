// Synthetic test setup on a disposable clone of copy A (never on copy A itself).
import { run, rpc, sel, one, asUser } from './lib.mjs'

export const P = {
  admin: '58787cc7-818b-4fd5-8b7b-c93e4e01f641', // Admin + super admin (real profile, sanitized)
  keeper: '199bb37c-593d-416d-a5ee-9d043bb93542', // Store Keeper
  keeper2: '249b32c1-06bf-4580-a12c-81262c896e40', // Store Keeper
  counter: '1cd74900-64fe-4f3a-913c-b9060f088ff3', // Tyre Man
  reviewer: '34793423-43df-4b6f-9270-9d1e8be6fa30', // Manager (KSA)
  approver: '06161659-c666-48ac-82f3-5887b1082dc2', // Workshop Maintenance Area Manager (KSA)
  pmv: '08aac5e1-8fe6-42fa-b51a-ef0a168f99cb', // PMV Manager (UAE scope)
  tpe: 'e864b410-3372-40ca-bd08-e020b0f90595', // Tire Planning Engineer
  finance: '33e40d9c-e1e7-4ccd-972e-d88e1bfcb11a', // Reporter re-roled to Finance Manager (synthetic)
  driver: '00205ce9-f5ec-41ed-90b7-e1757f0f8700', // Driver, no stock view
  orgB: 'c2f9a806-1d9c-4c3a-9a38-0bd7fefb087e', // Manager in the second company (a50e2d87)
}
export const ORG_A = '00000000-0000-0000-0000-000000000001'
export const ORG_B = 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7'

const G = {
  keeper: ['receive', 'issue', 'transfer', 'count'], keeper2: ['receive', 'issue', 'transfer', 'count'], counter: ['count'],
  reviewer: ['audit_create', 'discrepancy_review', 'view_value'], approver: ['adjustment_approve', 'discrepancy_review', 'view_value'],
  pmv: ['adjustment_approve', 'scrap_approve', 'view_value'], finance: ['financial_post', 'view_value'],
  orgB: ['create', 'receive', 'issue', 'transfer', 'count', 'audit_create', 'discrepancy_review', 'adjustment_approve', 'financial_post', 'view_value'],
}

export async function setup (db) {
  const rows = Object.entries(G).flatMap(([p, caps]) => caps.map(c => `('${P[p]}','stock','${c}','grant','rehearsal synthetic grant')`))
  await run(db, `insert into user_access_grants(user_id, module_key, capability, effect, note) values ${rows.join(',')} on conflict do nothing;
    insert into material_master(organisation_id, country, item_code, item_name, category)
      select '${ORG_B}', 'KSA', 'RH-B-ITEM', 'Rehearsal item company B', category from material_master limit 1;`, 'supabase_admin')
  await run(db, asUser(P.admin, `update profiles set role = 'Finance Manager' where id = '${P.finance}'`))
  const items = await sel(db, `select id from material_master where organisation_id = '${ORG_A}' and country = 'KSA' order by id limit 4`)
  const itemB = (await one(db, `select id from material_master where organisation_id = '${ORG_B}' limit 1`)).id
  const L = {}
  L.w1 = (await rpc(db, P.admin, 'inv_location_upsert', { country: 'KSA', site: 'NHC', location_type: 'warehouse', code: 'RH-WH1' })).id
  L.w2 = (await rpc(db, P.admin, 'inv_location_upsert', { country: 'KSA', site: 'DIRIYAH', location_type: 'warehouse', code: 'RH-WH2' })).id
  L.uae = (await rpc(db, P.admin, 'inv_location_upsert', { country: 'UAE', site: 'RH-UAE', location_type: 'warehouse', code: 'RH-WHU' })).id
  L.b = (await rpc(db, P.orgB, 'inv_location_upsert', { country: 'KSA', site: 'NHC', location_type: 'warehouse', code: 'RH-B1' })).id
  return { items: items.map(r => r.id), itemB, L }
}
