-- V441 - A sparse ERP asset row must not replace asset_extra with an empty object.
-- V439 includes this on fresh installs; this repairs the first live deployment.

do $migration$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='promote_erp_assets';

  v_old := E'''asset_extra'',jsonb_strip_nulls(jsonb_build_object(''capacity'',r.capacity,''shift'',r.shift,\n        ''second_user'',r.second_user,''age_of_asset'',r.age_of_asset,''org_ou'',r.org_ou))';
  v_new := E'''asset_extra'',nullif(jsonb_strip_nulls(jsonb_build_object(''capacity'',r.capacity,''shift'',r.shift,\n        ''second_user'',r.second_user,''age_of_asset'',r.age_of_asset,''org_ou'',r.org_ou)),''{}''::jsonb)';
  if position(v_new in v_def)>0 then return; end if;
  if position(v_old in v_def)=0 then raise exception 'V441: asset_extra anchor not found'; end if;
  execute replace(v_def,v_old,v_new);
end
$migration$;
