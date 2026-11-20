-- ROLLBACK of 20261120113000_inv_approval_roles.sql.
-- Restores approval_private.validate_policy and _inv_approval_block_reason from the
-- definitions captured at apply time (_bak.inv_113000_snapshot, executed verbatim),
-- drops the thresholds table and helpers, and removes the two role records this file
-- added, but only while no profile holds them (a held role is kept with a NOTICE).
begin;

do $$
declare r record;
begin
  if to_regclass('_bak.inv_113000_snapshot') is null then
    raise notice '113000 rollback: no snapshot table; functions left as they are.';
    return;
  end if;
  for r in select obj, def from _bak.inv_113000_snapshot order by obj loop
    if to_regprocedure(r.obj) is not null then
      execute r.def;
    end if;
  end loop;
end $$;

drop function if exists public.inv_approval_limit_upsert(jsonb);
drop function if exists public._inv_approval_extra_block(uuid);
drop function if exists public._inv_approval_magnitude(uuid);
drop table if exists public.inventory_approval_limits;
drop function if exists public.inv_approver_roles(text);

do $$
declare r record;
begin
  if to_regclass('_bak.inv_113000_roles') is null or to_regclass('public.custom_roles') is null then return; end if;
  for r in select b.id, b.name, b.organisation_id from _bak.inv_113000_roles b loop
    if exists (select 1 from public.profiles p where p.role = r.name
                and coalesce(p.org_id, p.organisation_id) is not distinct from r.organisation_id) then
      raise notice '113000 rollback: role % is assigned to a user; kept.', r.name;
    else
      delete from public.custom_roles where id = r.id;
    end if;
  end loop;
end $$;

drop table if exists _bak.inv_113000_roles;
drop table if exists _bak.inv_113000_snapshot;

commit;
