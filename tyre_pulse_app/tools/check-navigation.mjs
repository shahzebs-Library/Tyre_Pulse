#!/usr/bin/env node
/**
 * Navigation route checker - runs WITHOUT a JDK.
 *
 * WHY THIS EXISTS. Navigating to a route that no NavHost registered throws
 * IllegalArgumentException at runtime and takes the screen down. Nothing catches
 * it: Kotlin is happy (the route is a String), the import checker is happy, and
 * review is happy because the call site reads perfectly.
 *
 * It was already live here. TyreInspectionDestination was deliberately deleted -
 * the file even said "obsolete, handled by BottomSheet" - but its
 * navigateToTyreInspection() helper was left wired into the NavHost, so tapping a
 * tyre on the Inspection Form crashed the app. That is the core workflow.
 *
 * WHAT IT CHECKS, in both navigation styles this codebase uses:
 *   1. typed - navigate(XDestination.route / .createRoute(...)) vs
 *      composable(route = XDestination.route)
 *   2. literal - navigate("tyre_history/$id") vs composable("tyre_history/{tyreId}")
 *
 * Argument placeholders are normalised, so "tyre_history/$tyreId" matches
 * "tyre_history/{tyreId}" - it is the ROUTE SHAPE that must exist.
 *
 * WHAT IT DOES NOT CHECK: nested graphs behind navigation(), dynamic routes built
 * from a variable, deep links declared only in the manifest.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = process.argv[2] || 'app/src/main/java'

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
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * Reduce a route to its shape: every argument becomes {}, so a call site's
 * "asset_detail_route/$assetId" and the registration's
 * "asset_detail_route/{assetId}" compare equal.
 */
function shape(route) {
  return route
    .replace(/\$\{[^}]*\}/g, '{}')   // "${asset.id}"
    .replace(/\$\w+/g, '{}')          // "$assetId"
    .replace(/\{[^}]*\}/g, '{}')      // "{assetId}"
    .replace(/\?.*$/, '')             // drop optional-arg query part
    .replace(/\/+$/, '')
}

const files = walk(ROOT)
if (files.length === 0) {
  console.error('No .kt files under ' + ROOT + ' - refusing to report a clean run on an empty scan.')
  process.exit(2)
}

const definedDest = new Map()     // Destination object -> path
const destRoute = new Map()       // Destination object -> its literal route string
const registeredDest = new Set()
const navigatedDest = new Map()   // Destination -> path of the navigate()
const registeredLiteral = new Set()
const registeredRaw = new Map()   // raw route string -> file that registered it
const sources = new Map()         // file -> stripped source, for the reachability test
const navigatedLiteral = new Map() // shape -> { path, raw }

for (const path of files) {
  const code = strip(readFileSync(path, 'utf8'))

  // A destination object AND the literal route string it carries. The codebase
  // mixes styles - some call sites use navigateToScan(), others hand-write
  // navigate("scan_route") for the SAME screen - so a literal is only unregistered
  // if no destination object claims that shape either.
  for (const m of code.matchAll(/object\s+(\w*Destination)\b[\s\S]{0,400}?override\s+val\s+route\s*=\s*"([^"]+)"/g)) {
    definedDest.set(m[1], path)
    destRoute.set(m[1], m[2])
  }
  for (const m of code.matchAll(/object\s+(\w*Destination)\b/g)) {
    if (!definedDest.has(m[1])) definedDest.set(m[1], path)
  }
  for (const m of code.matchAll(/composable\s*\(\s*(?:route\s*=\s*)?(\w*Destination)\.(?:route|destination)/g)) registeredDest.add(m[1])
  for (const m of code.matchAll(/navigate\s*\(\s*(\w*Destination)\./g)) {
    if (!navigatedDest.has(m[1])) navigatedDest.set(m[1], path)
  }

  // Literal routes on both sides.
  for (const m of code.matchAll(/composable\s*\(\s*(?:route\s*=\s*)?"([^"]+)"/g)) {
    registeredLiteral.add(shape(m[1]))
    if (!registeredRaw.has(m[1])) registeredRaw.set(m[1], path)
  }
  for (const m of code.matchAll(/(?:navigate|popBackStack)\s*\(\s*"([^"]+)"/g)) {
    const s = shape(m[1])
    if (!navigatedLiteral.has(s)) navigatedLiteral.set(s, { path, raw: m[1] })
  }
  // Hub catalogs. Home and Profile do not call navigate() directly - they build a
  // list of HomeModule/AppModule entries whose third argument is a route, and hand
  // it to a callback later. Those are navigation targets in every sense that
  // matters, and looking only for navigate() missed them entirely: the Accidents
  // tile on BOTH hubs pointed at "accident_dashboard", which is registered nowhere,
  // and Compose Navigation throws on an unknown route. That is a crash on the most
  // prominent tile of the first screen, and this checker reported all-clear.
  for (const m of code.matchAll(/\b(?:HomeModule|AppModule)\s*\(\s*"[^"]*"\s*,\s*[^,]+,\s*"([^"]+)"/g)) {
    const s = shape(m[1])
    if (!navigatedLiteral.has(s)) navigatedLiteral.set(s, { path, raw: m[1] })
  }
  // Which file mentions which route name. Deliberately a substring test and NOT a
  // string-literal regex: pairing quotes with /"([^"]+)"/ drifts out of step after
  // the first escaped quote in a file, and then every later literal is mispaired.
  // That silently under-counted and reported reachable screens as dead.
  sources.set(path, code)

  // startDestination counts as a registration target too.
  for (const m of code.matchAll(/startDestination\s*=\s*"([^"]+)"/g)) navigatedLiteral.set(shape(m[1]), { path, raw: m[1] })
}

// A registered destination also registers its literal route shape, so a
// hand-written navigate("scan_route") resolves against composable(ScanDestination.route).
for (const dest of registeredDest) {
  const r = destRoute.get(dest)
  if (r) registeredLiteral.add(shape(r))
}

const findings = []

for (const [dest, path] of navigatedDest) {
  if (!registeredDest.has(dest)) {
    findings.push({ path, message: 'navigate(' + dest + '...) but no composable() registers ' + dest + ' - runtime crash' })
  }
}
for (const [dest, path] of definedDest) {
  if (!registeredDest.has(dest) && !navigatedDest.has(dest)) {
    findings.push({ path, message: dest + ' is defined but never registered and never navigated to - dead route object' })
  }
}
for (const [s, info] of navigatedLiteral) {
  if (!registeredLiteral.has(s)) {
    findings.push({ path: info.path, message: 'navigate("' + info.raw + '") -> no composable() registers route shape "' + s + '" - runtime crash' })
  }
}

// The inverse: a screen wired into the graph that nothing can reach. Not a crash,
// but it is dead weight that reads as a working feature, and nobody exercises it -
// the odometer screen was found this way, still holding a hard-coded vehicle id and
// a fabricated previous reading.
//
// CARE IS NEEDED HERE. This app does not only navigate with literals at the call
// site: Home and Profile hold data-driven module catalogs (HomeModule/AppModule)
// whose `route` field is handed to onNavigateToModule(). A naive "no navigate() call
// mentions it" rule reported 33 of 50 routes as unreachable, nearly all of them
// wrong. So a route counts as reachable if its string appears ANYWHERE other than
// its own registration - which is permissive on purpose, because a false alarm here
// costs more than a miss.
if (!process.argv.includes('--no-unreachable')) {
  for (const [raw, where] of registeredRaw) {
    const s = shape(raw)
    if (navigatedLiteral.has(s)) continue
    const quoted = JSON.stringify(raw)
    const namedElsewhere = [...sources.entries()].some(([f, src]) => f !== where && src.includes(quoted))
    if (namedElsewhere) continue // a catalog entry or another call site
    findings.push({
      path: where,
      message: 'route "' + raw + '" is registered but its name appears nowhere else - unreachable screen',
      soft: true,
    })
  }
}

console.log('Scanned ' + files.length + ' Kotlin files: ' +
  definedDest.size + ' destination objects, ' + registeredLiteral.size + ' literal routes registered')

const crashes = findings.filter(f => !f.soft)
const warnings = findings.filter(f => f.soft)

if (crashes.length === 0) {
  console.log('Every navigation target resolves to a registered route.')
} else {
  console.log('')
  console.log(crashes.length + ' navigation CRASH risk(s):')
  console.log('')
  for (const f of crashes) {
    console.log('  ' + relative(process.cwd(), f.path).split(sep).join('/'))
    console.log('    ' + f.message)
  }
}

if (warnings.length > 0) {
  console.log('')
  console.log(warnings.length + ' warning(s) - dead weight, not a crash:')
  console.log('')
  for (const f of warnings) {
    console.log('  ' + relative(process.cwd(), f.path).split(sep).join('/'))
    console.log('    ' + f.message)
  }
}

// Only a real crash risk fails the check. A warning that blocks a push gets
// silenced, and then the crash check goes with it.
process.exit(crashes.length > 0 ? 1 : 0)
