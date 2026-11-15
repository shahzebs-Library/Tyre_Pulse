/**
 * In-memory stand-in for src/lib/supabase.js, used ONLY by the PDF timing harness.
 * Synthetic data, no network except same-origin /photos. Table reads return empty
 * results; storage signs to /photos/<file>; the pdf_cache_* functions follow the rules
 * of the SQL draft closely enough to time the client flow (the SQL itself is tested on
 * the staging database). `latency` simulates one network round trip per call.
 */
export const IS_CONSOLE_SURFACE = false
export const AUTH_STORAGE_KEY = 'tp_auth'

export const fake = {
  latency: 0, user: 'user-1', rows: new Map(), objects: new Map(), calls: [], sourceRev: 'r1', seq: 0,
  reset() { this.rows.clear(); this.objects.clear(); this.calls = []; this.sourceRev = 'r1'; this.seq = 0 },
}
const wait = () => new Promise((r) => setTimeout(r, fake.latency))
const ok = async (data, name) => { fake.calls.push(name); await wait(); return { data, error: null, count: 0 } }

function chain(table) {
  const p = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => ok([], `from:${table}`).then(res, rej)
      if (prop === 'single' || prop === 'maybeSingle') return () => ok(null, `from:${table}`)
      return () => p
    },
    apply() { return p },
  })
  return p
}

const keyOf = (a) => [a.p_type, a.p_source, a.p_template, a.p_branding, a.p_client_rev || '', fake.sourceRev].join('|')
const fileOf = (r) => ({ id: r.id, bucket: 'report-pdfs', path: r.path, file_name: r.file_name, bytes: r.bytes, sha256: r.sha256, generation: 1, immutable: false, completed_at: r.completed_at })
const byId = (id) => [...fake.rows.values()].find((r) => r.id === id)

const rpcs = {
  pdf_cache_lookup(a) {
    const r = fake.rows.get(keyOf(a))
    return { ok: true, state: r ? r.status : 'missing', cache_key: keyOf(a), file: r ? fileOf(r) : null, previous: null }
  },
  pdf_cache_claim(a) {
    const k = keyOf(a)
    let r = fake.rows.get(k)
    if (r && r.status === 'ready') return { ok: true, state: 'ready', file: fileOf(r) }
    if (r && r.status === 'processing' && r.owner !== fake.user) return { ok: true, state: 'processing', file_id: r.id }
    if (!r) { r = { id: `file-${++fake.seq}`, path: `org/${a.p_type}/${a.p_source}/${fake.seq}.pdf`, file_name: a.p_file_name }; fake.rows.set(k, r) }
    Object.assign(r, { status: 'processing', owner: fake.user })
    return { ok: true, state: 'claimed', file_id: r.id, bucket: 'report-pdfs', path: r.path, file_name: r.file_name, generation: 1 }
  },
  pdf_cache_complete(a) {
    const r = byId(a.p_file)
    if (!r || !fake.objects.has(r.path)) return { ok: false, reason: 'file_missing' }
    Object.assign(r, { status: 'ready', sha256: a.p_sha256, bytes: a.p_bytes, completed_at: new Date().toISOString() })
    return { ok: true, state: 'ready', file_id: r.id, current: true, immutable: false }
  },
  pdf_cache_fail(a) { const r = byId(a.p_file); if (r) r.status = 'queued'; return { ok: true, state: 'queued' } },
  pdf_cache_heartbeat() { return { ok: true } },
  pdf_cache_record_download() { return { ok: true } },
  pdf_cache_pending() { return [] },
}

export const supabase = {
  from: (table) => chain(table),
  rpc: (name, args) => ok(rpcs[name] ? rpcs[name](args || {}) : null, `rpc:${name}`),
  storage: {
    from: (bucket) => ({
      createSignedUrl: async (p) => {
        fake.calls.push('sign'); await wait()
        const url = bucket === 'report-pdfs' ? URL.createObjectURL(fake.objects.get(p)) : `${location.origin}/photos/${p.split('/').pop()}`
        return { data: { signedUrl: url }, error: null }
      },
      createSignedUrls: async (paths) => ok(paths.map((p) => ({ path: p, signedUrl: `${location.origin}/photos/${p.split('/').pop()}` })), 'signMany'),
      upload: async (p, blob) => { fake.calls.push('upload'); await wait(); fake.objects.set(p, blob); return { data: { path: p }, error: null } },
      download: async (p) => ok(fake.objects.get(p) || null, 'download'),
    }),
  },
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  channel: () => ({ on() { return this }, subscribe() { return this }, unsubscribe() {} }),
  removeChannel() {},
}
