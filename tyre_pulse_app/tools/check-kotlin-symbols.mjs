#!/usr/bin/env node
/**
 * Unresolved-symbol checker for Kotlin/Compose - runs WITHOUT a JDK.
 *
 * WHY THIS EXISTS. This machine has no JDK and no Android SDK, so the only
 * compiler feedback available is a CI run. A regex-driven PullToRefresh refactor
 * stripped imports across many screens, and the repair became a run of blind
 * "fix: missing import" commits, each costing a full CI build to learn one more
 * error. This finds that whole class of error in about a second, locally.
 *
 * WHAT IT CATCHES: a capitalised symbol (type, Composable, object) referenced but
 * neither declared in the file, nor declared elsewhere in the same package, nor
 * imported, nor a Kotlin default import.
 *
 * WHAT IT DOES NOT CATCH: type mismatches, wrong argument counts, overload
 * resolution - anything needing a real type checker. A clean run here means
 * "no missing imports", never "this compiles".
 *
 * Deliberately biased AGAINST false positives: a wildcard import of a package we
 * cannot enumerate silences that file, because a checker that cries wolf gets
 * ignored, and an ignored checker is worse than none.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = process.argv[2] || 'app/src/main/java'

/** Kotlin implicit default imports (kotlin.*, kotlin.collections.*, kotlin.text.* ...). */
const DEFAULT_IMPORTS = new Set([
  'String', 'Int', 'Long', 'Short', 'Byte', 'Float', 'Double', 'Boolean', 'Char', 'Unit', 'Any', 'Nothing',
  'Array', 'List', 'Map', 'Set', 'MutableList', 'MutableMap', 'MutableSet', 'Collection', 'Iterable', 'Sequence',
  'Pair', 'Triple', 'Result', 'Comparable', 'Number', 'CharSequence', 'Throwable', 'Exception', 'RuntimeException',
  'IllegalArgumentException', 'IllegalStateException', 'UnsupportedOperationException', 'NullPointerException',
  'IndexOutOfBoundsException', 'NumberFormatException', 'ClassCastException', 'Regex', 'StringBuilder', 'Lazy',
  'Enum', 'Deprecated', 'JvmStatic', 'JvmField', 'JvmOverloads', 'JvmInline', 'Throws', 'Suppress', 'OptIn',
  'RequiresOptIn', 'ExperimentalStdlibApi', 'Volatile', 'Synchronized', 'Transient',
  'ByteArray', 'IntArray', 'LongArray', 'FloatArray', 'DoubleArray', 'BooleanArray', 'CharArray', 'ShortArray',
  'UInt', 'ULong', 'UByte', 'UShort', 'Runnable', 'Thread', 'Math', 'System', 'Object',
  'Comparator', 'Iterator', 'Cloneable', 'AutoCloseable', 'Closeable', 'Error', 'StackTraceElement',
  // Kotlin/JVM auto-imports java.lang.*, so these need no import either.
  'SecurityException', 'InterruptedException', 'IOException', 'StringBuffer', 'Character',
  'Integer', 'Boolean', 'Void', 'Class', 'ClassLoader', 'Process', 'ProcessBuilder', 'Package',
  'ArithmeticException', 'ArrayIndexOutOfBoundsException', 'StringIndexOutOfBoundsException',
  'NoSuchFieldException', 'NoSuchMethodException', 'CloneNotSupportedException', 'OutOfMemoryError',
  'StackOverflowError', 'AssertionError', 'ThreadLocal', 'InheritableThreadLocal', 'StrictMath',
])

/** Single-letter generics and idioms that look like types but are not references. */
const NON_SYMBOLS = new Set([
  'T', 'R', 'E', 'K', 'V', 'U', 'S', 'A', 'B', 'C', 'D', 'P', 'Q', 'W', 'X', 'Y', 'Z',
  'VM', 'ID', 'UI', 'OK', 'TAG', 'Companion', 'TODO',
])

/**
 * Compose/AndroidX EXTENSION functions and properties. These are lowercase, so the
 * capitalised-symbol pass above is blind to them - yet they are the single most
 * common missing import in this repo ("fix: add missing clickable import ...").
 * An extension needs its import even when called on a receiver (Modifier.padding),
 * so usage is matched with or without a leading dot.
 *
 * Curated on purpose: only symbols whose home package is unambiguous, so a report
 * can name the exact import line to add.
 */
const EXTENSION_CATALOG = new Map(Object.entries({
  clickable: 'androidx.compose.foundation.clickable',
  combinedClickable: 'androidx.compose.foundation.combinedClickable',
  background: 'androidx.compose.foundation.background',
  border: 'androidx.compose.foundation.border',
  horizontalScroll: 'androidx.compose.foundation.horizontalScroll',
  verticalScroll: 'androidx.compose.foundation.verticalScroll',
  selectable: 'androidx.compose.foundation.selection.selectable',
  toggleable: 'androidx.compose.foundation.selection.toggleable',
  padding: 'androidx.compose.foundation.layout.padding',
  fillMaxSize: 'androidx.compose.foundation.layout.fillMaxSize',
  fillMaxWidth: 'androidx.compose.foundation.layout.fillMaxWidth',
  fillMaxHeight: 'androidx.compose.foundation.layout.fillMaxHeight',
  wrapContentSize: 'androidx.compose.foundation.layout.wrapContentSize',
  wrapContentWidth: 'androidx.compose.foundation.layout.wrapContentWidth',
  wrapContentHeight: 'androidx.compose.foundation.layout.wrapContentHeight',
  widthIn: 'androidx.compose.foundation.layout.widthIn',
  heightIn: 'androidx.compose.foundation.layout.heightIn',
  sizeIn: 'androidx.compose.foundation.layout.sizeIn',
  defaultMinSize: 'androidx.compose.foundation.layout.defaultMinSize',
  aspectRatio: 'androidx.compose.foundation.layout.aspectRatio',
  navigationBarsPadding: 'androidx.compose.foundation.layout.navigationBarsPadding',
  statusBarsPadding: 'androidx.compose.foundation.layout.statusBarsPadding',
  imePadding: 'androidx.compose.foundation.layout.imePadding',
  safeDrawingPadding: 'androidx.compose.foundation.layout.safeDrawingPadding',
  clip: 'androidx.compose.ui.draw.clip',
  alpha: 'androidx.compose.ui.draw.alpha',
  shadow: 'androidx.compose.ui.draw.shadow',
  rotate: 'androidx.compose.ui.draw.rotate',
  drawBehind: 'androidx.compose.ui.draw.drawBehind',
  drawWithContent: 'androidx.compose.ui.draw.drawWithContent',
  graphicsLayer: 'androidx.compose.ui.graphics.graphicsLayer',
  toArgb: 'androidx.compose.ui.graphics.toArgb',
  itemsIndexed: 'androidx.compose.foundation.lazy.itemsIndexed',
  collectAsStateWithLifecycle: 'androidx.lifecycle.compose.collectAsStateWithLifecycle',
  collectAsState: 'androidx.compose.runtime.collectAsState',
  // OkHttp 4 Kotlin extensions - a previous commit here was 'fix: ... missing okhttp ext'.
  toMediaType: 'okhttp3.MediaType.Companion.toMediaType',
  toRequestBody: 'okhttp3.RequestBody.Companion.toRequestBody',
  toResponseBody: 'okhttp3.ResponseBody.Companion.toResponseBody',
}))

/**
 * `dp` and `sp` are extension PROPERTIES on Int/Float. `16.dp` with no
 * `import androidx.compose.ui.unit.dp` does not compile, and the failure reads as
 * an unresolved reference on a number literal, which is easy to misread.
 */
const UNIT_EXTENSIONS = new Map(Object.entries({
  dp: 'androidx.compose.ui.unit.dp',
  sp: 'androidx.compose.ui.unit.sp',
}))

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

/** Blank out comments and string/char literals so prose never reads as code. */
function strip(src) {
  let out = ''
  let i = 0
  const n = src.length
  const DQ = String.fromCharCode(34)
  const SQ = String.fromCharCode(39)
  const TRIPLE = DQ + DQ + DQ
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (src.slice(i, i + 3) === TRIPLE) {
      i += 3
      while (i < n && src.slice(i, i + 3) !== TRIPLE) { out += src[i] === '\n' ? '\n' : ' '; i++ }
      i += 3
      continue
    }
    if (c === DQ) {
      i++
      while (i < n && src[i] !== DQ) { if (src[i] === '\\') i++; i++ }
      i++
      out += ' '
      continue
    }
    if (c === SQ) {
      i++
      while (i < n && src[i] !== SQ) { if (src[i] === '\\') i++; i++ }
      i++
      out += ' '
      continue
    }
    out += c
    i++
  }
  return out
}

const files = walk(ROOT)
if (files.length === 0) {
  console.error('No .kt files under ' + ROOT + ' - refusing to report a clean run on an empty scan.')
  process.exit(2)
}

const parsed = files.map(path => {
  const code = strip(readFileSync(path, 'utf8'))
  const pkgMatch = code.match(/^\s*package\s+([\w.]+)/m)
  const pkg = pkgMatch ? pkgMatch[1] : ''

  const imports = []
  const wildcards = []
  for (const m of code.matchAll(/^[ \t]*import[ \t]+([\w.]+?)(\.\*)?(?:[ \t]+as[ \t]+(\w+))?[ \t]*$/gm)) {
    if (m[2]) wildcards.push(m[1])
    else imports.push(m[3] || m[1].split('.').pop())
  }

  // Supertypes this file inherits from. A class that extends a LIBRARY type also
  // inherits that type's nested classes, usable unqualified and with no import -
  // PagingSource brings LoadParams and LoadResult in exactly this way. We cannot
  // enumerate a library's nested types, so such a file is not reportable.
  const superTypes = []
  // A constructor parameter list often spans lines, so the header scan must cross
  // newlines - bounded, and stopping at the class body, so it cannot run away.
  for (const m of code.matchAll(/\b(?:class|object|interface)\s+\w+[^{]{0,400}?:\s*([A-Z][\w.]*)/g)) superTypes.push(m[1].split('.').pop())

  const declared = new Set()
  for (const m of code.matchAll(/\b(?:class|interface|object|typealias)\s+(\w+)/g)) declared.add(m[1])
  for (const m of code.matchAll(/\bfun\s+(?:<[^>]*>\s*)?(?:[\w.<>?, ]+\.)?(\w+)\s*\(/g)) declared.add(m[1])
  for (const m of code.matchAll(/\b(?:val|var)\s+(\w+)/g)) declared.add(m[1])

  return { path, code, pkg, imports: new Set(imports), wildcards, declared, superTypes }
})

/** package -> every name declared anywhere in it (files in a package see each other). */
const byPackage = new Map()
for (const f of parsed) {
  if (!byPackage.has(f.pkg)) byPackage.set(f.pkg, new Set())
  const bag = byPackage.get(f.pkg)
  for (const d of f.declared) bag.add(d)
}
const projectPackages = new Set(byPackage.keys())

const findings = []

/** Everything an import line in this file could bring in, by simple name. */
function importedNames(f) {
  return f.imports
}
/** True when a wildcard import covers the package that owns `fqn`. */
function wildcardCovers(f, fqn) {
  const owner = fqn.slice(0, fqn.lastIndexOf('.'))
  return f.wildcards.includes(owner)
}

for (const f of parsed) {
  // --- Pass 2: lowercase extension functions / properties, and `by` delegates. ---
  // These are checked for EVERY file, including ones with an opaque wildcard onto a
  // package that does not own the symbol, because the catalog names the exact owner.
  for (const [name, fqn] of EXTENSION_CATALOG) {
    const used = new RegExp('(?:^|[^\\w.])\\.?' + name + '\\s*[({]', 'm').test(f.code) ||
      new RegExp('\\.' + name + '\\s*[({]').test(f.code)
    if (!used) continue
    if (importedNames(f).has(name)) continue
    if (wildcardCovers(f, fqn)) continue
    if (f.declared.has(name)) continue
    if ((byPackage.get(f.pkg) || new Set()).has(name)) continue
    findings.push({ path: f.path, line: lineOf(f.code, new RegExp('\\.?' + name + '\\s*[({]')), name, fix: 'import ' + fqn })
  }
  for (const [name, fqn] of UNIT_EXTENSIONS) {
    if (!new RegExp('[\\w)]\\s*\\.\\s*' + name + '\\b').test(f.code)) continue
    if (importedNames(f).has(name)) continue
    if (wildcardCovers(f, fqn)) continue
    findings.push({ path: f.path, line: lineOf(f.code, new RegExp('[\\w)]\\s*\\.\\s*' + name + '\\b')), name, fix: 'import ' + fqn })
  }
  // `var x by remember { mutableStateOf(...) }` needs the property-delegate operators.
  // Missing them is the exact break the PullToRefresh refactor left behind.
  const usesByDelegate = /\b(?:val|var)\s+\w+(?:\s*:\s*[\w<>?., ]+)?\s+by\s+/.test(f.code)
  const usesVarByDelegate = /\bvar\s+\w+(?:\s*:\s*[\w<>?., ]+)?\s+by\s+/.test(f.code)
  if (usesByDelegate && !importedNames(f).has('getValue') && !wildcardCovers(f, 'androidx.compose.runtime.getValue')) {
    findings.push({ path: f.path, line: lineOf(f.code, /\b(?:val|var)\s+\w+.*\s+by\s+/), name: 'getValue', fix: 'import androidx.compose.runtime.getValue (required by `by` delegation)' })
  }
  if (usesVarByDelegate && !importedNames(f).has('setValue') && !wildcardCovers(f, 'androidx.compose.runtime.setValue')) {
    findings.push({ path: f.path, line: lineOf(f.code, /\bvar\s+\w+.*\s+by\s+/), name: 'setValue', fix: 'import androidx.compose.runtime.setValue (required to assign a `by` delegated var)' })
  }
}

function lineOf(code, re) {
  const m = code.match(re)
  return m ? code.slice(0, m.index).split('\n').length : 0
}

for (const f of parsed) {
  // A wildcard onto a package we cannot enumerate (androidx.*, java.*) makes this
  // file's unknowns unknowable, so stay quiet rather than guess.
  const opaqueWildcard = f.wildcards.some(w => !projectPackages.has(w))
  if (opaqueWildcard) continue

  // Same reasoning for an inherited library supertype: its nested types are in
  // scope here, unqualified and unimported, and we cannot list them.
  const opaqueSuper = f.superTypes.some(t => !projectPackages.has(f.pkg) || !(byPackage.get(f.pkg) || new Set()).has(t))
  if (opaqueSuper) continue

  const wildcardNames = new Set()
  for (const w of f.wildcards) for (const n of (byPackage.get(w) || [])) wildcardNames.add(n)
  const samePackage = byPackage.get(f.pkg) || new Set()

  // Capitalised identifiers NOT preceded by a dot: a dot means member access,
  // resolved by the receiver rather than by an import.
  const seen = new Map()
  for (const m of f.code.matchAll(/(^|[^\w.@`])([A-Z]\w*)/g)) {
    const name = m[2]
    if (!seen.has(name)) seen.set(name, m.index + m[1].length)
  }

  for (const [name, idx] of seen) {
    if (NON_SYMBOLS.has(name)) continue
    if (DEFAULT_IMPORTS.has(name)) continue
    if (f.declared.has(name)) continue
    if (samePackage.has(name)) continue
    if (f.imports.has(name)) continue
    if (wildcardNames.has(name)) continue
    // An ALL_CAPS_CONSTANT is a constant reference, not a type needing an import.
    if (/^[A-Z0-9_]+$/.test(name)) continue
    findings.push({ path: f.path, line: f.code.slice(0, idx).split('\n').length, name })
  }
}

// ---------------------------------------------------------------------------
// Abandoned wiring: an import that is never used.
//
// WHY THIS EXISTS. ProfileScreen imported hiltViewModel and collectAsState, and
// referenced `user` throughout - but the two lines that DECLARE it (the viewModel
// parameter and `val user by viewModel.user.collectAsState()`) were never added.
// That is a compile error, and this checker walked straight past it: the main scan
// only resolves CAPITALISED identifiers, so an undeclared lowercase local like
// `user` is invisible to it. Resolving arbitrary locals needs a real parser; this
// does not.
//
// The signature is narrow and precise instead: importing a symbol and never calling
// it means the edit that needed it was left half-finished. It costs nothing and it
// catches exactly the class of failure that got through.
for (const f of parsed) {
  for (const [imp, call] of [
    ['androidx.hilt.navigation.compose.hiltViewModel', 'hiltViewModel('],
    ['androidx.compose.runtime.collectAsState', 'collectAsState('],
  ]) {
    if (!f.code.includes('import ' + imp)) continue
    if (f.code.includes(call)) continue
    findings.push({
      path: f.path,
      line: lineOf(f.code, new RegExp('import\\s+' + imp.replace(/\./g, '\\.'))),
      name: imp.split('.').pop(),
      fix: 'imported but never called - half-finished ViewModel wiring?',
    })
  }
}

const byFile = new Map()
for (const x of findings) {
  if (!byFile.has(x.path)) byFile.set(x.path, [])
  byFile.get(x.path).push(x)
}

console.log('Scanned ' + parsed.length + ' Kotlin files under ' + ROOT)
if (findings.length === 0) {
  console.log('No unresolved symbols and no missing Compose imports found.')
  console.log('(This means "no missing imports", NOT "this compiles".)')
  process.exit(0)
}
console.log('')
console.log(findings.length + ' missing import(s) / unresolved reference(s) in ' + byFile.size + ' file(s):')
console.log('')
const sorted = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)
for (const [path, list] of sorted) {
  const rel = relative(process.cwd(), path).split(sep).join('/')
  const names = [...new Set(list.map(x => x.fix ? x.name + ' (line ' + x.line + ') -> ' + x.fix : x.name + ':' + x.line))]
  console.log('  ' + rel)
  console.log('    ' + names.join(', '))
}
process.exit(1)
