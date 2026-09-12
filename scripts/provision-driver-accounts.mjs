import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function externalPath(value, repository = root) {
  const target = path.resolve(value)
  const canonical = fs.existsSync(target) ? fs.realpathSync(target) : path.join(fs.realpathSync(path.dirname(target)), path.basename(target))
  const relative = path.relative(fs.realpathSync(repository), canonical)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Credential files must remain outside the repository')
  return canonical
}
export function prepareRecords(rows) {
  const seen = new Set(); const passwords = new Set()
  return rows.map((row, index) => {
    const employeeId = String(row['Employee ID'] ?? '').trim()
    const name = String(row.Name ?? '').trim()
    const position = String(row.Position ?? '').trim()
    const password = String(row.Password ?? '')
    const existingUsername = String(row['Existing Username'] ?? '').trim()
    if (!/^\d{3,30}$/.test(employeeId) || seen.has(employeeId) || !name || !position) throw new Error(`Invalid or repeated identity at workbook row ${index + 2}`)
    if (String(row['Proposed Country']).trim() !== 'KSA') throw new Error(`Country must be approved KSA at row ${index + 2}`)
    if (existingUsername && password) throw new Error(`Existing account must not have a replacement password at row ${index + 2}`)
    if (!existingUsername && (password.length < 12 || passwords.has(password))) throw new Error(`Missing, short or reused password at row ${index + 2}`)
    seen.add(employeeId); if (password) passwords.add(password)
    return { employeeId, name, position, password, existingUsername, iqama: String(row.Iqama ?? '').trim(), row }
  })
}
const unwrap = result => { if (result.error) throw new Error(`Database request failed (${result.error.code || 'unknown'}): ${result.error.message}`); return result.data }
async function allProfiles(client) {
  const result = []
  for (let offset = 0; ; offset += 1000) {
    const rows = unwrap(await client.from('profiles').select('id,username,employee_id,full_name,role,approved,locked,org_id,organisation_id,country,countries,sites,site').order('id').range(offset, offset + 999))
    result.push(...rows); if (rows.length < 1000) return result
  }
}
export async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    input: { type: 'string' }, output: { type: 'string' }, journal: { type: 'string' },
    'key-file': { type: 'string' }, url: { type: 'string' }, org: { type: 'string' }, actor: { type: 'string' },
    execute: { type: 'boolean', default: false },
  } })
  for (const required of ['input', 'output', 'journal', 'key-file', 'url', 'org', 'actor']) if (!values[required]) throw new Error(`--${required} is required`)
  const input = externalPath(values.input); const output = externalPath(values.output); const journalPath = externalPath(values.journal)
  if (new Set([input, output, journalPath]).size !== 3) throw new Error('Input, output and journal must have different paths')
  const keys = JSON.parse(fs.readFileSync(externalPath(values['key-file']), 'utf8').replace(/^\uFEFF/, ''))
  const key = keys.find(k => k.name === 'service_role' && !k.disabled)?.api_key
  if (!key) throw new Error('Service-role API key unavailable')
  const client = createClient(values.url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const bytes = fs.readFileSync(input); const digest = createHash('sha256').update(bytes).digest('hex')
  const workbook = XLSX.read(bytes); const records = prepareRecords(XLSX.utils.sheet_to_json(workbook.Sheets.Credentials, { defval: '' }))
  let journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : null
  if (fs.existsSync(output) && !journal) throw new Error('Refusing to overwrite an unrelated credential workbook')
  if (journal && (journal.sourceHash !== digest || journal.org !== values.org || journal.url !== values.url || journal.actor !== values.actor)) throw new Error('Journal belongs to a different source, project, organisation or administrator')
  const profiles = await allProfiles(client)
  const actor = profiles.find(p => p.id === values.actor)
  if (!actor || actor.role !== 'Admin' || !actor.approved || actor.locked || actor.org_id !== values.org) throw new Error('Active administrator in target organisation required')
  const authUsers = []
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Auth preflight failed (${error.status || 'unknown'})`)
    authUsers.push(...data.users); if (data.users.length < 1000) break
  }
  const existingSnapshots = []
  for (const record of records) {
    const matches = profiles.filter(p => String(p.employee_id ?? '').trim() === record.employeeId || String(p.username).toLowerCase() === record.employeeId.toLowerCase())
    if (matches.length > 1) throw new Error('Multiple accounts match an import identity; resolve before execution')
    const match = matches[0]
    if (record.existingUsername) {
      if (!match || match.username !== record.existingUsername || match.org_id !== values.org || match.organisation_id !== values.org || String(match.employee_id).trim() !== record.employeeId) throw new Error('An existing account no longer matches the approved workbook')
      existingSnapshots.push(match); record.userId = match.id; record.preserve = true
    } else if (match) {
      const user = authUsers.find(u => u.id === match.id)
      if (!journal || user?.app_metadata?.driver_import_batch !== journal.batchId || match.username !== record.employeeId) throw new Error('New account collides with an existing account; no passwords were reset')
      record.userId = match.id; record.preserve = false
    } else {
      const email = `${record.employeeId}@users.tyrepulse.app`
      if (authUsers.some(u => u.email?.toLowerCase() === email)) throw new Error('Auth email collision requires investigation')
      record.preserve = false
    }
  }
  journal ??= { batchId: randomUUID(), sourceHash: digest, org: values.org, actor: values.actor, url: values.url, existingSnapshots, results: {} }
  const save = () => fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ mode: values.execute ? 'execute' : 'dry-run', employees: records.length, preservedAccounts: existingSnapshots.length, newAccounts: records.length - existingSnapshots.length, role: 'Driver', country: 'KSA' }))
  if (!values.execute) return
  // Check deployment before creating any Auth accounts. A null user is expected
  // to fail validation; a missing function is a hard preflight failure.
  const probe = await client.rpc('provision_approved_driver_account', {
    p_user_id: null, p_actor_id: values.actor, p_organisation_id: values.org,
    p_employee_id: '000', p_full_name: 'preflight', p_country: 'KSA', p_position: 'preflight', p_iqama: null, p_batch_id: journal.batchId,
  })
  if (probe.error?.code !== '42501') throw new Error('Provisioning function unavailable or returned an unexpected preflight result')
  save()
  let next = 0; let failed = false
  const worker = async () => {
    while (!failed && next < records.length) {
      const record = records[next++]
      try {
        if (!record.userId) {
          const { data, error } = await client.auth.admin.createUser({
            email: `${record.employeeId}@users.tyrepulse.app`, password: record.password, email_confirm: true,
            app_metadata: { driver_import_batch: journal.batchId },
            user_metadata: { username: record.employeeId, employee_id: record.employeeId, full_name: record.name, region: 'KSA' },
          })
          if (error) throw new Error(`Auth creation failed (${error.status || 'unknown'}); inspect journal before retry`)
          record.userId = data.user.id
          journal.results[record.employeeId] = { userId: record.userId, status: 'auth_created' }; save()
        }
        const result = unwrap(await client.rpc('provision_approved_driver_account', {
          p_user_id: record.userId, p_actor_id: values.actor, p_organisation_id: values.org,
          p_employee_id: record.employeeId, p_full_name: record.name, p_country: 'KSA',
          p_position: record.position, p_iqama: record.iqama || null, p_batch_id: journal.batchId,
          p_preserve_profile: record.preserve || journal.results[record.employeeId]?.status === 'provisioned',
        }))
        journal.results[record.employeeId] = { ...result, status: 'provisioned' }; save()
        const count = Object.values(journal.results).filter(r => r.status === 'provisioned').length
        if (count % 25 === 0) console.log(JSON.stringify({ provisioned: count, total: records.length }))
      } catch (error) {
        failed = true
        journal.results[record.employeeId] = { ...journal.results[record.employeeId], status: 'failed', error: error.message }; save()
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  if (failed) throw new Error('Import paused after an error. Completed accounts are recorded in the external journal; rerun resumes without resetting passwords.')
  const current = await allProfiles(client)
  for (const previous of journal.existingSnapshots) {
    const now = current.find(p => p.id === previous.id)
    if (JSON.stringify(now) !== JSON.stringify(previous)) throw new Error('Existing-account verification failed; inspect external journal')
  }
  for (const record of records.filter(r => !r.preserve)) {
    const profile = current.find(p => p.id === record.userId)
    if (!profile || profile.username !== record.employeeId || profile.role !== 'Driver' || !profile.approved || profile.locked || profile.org_id !== values.org || JSON.stringify(profile.country) !== '["KSA"]') throw new Error('New profile verification failed')
  }
  const rows = records.map(record => {
    const result = journal.results[record.employeeId]
    return { ...record.row, 'Proposed Role': record.preserve ? record.row['Existing Role'] : 'Driver',
      'Proposed Country': 'KSA', 'Proposed Organisation': 'Verified approved organisation',
      'Proposed Action': record.preserve ? 'Existing account preserved; driver record linked where available' : 'Account created and approved',
      'System Status': result.workspace_linked ? 'Account verified; driver workspace linked' : 'Account verified; driver workspace linkage pending deployment',
      'Driver Workspace Access': result.workspace_linked ? 'Own records only' : 'Pending workspace deployment',
      'Account ID': record.userId, 'Driver Record ID': result.driver_id,
    }
  })
  const credentials = XLSX.utils.json_to_sheet(rows); credentials['!autofilter'] = { ref: credentials['!ref'] }; credentials['!cols'] = Object.keys(rows[0]).map(() => ({ wch: 26 })); workbook.Sheets.Credentials = credentials
  workbook.Sheets['Read Me'] = XLSX.utils.aoa_to_sheet([
    ['Item', 'Value'], ['Status', 'Accounts created and approved; existing accounts preserved. See per-row workspace linkage status.'],
    ['Country', 'KSA'], ['New account role', 'Driver for all new employees, including operators and DCOs.'],
    ['Existing accounts', 'Usernames, passwords, roles and scope unchanged. Password cells intentionally blank.'],
    ['Passwords', 'Regular generated passwords; no expiration or forced-change setting applied by this import.'],
    ['Positions', 'Job titles retained in each driver record separately from access role. DCO drives and operates the concrete pump.'],
    ['Site', 'No site fabricated and no all-sites permission granted.'],
    ['Source exceptions', 'Missing and duplicate Iqamas retained for review; employee ID is the account identity.'],
    ['Confidential', 'This workbook stays outside Git. Share each employee only their own credentials.'],
  ])
  workbook.Sheets['Read Me']['!cols'] = [{ wch: 25 }, { wch: 110 }]
  const positions = XLSX.utils.sheet_to_json(workbook.Sheets.Positions, { defval: '' }).map(p => ({ ...p, 'Access Role For New Accounts': 'Driver', 'Position Setup Status': 'Saved on driver records' }))
  workbook.Sheets.Positions = XLSX.utils.json_to_sheet(positions)
  XLSX.writeFile(workbook, output, { compression: true })
  journal.verifiedAt = new Date().toISOString(); save()
  console.log(JSON.stringify({ verified: records.length, preserved: existingSnapshots.length, workspaceLinked: Object.values(journal.results).filter(r => r.workspace_linked).length, credentialWorkbook: output }))
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
