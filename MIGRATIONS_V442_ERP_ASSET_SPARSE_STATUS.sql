-- V442 - A sparse ERP asset refresh must not force a missing status to Active.
-- V439 includes this on fresh installs; this repairs the first live deployment.

do $migration$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='promote_erp_assets';

  v_old := '''status'',case when r.status ~* ''inactive|retire|dispos'' then ''Inactive'' else ''Active'' end,';
  v_new := '''status'',case when nullif(btrim(coalesce(r.status,'''')),'''') is null then null
        when r.status ~* ''inactive|retire|dispos'' then ''Inactive'' else ''Active'' end,';
  if position(v_new in v_def)>0 then return; end if;
  if position(v_old in v_def)=0 then raise exception 'V442: sparse status anchor not found'; end if;
  execute replace(v_def,v_old,v_new);
end
$migration$;
