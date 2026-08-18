/**
 * Checklist history - the read a tradesman's own sheet list depends on.
 *
 * WHAT THESE TESTS EXIST TO STOP
 * ------------------------------
 * 1. A "Mine" list that silently becomes EVERYONE's. `submitted_by` is the only
 *    thing separating the two, and the RLS read policy on checklist_submissions
 *    is `auth.uid() IS NOT NULL` - every signed-in user in the tenant can read
 *    every sheet their country scope allows. So dropping the filter does not
 *    error, does not return nothing, and does not look wrong: it quietly puts
 *    other people's work under a heading that says "yours".
 * 2. A read that truncates in silence. PostgREST caps every response at 1,000
 *    rows whatever `.limit()` claims, so this pages with `.range()` and reports
 *    honestly when it stopped at the ceiling.
 * 3. A count that fails and reads as ZERO. "We could not count" and "there are
 *    none" are opposite statements; the service returns null for the first.
 *
 * lib/checklists.ts imports native-backed modules, so every one is mocked here
 * and the suite stays inside the pure Node + ts-jest project (jest.config.js).
 */

// ---- native-backed module mocks ---------------------------------------------
/**
 * Every recorded call carries WHICH query made it. Without that, an assertion
 * like "a submitted_by filter was sent" is satisfied by the head COUNT query
 * even after the filter is dropped from the paged read - proven by mutation:
 * removing the .eq from the page left this suite green.
 */
type QueryKind = 'page' | 'count' | 'other'
interface Call { table: string; op: string; args: any[]; kind: QueryKind }

const calls: Call[] = []
const db = {
  /** Rows the paged read draws from, newest first. */
  submissions: [] as any[],
  /** Exact count the head request answers with. */
  count: null as number | null,
  countError: null as any,
  selectError: null as any,
  profiles: [] as any[],
  profilesError: null as any,
}

function builder(table: string, head: boolean) {
  const kind: QueryKind = table !== 'checklist_submissions' ? 'other' : head ? 'count' : 'page'
  const self: any = {
    eq(col: string, val: any) { calls.push({ table, op: 'eq', args: [col, val], kind }); return self },
    in(col: string, vals: any[]) { calls.push({ table, op: 'in', args: [col, vals], kind }); return self },
    or(expr: string) { calls.push({ table, op: 'or', args: [expr], kind }); return self },
    order(col: string, o?: any) { calls.push({ table, op: 'order', args: [col, o], kind }); return self },
    limit(n: number) { calls.push({ table, op: 'limit', args: [n], kind }); return self },
    range(from: number, to: number) {
      calls.push({ table, op: 'range', args: [from, to], kind })
      self._range = [from, to]
      return self
    },
    _range: null as null | [number, number],
    then(resolve: any, reject: any) {
      let out: any
      if (table === 'profiles') {
        out = { data: db.profilesError ? null : db.profiles, error: db.profilesError }
      } else if (head) {
        out = { data: null, count: db.count, error: db.countError }
      } else if (db.selectError) {
        out = { data: null, error: db.selectError }
      } else {
        const [from, to] = self._range ?? [0, db.submissions.length - 1]
        out = { data: db.submissions.slice(from, to + 1), error: null }
      }
      return Promise.resolve(out).then(resolve, reject)
    },
  }
  return self
}

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (_cols: string, opts?: any) => {
        const kind: QueryKind =
          table !== 'checklist_submissions' ? 'other' : opts?.head === true ? 'count' : 'page'
        calls.push({ table, op: 'select', args: [_cols, opts], kind })
        return builder(table, opts?.head === true)
      },
    }),
    rpc: jest.fn(),
  },
}))
jest.mock('../lib/recordQueue', () => ({ saveCommand: jest.fn() }))
jest.mock('../lib/photoUpload', () => ({ uploadModulePhoto: jest.fn() }))
jest.mock('../lib/durablePhotos', () => ({ persistPhotoForQueue: jest.fn() }))
jest.mock('../lib/ids', () => ({ safeUuid: () => 'sub-1111' }))

import {
  listSubmissionHistory, listSubmitterNames, historyScopeQuery, historyStateOf,
  historyCounts, historyTemplateOptions, submissionReference, matchesHistorySearch,
  filterHistory, HISTORY_MAX, ChecklistHistoryRow,
} from '../lib/checklists'

function row(over: Partial<ChecklistHistoryRow> = {}): ChecklistHistoryRow {
  return {
    id: 'r1', template_id: 'tpl-1', template_name: 'Workshop Daily Checklist',
    title: null, site: 'NHC', asset_no: 'TM514', status: 'submitted',
    submitted_by: 'user-1', submitted_at: '2026-08-10T06:00:00Z',
    score_pct: null, score_passed: null, approval_status: 'pending',
    document_no: 'WDC-TM514-2026-0001', approver_name: null, approved_at: null,
    supervisor_name: null, supervisor_at: null, review_note: null, locked: false,
    ...over,
  } as ChecklistHistoryRow
}

function many(n: number): any[] {
  return Array.from({ length: n }, (_, i) => row({ id: 'r' + i }))
}

beforeEach(() => {
  calls.length = 0
  db.submissions = []
  db.count = null
  db.countError = null
  db.selectError = null
  db.profiles = []
  db.profilesError = null
})

const eqCalls = (kind?: QueryKind) =>
  calls.filter(c => c.op === 'eq' && (kind ? c.kind === kind : true))
const orderCalls = () => calls.filter(c => c.op === 'order')
const rangeCalls = () => calls.filter(c => c.op === 'range')

// ---------------------------------------------------------------- the guard

describe('historyScopeQuery - whose sheets are being asked for', () => {
  it('scopes to the reader when the account is known', () => {
    expect(historyScopeQuery('mine', 'user-9')).toEqual({ ok: true, submittedBy: 'user-9' })
  })

  it('REFUSES rather than widening "mine" to everyone when the user is unknown', () => {
    // The failure this pins: falling back to `submittedBy: null` here returns
    // the whole team's sheets under a heading that says they are yours, and
    // nothing about the screen looks broken.
    expect(historyScopeQuery('mine', null)).toEqual({ ok: false, reason: 'unknown_user' })
    expect(historyScopeQuery('mine', undefined)).toEqual({ ok: false, reason: 'unknown_user' })
    expect(historyScopeQuery('mine', '   ')).toEqual({ ok: false, reason: 'unknown_user' })
  })

  it('asks for everyone only when the reader explicitly chose the team view', () => {
    expect(historyScopeQuery('team', 'user-9')).toEqual({ ok: true, submittedBy: null })
    expect(historyScopeQuery('team', null)).toEqual({ ok: true, submittedBy: null })
  })
})

// ------------------------------------------------------------------ the read

describe('listSubmissionHistory', () => {
  it('filters by submitter, scopes the country, and orders on a UNIQUE key', async () => {
    db.submissions = many(3)
    db.count = 3

    await listSubmissionHistory({ country: 'KSA', submittedBy: 'user-1' })

    // Asserted on the PAGED read specifically. Asserting it anywhere in `calls`
    // is satisfied by the head COUNT query alone, so the rows could come back
    // unfiltered while this test stayed green - mutation-proven.
    const onPage = eqCalls('page')
    expect(onPage.some(c => c.args[0] === 'submitted_by' && c.args[1] === 'user-1')).toBe(true)
    // And on the count, or the total would describe a different set from the
    // rows - "showing 12 of 400" where the 400 is the whole workshop's.
    expect(eqCalls('count').some(c => c.args[0] === 'submitted_by' && c.args[1] === 'user-1')).toBe(true)
    expect(calls.some(c => c.op === 'or' && c.kind === 'page' && String(c.args[0]).includes('country.eq.KSA'))).toBe(true)

    // submitted_at is a server DEFAULT, so a batch of offline sheets synced
    // together shares a timestamp; without the id tiebreak a row can drop or
    // repeat at a page boundary.
    const cols = orderCalls().map(c => c.args[0])
    expect(cols).toContain('submitted_at')
    expect(cols).toContain('id')
  })

  it('never sends a submitter filter for the team view', async () => {
    db.submissions = many(2)
    db.count = 2

    await listSubmissionHistory({ submittedBy: null })

    expect(eqCalls().some(c => c.args[0] === 'submitted_by')).toBe(false)
    expect(eqCalls('page')).toEqual([])
  })

  it('pages with .range() instead of trusting a .limit() the server ignores', async () => {
    db.submissions = many(250)
    db.count = 250

    const res = await listSubmissionHistory({ submittedBy: 'user-1' })

    expect(res.rows).toHaveLength(250)
    expect(rangeCalls().map(c => c.args)).toEqual([[0, 99], [100, 199], [200, 299]])
    expect(calls.some(c => c.op === 'limit')).toBe(false)
    expect(res.bounded).toBe(false)
  })

  it('stops at the ceiling and SAYS the view is bounded', async () => {
    db.submissions = many(400)
    db.count = 812

    const res = await listSubmissionHistory({ submittedBy: 'user-1' })

    expect(res.rows).toHaveLength(HISTORY_MAX)
    expect(res.max).toBe(HISTORY_MAX)
    expect(res.total).toBe(812)
    expect(res.bounded).toBe(true)
  })

  it('reports an unreadable count as unknown, never as zero', async () => {
    db.submissions = many(2)
    db.countError = { message: 'nope' }

    const res = await listSubmissionHistory({ submittedBy: 'user-1' })

    // null = "we could not count". Zero would claim the person has no sheets
    // while two of them are on screen.
    expect(res.total).toBeNull()
    expect(res.rows).toHaveLength(2)
    expect(res.bounded).toBe(false)
  })

  it('propagates a failed read so the screen can show an error, not an empty list', async () => {
    db.selectError = { message: 'network' }
    await expect(listSubmissionHistory({ submittedBy: 'user-1' })).rejects.toBeTruthy()
  })
})

describe('listSubmitterNames', () => {
  it('maps ids to a display name and de-duplicates the lookup', async () => {
    db.profiles = [
      { id: 'user-1', full_name: 'Ali Hassan', username: 'ali' },
      { id: 'user-2', full_name: '', username: 'sam' },
    ]
    const out = await listSubmitterNames(['user-1', 'user-1', 'user-2', null, ''])

    expect(out).toEqual({ 'user-1': 'Ali Hassan', 'user-2': 'sam' })
    const inCall = calls.find(c => c.op === 'in')
    expect(inCall?.args[1]).toEqual(['user-1', 'user-2'])
  })

  it('asks for nothing when there is nobody to name', async () => {
    await listSubmitterNames([null, undefined, ''])
    expect(calls).toHaveLength(0)
  })

  it('degrades to no names rather than failing the list', async () => {
    db.profilesError = { message: 'denied' }
    await expect(listSubmitterNames(['user-1'])).resolves.toEqual({})
  })
})

// --------------------------------------------------------------- pure logic

describe('history state buckets', () => {
  it('folds both waiting rungs into one filter bucket', () => {
    expect(historyStateOf({ approval_status: 'pending' })).toBe('waiting')
    expect(historyStateOf({ approval_status: 'pending_area_manager' })).toBe('waiting')
    expect(historyStateOf({ approval_status: 'approved' })).toBe('closed')
    expect(historyStateOf({ approval_status: 'rejected' })).toBe('sent_back')
    expect(historyStateOf({ approval_status: 'not_required' })).toBe('no_approval')
    // An unrecognised value must not be counted as closed.
    expect(historyStateOf({ approval_status: 'something_new' })).toBe('no_approval')
    expect(historyStateOf(null)).toBe('no_approval')
  })

  it('counts every bucket plus the total', () => {
    const rows = [
      row({ id: 'a', approval_status: 'pending' }),
      row({ id: 'b', approval_status: 'pending_area_manager' }),
      row({ id: 'c', approval_status: 'approved' }),
      row({ id: 'd', approval_status: 'rejected' }),
      row({ id: 'e', approval_status: 'not_required' }),
    ]
    expect(historyCounts(rows)).toEqual({
      all: 5, waiting: 2, closed: 1, sent_back: 1, no_approval: 1,
    })
  })
})

describe('template options', () => {
  it('offers only templates the reader actually has sheets for', () => {
    const rows = [
      row({ id: 'a', template_id: 't1', template_name: 'Workshop Daily' }),
      row({ id: 'b', template_id: 't1', template_name: 'Workshop Daily' }),
      row({ id: 'c', template_id: 't2', template_name: 'Fleet Transit Mixer' }),
      row({ id: 'd', template_id: null, template_name: 'Orphan' }),
    ]
    expect(historyTemplateOptions(rows)).toEqual([
      { id: 't2', name: 'Fleet Transit Mixer', count: 1 },
      { id: 't1', name: 'Workshop Daily', count: 2 },
    ])
  })
})

describe('the sheet reference', () => {
  it('returns null when no document number was ever minted', () => {
    // Measured live: all three existing submissions predate V594's minting and
    // carry a NULL document_no, so the screen must be able to say so instead of
    // rendering a blank where an identity should be.
    expect(submissionReference({ document_no: null })).toBeNull()
    expect(submissionReference({ document_no: '   ' })).toBeNull()
    expect(submissionReference({ document_no: 'WDC-TM514-2026-0001' })).toBe('WDC-TM514-2026-0001')
  })
})

describe('filtering', () => {
  const rows = [
    row({ id: 'a', template_id: 't1', asset_no: 'TM514', approval_status: 'pending', document_no: 'WDC-TM514-2026-0001' }),
    row({ id: 'b', template_id: 't2', asset_no: 'TM600', approval_status: 'approved', document_no: null, site: 'DIRIYAH' }),
    row({ id: 'c', template_id: 't1', asset_no: 'MP083', approval_status: 'rejected', document_no: 'WDC-MP083-2026-0007' }),
  ]

  it('matches on document number, machine, site and template', () => {
    expect(matchesHistorySearch(rows[0], 'tm514')).toBe(true)
    expect(matchesHistorySearch(rows[1], 'diriyah')).toBe(true)
    expect(matchesHistorySearch(rows[2], '0007')).toBe(true)
    expect(matchesHistorySearch(rows[0], 'nothing')).toBe(false)
    // A row with no document number must not crash the search.
    expect(matchesHistorySearch(rows[1], 'wdc')).toBe(false)
  })

  it('an empty search matches everything', () => {
    expect(filterHistory(rows, { search: '   ' })).toHaveLength(3)
    expect(filterHistory(rows)).toHaveLength(3)
  })

  it('combines state, template and search', () => {
    expect(filterHistory(rows, { state: 'waiting' }).map(r => r.id)).toEqual(['a'])
    expect(filterHistory(rows, { templateId: 't1' }).map(r => r.id)).toEqual(['a', 'c'])
    expect(filterHistory(rows, { state: 'closed', templateId: 't1' })).toEqual([])
    expect(filterHistory(rows, { templateId: 't1', search: 'MP083' }).map(r => r.id)).toEqual(['c'])
  })

  it('a filter that matches nothing returns NOTHING, never the unfiltered list', () => {
    expect(filterHistory(rows, { search: 'no-such-machine' })).toEqual([])
  })
})
