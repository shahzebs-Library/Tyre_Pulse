#!/usr/bin/env node
/**
 * Call sites that do not match their function's signature.
 *
 * WHY THIS EXISTS. Adding one parameter to a Composable broke the build, and all
 * three existing checkers passed. `AssetDetailRoute` gained `onUpdateOdometer`; the
 * NavHost call was updated, a SECOND call site in AssetsNavigation.kt was not, and CI
 * reported `No value passed for parameter 'onUpdateOdometer'` - after a full run.
 *
 * check-kotlin-symbols resolves imports, check-hilt-graph resolves bindings,
 * check-navigation resolves routes. None of them looks at arguments. On a machine
 * with no JDK, that gap costs one CI run per instance.
 *
 * WHAT IT CHECKS, and deliberately nothing more: for every function declared in the
 * project, the parameters that have NO default are required. At every call site of
 * that function, each required parameter must be passed - by name, or positionally.
 * This codebase names its arguments almost everywhere, which is what makes the check
 * tractable without a parser.
 *
 * WHAT IT DOES NOT CHECK: types, nullability, overloads, generics, receivers, or
 * lambdas passed outside the parentheses. A pass means "no missing required argument",
 * not "this compiles".
 *
 * DELIBERATELY CONSERVATIVE. Anything ambiguous is SKIPPED rather than reported:
 * a name declared more than once (an overload), a call whose parentheses do not
 * balance within the window, or a call that mixes positional and named arguments in a
 * way this cannot read. A false alarm here would train someone to ignore the tool,
 * which is worse than a miss.
 */
import fs from 'fs'
import path from 'path'
import { relative, sep } from 'path'

const ROOT = 'app/src/main/java'

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.kt')) out.push(p)
  }
  return out
}

/** Strip comments and string literals so neither can look like code. */
function strip(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue }
    if (two === '/*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue }
    if (src.slice(i, i + 3) === '"""') {
      const j = src.indexOf('"""', i + 3); i = j < 0 ? src.length : j + 3; out += '""'; continue
    }
    if (src[i] === '"') {
      let j = i + 1
      while (j < src.length && !(src[j] === '"' && src[j - 1] !== '\\')) j++
      i = j + 1; out += '""'; continue
    }
    out += src[i]; i++
  }
  return out
}

/** Text between the parens starting at `open`, or null if they do not balance. */
function balanced(code, open) {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    const c = code[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return code.slice(open + 1, i) }
    else if (c === '{') { // skip a lambda body wholesale
      let d2 = 0
      for (; i < code.length; i++) {
        if (code[i] === '{') d2++
        else if (code[i] === '}') { d2--; if (d2 === 0) break }
      }
    }
  }
  return null
}

/**
 * Split a parameter/argument list on top-level commas.
 *
 * THE ARROW IN A LAMBDA TYPE IS THE TRAP. `<` and `>` are tracked so a comma inside
 * `Map<String, Int>` does not split - but `->` in `onClick: () -> Unit` also contains
 * `>`, which drove the depth negative. Every comma after the first lambda parameter
 * then looked nested, so the parameter list was silently truncated and the checker
 * reported real parameters as "unknown". Neutralise the arrows first; they carry no
 * nesting.
 */
function topLevelSplit(text, generics) {
  const src = text.replace(/->/g, '  ')
  const parts = []
  let depth = 0, cur = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '{' || c === '[' || (generics && c === '<')) depth++
    else if (c === ')' || c === '}' || c === ']' || (generics && c === '>')) depth--
    if (c === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += text[i]
  }
  if (cur.trim()) parts.push(cur)
  return parts.map(s => s.trim()).filter(Boolean)
}

/**
 * ANGLE BRACKETS ARE ONLY BRACKETS IN A TYPE. In a PARAMETER list they delimit
 * generics, so `Map<String, Int>` must not split. In an ARGUMENT list the same
 * characters are comparison operators - `takeIf { it > 0 }` drove the depth negative,
 * every later comma looked nested, and a genuinely-passed argument was reported
 * missing. So the two lists are split under different rules, which is why this takes
 * a flag rather than one shared helper.
 */
const splitParams = t => topLevelSplit(t, true)
const splitArgs = t => topLevelSplit(t, false)

const files = walk(ROOT)
const sources = new Map()
for (const f of files) sources.set(f, strip(fs.readFileSync(f, 'utf8')))

// ── Declarations ────────────────────────────────────────────────────────────
// name -> { required:[], all:Set, path, count }
const decls = new Map()
const DECL_RE = /(?:^|\n)[ \t]*(?:@\w[\w.]*(?:\([^)]*\))?[ \t]*\n[ \t]*)*(?:public |internal |private |protected |inline |suspend |operator |infix |override |abstract |open |external )*fun\s+(?:<[^>]+>\s*)?(\w+)\s*\(/g

for (const [f, code] of sources) {
  let m
  while ((m = DECL_RE.exec(code))) {
    const name = m[1]
    const open = code.indexOf('(', m.index + m[0].length - 1)
    const inner = balanced(code, open)
    if (inner === null) continue
    // An extension function's receiver is not a parameter; the name is still the key.
    const params = splitParams(inner)
    const required = []
    const all = new Set()
    let readable = true
    for (const p of params) {
      const nm = p.match(/^(?:@\w+\s+)*(?:vararg\s+)?(?:val\s+|var\s+)?(\w+)\s*:/)
      if (!nm) { readable = false; break }
      all.add(nm[1])
      if (!/=/.test(p.replace(/<[^>]*>/g, ''))) required.push(nm[1])
    }
    if (!readable) continue
    const prev = decls.get(name)
    if (prev) { prev.count++; continue }          // overload -> skipped below
    decls.set(name, { required, all, path: f, count: 1 })
  }
}

// ── Call sites ──────────────────────────────────────────────────────────────
const findings = []
for (const [f, code] of sources) {
  for (const [name, d] of decls) {
    if (d.count > 1) continue                      // overloaded: cannot tell which
    if (d.required.length === 0) continue          // nothing can be missing
    // A project function whose name also exists in a library - Material3's SearchBar
    // against this app's own SearchBar, for one - would otherwise have every library
    // call judged against the local signature. Only look at files that can actually
    // see this declaration: the declaring file itself, or one that imports the name.
    if (f !== d.path && !new RegExp('import\\s+[\\w.]*\\.' + name + '\\b').test(code)) continue
    const CALL = new RegExp('(?<![\\w.])' + name + '\\s*\\(', 'g')
    let m
    while ((m = CALL.exec(code))) {
      const open = code.indexOf('(', m.index + name.length)
      // its own declaration
      const before = code.slice(Math.max(0, m.index - 60), m.index)
      if (/\bfun\s+(?:<[^>]+>\s*)?$/.test(before)) continue
      const inner = balanced(code, open)
      if (inner === null) continue
      const args = splitArgs(inner)
      const named = args.filter(a => /^\w+\s*=/.test(a)).map(a => a.match(/^(\w+)\s*=/)[1])
      const positional = args.length - named.length
      // Mixed or fully positional: only flag when even the count cannot suffice.
      if (named.length === 0) {
        if (positional < d.required.length && !/\)\s*\{/.test(code.slice(open))) {
          // a trailing lambda supplies one more argument; be lenient by one
          if (positional + 1 < d.required.length) {
            findings.push({ path: f, line: code.slice(0, m.index).split('\n').length, name,
              missing: '(positional) expects ' + d.required.length + ', got ' + positional })
          }
        }
        continue
      }
      const missing = d.required.filter(r => !named.includes(r))
      // positional args cover the leading parameters
      const covered = missing.slice(0, positional)
      const stillMissing = missing.filter(x => !covered.includes(x))
      // a trailing lambda can supply the last parameter
      const trailingLambda = /^\s*\{/.test(code.slice(open + inner.length + 2))
      const finalMissing = trailingLambda ? stillMissing.slice(0, -1) : stillMissing
      if (finalMissing.length) {
        findings.push({ path: f, line: code.slice(0, m.index).split('\n').length, name,
          missing: finalMissing.join(', ') })
      }
      // an argument the function does not declare
      const unknown = named.filter(n => !d.all.has(n))
      if (unknown.length) {
        findings.push({ path: f, line: code.slice(0, m.index).split('\n').length, name,
          missing: 'unknown parameter: ' + unknown.join(', ') })
      }
    }
  }
}

console.log('Scanned ' + files.length + ' Kotlin files: ' + decls.size + ' uniquely-named functions')
if (!findings.length) {
  console.log('Every call site passes its function\'s required parameters.')
  console.log('(Names and counts only - types, overloads and generics are NOT checked.)')
  process.exit(0)
}
console.log('')
console.log(findings.length + ' call site(s) missing a required argument:')
console.log('')
for (const x of findings) {
  console.log('  ' + relative(process.cwd(), x.path).split(sep).join('/') + ':' + x.line)
  console.log('    ' + x.name + '(...) -> ' + x.missing)
}
process.exit(1)
