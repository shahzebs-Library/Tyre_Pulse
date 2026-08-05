/**
 * Platform Map - the single honest inventory of what this platform HAS and
 * what it DOES NOT have, written for the owner, not for engineers.
 *
 * Three sources, none invented here:
 *   - console pages come from ConsoleLayout's CONSOLE_NAV (derived from the
 *     real sidebar, so the map cannot drift); this file only adds the
 *     plain-English description per route - a coverage test fails when a new
 *     console page ships without one
 *   - web app areas come from Layout's NAV_CATALOG (the real app sidebar)
 *   - mobile modules come from src/lib/mobileModules.js (the mirror of the
 *     phone app's own registry)
 *
 * NOT_BUILT is the part most inventories lie about: the known gaps, stated
 * plainly, each with WHO can move it forward. An owner who can see what is
 * missing does not have to discover it mid-task.
 */

/** Plain-English description per console route. Keyed by the route in CONSOLE_NAV. */
export const CONSOLE_DESCRIPTIONS = {
  '/console': 'The landing view: user counts, pending approvals, recent activity, and anything waiting on you.',
  '/console/control-center': 'Trust scores for the key figures, data problems found, and where each number comes from.',
  '/console/health': 'Is the system itself healthy: a 0-100 score, error log, and checks on every subsystem.',
  '/console/crash-reports': 'Live crash reports from the mobile app and website, with assign / comment / resolve.',
  '/console/data-ops': 'One launchpad linking every data surface, with a live open-issues headline.',
  '/console/import-history': 'Every file upload: what was loaded, what was skipped, repeat files, and daily coverage gaps.',
  '/console/smart-import': 'Upload any Excel/CSV and it works out which module the data belongs to by itself.',
  '/console/material-master': 'The item catalogue behind expense classification; confirming items makes the figures more trustworthy.',
  '/console/classification-learning': 'The classifier proposes rules learned from your corrections; you accept or reject them.',
  '/console/data-learning': 'Confirm a fact once (a brand, a size) and it fixes current data AND future uploads.',
  '/console/metric-catalogue': 'The registry of every governed KPI: its formula, source, and freshness.',
  '/console/data-quality': 'Automated quality checks over the data (gaps, impossible dates, unpriced items).',
  '/console/reconciliation': 'Cross-checks that different tables agree with each other about the same money and volumes.',
  '/console/pipeline-monitor': 'Did the scheduled jobs and imports actually run.',
  '/console/correction-center': 'A governed workflow for correcting a wrong figure, keeping the original on record.',
  '/console/lineage': 'Trace any figure back through every table it came from.',
  '/console/trust-alerts': 'Open alerts raised by the quality and reconciliation checks.',
  '/console/releases': 'A log of platform changes and which figures each change affected.',
  '/console/duplicates': 'Find and safely remove duplicate rows, with one-click undo.',
  '/console/data-browser': 'Read any core table with filters, ask questions in plain English, edit or delete single rows (audited).',
  '/console/data-cleanup': 'Delete old data deliberately: preview the count, snapshot first, typed confirmation.',
  '/console/backups': 'Nightly snapshots of the core tables and a safe restore for deleted rows.',
  '/console/users': 'Approve, lock, and manage every user: role, country, and site access.',
  '/console/access': 'Who can see which module: role permissions, custom roles, per-user overrides, and the audit of changes.',
  '/console/admin-roles': 'The console admin role model (super admin / regional / viewer).',
  '/console/organisations': 'The companies on the platform.',
  '/console/sessions': 'Who is signed in on what device; lock accounts and clear push registrations.',
  '/console/support-sessions': 'Time-boxed, audited permission for a super admin to inspect one company.',
  '/console/account-deletions': 'User requests to delete their account (a store-policy requirement).',
  '/console/alert-rules': 'Build "if X passes Y, notify Z" rules without code.',
  '/console/automation': 'Are the scheduled reports and background jobs healthy.',
  '/console/delivery': 'Did the emails and push notifications actually deliver.',
  '/console/self-healing': 'Automatic scans that find and (with your click) fix common data problems.',
  '/console/announcements': 'Broadcast a message to app users.',
  '/console/ai-usage': 'What the AI features cost: calls, tokens, and spend over time.',
  '/console/ai-admin': 'AI configuration: models, prompts, budgets, and feedback.',
  '/console/audit-trail': 'One searchable trail of every change across the system, with before/after.',
  '/console/audit': 'The raw console action log.',
  '/console/security': 'Security posture and sign-on configuration.',
  '/console/config': 'The global switches: maintenance mode, registration, exports, session rules.',
  '/console/system': 'Environment and platform information.',
  '/console/module-control': 'Turn any module Live / Maintenance / Off across the whole app.',
  '/console/navigation': 'Reorder, rename, or hide the app sidebar without code.',
  '/console/appearance': 'The report colour theme every chart and shared board follows.',
  '/console/vehicle-designer': 'Design how each vehicle type is drawn (axles, tyres, body) across the app.',
  '/console/platform-map': 'This page: everything the platform has, and the honest list of what it does not.',
  '/console/mobile-app': 'The field phones: released version, forced-update rule, and device counts.',
}

/**
 * The honest gap list. Each entry: what is missing, why it matters, and WHO
 * can move it - 'you' (a decision or setting), 'customer file' (data only the
 * operating company holds), or 'build' (engineering work not yet done).
 */
export const NOT_BUILT = [
  {
    title: 'Combined-country money totals',
    who: 'you',
    what: 'KSA, UAE and Egypt each report in their own currency. A combined total needs exchange rates entered and approved in System Configuration; until then the app deliberately refuses to blend SAR + AED + EGP into one number.',
  },
  {
    title: 'About 1,500 KSA job cards with day/month possibly swapped',
    who: 'customer file',
    what: 'A date like 07-09 could be 7 September or 9 July. Only re-uploading the original job-card file fixes these exactly; guessing would corrupt them differently.',
  },
  {
    title: 'Production volumes since 9 July',
    who: 'customer file',
    what: 'The last production (m3) upload was 9 July, so Cost per M3 for recent weeks runs on an old denominator until the next file is uploaded.',
  },
  {
    title: 'Mobile crash symbol upload',
    who: 'you',
    what: 'Crash reports arrive but without full detail. Turning on symbol upload needs the Sentry token ticked for Production in the Expo build settings.',
  },
  {
    title: 'UAE and Egypt tyre prices',
    who: 'customer file',
    what: 'Thousands of tyres there have no purchase price in any file received so far, so their cost-per-km stays honest N/A rather than a guess.',
  },
  {
    title: 'Automatic deletion of old business records',
    who: 'you',
    what: 'Deliberately off. Old accidents, tyres and fleet records are never auto-deleted; the manual Data Cleanup page (with snapshots) is the only path.',
  },
  {
    title: 'Self-serve signup for new companies',
    who: 'you',
    what: 'Built but switched off by your decision: new users join your company after approval; creating a brand-new company is not open to the public.',
  },
  {
    title: 'External insurer portal screens',
    who: 'build',
    what: 'The secure links for an insurer to view one accident case exist at the database level; the polished web page an insurer would see is not built yet.',
  },
]

/** Console section rows: merge the live nav with the descriptions. */
export function consoleSections(consoleNav) {
  return (consoleNav || []).map((g) => ({
    label: g.label,
    items: g.items.map((it) => ({
      to: it.to,
      label: it.label,
      what: CONSOLE_DESCRIPTIONS[it.to] || '',
    })),
  }))
}

/** Console routes that are missing a plain-English description (test + UI honesty). */
export function undescribedConsoleRoutes(consoleNav) {
  const out = []
  ;(consoleNav || []).forEach((g) => g.items.forEach((it) => {
    if (!CONSOLE_DESCRIPTIONS[it.to]) out.push(it.to)
  }))
  return out
}

/** Flatten web NAV_CATALOG into displayable groups. */
export function webSections(navCatalog) {
  return (navCatalog || []).map((g) => ({ label: g.label, items: (g.items || []).map((i) => i.label) }))
}

/** Group the mobile module registry for display. */
export function mobileSections(mobileModules) {
  const by = new Map()
  ;(mobileModules || []).forEach((m) => {
    if (!by.has(m.group)) by.set(m.group, [])
    by.get(m.group).push({
      label: m.label,
      openTo: m.roles && m.roles.length
        ? m.roles.join(', ')
        : 'admins only (grantable per person)',
    })
  })
  return Array.from(by.entries()).map(([label, items]) => ({ label, items }))
}

/** Case-insensitive filter over any {label, items:[{label|string}]} sections. */
export function filterSections(sections, term) {
  const q = String(term || '').trim().toLowerCase()
  if (!q) return sections
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => {
        const label = typeof i === 'string' ? i : i.label
        const what = typeof i === 'string' ? '' : (i.what || '')
        return label.toLowerCase().includes(q) || what.toLowerCase().includes(q)
      }),
    }))
    .filter((s) => s.items.length)
}

export function platformCounts({ consoleNav, navCatalog, mobileModules }) {
  const n = (secs) => secs.reduce((a, s) => a + s.items.length, 0)
  return {
    consolePages: n(consoleSections(consoleNav)),
    webAreas: n(webSections(navCatalog)),
    mobileModules: (mobileModules || []).length,
    gaps: NOT_BUILT.length,
  }
}
