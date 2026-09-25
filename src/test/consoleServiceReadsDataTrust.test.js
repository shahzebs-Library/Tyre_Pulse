/**
 * Honest console reads, second batch: the Data Trust / reconciliation /
 * operations services (dataTrustOps, lineageOps, metricRegistry, reconBrand,
 * backups, selfHealing, automationHealth, tyreLearning).
 *
 * The rule under test: a read degrades to [] / "not provisioned" ONLY when the
 * table or function is genuinely not deployed (by error CODE). A permission or
 * network failure THROWS, so the page shows an error with Retry instead of an
 * empty list that reads as "nothing wrong". Reads that can exceed the 1,000-row
 * PostgREST cap are PAGED; the mock caps every response at 1,000 rows exactly as
 * the server does, so an unpaged read would visibly stop at 1,000.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = { tables: {}, error: null, tableErrors: {}, rpcResults: {}, calls: [], rpcCalls: [] }
  function builder(table) {
    const q = { table, orders: [], rangeArgs: null, limitN: null }
    const api = {
      select() { return api },
      gte() { return api },
      lte() { return api },
      eq() { return api },
      neq() { return api },
      or() { return api },
      not() { return api },
      order(col, opts) { q.orders.push([col, opts]); return api },
      range(a, b) { q.rangeArgs = [a, b]; return api },
      limit(n) { q.limitN = n; return api },
      maybeSingle() { q.single = true; return api },
      then(res, rej) {
        state.calls.push(q)
        const err = state.tableErrors[table] || state.error
        if (err) return Promise.resolve({ data: null, error: err }).then(res, rej)
        const all = state.tables[table] || []
        let rows = all
        if (q.rangeArgs) rows = all.slice(q.rangeArgs[0], q.rangeArgs[1] + 1)
        else if (q.limitN != null) rows = all.slice(0, q.limitN)
        rows = rows.slice(0, 1000) // the server cap
        if (q.single) return Promise.resolve({ data: rows[0] ?? null, error: null }).then(res, rej)
        return Promise.resolve({ data: rows, error: null }).then(res, rej)
      },
    }
    return api
  }
  function rpc(name, args) {
    state.rpcCalls.push({ name, args })
    const r = state.rpcResults[name]
    return Promise.resolve(r || { data: null, error: null })
  }
  return { state, supabase: { from: builder, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const dataTrust = await import('../lib/api/dataTrustOps')
const lineage = await import('../lib/api/lineageOps')
const metrics = await import('../lib/api/metricRegistry')
const brand = await import('../lib/api/reconBrand')
const backups = await import('../lib/api/backups')
const heal = await import('../lib/api/selfHealing')
const automation = await import('../lib/api/automationHealth')
const learning = await import('../lib/api/tyreLearning')

const PERMISSION = { code: '42501', message: 'permission denied for relation quality_results' }
const NETWORK = { message: 'Failed to fetch' }
const MISSING_TABLE = { code: '42P01', message: 'relation "x" does not exist' }
const MISSING_FN = { code: 'PGRST202', message: 'Could not find the function' }

const makeRows = (n, extra = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(6, '0')}`, ...extra(i) }))

beforeEach(() => {
  h.state.tables = {}
  h.state.error = null
  h.state.tableErrors = {}
  h.state.rpcResults = {}
  h.state.calls = []
  h.state.rpcCalls = []
})

describe('dataTrustOps - honest reads', () => {
  it('a permission denial that mentions "relation" THROWS (it is not a missing table)', async () => {
    h.state.error = PERMISSION
    await expect(dataTrust.listQualityResults()).rejects.toBeTruthy()
    await expect(dataTrust.listQualityRules()).rejects.toBeTruthy()
    await expect(dataTrust.listReconciliationRuns()).rejects.toBeTruthy()
    await expect(dataTrust.listCorrectionCases()).rejects.toBeTruthy()
    await expect(dataTrust.getCorrectionCase('c1')).rejects.toBeTruthy()
  })

  it('a network failure THROWS rather than reading as no results', async () => {
    h.state.error = NETWORK
    await expect(dataTrust.listQualityResults()).rejects.toBeTruthy()
  })

  it('a genuinely undeployed table reads as []', async () => {
    h.state.error = MISSING_TABLE
    expect(await dataTrust.listQualityResults()).toEqual([])
    expect(await dataTrust.listCorrectionCases()).toEqual([])
  })

  it('the monitor RPCs throw on failure and unwrap their payload on success', async () => {
    h.state.rpcResults.get_pipeline_runs = { data: null, error: PERMISSION }
    await expect(dataTrust.getPipelineRuns()).rejects.toBeTruthy()
    h.state.rpcResults.get_pipeline_runs = { data: { runs: [{ id: 1 }, { id: 2 }] }, error: null }
    expect(await dataTrust.getPipelineRuns()).toHaveLength(2)
    h.state.rpcResults.get_integration_events = { data: null, error: MISSING_FN }
    expect(await dataTrust.getIntegrationEvents()).toEqual([])
  })

  it('bounded windows stay under the 1,000-row response cap', () => {
    for (const n of [dataTrust.QUALITY_RESULTS_WINDOW, dataTrust.RECON_RUNS_WINDOW, dataTrust.CORRECTION_CASES_WINDOW]) {
      expect(n).toBeLessThanOrEqual(1000)
    }
  })
})

describe('lineageOps - paged + honest', () => {
  it('listDataAssets pages past the 1,000 cap with a unique tiebreak', async () => {
    h.state.tables.data_assets = makeRows(2500, (i) => ({ asset_id: `a${i}` }))
    const rows = await lineage.listDataAssets()
    expect(rows).toHaveLength(2500)
    expect(h.state.calls[0].orders.map(([c]) => c)).toEqual(['kind', 'name', 'asset_id'])
    expect(h.state.calls[0].rangeArgs).toEqual([0, 999])
  })

  it('listReleases pages every impact and throws on a failed read', async () => {
    h.state.tables.releases = makeRows(3)
    h.state.tables.release_impacts = makeRows(2300)
    const out = await lineage.listReleases()
    expect(out.releases).toHaveLength(3)
    expect(out.impacts).toHaveLength(2300)

    h.state.tableErrors.release_impacts = PERMISSION
    await expect(lineage.listReleases()).rejects.toBeTruthy()
  })

  it('lineage RPCs throw on error and on a server ok:false (never an empty graph)', async () => {
    h.state.rpcResults.get_lineage_graph = { data: null, error: NETWORK }
    await expect(lineage.getLineageGraph('t:x')).rejects.toBeTruthy()
    h.state.rpcResults.get_lineage_graph = { data: { ok: false, reason: 'forbidden' }, error: null }
    await expect(lineage.getLineageGraph('t:x')).rejects.toBeTruthy()
    h.state.rpcResults.get_lineage_graph = { data: { ok: true, nodes: [] }, error: null }
    expect(await lineage.getLineageGraph('t:x')).toEqual({ ok: true, nodes: [] })
  })

  it('listTrustAlerts throws on a permission error', async () => {
    h.state.error = PERMISSION
    await expect(lineage.listTrustAlerts()).rejects.toBeTruthy()
  })
})

describe('metricRegistry - honest reads', () => {
  it('listMetrics throws on failure, [] only when not deployed', async () => {
    h.state.error = PERMISSION
    await expect(metrics.listMetrics()).rejects.toBeTruthy()
    h.state.error = MISSING_TABLE
    expect(await metrics.listMetrics()).toEqual([])
  })

  it('getMetric throws when either read fails', async () => {
    h.state.tableErrors.metric_versions = NETWORK
    await expect(metrics.getMetric('fleet_cpk')).rejects.toBeTruthy()
  })

  it('explainMetric throws on a real failure and reports not_provisioned honestly', async () => {
    h.state.rpcResults.explain_metric = { data: null, error: PERMISSION }
    await expect(metrics.explainMetric('fleet_cpk')).rejects.toBeTruthy()
    h.state.rpcResults.explain_metric = { data: null, error: MISSING_FN }
    expect(await metrics.explainMetric('fleet_cpk')).toEqual({ ok: false, reason: 'not_provisioned' })
  })
})

describe('reconBrand.listBrandGapTyresAll - paged, never partial', () => {
  it('returns every blank-brand tyre past the 1,000 cap, ordered with an id tiebreak', async () => {
    h.state.tables.tyre_records = makeRows(2500, (i) => ({ country: 'KSA', serial_no: `S${i}` }))
    const rows = await brand.listBrandGapTyresAll({ country: 'KSA' })
    expect(rows).toHaveLength(2500)
    expect(rows[0]).not.toHaveProperty('id')
    expect(h.state.calls[0].orders.map(([c]) => c)).toEqual(['country', 'asset_no', 'serial_no', 'id'])
  })

  it('THROWS on a failed page instead of returning the rows read so far', async () => {
    h.state.error = NETWORK
    await expect(brand.listBrandGapTyresAll()).rejects.toBeTruthy()
  })
})

describe('backups.listBackupSnapshots - a permission denial is not "no backups"', () => {
  it('throws on 42501 (it used to read as [])', async () => {
    h.state.rpcResults.list_backup_snapshots = { data: null, error: { code: '42501', message: 'not authorized' } }
    await expect(backups.listBackupSnapshots()).rejects.toBeTruthy()
  })

  it('[] only when the RPC is not deployed', async () => {
    h.state.rpcResults.list_backup_snapshots = { data: null, error: { code: '42883', message: 'function does not exist' } }
    expect(await backups.listBackupSnapshots()).toEqual([])
    expect(backups.isMissingRelation({ code: '42501' })).toBe(false)
  })
})

describe('selfHealing.runScans - isolated, but failures are RECORDED', () => {
  it('a failing check is listed in `failed` while the others still return', async () => {
    h.state.rpcResults.recon_orphan_assets = { data: null, error: PERMISSION }
    h.state.rpcResults.recon_duplicate_tyres = { data: [{ serial_no: 'S1' }], error: null }
    h.state.rpcResults.recon_serial_conflicts = { data: [], error: null }
    const out = await heal.runScans()
    expect(out.orphans).toEqual([])
    expect(out.duplicates).toHaveLength(1)
    expect(out.failed.map((f) => f.key)).toEqual(['orphans'])
    expect(out.failed[0].label).toBe(heal.SCAN_LABELS.orphans)
    expect(out.failed[0].message).toBeTruthy()
  })

  it('a staleness table that fails is recorded; an undeployed one is skipped', async () => {
    h.state.rpcResults.recon_orphan_assets = { data: [], error: null }
    h.state.rpcResults.recon_duplicate_tyres = { data: [], error: null }
    h.state.rpcResults.recon_serial_conflicts = { data: [], error: null }
    h.state.tables.tyre_records = [{ id: 't1', site: 'NHC', created_at: '2026-09-01T00:00:00Z' }]
    h.state.tableErrors.accidents = NETWORK
    h.state.tableErrors.inspections = MISSING_TABLE
    const out = await heal.runScans()
    expect(out.staleRows).toEqual([{ site: 'NHC', created_at: '2026-09-01T00:00:00Z' }])
    expect(out.failed).toHaveLength(1)
    expect(out.failed[0].key).toBe('stale')
    expect(out.failed[0].detail.map((d) => d.table)).toEqual(['accidents'])
  })

  it('a clean run reports no failures', async () => {
    h.state.rpcResults.recon_orphan_assets = { data: [], error: null }
    h.state.rpcResults.recon_duplicate_tyres = { data: [], error: null }
    h.state.rpcResults.recon_serial_conflicts = { data: [], error: null }
    const out = await heal.runScans()
    expect(out.failed).toEqual([])
  })

  it('scanAnomalies throws on a failed read and pages past 1,000', async () => {
    h.state.error = PERMISSION
    await expect(heal.scanAnomalies()).rejects.toBeTruthy()
    h.state.error = null
    h.state.tables.tyre_records = makeRows(1500, () => ({ asset_no: 'A1', created_at: '2026-09-01' }))
    await heal.scanAnomalies()
    expect(h.state.calls.some((q) => q.rangeArgs && q.rangeArgs[0] === 1000)).toBe(true)
  })
})

describe('automationHealth - a permission denial surfaces', () => {
  it('listCronJobs throws on 42501 (it used to read as "no background jobs")', async () => {
    h.state.rpcResults.console_cron_jobs = { data: null, error: { code: '42501', message: 'not authorized' } }
    await expect(automation.listCronJobs()).rejects.toBeTruthy()
    h.state.rpcResults.console_cron_jobs = { data: null, error: MISSING_FN }
    expect(await automation.listCronJobs()).toEqual([])
  })

  it('listSchedules throws on a permission error that mentions "relation"', async () => {
    h.state.error = { code: '42501', message: 'permission denied for relation report_schedules' }
    await expect(automation.listSchedules()).rejects.toBeTruthy()
    h.state.error = MISSING_TABLE
    expect(await automation.listSchedules()).toEqual([])
  })
})

describe('tyreLearning - honest reads', () => {
  it('suggestions and learned facts throw on failure', async () => {
    h.state.rpcResults.tyre_learn_suggestions = { data: null, error: NETWORK }
    await expect(learning.listTyreSuggestions()).rejects.toBeTruthy()
    h.state.error = PERMISSION
    await expect(learning.listLearnedFacts()).rejects.toBeTruthy()
  })

  it('a server ok:false gap overview throws; an undeployed RPC is reported as such', async () => {
    h.state.rpcResults.get_tyre_gap_overview = { data: { ok: false, reason: 'forbidden' }, error: null }
    await expect(learning.getTyreGapOverview()).rejects.toBeTruthy()
    h.state.rpcResults.get_master_file_completeness = { data: null, error: MISSING_FN }
    expect(await learning.getMasterCompleteness()).toEqual({ ok: false, reason: 'not_provisioned' })
  })

  it('suggestions unwrap the payload and clamp the limit to the response cap', async () => {
    h.state.rpcResults.tyre_learn_suggestions = { data: { suggestions: [{ serial_no: 'S1' }] }, error: null }
    expect(await learning.listTyreSuggestions({ limit: 5000 })).toHaveLength(1)
    expect(h.state.rpcCalls.at(-1).args.p_limit).toBe(1000)
  })
})
