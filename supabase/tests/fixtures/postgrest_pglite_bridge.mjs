// A small supabase-js compatible client that executes the CLIENT service calls
// (src/lib/api/inventory*.js) against PGlite, so the real service functions can be
// driven end to end with the real migrations, RLS, SECURITY DEFINER RPCs,
// approvals and separation of duties.
//
// Fidelity rules (what makes this a real test and not a mock):
//   * every statement runs as `set role authenticated` (or `anon`) with
//     `request.jwt.claims` set to {sub, role} exactly as PostgREST does, and
//     auth.uid()/auth.role() are redefined to read those claims the way the
//     Supabase platform does. RLS and grants are therefore the real boundary.
//   * reads go through the relation the service names (base tables, views),
//     embeds resolve over the real foreign keys, filters become SQL predicates.
//   * an RPC is `select public.fn(name => value, ...)`; refusals keep their
//     SQLSTATE in `error.code`, as PostgREST forwards them.
// What it does NOT reproduce: HTTP, PostgREST's schema cache error codes
// (a missing relation surfaces as 42P01, a missing function as 42883), the
// 1,000-row response cap and connection-level concurrency (one PGlite
// connection; calls are serialised in arrival order).

export const AUTH_SQL = `
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), 'anon') $$;
`

const qi = (s) => `"${String(s).replace(/"/g, '""')}"`
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

// split on commas outside parentheses
function splitTop (s) {
  const out = []; let depth = 0; let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

function parseSelect (s) {
  return splitTop(s || '*').map((item) => {
    const m = item.match(/^(?:([A-Za-z_][\w]*):)?([A-Za-z_][\w]*)\((.*)\)$/s)
    if (m) return { kind: 'embed', alias: m[1] || m[2], table: m[2], inner: parseSelect(m[3]) }
    if (item === '*') return { kind: 'star' }
    const a = item.match(/^(?:([A-Za-z_][\w]*):)?([A-Za-z_][\w]*)$/)
    if (!a) throw new Error(`bridge: unsupported select item "${item}"`)
    return { kind: 'col', alias: a[1] || a[2], col: a[2] }
  })
}

const PGRST_OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

function predicate (alias, col, op, value) {
  const c = `${alias}.${qi(col)}`
  if (PGRST_OPS[op]) return `${c} ${PGRST_OPS[op]} ${lit(value)}`
  if (op === 'ilike' || op === 'like') return `${c}::text ${op} ${lit(String(value).replace(/\*/g, '%'))}`
  if (op === 'is') {
    const v = String(value).toLowerCase()
    if (v === 'null') return `${c} is null`
    if (v === 'true' || v === 'false') return `${c} is ${v}`
    throw new Error(`bridge: is.${value}`)
  }
  if (op === 'in') {
    const list = Array.isArray(value) ? value : splitTop(String(value).replace(/^\(|\)$/g, '')).map((x) => x.replace(/^"|"$/g, ''))
    if (!list.length) return 'false'
    return `${c} in (${list.map(lit).join(', ')})`
  }
  throw new Error(`bridge: unsupported operator ${op}`)
}

function parseOr (expr, alias) {
  return '(' + splitTop(expr).map((part) => {
    const i = part.indexOf('.'); const col = part.slice(0, i); const rest = part.slice(i + 1)
    const j = rest.indexOf('.'); const op = rest.slice(0, j); const val = rest.slice(j + 1)
    if (op === 'not') {
      const k = val.indexOf('.')
      return `not (${predicate(alias, col, val.slice(0, k), val.slice(k + 1))})`
    }
    return predicate(alias, col, op, val)
  }).join(' or ') + ')'
}

export function createBridge (db, { log } = {}) {
  let uid = null
  let chain = Promise.resolve()
  const fkCache = new Map()
  const procCache = new Map()
  const calls = []

  // one PGlite connection: every request is a critical section (role + claims + statement)
  const serial = (fn) => {
    const p = chain.then(fn, fn)
    chain = p.then(() => {}, () => {})
    return p
  }
  async function asCurrent (fn) {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claims', $1, false)",
      [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : JSON.stringify({ role: 'anon' })])
    await db.exec(uid ? 'set role authenticated' : 'set role anon')
    try { return await fn() } finally {
      await db.exec('reset role')
      await db.query("select set_config('request.jwt.claims', '', false)")
    }
  }
  const toError = (e) => ({ code: e?.code || 'BRIDGE', message: e?.message || String(e), details: e?.detail || null, hint: e?.hint || null })

  async function fkBetween (parent, child) {
    const key = `${parent}>${child}`
    if (fkCache.has(key)) return fkCache.get(key)
    const rows = (await db.query(`
      select c.conrelid::regclass::text as from_t, c.confrelid::regclass::text as to_t,
             (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) as from_col,
             (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) as to_col
        from pg_constraint c
       where c.contype = 'f' and array_length(c.conkey, 1) = 1
         and ((c.conrelid = to_regclass($1) and c.confrelid = to_regclass($2))
           or (c.conrelid = to_regclass($2) and c.confrelid = to_regclass($1)))`,
    [`public.${parent}`, `public.${child}`])).rows
    const manyToOne = rows.filter((r) => r.from_t.replace(/^public\./, '') === parent)
    const oneToMany = rows.filter((r) => r.from_t.replace(/^public\./, '') === child)
    let res
    if (manyToOne.length === 1) res = { kind: 'one', parentCol: manyToOne[0].from_col, childCol: manyToOne[0].to_col }
    else if (oneToMany.length === 1) res = { kind: 'many', parentCol: oneToMany[0].to_col, childCol: oneToMany[0].from_col }
    else throw new Error(`bridge: cannot resolve the embed ${parent} -> ${child} (${rows.length} foreign keys)`)
    fkCache.set(key, res)
    return res
  }

  let aliasN = 0
  async function rowExpr (table, alias, items) {
    const parts = []
    const cols = []
    for (const it of items) {
      if (it.kind === 'star') parts.push(`to_jsonb(${alias})`)
      else if (it.kind === 'col') cols.push(`${lit(it.alias)}, ${alias}.${qi(it.col)}`)
      else {
        const fk = await fkBetween(table, it.table)
        const a = `e${++aliasN}`
        const inner = await rowExpr(it.table, a, it.inner)
        const where = `${a}.${qi(fk.childCol)} = ${alias}.${qi(fk.parentCol)}`
        cols.push(`${lit(it.alias)}, ` + (fk.kind === 'one'
          ? `(select ${inner} from public.${qi(it.table)} ${a} where ${where} limit 1)`
          : `coalesce((select jsonb_agg(${inner}) from public.${qi(it.table)} ${a} where ${where}), '[]'::jsonb)`))
      }
    }
    // jsonb_build_object takes at most 100 arguments: chunk the pairs
    for (let i = 0; i < cols.length; i += 40) parts.push(`jsonb_build_object(${cols.slice(i, i + 40).join(', ')})`)
    return parts.length ? parts.join(' || ') : `'{}'::jsonb`
  }

  function builder (table) {
    const st = { mode: 'select', cols: '*', count: null, head: false, where: [], order: [], limit: null, offset: null, single: null, values: null }
    const b = {
      select (cols = '*', opts = {}) { if (st.mode === 'select') { st.cols = cols; st.count = opts.count || null; st.head = !!opts.head } return b },
      insert (values) { st.mode = 'insert'; st.values = Array.isArray(values) ? values : [values]; return b },
      update (values) { st.mode = 'update'; st.values = values; return b },
      delete () { st.mode = 'delete'; return b },
      eq: (c, v) => (st.where.push(predicate('t0', c, 'eq', v)), b),
      neq: (c, v) => (st.where.push(predicate('t0', c, 'neq', v)), b),
      gt: (c, v) => (st.where.push(predicate('t0', c, 'gt', v)), b),
      gte: (c, v) => (st.where.push(predicate('t0', c, 'gte', v)), b),
      lt: (c, v) => (st.where.push(predicate('t0', c, 'lt', v)), b),
      lte: (c, v) => (st.where.push(predicate('t0', c, 'lte', v)), b),
      ilike: (c, v) => (st.where.push(predicate('t0', c, 'ilike', v)), b),
      is: (c, v) => (st.where.push(predicate('t0', c, 'is', v === null ? 'null' : v)), b),
      in: (c, v) => (st.where.push(predicate('t0', c, 'in', v)), b),
      not: (c, op, v) => (st.where.push(`not (${predicate('t0', c, op, v)})`), b),
      or: (expr) => (st.where.push(parseOr(expr, 't0')), b),
      order: (c, { ascending = true, nullsFirst } = {}) => {
        st.order.push(`t0.${qi(c)} ${ascending ? 'asc' : 'desc'}${nullsFirst === undefined ? '' : nullsFirst ? ' nulls first' : ' nulls last'}`)
        return b
      },
      range: (from, to) => { st.offset = from; st.limit = to - from + 1; return b },
      limit: (n) => { st.limit = n; return b },
      maybeSingle: () => { st.single = 'maybe'; return b },
      single: () => { st.single = 'one'; return b },
      then: (res, rej) => serial(() => run()).then(res, rej),
    }
    async function write (where) {
      let sql
      if (st.mode === 'insert') {
        const cols = [...new Set(st.values.flatMap((v) => Object.keys(v)))]
        sql = `insert into public.${qi(table)} (${cols.map(qi).join(', ')}) select ${cols.map(qi).join(', ')} from jsonb_populate_recordset(null::public.${qi(table)}, ${lit(st.values)}::jsonb)`
      } else if (st.mode === 'update') {
        const sets = Object.entries(st.values).map(([k, v]) => `${qi(k)} = ${lit(v)}`).join(', ')
        sql = `update public.${qi(table)} t0 set ${sets}${where}`
      } else {
        sql = `delete from public.${qi(table)} t0${where}`
      }
      const r = await db.query(sql)
      calls.push({ kind: st.mode, table, uid, affected: r.affectedRows })
      return { data: null, error: null, count: r.affectedRows ?? null, status: 204 }
    }
    async function run () {
      const where = st.where.length ? ` where ${st.where.join(' and ')}` : ''
      if (st.mode !== 'select') {
        try { return await asCurrent(() => write(where)) } catch (e) { return { data: null, error: toError(e), count: null } }
      }
      try {
        return await asCurrent(async () => {
          aliasN = 0
          let count = null
          if (st.count) count = (await db.query(`select count(*)::int as n from public.${qi(table)} t0${where}`)).rows[0].n
          if (st.head) return { data: null, error: null, count, status: 200 }
          const expr = await rowExpr(table, 't0', parseSelect(st.cols))
          const sql = `select ${expr} as r from public.${qi(table)} t0${where}` +
            (st.order.length ? ` order by ${st.order.join(', ')}` : '') +
            (st.limit != null ? ` limit ${Number(st.limit)}` : '') + (st.offset != null ? ` offset ${Number(st.offset)}` : '')
          const rows = (await db.query(sql)).rows.map((r) => r.r)
          calls.push({ kind: 'from', table, uid, rows: rows.length })
          if (st.single) {
            if (rows.length > 1 || (st.single === 'one' && rows.length === 0)) {
              return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count }
            }
            return { data: rows[0] ?? null, error: null, count }
          }
          return { data: rows, error: null, count, status: 200 }
        })
      } catch (e) {
        log?.(`from(${table}) failed: ${e.message}`)
        return { data: null, error: toError(e), count: null }
      }
    }
    return b
  }

  async function procInfo (fn) {
    if (procCache.has(fn)) return procCache.get(fn)
    const r = (await db.query(`select bool_or(p.proretset) as setof, count(*)::int as n from pg_proc p
      join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1`, [fn])).rows[0]
    procCache.set(fn, r)
    return r
  }

  async function rpc (fn, args = {}) {
    return serial(async () => {
      try {
        return await asCurrent(async () => {
          const info = await procInfo(fn)
          if (!info?.n) return { data: null, error: { code: '42883', message: `function public.${fn} does not exist` } }
          const names = Object.keys(args)
          const params = names.map((k) => {
            const v = args[k]
            return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
          })
          const call = `public.${qi(fn)}(${names.map((k, i) => `${qi(k)} => $${i + 1}`).join(', ')})`
          const sql = info.setof
            ? `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as r from ${call} x`
            : `select ${call} as r`
          const r = (await db.query(sql, params)).rows[0].r
          calls.push({ kind: 'rpc', fn, uid, args })
          return { data: r, error: null }
        })
      } catch (e) {
        calls.push({ kind: 'rpc', fn, uid, args, error: e.code })
        log?.(`rpc(${fn}) failed: ${e.code} ${e.message}`)
        return { data: null, error: toError(e) }
      }
    })
  }

  return {
    from: (table) => builder(table),
    rpc,
    auth: {
      getUser: async () => ({ data: { user: uid ? { id: uid } : null }, error: null }),
      getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null }, error: null }),
    },
    channel: () => ({ on () { return this }, subscribe () { return this } }),
    removeChannel: () => {},
    /** Who the next calls run as (null = anon). */
    as (userId) { uid = userId ?? null; return this },
    get user () { return uid },
    calls,
    /** Raw superuser SQL for assertions and fixtures (never used by the service). */
    sql: (text, params) => serial(() => db.query(text, params).then((r) => r.rows)),
    exec: (text) => serial(() => db.exec(text)),
  }
}
