import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
const migration=await readFile(new URL('../migrations/20260912113329_driver_self_access_without_site_assignment.sql',import.meta.url),'utf8')
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
test('linked driver self-access does not grant all-site, other-driver or foreign-tenant access',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`CREATE SCHEMA private; ${migration}
   CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
   CREATE TABLE profiles(id uuid,org uuid,active boolean,country text[],site text[],manager boolean);
   CREATE TABLE drivers(id uuid,organisation_id uuid,country text,site text);
   CREATE TABLE driver_account_links(driver_id uuid,user_id uuid,organisation_id uuid);
   CREATE TABLE driver_team_assignments(driver_id uuid,organisation_id uuid,starts_at timestamptz,ends_at timestamptz,supervisor_id uuid,manager_id uuid);
   CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql SET search_path TO 'public' AS $$ SELECT active FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql SET search_path TO 'public' AS $$ SELECT org FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION app_sees_all_countries() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION app_country_scope() RETURNS text[] LANGUAGE sql SET search_path TO 'public' AS $$ SELECT country FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION app_user_can(text,text) RETURNS boolean LANGUAGE sql SET search_path TO 'public' AS $$ SELECT manager FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION private.driver_workspace_scope(o uuid,c text,s text) RETURNS boolean LANGUAGE sql SET search_path TO 'public' AS $$ SELECT coalesce((SELECT org=o AND lower(c)=ANY(country) AND s=ANY(site) AND active FROM profiles WHERE id=auth.uid()),false) $$;
   CREATE FUNCTION private.driver_workspace_access(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'none'::text $$;
   INSERT INTO profiles VALUES('${id(1)}','${id(9)}',true,ARRAY['ksa'],ARRAY[]::text[],false),('${id(2)}','${id(9)}',true,ARRAY['ksa'],ARRAY['SITE-A'],true);
   INSERT INTO drivers VALUES('${id(3)}','${id(9)}','KSA',NULL),('${id(4)}','${id(9)}','KSA',NULL),('${id(5)}','${id(8)}','KSA',NULL),('${id(6)}','${id(9)}','UAE',NULL),('${id(7)}','${id(9)}','KSA','SITE-A');
   INSERT INTO driver_account_links VALUES('${id(3)}','${id(1)}','${id(9)}'),('${id(5)}','${id(1)}','${id(8)}'),('${id(6)}','${id(1)}','${id(9)}');
   ${migration}
   SET test.actor='${id(1)}';
  `)
  const access=async n=>(await db.query('SELECT private.driver_workspace_access($1) access',[id(n)])).rows[0].access
  assert.equal(await access(3),'driver')
  assert.equal(await access(4),'none');assert.equal(await access(5),'none');assert.equal(await access(6),'none')
  await db.query('UPDATE profiles SET active=false WHERE id=$1',[id(1)])
  assert.equal(await access(3),'none')
  await db.exec(`SET test.actor='${id(2)}'`)
  assert.equal(await access(3),'none');assert.equal(await access(7),'manager')
  await db.exec("SET test.actor=''")
  assert.equal(await access(3),'none')
 }finally{await db.close()}
})
