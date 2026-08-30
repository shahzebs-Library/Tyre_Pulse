import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const sql = fs.readFileSync(
  path.resolve('supabase/migrations/20260830181348_advanced_operational_workflow.sql'),
  'utf8',
)

describe('advanced operational workflow migration', () => {
  it('keeps every exposed workflow table behind RLS and explicit grants', () => {
    for (const table of ['action_item_history', 'shift_handovers', 'shift_handover_items']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`)
    }
    expect(sql).toContain('revoke all on public.action_item_history from anon, authenticated')
    expect(sql).toContain('grant select on public.action_item_history to authenticated')
  })

  it('makes history append-only to clients and tenant scoped', () => {
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete)[^;]*action_item_history/i)
    expect(sql).toContain('organisation_id = (select public.app_current_org())')
    expect(sql).toContain('action_item_history_trigger')
    expect(sql).toContain('revoke delete on public.action_items from authenticated')
    expect(sql).toContain('references public.action_items(id) on delete restrict')
  })

  it('validates transitions and cross-tenant handover links in the database', () => {
    expect(sql).toContain('Invalid action item transition')
    expect(sql).toContain("new.organisation_id is distinct from old.organisation_id")
    expect(sql).toContain('a.organisation_id = h.organisation_id')
    expect(sql).toContain('public.transition_action_item')
  })

  it('adds realtime tables idempotently without touching the realtime schema', () => {
    expect(sql).toContain("pubname = 'supabase_realtime'")
    expect(sql).toContain('alter publication supabase_realtime add table public.action_items')
    expect(sql).not.toMatch(/(?:create|alter|drop)\s+(?:table|function|schema)\s+realtime\./i)
  })

  it('reserves and releases work-order stock atomically behind narrow RPCs', () => {
    expect(sql).toContain('public.work_order_stock_reservations')
    expect(sql).toContain('public.work_order_stock_reservation_lines')
    expect(sql).toContain('private.reserve_work_order_stock_internal')
    expect(sql).toContain('private.release_work_order_stock_internal')
    expect(sql).toContain('public.reserve_work_order_stock')
    expect(sql).toContain('public.release_work_order_stock')
    expect(sql).toMatch(/from public\.stock[\s\S]*for update/i)
    expect(sql).toContain('coalesce(quantity, 0) - v_line.qty::integer')
    expect(sql).toContain('coalesce(quantity, 0) + v_line.quantity')
  })

  it('prevents direct reservation writes and cross-tenant stock access', () => {
    expect(sql).toContain('revoke all on public.work_order_stock_reservations')
    expect(sql).toContain('grant select on public.work_order_stock_reservations')
    expect(sql).toContain('where id = v_line.stock_id and organisation_id = v_org for update')
    expect(sql).toContain('where id = p_work_order_id and organisation_id = v_org for update')
    expect(sql).toContain('unique (organisation_id, idempotency_key)')
    expect(sql).toContain('work_order_stock_one_active_idx')
  })
})
