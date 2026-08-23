#!/usr/bin/env node
/**
 * Hilt dependency-graph checker - runs WITHOUT a JDK.
 *
 * WHY THIS EXISTS. A missing Hilt binding is invisible to review and to any
 * source-level import check: the code reads perfectly, and KSP only reports it
 * during a real build. This repo has already lost a CI round trip to exactly
 * that ("fix: provide ChecklistApi in NetworkModule"). With no local JDK, one
 * missing @Provides costs a full pipeline run to discover.
 *
 * WHAT IT CHECKS
 *   1. Every type requested by an @Inject constructor / @HiltViewModel has a
 *      provider: another @Inject constructor, a @Provides, a @Binds, or a
 *      framework type Hilt supplies itself (Context, Application, ...).
 *   2. Dependency CYCLES between @Inject-constructed types. Hilt rejects these,
 *      and one is genuinely reachable here: injecting AuthApi into TokenManager
 *      would close AuthApi -> OkHttp -> AuthInterceptor -> TokenManager.
 *
 * WHAT IT DOES NOT CHECK: qualifiers (@Named/@Singleton scoping mismatches),
 * generic type arguments, assisted injection. A clean run means "no obviously
 * unsatisfied dependency", not "the graph compiles".
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = process.argv[2] || 'app/src/main/java'

/** Types Hilt/Android provide without any module of ours. */
const FRAMEWORK_PROVIDED = new Set([
  'Context', 'Application', 'Activity', 'Fragment', 'View', 'Service',
  'SavedStateHandle', 'WorkerParameters', 'CoroutineScope', 'CoroutineDispatcher',
  'ViewModelStoreOwner', 'LifecycleOwner', 'Set', 'Map', 'List',
])

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const full = join(dir, e)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walk(full, out)
    else if (e.endsWith('.kt')) out.push(full)
  }
  return out
}

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** Bare type name from a declaration like `Lazy<AuthApi>?` or `dagger.Lazy<X>`. */
function bareType(raw) {
  let t = raw.trim()
  // Unwrap the standard indirection wrappers - what is really needed is inside.
  const wrapper = t.match(/^(?:dagger\.)?(?:Lazy|Provider)\s*<\s*(.+)\s*>$/)
  if (wrapper) t = wrapper[1]
  t = t.replace(/<.*$/, '')     // drop generic args
  t = t.replace(/[?!].*$/, '')  // drop nullability
  t = t.split('.').pop()        // drop package qualification
  return t.trim()
}

const files = walk(ROOT)
if (files.length === 0) {
  console.error('No .kt files under ' + ROOT + ' - refusing to report a clean run on an empty scan.')
  process.exit(2)
}

/**
 * Read a balanced parameter list starting at the index of its opening "(".
 * A regex [^)]* stops at the first ")", which a default value like `= listOf()`
 * or a lambda type `(Int) -> Unit` breaks - and a broken match silently drops the
 * whole declaration, which is how this checker first reported two classes as
 * unprovided when both were plainly @Inject-constructed.
 */
function readParens(code, openIdx) {
  let depth = 0
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')') {
      depth--
      if (depth === 0) return { body: code.slice(openIdx + 1, i), end: i }
    }
  }
  return null
}

/** Split a parameter list on top-level commas only. */
function splitParams(body) {
  const out = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '(' || ch === '<' || ch === '[') depth++
    else if (ch === ')' || ch === '>' || ch === ']') depth--
    if (ch === ',' && depth === 0) { out.push(current); current = '' } else current += ch
  }
  if (current.trim()) out.push(current)
  return out
}

const providers = new Set()          // type name -> provided somewhere
const injectables = new Map()        // @Inject-constructed types only
const graph = new Map()              // EVERY provided type -> what it needs

for (const path of files) {
  const code = strip(readFileSync(path, 'utf8'))

  // @Provides / @Binds declare a provider by their RETURN type. Their PARAMETERS
  // are real graph edges: provideOkHttp(authInterceptor) means OkHttpClient depends
  // on AuthInterceptor. Ignoring them hides every cycle that runs through a module,
  // which is precisely the AuthApi -> OkHttp -> AuthInterceptor -> TokenManager one.
  for (const m of code.matchAll(/@(?:Provides|Binds)[\s\S]{0,300}?fun\s+(?:<[^>]*>\s*)?\w+\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const parens = readParens(code, open)
    if (!parens) continue
    const after = code.slice(parens.end + 1, parens.end + 200)
    const ret = after.match(/^\s*:\s*([\w.<>?]+)/)
    if (!ret) continue
    const type = bareType(ret[1])
    providers.add(type)
    const deps = []
    for (const param of splitParams(parens.body)) {
      const p = param.match(/(?:val|var)?\s*\w+\s*:\s*([\w.<>?]+)/)
      if (p) deps.push(bareType(p[1]))
    }
    const existing = graph.get(type)
    if (existing) existing.deps.push(...deps)
    else graph.set(type, { path, deps })
  }
  // A @Binds takes the implementation as its parameter; that impl is consumed,
  // not provided, so it is not added here.

  // `class X @Inject constructor(...)`. The class name must sit IMMEDIATELY before
  // the @Inject - a tolerant window lets an earlier `data class` in the same file
  // bridge to a later class's constructor and steal its identity.
  for (const m of code.matchAll(/\b(?:class|object)\s+(\w+)\s*(?:<[^>]*>)?\s*@Inject\s+constructor\s*\(/g)) {
    const type = m[1]
    const parens = readParens(code, m.index + m[0].length - 1)
    if (!parens) continue
    providers.add(type)
    const deps = []
    for (const param of splitParams(parens.body)) {
      const p = param.match(/(?:val|var)\s+\w+\s*:\s*([\w.<>?]+)/) || param.match(/\w+\s*:\s*([\w.<>?]+)/)
      if (p) deps.push(bareType(p[1]))
    }
    injectables.set(type, { path, deps })
    const prior = graph.get(type)
    if (prior) prior.deps.push(...deps)
    else graph.set(type, { path, deps })
  }

  // A class with no @Inject constructor can still be provided by a module; those
  // are picked up by the @Provides scan above.
}

const findings = []

// --- 1. Unsatisfied dependencies -------------------------------------------
for (const [type, info] of injectables) {
  for (const dep of info.deps) {
    if (!dep || FRAMEWORK_PROVIDED.has(dep)) continue
    if (providers.has(dep)) continue
    findings.push({
      kind: 'unsatisfied',
      path: info.path,
      message: type + ' injects ' + dep + ', but nothing provides ' + dep +
        ' (no @Inject constructor, no @Provides, no @Binds)',
    })
  }
}

// --- 2. Cycles across the whole graph (constructors AND module @Provides) ------------------------------
const WHITE = 0, GREY = 1, BLACK = 2
const colour = new Map()
const stack = []
const reported = new Set()

function visit(type) {
  colour.set(type, GREY)
  stack.push(type)
  const info = graph.get(type)
  if (info) {
    for (const dep of info.deps) {
      if (!graph.has(dep)) continue
      const c = colour.get(dep) ?? WHITE
      if (c === GREY) {
        const cycle = stack.slice(stack.indexOf(dep)).concat(dep)
        const key = [...cycle].sort().join('|')
        if (!reported.has(key)) {
          reported.add(key)
          findings.push({
            kind: 'cycle',
            path: graph.get(dep).path,
            message: 'dependency cycle: ' + cycle.join(' -> '),
          })
        }
      } else if (c === WHITE) {
        visit(dep)
      }
    }
  }
  stack.pop()
  colour.set(type, BLACK)
}
for (const type of graph.keys()) {
  if ((colour.get(type) ?? WHITE) === WHITE) visit(type)
}

console.log('Scanned ' + files.length + ' Kotlin files: ' +
  injectables.size + ' @Inject-constructed types, ' + providers.size + ' providers')

if (findings.length === 0) {
  console.log('No unsatisfied dependencies and no cycles found.')
  console.log('(Qualifiers and scopes are NOT checked - this is not a full graph validation.)')
  process.exit(0)
}

console.log('')
console.log(findings.length + ' Hilt graph problem(s):')
console.log('')
for (const f of findings) {
  console.log('  [' + f.kind + '] ' + relative(process.cwd(), f.path).split(sep).join('/'))
  console.log('    ' + f.message)
}
process.exit(1)
