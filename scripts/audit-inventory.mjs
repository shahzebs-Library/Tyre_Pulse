import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'

const dir = 'src/pages'
const pages = readdirSync(dir).filter((f) => f.endsWith('.jsx') && !/\.(test|spec)\.jsx$/.test(f)).map((file) => {
  const text = readFileSync(join(dir, file), 'utf8')
  const lines = text.split(/\r?\n/).length
  const has = (re) => re.test(text)
  const directImports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
  const serviceCandidates = directImports.filter((name) => name.startsWith('../lib/api/')).flatMap((name) => {
    const path = resolve(dir, name.endsWith('.js') ? name : `${name}.js`)
    if (!existsSync(path)) return []
    const service = readFileSync(path, 'utf8')
    return [{
      source: relative('.', path).replaceAll('\\', '/'),
      boundedRead: /\.limit\(/.test(service),
      rangeRead: /\.range\(|fetchAllPages/.test(service),
      missingRelationBecomesEmpty: /if\s*\(isMissingRelation\(err\)\)\s*return\s*\[\]/.test(service),
    }]
  })
  return {
    page: file.replace(/\.jsx$/, ''), lines,
    source: join(dir, file).replaceAll('\\', '/'),
    reviewStatus: 'static-signals-only',
    directImports, serviceCandidates,
    nextReview: 'Trace the primary task through these imports; verify scope, success/error/empty states, persistence, totals versus export, and permitted actions. Service flags are candidates, not confirmed defects.',
    data: has(/\.\.\/lib\/|supabase|useQuery\(/), directSupabase: has(/supabase\.(from|rpc|storage|functions)/),
    table: has(/<table|DataTable|EnterpriseTable|useReactTable/), filter: has(/filter|Filter/), search: has(/search|Search/),
    sharedFilter: has(/\bFilterBar\b/),
    date: has(/type=['"](?:date|month|datetime-local)|DatePicker|DateField|<Calendar/),
    nativeDate: has(/type=['"](?:date|month|datetime-local)/), sharedDate: has(/\bDateField\b/),
    select: has(/<select|\bSelect\b/), enterpriseTable: has(/\bEnterpriseTable\b/),
    loading: has(/LoadingState|loading|isLoading/), error: has(/ErrorState|\berror\b|toUserMessage/),
    empty: has(/EmptyState|No data|No records|no data|no records|\.length\s*===?\s*0/),
    export: has(/export|Export|download|Download/), pagination: has(/pagination|pageSize|currentPage|\.range\(|\busePagedRows\b/),
    pagedHook: has(/\busePagedRows\b/), serverRange: has(/\.range\(/),
    virtualized: has(/useVirtualizer|react-virtual/),
    savedView: has(/useFilterState|savedView|saved view/i),
    drilldown: has(/onRowClick|navigate\s*\(|<Link\b/),
  }
})

const app = readFileSync('src/App.jsx', 'utf8')
function sourceFiles(root, extension) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? sourceFiles(path, extension) : path.endsWith(extension) ? [path] : []
  })
}

const flutterRoot = 'tyre_pulse_flutter/lib/features'
const flutterFeatures = existsSync(flutterRoot) ? readdirSync(flutterRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => {
    const files = sourceFiles(join(flutterRoot, entry.name), '.dart')
    const boundedReads = files.flatMap((path) => readFileSync(path, 'utf8').split(/\r?\n/)
      .flatMap((line, index) => /^\s*\/\//.test(line) || !/\.limit\(\d+\)/.test(line) ? [] : [{
        source: path.replaceAll('\\', '/'), line: index + 1, expression: line.trim(),
      }]))
    return {
      feature: entry.name, reviewStatus: 'static-signals-only',
      sources: files.map((path) => path.replaceAll('\\', '/')),
      boundedReads,
      nextReview: 'Verify the registered screen, role/scope, persisted writes, offline or explicit online-only behavior, back navigation, RTL and platform tests. Bounded reads may be intentional; inspect their callers.',
    }
  }) : []
const marketingPages = sourceFiles('marketing/app', 'page.tsx').map((path) => ({
  source: path.replaceAll('\\', '/'), reviewStatus: 'static-signals-only',
  directImports: [...readFileSync(path, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]),
  nextReview: 'Verify claim evidence, links and CTA destination, responsive keyboard flow, language, metadata, and actual capability availability.',
}))
const result = {
  generatedAt: new Date().toISOString(),
  methodology: 'Source keyword inventory, not a workflow audit or readiness score. Missing signals require inspection of direct imports and composed components. A short page is not necessarily incomplete.',
  totals: {
    pages: pages.length,
    routeElements: (app.match(/<Route/g) || []).length,
    lazyCalls: (app.match(/lazy\(/g) || []).length,
    directSupabasePages: pages.filter((p) => p.directSupabase).length,
    tablePages: pages.filter((p) => p.table).length,
    tableWithoutFilter: pages.filter((p) => p.table && !p.filter && !p.search).length,
    tableWithoutPagination: pages.filter((p) => p.table && !p.pagination).length,
    dataWithoutEmpty: pages.filter((p) => p.data && !p.empty).length,
    dataWithoutError: pages.filter((p) => p.data && !p.error).length,
    dataWithoutLoading: pages.filter((p) => p.data && !p.loading).length,
    datePages: pages.filter((p) => p.date).length,
    nativeDatePages: pages.filter((p) => p.nativeDate).length,
    nativeDateWithoutShared: pages.filter((p) => p.nativeDate && !p.sharedDate).length,
    enterpriseTablePages: pages.filter((p) => p.enterpriseTable).length,
    pagedHookPages: pages.filter((p) => p.pagedHook).length,
    serverRangePages: pages.filter((p) => p.serverRange).length,
    virtualizedPages: pages.filter((p) => p.virtualized).length,
    savedViewPages: pages.filter((p) => p.savedView).length,
    tableWithoutDrilldown: pages.filter((p) => p.table && !p.drilldown).length,
    selectPages: pages.filter((p) => p.select).length,
  },
  thinPages: pages.filter((p) => p.lines < 180),
  tableWithoutFilter: pages.filter((p) => p.table && !p.filter && !p.search),
  tableWithoutPagination: pages.filter((p) => p.table && !p.pagination),
  dataWithoutEmpty: pages.filter((p) => p.data && !p.empty),
  dataWithoutError: pages.filter((p) => p.data && !p.error),
  dataWithoutLoading: pages.filter((p) => p.data && !p.loading),
  nativeDateWithoutShared: pages.filter((p) => p.nativeDate && !p.sharedDate),
  tableWithoutDrilldown: pages.filter((p) => p.table && !p.drilldown),
  pages,
  flutterFeatures,
  marketingPages,
}
const output = process.argv[2] || 'audit/module-inventory-2026-08-30.json'
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(result, null, 2))
const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`
const reviewRows = pages.map((page) => {
  const bounded = page.serviceCandidates.filter((service) => service.boundedRead && !service.rangeRead)
  const hidden = page.serviceCandidates.filter((service) => service.missingRelationBecomesEmpty)
  const checks = [
    ...(bounded.length ? ['Trace bounded reads: prove totals, conflict checks and exports cover the intended dataset.'] : []),
    ...(hidden.length ? ['Distinguish unavailable backend from successful empty results.'] : []),
    'Exercise primary action, denied access, scope change, error/retry and filtered export.',
  ]
  return [page.page, page.source, bounded.length || hidden.length ? 'P1 candidate' : 'P2 workflow review',
    'Not end-to-end verified', page.directImports.join('; '), checks.join(' ')]
})
writeFileSync(output.replace(/\.json$/, '') + '.csv', [
  ['Page', 'Source', 'Review priority', 'Status', 'Direct imports', 'Next acceptance checks'],
  ...reviewRows,
].map((row) => row.map(csvCell).join(',')).join('\n') + '\n')
console.log(JSON.stringify(result.totals, null, 2))
