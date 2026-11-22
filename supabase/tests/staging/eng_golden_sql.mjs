// The one SQL script that runs every engineering RPC on the golden fixture.
// Used by eng_round2_staging.mjs on the patched copy and on the untouched baseline.
import { FIXTURE as fx, loadFixtureSql, asUser, asOwner, emit } from './eng_staging_lib.mjs'

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const numLit = (v) => (v === null || v === undefined ? 'null::numeric' : `${Number(v)}::numeric`)

export function goldenScript({ withBreakdown }) {
  const W = fx.window
  const p = fx.pure
  let s = 'begin;\n' + loadFixtureSql(fx) + asUser(fx.user)

  s += emit('fit', `select jsonb_object_agg(f.id, jsonb_build_object('km', f.km, 'overlap', f.is_overlap,
        'calc_cpk', public.calc_cpk(f.cost_per_tyre, f.km_at_fitment, f.km_at_removal))) from public.v_tyre_lifetime_fitments f`)
  s += emit('tyres', `select jsonb_object_agg(v.tyre_key, jsonb_build_object('cost', v.purchase_cost, 'km', v.km_known, 'fitments', v.fitments,
        'status', v.purchase_cost_status, 'coverage', v.km_coverage, 'qty', v.qty, 'active', v.is_active)) from public.v_tyre_lifetime v`)
  s += emit('lifetime', `public.get_tyre_lifetime_cpk(null, null, null, null)`)
  s += emit('running', `public.get_tyre_running_life('KSA', null, 0, null, false)`)
  s += emit('due', `public.get_tyre_running_life('KSA', null, 0, null, true)`)
  s += emit('double', `select coalesce(jsonb_agg(e.serial_no order by e.serial_no), '[]'::jsonb) from public.v_tyre_fitment_evidence e where e.double_active_wheel`)
  s += emit('overview', `public.get_cost_cpk_overview('KSA', null, ${lit(W.from)}, ${lit(W.to)})`)
  s += emit('fleet', `public.get_fleet_cpk('KSA', ${lit(W.from)}, ${lit(W.to)})`)
  s += emit('fleet_all', `public.get_fleet_cpk(null, ${lit(W.from)}, ${lit(W.to)})`)
  s += emit('kmspan', `select jsonb_object_agg(x.asset_no, x.km_run) from public.fleet_km_by_asset(${lit(fx.org)}::uuid, 'KSA', ${lit(W.from)}, ${lit(W.to)}) x`)
  s += emit('backfill', `public.tyre_price_backfill(true, 'KSA')`)
  s += asOwner()
  s += emit('backfill_rows', `select coalesce(jsonb_object_agg(serial_no, jsonb_build_object('new_cost', new_cost, 'source', source)), '{}'::jsonb) from _tyre_price_fill`)
  s += asUser(fx.user)
  if (withBreakdown) s += emit('breakdown', `public.get_tyre_spend_breakdown(null, null, null)`)

  s += emit('pure_km', `select jsonb_agg(public.tyre_km_life(c.fit, c.rem, c.total, c.typ) order by c.i) from (values ${
    p.km_life.map((c, i) => `(${i}, ${numLit(c.fit)}, ${numLit(c.rem)}, ${numLit(c.total)}, ${lit(c.type)}::text)`).join(', ')}) c(i, fit, rem, total, typ)`)
  s += emit('pure_cpk', `select jsonb_agg(public.calc_cpk(c.cost, c.fit, c.rem) order by c.i) from (values ${
    p.calc_cpk.map((c, i) => `(${i}, ${numLit(c.cost)}, ${numLit(c.fit)}, ${numLit(c.rem)})`).join(', ')}) c(i, cost, fit, rem)`)
  s += emit('pure_unit', `select jsonb_agg(public.cpk_unit_for_asset_type(c.typ) order by c.i) from (values ${
    p.unit.map((c, i) => `(${i}, ${lit(c.type)}::text)`).join(', ')}) c(i, typ)`)
  s += emit('pure_lines', `select jsonb_agg(jsonb_build_object('warranty', public.tyre_price_is_warranty(c.t), 'repair', public.tyre_price_is_repair(c.t),
        'kind', public.tyre_cost_line_kind(c.t)) order by c.i) from (values ${
    p.lines.map((c, i) => `(${i}, ${lit(c.text)}::text)`).join(', ')}) c(i, t)`)
  s += emit('line_kinds', `select jsonb_agg(public.tyre_cost_line_kind(c.t) order by c.i) from (values ${
    fx.expense_lines.map((c, i) => `(${i}, ${lit(c.item_description)}::text)`).join(', ')}) c(i, t)`)
  s += 'rollback;\n'
  return s
}
