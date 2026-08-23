#!/usr/bin/env node
/**
 * Experimental Compose APIs used without @OptIn.
 *
 * WHY THIS EXISTS. PullToRefreshBox is still ExperimentalMaterial3Api in the Compose
 * BOM this project is held at (2024.09.02). A composable that calls it without
 * @OptIn is a hard compile error, and CI reported exactly that for ApprovalsScreen
 * after a full run. None of the other checkers looks at annotations.
 *
 * A pass means no listed experimental API is called without an opt-in. It is not a
 * type checker, and the list below is the set this project actually uses - extend it
 * when a new experimental API is adopted.
 *
 * MUTATION-TESTED: removing the @OptIn above ApprovalsScreen makes this report it.
 * An earlier version silently passed that same mutation, because it matched the
 * annotation block with [^)]* - which crosses newlines and reached an unrelated
 * @OptIn further up the file. It now tests the annotation lines one at a time.
 */
import fs from 'fs'; import path from 'path'
const ROOT = 'app/src/main/java'
const EXP = { PullToRefreshBox:'ExperimentalMaterial3Api', TopAppBar:'ExperimentalMaterial3Api',
  SecondaryScrollableTabRow:'ExperimentalMaterial3Api', CenterAlignedTopAppBar:'ExperimentalMaterial3Api',
  ExposedDropdownMenuBox:'ExperimentalMaterial3Api', ModalBottomSheet:'ExperimentalMaterial3Api',
  rememberModalBottomSheetState:'ExperimentalMaterial3Api', FlowRow:'ExperimentalLayoutApi' }
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : e.name.endsWith('.kt') && o.push(p) } return o }
const isFun = l => /^\s*(?:internal |private |public |suspend )*fun\s+\w+/.test(l)
const bad = []
for (const f of walk(ROOT)) {
  const raw = fs.readFileSync(f, 'utf8')
  const lines = raw.split(/\r?\n/)
  const fileOptIn = lines.some(l => /^@file:OptIn/.test(l))
  lines.forEach((line, i) => {
    for (const [sym, api] of Object.entries(EXP)) {
      if (!new RegExp('\b' + sym + '\s*[({]').test(line)) continue
      // nearest enclosing fun, scanning upward
      let d = i; while (d >= 0 && !isFun(lines[d])) d--
      if (d < 0) continue
      // the contiguous annotation/comment block directly above it, LINE BY LINE
      let ok = fileOptIn
      for (let a = d - 1; a >= 0 && /^\s*(@|\/\/|\*|\/\*)/.test(lines[a]); a--) {
        if (/^\s*@OptIn\s*\(/.test(lines[a]) && lines[a].includes(api)) { ok = true; break }
      }
      if (!ok) bad.push(f + ':' + (i + 1) + '  ' + sym + ' in fun at line ' + (d + 1) + ' needs @OptIn(' + api + '::class)')
    }
  })
}
console.log(bad.length ? bad.join('\n') : 'no experimental Compose API used without @OptIn')
