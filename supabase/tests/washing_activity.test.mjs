import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('washing attribution, structured evidence, atomic corrections and scope', async () => {
  const db = new PGlite()
  const user='00000000-0000-0000-0000-000000000001', other='00000000-0000-0000-0000-000000000002', org='00000000-0000-0000-0000-000000000003'
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select '${user}'::uuid $$;
      create function app_current_org() returns uuid language sql stable as $$ select '${org}'::uuid $$;
      create function app_is_elevated() returns boolean language sql stable as $$ select coalesce(current_setting('test.elevated',true),'true')='true' $$;
      create table profiles(id uuid primary key, organisation_id uuid, full_name text, username text);
      insert into profiles values('${user}','${org}','Entry Person','entry');
      create table wash_records(id uuid primary key default gen_random_uuid(), organisation_id uuid default app_current_org(), country text, site text, area text, asset_no text, vehicle_type text,
        wash_date date, wash_time text,wash_type text,bay text,washed_by text,water_liters numeric,cost numeric,duration_min numeric,status text,
        odometer_km numeric,notes text,created_by uuid default auth.uid(),created_at timestamptz default now(),updated_at timestamptz default now(),client_uuid text unique);
      create table wash_record_corrections(id uuid default gen_random_uuid(),organisation_id uuid,wash_id uuid references wash_records,field text,old_value text,new_value text,reason text,corrected_by uuid default auth.uid(),corrected_at timestamptz default now());
      alter table wash_records enable row level security;
      create policy wash_access on wash_records to authenticated using (organisation_id=app_current_org() and site='A') with check(organisation_id=app_current_org() and site='A');
      alter table wash_record_corrections enable row level security;
      create policy correction_read on wash_record_corrections for select to authenticated using(organisation_id=app_current_org());
      grant usage on schema public,auth to authenticated; grant select,insert,update on wash_records to authenticated; grant select on wash_record_corrections,profiles to authenticated;
    `)
    await db.exec(readFileSync(new URL('../migrations/20260921085115_washing_activity_and_evidence.sql',import.meta.url),'utf8'))
    await db.exec('set role authenticated')
    await assert.rejects(db.query('insert into wash_records(site,created_by) values($1,$2)',['A',other]),e=>e.code==='42501')
    const details={version:1,chemical_status:'used',chemicals:[{name:'Actual product',dilution:'As labelled'}],checklist:[{label:'Cab',result:'fail',note:'Dust remains'}]}
    const row=(await db.query("insert into wash_records(site,status,wash_details,entry_name) values('A','Scheduled',$1,'Spoof') returning *",[details])).rows[0]
    assert.equal(row.entry_name,'Entry Person'); assert.equal(row.created_by,user); assert.equal(row.completed_by,null)
    await assert.rejects(db.query('update wash_records set created_by=$1 where id=$2',[other,row.id]),e=>e.code==='42501')
    await assert.rejects(db.query('update wash_records set wash_details=$1 where id=$2',[{...details,checklist:[{label:'Cab',result:'fail'}]},row.id]),e=>e.code==='23514')
    const correction=(await db.query('select correct_wash_record($1,$2,$3) result',[row.id,{status:'Completed',wash_details:{...details,chemical_status:'none',chemicals:[]}},'Correct actual wash'])).rows[0].result
    assert.equal(correction.changed,2)
    const updated=(await db.query('select * from wash_records where id=$1',[row.id])).rows[0]
    assert.equal(updated.created_by,user); assert.equal(updated.completed_by,user)
    assert.equal(updated.wash_details.chemical_status,'none')
    assert.equal((await db.query('select count(*)::int n from wash_record_corrections')).rows[0].n,2)
    await assert.rejects(db.query('select correct_wash_record($1,$2,$3)',[row.id,{site:'B',notes:'must roll back'},'Wrong scope']),e=>e.code==='42501')
    assert.equal((await db.query('select site from wash_records where id=$1',[row.id])).rows[0].site,'A')
    await assert.rejects(db.query('insert into wash_record_corrections(wash_id,organisation_id) values($1,$2)',[row.id,org]),e=>e.code==='42501')
    await db.exec("set test.elevated='false'")
    assert.equal((await db.query('select correct_wash_record($1,$2,$3) result',[row.id,{notes:'x'},'No access'])).rows[0].result.reason,'forbidden')
    assert.equal((await db.query('select * from wash_entry_people($1)',[[row.id]])).rows[0].username,'entry')
  } finally { await db.close() }
})
