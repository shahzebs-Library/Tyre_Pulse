/**
 * Inspection sign-off - the DECISION write path.
 *
 * This used to be a direct `inspections` UPDATE from the phone, and every one of
 * the cases below is a defect that shipped because of it:
 *
 *   - two supervisors could both "approve" the same pending inspection, the
 *     second silently overwriting the first one's signature and timestamp;
 *   - the approver was whatever name the operator typed, written into the
 *     `approver_email` column;
 *   - the permissive `role_update_inspections` policy admits admin/manager/
 *     INSPECTOR, so the write itself never checked that the caller may approve;
 *   - and it excludes 'director', so a Director - who the approvals module and
 *     the server-side RPC both allow - was refused by RLS.
 *
 * The fix is to go through `decide_inspection_approval`, which derives the
 * approver from the caller's own session and refuses an already-decided record.
 * These tests pin the RPC call shape, because a silent revert to a direct
 * UPDATE would look identical on screen right up until two people sign.
 */
const rpc = jest.fn()
const update = jest.fn()
const eq = jest.fn()
const from = jest.fn()

jest.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => rpc(...a), from: (...a: any[]) => from(...a) } }))

import { decideInspection } from '../lib/inspectionApprovals'

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null })
  eq.mockReset().mockResolvedValue({ error: null })
  update.mockReset().mockReturnValue({ eq })
  from.mockReset().mockReturnValue({ update })
})

const APPROVE = {
  id: 'insp-1',
  approved: true,
  approverSignature: '<svg><path d="M 1 1 L 2 2"/></svg>',
  reviewNote: null,
  approverName: 'Ahmed',
}

describe('decideInspection - approve', () => {
  it('decides through the RPC, not a direct table update', async () => {
    await decideInspection(APPROVE)

    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('decide_inspection_approval')
    expect(args.p_inspection_id).toBe('insp-1')
    expect(args.p_decision).toBe('approved')
    expect(args.p_signature).toBe(APPROVE.approverSignature)

    // The whole point: nothing writes to `inspections` directly on approve.
    expect(from).not.toHaveBeenCalled()
  })

  it('never sends an approver identity from the client', async () => {
    await decideInspection(APPROVE)
    const args = rpc.mock.calls[0][1]

    // auth.uid() and the caller's profile email are the server's job. A client
    // that can name the approver can attribute a signature to someone else.
    for (const k of ['approver_email', 'approved_by', 'p_approver', 'approverName']) {
      expect(args).not.toHaveProperty(k)
    }
    expect(Object.keys(args).sort()).toEqual(
      ['p_decision', 'p_inspection_id', 'p_note', 'p_signature'],
    )
  })

  it('surfaces the server refusal rather than reporting success', async () => {
    // What the RPC raises when a second approver arrives late.
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'This inspection was already approved by Ahmed.', code: 'P0001' },
    })
    await expect(decideInspection(APPROVE)).rejects.toMatchObject({
      message: 'This inspection was already approved by Ahmed.',
    })
    // A refused decision must not then rewrite the record's notes.
    expect(from).not.toHaveBeenCalled()
  })
})

describe('decideInspection - return to the field', () => {
  const RETURN = {
    id: 'insp-2',
    approved: false,
    approverSignature: null,
    reviewNote: '  Front left tread not recorded  ',
    approverName: 'Sara',
    existingNotes: 'Original observation',
  }

  it('sends a trimmed reason to the RPC as the rejection note', async () => {
    await decideInspection(RETURN)
    const args = rpc.mock.calls[0][1]
    expect(args.p_decision).toBe('rejected')
    expect(args.p_note).toBe('Front left tread not recorded')
  })

  it('echoes the reason into notes so the inspector can read it', async () => {
    // The RPC files the reason in inspection_audit_log, which no mobile screen
    // reads. inspection/[id].tsx renders `notes`, so without this echo a
    // returned inspection arrives back with no visible explanation.
    await decideInspection(RETURN)

    expect(from).toHaveBeenCalledWith('inspections')
    const patch = update.mock.calls[0][0]
    expect(patch.notes).toContain('Original observation')
    expect(patch.notes).toContain('Returned by Sara: Front left tread not recorded')
    expect(eq).toHaveBeenCalledWith('id', 'insp-2')

    // Only `notes` - the decision itself was already committed by the RPC.
    expect(Object.keys(patch)).toEqual(['notes'])
  })

  it('does not fail the decision when the notes echo is refused', async () => {
    // A Director passes the RPC but is not in `role_update_inspections`, so the
    // convenience echo can be blocked. The decision still stands.
    eq.mockRejectedValue(new Error('permission denied'))
    await expect(decideInspection(RETURN)).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('writes no note at all when no reason was given', async () => {
    await decideInspection({ ...RETURN, reviewNote: '   ' })
    expect(rpc.mock.calls[0][1].p_note).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})
