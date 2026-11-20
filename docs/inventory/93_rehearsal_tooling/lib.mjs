// Rehearsal helpers: every call is its own psql connection (like one PostgREST request):
// begin; set local role authenticated; request.jwt.claims = {sub, role}; select fn(payload); commit.
import { spawn } from 'node:child_process'

export const PORT = '54417'
export const run = (db, sql, user = 'postgres') => new Promise((resolve, reject) => {
  const p = spawn('psql', ['-h', 'localhost', '-p', PORT, '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-A', '-t', '-q'])
  let out = ''; let err = ''
  p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
  p.on('close', c => (c === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exit ${c}`))))
  p.stdin.end('\\set VERBOSITY verbose\n' + sql)
})
const lit = s => "'" + String(s).replace(/'/g, "''") + "'"
export const claims = (uid, role = 'authenticated') => `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role }))}, true);`
export const asUser = (uid, sql) => `begin;\nset local role authenticated;\n${claims(uid)}\n${sql};\ncommit;`
let k = 0
export const key = p => `${p}-${process.pid}-${++k}-${Date.now()}`
export const rpc = async (db, uid, fn, payload, opts = {}) => {
  const body = opts.noKey ? payload : { idempotency_key: key(fn), ...payload }
  const out = await run(db, asUser(uid, `select public.${fn}(${lit(JSON.stringify(body))}::jsonb)`))
  const last = out.split('\n').filter(Boolean).pop()
  try { return JSON.parse(last) } catch { return last }
}
export const sel = async (db, sql, uid = null) => {
  const s = `select coalesce(jsonb_agg(x), '[]') from (${sql}) x`
  const out = await run(db, uid ? asUser(uid, s) : s)
  return JSON.parse(out.split('\n').filter(Boolean).pop())
}
export const one = async (db, sql, uid) => (await sel(db, sql, uid))[0]
export const errCode = e => (String(e.message).match(/ERROR:\s+([0-9A-Z]{5}):/) || [])[1]
export const settle = ps => Promise.allSettled(ps)

export const results = []
export const check = (gate, name, ok, evidence) => {
  results.push({ gate, name, ok: !!ok, evidence })
  console.log(`${ok ? 'PASS' : 'FAIL'} [G${gate}] ${name}${evidence !== undefined ? ' :: ' + (typeof evidence === 'string' ? evidence : JSON.stringify(evidence)) : ''}`)
}
export const expectRefused = async (gate, name, p, re) => {
  try { const r = await p; check(gate, name, false, { unexpected: r }) } catch (e) {
    const m = String(e.message).split('\n').find(l => l.includes('ERROR')) || e.message
    check(gate, name, re ? re.test(e.message) : true, m.slice(0, 220))
  }
}
