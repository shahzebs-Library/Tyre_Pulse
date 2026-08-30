import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'src/pages'
const pages = readdirSync(dir).filter((f) => f.endsWith('.jsx')).map((file) => {
  const text = readFileSync(join(dir, file), 'utf8')
  const lines = text.split(/\r?\n/).length
  const has = (re) => re.test(text)
  return {
    page: file.replace(/\.jsx$/, ''), lines,
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
const result = {
  generatedAt: new Date().toISOString(),
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
}
mkdirSync('audit', { recursive: true })
writeFileSync('audit/module-inventory-2026-08-30.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify(result.totals, null, 2))
