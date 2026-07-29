/**
 * Accident workflow service - departments, routing rules and approved email
 * templates CRUD, plus the guarded stage/VOR mutations and the master email
 * toggle. Backs the accident detail workflow controls and the admin config
 * pages. Org + role isolation is enforced server-side (RLS / triggers); this
 * layer is explicit-column, missing-relation -> [] safe.
 *
 * The lifecycle maths live in src/lib/accidentWorkflow.js (pure engine) - do NOT
 * re-derive stages/routing here.
 */
import { supabase, unwrap } from './_client'
import { statusFromStage } from '../accidentWorkflow'

const DEPT_COLS = 'id,name,code,description,active,sort_order,created_at,updated_at'
const RULE_COLS =
  'id,name,description,active,priority,event_key,match_severities,match_types,match_sites,match_countries,min_cost,require_injury,require_vor,require_third_party,departments,to_roles,cc_roles,escalate_roles,created_at,updated_at'
const TPL_COLS = 'id,key,name,subject,body_html,active,approved,updated_at'
const PROFILE_COLS = 'id,full_name,email,role,site,sites,country,push_token,approved,locked,organisation_id'

// ── departments ───────────────────────────────────────────────────────────────
export async function listDepartments({ activeOnly = false } = {}) {
  let q = supabase.from('departments').select(DEPT_COLS).order('sort_order').order('name')
  if (activeOnly) q = q.eq('active', true)
  return unwrap(await q)
}
export async function createDepartment(values) {
  return unwrap(await supabase.from('departments').insert(values).select(DEPT_COLS).single())
}
export async function updateDepartment(id, patch) {
  return unwrap(await supabase.from('departments').update(patch).eq('id', id).select(DEPT_COLS).single())
}
export async function deleteDepartment(id) {
  return supabase.from('departments').delete().eq('id', id)
}

// ── routing rules ─────────────────────────────────────────────────────────────
export async function listRoutingRules() {
  return unwrap(await supabase.from('accident_routing_rules').select(RULE_COLS).order('priority').order('name'))
}
export async function createRoutingRule(values) {
  return unwrap(await supabase.from('accident_routing_rules').insert(values).select(RULE_COLS).single())
}
export async function updateRoutingRule(id, patch) {
  return unwrap(await supabase.from('accident_routing_rules').update(patch).eq('id', id).select(RULE_COLS).single())
}
export async function deleteRoutingRule(id) {
  return supabase.from('accident_routing_rules').delete().eq('id', id)
}

// ── email templates ───────────────────────────────────────────────────────────
export async function listEmailTemplates() {
  return unwrap(await supabase.from('accident_email_templates').select(TPL_COLS).order('key'))
}
export async function updateEmailTemplate(id, patch) {
  return unwrap(await supabase.from('accident_email_templates').update(patch).eq('id', id).select(TPL_COLS).single())
}
export async function createEmailTemplate(values) {
  return unwrap(await supabase.from('accident_email_templates').insert(values).select(TPL_COLS).single())
}

// ── recipient-preview source (profiles scoped by RLS to the caller's org) ─────
export async function listRoutingProfiles() {
  return unwrap(
    await supabase.from('profiles').select(PROFILE_COLS).eq('approved', true).eq('locked', false),
  )
}

// ── guarded stage / VOR / claim mutations (triggers sync status + emit events) ─
/** Advance/set the unified workflow stage. Also carries the legacy status so old
 *  readers stay consistent immediately (the DB trigger would do this too). */
export async function setAccidentStage(id, stage, extra = {}) {
  const patch = { workflow_stage: stage, status: statusFromStage(stage), ...extra }
  return unwrap(await supabase.from('accidents').update(patch).eq('id', id).select('id,workflow_stage,status').single())
}
/** Toggle Vehicle-Off-Road. vor_since is managed by the DB trigger. */
export async function setAccidentVor(id, vor) {
  return unwrap(await supabase.from('accidents').update({ vor }).eq('id', id).select('id,vor,vor_since').single())
}

// ── master email toggle (system_config) ───────────────────────────────────────
function truthyConfig(v) {
  return ['true', '1', 'on', 'yes'].includes(String(v ?? '').trim().replace(/^"|"$/g, '').toLowerCase())
}
export async function getAccidentEmailsEnabled() {
  const { data } = await supabase.from('system_config').select('value').eq('key', 'accident_emails_enabled').maybeSingle()
  return truthyConfig(data?.value)
}
export async function setAccidentEmailsEnabled(enabled) {
  return unwrap(
    await supabase
      .from('system_config')
      .upsert({ key: 'accident_emails_enabled', value: enabled ? 'true' : 'false' }, { onConflict: 'key' })
      .select('key,value')
      .single(),
  )
}

// ── fixed-mailbox routing config (system_config) ──────────────────────────────
// Accident emails are sent from a single verified sender to an admin-configured
// To + CC list, with a subject prefix. The three keys mirror the SQL consumer in
// docs/accident-module/19_ACCIDENT_EMAIL_ROUTING.sql.
const ACCIDENT_EMAIL_SENDER = 'info@tyrepulse.app'
function cleanConfigStr(v) {
  return String(v ?? '').trim().replace(/^"|"$/g, '')
}
/** Read the fixed-mailbox routing config. Missing keys -> ''. */
export async function getAccidentEmailConfig() {
  const { data } = await supabase
    .from('system_config')
    .select('key,value')
    .in('key', ['accident_email_to', 'accident_email_cc', 'accident_email_subject_prefix'])
  const map = {}
  for (const row of Array.isArray(data) ? data : []) map[row.key] = cleanConfigStr(row.value)
  return {
    to: map.accident_email_to || '',
    cc: map.accident_email_cc || '',
    subjectPrefix: map.accident_email_subject_prefix || '',
    sender: ACCIDENT_EMAIL_SENDER,
  }
}
/** Upsert the fixed-mailbox routing config (stores the raw strings the admin typed). */
export async function setAccidentEmailConfig({ to = '', cc = '', subjectPrefix = '' } = {}) {
  const rows = [
    { key: 'accident_email_to', value: String(to ?? '').trim() },
    { key: 'accident_email_cc', value: String(cc ?? '').trim() },
    { key: 'accident_email_subject_prefix', value: String(subjectPrefix ?? '').trim() },
  ]
  return unwrap(await supabase.from('system_config').upsert(rows, { onConflict: 'key' }).select('key,value'))
}
