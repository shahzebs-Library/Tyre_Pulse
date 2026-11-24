// Issue to / return from a job card: payload shapes the ledger expects, one
// idempotency key per distinct request, and a shortage read as a refusal.
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inventory/domain/job_card_issue.dart';

JobCardMoveDraft _draft({
  JobCardMove move = JobCardMove.issue,
  String jobCard = ' gckr/jc/0001/0826 ',
  num? qty = 2,
  String? reason,
  num? available = 5,
}) =>
    JobCardMoveDraft(
      move: move,
      stockId: 'stock-1',
      jobCard: jobCard,
      qty: qty,
      reason: reason,
      available: available,
    );

void main() {
  test('job card numbers are trimmed, collapsed and upper case', () {
    expect(normalizeJobCard('  gckr/jc  0001 '), 'GCKR/JC 0001');
    expect(normalizeJobCard('   '), isNull);
    expect(normalizeJobCard(null), isNull);
    expect(escapeLikeExact(r'A_B%C\D'), r'A\_B\%C\\D');
  });

  test('quantities must be above zero', () {
    expect(parseMoveQty('2'), 2);
    expect(parseMoveQty('2,5'), 2.5);
    expect(parseMoveQty('0'), isNull);
    expect(parseMoveQty('-1'), isNull);
    expect(parseMoveQty('x'), isNull);
  });

  test('validation names the first problem', () {
    expect(_draft().validate(), isNull);
    expect(_draft(jobCard: '  ').validate(), 'jc_needJobCard');
    expect(_draft(qty: null).validate(), 'jc_needQty');
    expect(_draft(qty: 6).validate(), 'jc_moreThanOnHand');
    expect(
      _draft(move: JobCardMove.issueReturn, available: null).validate(),
      'jc_needReason',
    );
    expect(
      _draft(move: JobCardMove.issueReturn, reason: 'unused', qty: 9)
          .validate(),
      isNull,
      reason: 'a return is bounded by the server, not by on-hand',
    );
  });

  test('an issue goes to inv_issue against the job card, with no cost', () {
    final Map<String, Object?> p = _draft(reason: '  ').toPayload('k1');
    expect(_draft().rpc, 'inv_issue');
    expect(p, <String, Object?>{
      'idempotency_key': 'k1',
      'stock_id': 'stock-1',
      'qty': 2,
      'reason': null,
      'source_doc_type': 'job_card',
      'source_doc_id': 'GCKR/JC/0001/0826',
    });
  });

  test('a return is an issue_return through inv_post_movement, no cost', () {
    final JobCardMoveDraft d =
        _draft(move: JobCardMove.issueReturn, reason: 'not used');
    expect(d.rpc, 'inv_post_movement');
    final Map<String, Object?> p = d.toPayload('k2');
    expect(p['movement_type'], 'issue_return');
    expect(p['qty_change'], 2);
    expect(p['source_doc_id'], 'GCKR/JC/0001/0826');
    expect(p.containsKey('unit_cost'), isFalse);
    expect(p['reason'], 'not used');
  });

  test('the request signature changes only when the request changes', () {
    expect(_draft().signature, _draft(jobCard: 'GCKR/JC/0001/0826').signature);
    expect(_draft().signature, isNot(_draft(qty: 3).signature));
    expect(
      _draft().signature,
      isNot(_draft(move: JobCardMove.issueReturn).signature),
    );
  });

  test('a shortage is a refusal, never a success', () {
    final JobCardMoveOutcome s = parseJobCardMoveResponse(<String, Object?>{
      'status': 'refused_shortage',
      'qty_available': 1,
      'qty_requested': 4,
    });
    expect(s, isA<JobCardMoveShortage>());
    expect((s as JobCardMoveShortage).available, 1);
    final JobCardMoveOutcome ok = parseJobCardMoveResponse(
      <String, Object?>{'movement_id': 'm1', 'replayed': true},
    );
    expect(ok, isA<JobCardMovePosted>());
    expect((ok as JobCardMovePosted).replayed, isTrue);
    expect(ok.movementId, 'm1');
  });

  test('a closed job card is recognised', () {
    expect(const JobCardRef(workOrderNo: 'A', status: 'Closed').isClosed, true);
    expect(const JobCardRef(workOrderNo: 'A', status: 'Open').isClosed, false);
    expect(const JobCardRef(workOrderNo: 'A').isClosed, false);
  });

  test('the oldest reservation still holding units is picked', () {
    final JobCardReservation a = JobCardReservation(
      id: 'a',
      qty: 2,
      qtyReleased: 0,
      qtyConsumed: 2,
      createdAt: DateTime.utc(2026),
    );
    final JobCardReservation b = JobCardReservation(
      id: 'b',
      qty: 5,
      qtyReleased: 1,
      qtyConsumed: 0,
      createdAt: DateTime.utc(2026, 2),
    );
    const JobCardReservation c =
        JobCardReservation(id: 'c', qty: 1, qtyReleased: 0, qtyConsumed: 0);
    expect(pickReservation(<JobCardReservation>[c, b, a])?.id, 'b');
    expect(b.remaining, 4);
    expect(pickReservation(<JobCardReservation>[a]), isNull);
    expect(pickReservation(const <JobCardReservation>[]), isNull);
  });

  test('a reservation is sent, counts towards the limit and changes the key',
      () {
    const JobCardMoveDraft plain = JobCardMoveDraft(
      move: JobCardMove.issue,
      stockId: 'stock-1',
      jobCard: 'JC',
      qty: 4,
      available: 2,
    );
    const JobCardMoveDraft held = JobCardMoveDraft(
      move: JobCardMove.issue,
      stockId: 'stock-1',
      jobCard: 'JC',
      qty: 4,
      available: 2,
      reservationId: 'res-1',
      reserved: 2,
    );
    expect(plain.validate(), 'jc_moreThanOnHand');
    expect(held.validate(), isNull);
    expect(plain.toPayload('k').containsKey('reservation_id'), isFalse);
    expect(held.toPayload('k')['reservation_id'], 'res-1');
    expect(plain.signature == held.signature, isFalse);
  });
}
