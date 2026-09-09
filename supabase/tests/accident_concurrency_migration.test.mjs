// Isolated PostgreSQL/PGlite regression harness; never connects to a server.
// Run: npm run test:database
// The minimal fixtures test function behavior and gate wiring, not production RLS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = await readFile(new URL('../security-rollout/migrations/20260907075433_serialize_accident_closure_and_claim_registration.sql', import.meta.url), 'utf8');

const actor = '00000000-0000-0000-0000-000000000001';
const requester = '00000000-0000-0000-0000-000000000002';
const caseA = '00000000-0000-0000-0000-000000000101';
const caseB = '00000000-0000-0000-0000-000000000102';
const caseC = '00000000-0000-0000-0000-000000000103';

await db.exec(`
  create schema auth;
  create table public.accidents (
    id uuid primary key, organisation_id uuid, country text, site text,
    close_requested_by uuid, closure_status text, status text,
    closure_approved_by uuid, closure_approved_at timestamptz,
    closure_rejected_reason text, claim_amount numeric
  );
  create table public.profiles (id uuid primary key, full_name text, username text);
  create table public.accident_remarks (
    id bigserial primary key, accident_id uuid, author_id uuid, author_name text,
    remark text, remark_type text
  );
  create table public.notifications (
    id bigserial primary key, user_id uuid, type text, title text, body text,
    entity_type text, entity_id uuid
  );
  create table public.accident_insurance_claims (
    id uuid primary key default gen_random_uuid(), organisation_id uuid,
    accident_id uuid, country text, site text, insurance_applicable boolean,
    insurer text, policy_no text, claim_no text, deductible numeric, decision text,
    claim_registered_date date, created_by uuid, created_at timestamptz, updated_at timestamptz
  );
  create table public.accident_case_workstreams (
    id uuid primary key default gen_random_uuid(), organisation_id uuid,
    accident_id uuid, country text, site text, workstream_key text, status text,
    started_at timestamptz, created_by uuid, created_at timestamptz, updated_at timestamptz,
    unique(accident_id, workstream_key)
  );
  create function auth.uid() returns uuid language sql as $$ select '${actor}'::uuid $$;
  create function public.is_elevated_user() returns boolean language sql as $$
    select coalesce(current_setting('test.elevated', true), 'true') = 'true'
  $$;
  create function public.app_is_elevated() returns boolean language sql as $$ select public.is_elevated_user() $$;
  create function public.app_user_can(text,text) returns boolean language sql as $$ select false $$;
  create function public._accident_rpc_context(p_accident_id uuid, out org uuid, out country text, out site text)
  returns record language plpgsql as $$
  begin
    if current_setting('test.deny_scope', true) = 'true' then
      raise exception 'Not permitted for this case scope.' using errcode = '42501';
    end if;
    select a.organisation_id, a.country, a.site into org, country, site
      from public.accidents a where a.id = p_accident_id;
    if not found then raise exception 'Case not found' using errcode = 'P0002'; end if;
  end $$;
  insert into public.profiles values ('${actor}', 'Reviewer', 'reviewer');
  insert into public.accidents(id,organisation_id,country,site,close_requested_by,closure_status,status)
  values ('${caseA}','${actor}','KSA','Site A','${requester}','pending_closure','Open'),
         ('${caseB}','${actor}','KSA','Site A','${requester}','pending_closure','Open'),
         ('${caseC}','${actor}','KSA','Site A','${requester}',null,'Open');
`);

await db.exec(migration);
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const rejected = async (sql, params, code) => {
  await assert.rejects(db.query(sql, params), error => error.code === code);
};

await db.query('select public.approve_accident_closure($1)', [caseA]);
assert.equal(await scalar('select closure_status from accidents where id=$1', [caseA]), 'closed');
await rejected('select public.approve_accident_closure($1)', [caseA], '55000');
await rejected('select public.reject_accident_closure($1,$2)', [caseA, 'Competing decision'], '55000');
assert.equal(await scalar('select count(*)::int from accident_remarks where accident_id=$1', [caseA]), 1);
assert.equal(await scalar('select count(*)::int from notifications where entity_id=$1', [caseA]), 1);

await db.query('select public.reject_accident_closure($1,$2)', [caseB, 'More evidence needed']);
assert.equal(await scalar('select closure_status from accidents where id=$1', [caseB]), 'open');
await rejected('select public.reject_accident_closure($1,$2)', [caseB, 'Repeated decision'], '55000');
await rejected('select public.approve_accident_closure($1)', [caseB], '55000');
assert.equal(await scalar('select count(*)::int from accident_remarks where accident_id=$1', [caseB]), 1);
assert.equal(await scalar('select count(*)::int from notifications where entity_id=$1', [caseB]), 1);
await rejected('select public.approve_accident_closure($1)', [caseC], '55000');
await rejected('select public.reject_accident_closure($1,$2)', [caseC, null], '55000');

const register = 'select public.accident_claim_register($1,$2,$3,$4,$5,$6) as result';
const first = await scalar(register, [caseC, 'Insurer', 'P1', 'C1', 100, null]);
const repeat = await scalar(register, [caseC, 'Insurer', 'P1', 'C1', 125, 5]);
assert.equal(first.claim.id, repeat.claim.id);
assert.equal(await scalar('select count(*)::int from accident_insurance_claims where accident_id=$1', [caseC]), 1);
assert.equal(Number(await scalar('select claim_amount from accidents where id=$1', [caseC])), 125);
assert.equal(await scalar('select count(*)::int from accident_case_workstreams where accident_id=$1', [caseC]), 1);

await db.exec("set test.deny_scope='true'");
await rejected(register, [caseC, 'Insurer', 'P1', 'C1', 200, null], '42501');
await rejected('select public.approve_accident_closure($1)', [caseC], '42501');
await rejected('select public.reject_accident_closure($1,$2)', [caseC, 'Denied'], '42501');
await db.exec("set test.deny_scope='false'; set test.elevated='false'");
await rejected(register, [caseC, 'Insurer', 'P1', 'C1', 200, null], '42501');
await rejected('select public.approve_accident_closure($1)', [caseC], 'P0001');
await rejected('select public.reject_accident_closure($1,$2)', [caseC, 'Denied'], 'P0001');
assert.equal(await scalar('select count(*)::int from accident_remarks'), 2);
assert.equal(await scalar('select count(*)::int from notifications'), 2);
assert.equal(Number(await scalar('select claim_amount from accidents where id=$1', [caseC])), 125);

// PGlite has one backend: validate lock ordering structurally, without claiming a
// two-session contention test. Production concurrency verification remains a gate.
for (const name of ['approve_accident_closure', 'reject_accident_closure']) {
  const start = migration.indexOf(`FUNCTION public.${name}`);
  const body = migration.slice(start, migration.indexOf('$function$;', start));
  assert.ok(body.indexOf('FOR UPDATE') < body.indexOf("IS DISTINCT FROM 'pending_closure'"));
  assert.ok(body.indexOf("IS DISTINCT FROM 'pending_closure'") < body.indexOf('UPDATE public.accidents'));
}
const claimStart = migration.indexOf('FUNCTION public.accident_claim_register');
const claimBody = migration.slice(claimStart, migration.indexOf('$function$;', claimStart));
assert.ok(claimBody.indexOf('for update') < claimBody.indexOf('select * into v_existing'));
await db.close();
console.log('PASS: SQL compiled; closure repeat/competing-state refusal, one audit/notification per decision, claim reuse/readback, role/scope gate wiring, and lock ordering. Two-session contention not tested.');
