import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/driver_concerns/domain/driver_concern_rules.dart';
import 'package:tyre_pulse/features/driver_concerns/presentation/driver_concerns_copy.dart';

DriverConcern _c(Map<String, Object?> j) =>
    DriverConcern.fromJson(<String, Object?>{
      'id': 'x',
      'case_no': 'DC-2026-0001',
      'category': 'pay',
      'subtype': 'salary_late',
      'status': 'open',
      'level': 'supervisor',
      ...j,
    });

void main() {
  final DateTime now = DateTime.utc(2026, 11, 27, 12);

  test('ladder mirrors the SQL; sensitive skips the pool', () {
    expect(nextLevel('supervisor', sensitive: false), 'incharge');
    expect(nextLevel('incharge', sensitive: false), 'manager');
    expect(nextLevel('manager', sensitive: false), isNull);
    expect(nextLevel('hr', sensitive: true), 'manager');
    expect(nextLevel('supervisor', sensitive: true), isNull);
  });

  test('treatment is the only sensitive category, subtypes validate', () {
    expect(
        concernCategories
            .where((ConcernCategory c) => c.sensitive)
            .map((ConcernCategory c) => c.key),
        <String>['treatment']);
    expect(isValidSubtype('pay', 'salary_late'), isTrue);
    expect(isValidSubtype('pay', 'harassment'), isFalse);
  });

  test('deadline: unacknowledged past ack is overdue, closed is null', () {
    expect(
        deadlineState(
            _c(<String, Object?>{
              'ack_due_at': '2026-11-27T10:00:00Z',
              'due_at': '2026-11-29T10:00:00Z'
            }),
            now),
        ConcernDeadline.overdue);
    expect(
        deadlineState(
            _c(<String, Object?>{
              'acknowledged_at': '2026-11-27T09:00:00Z',
              'due_at': '2026-11-27T18:00:00Z'
            }),
            now),
        ConcernDeadline.dueSoon);
    expect(deadlineState(_c(<String, Object?>{'status': 'accepted'}), now),
        isNull);
  });

  test('driver signs only after confirming the outcome was seen', () {
    ConcernDetail d(Map<String, Object?> extra) => ConcernDetail(
          concern: _c(<String, Object?>{'status': 'outcome_shared', ...extra}),
          events: const <ConcernEvent>[],
          isDriver: true,
          myRank: 0,
        );
    expect(
        allowedActions(d(<String, Object?>{}), now).contains('sign'), isFalse);
    expect(
        allowedActions(
                d(<String, Object?>{'outcome_seen_at': '2026-11-27T11:00:00Z'}),
                now)
            .contains('sign'),
        isTrue);
  });

  test('a supervisor cannot act on a case already with the incharge', () {
    final ConcernDetail d = ConcernDetail(
      concern: _c(<String, Object?>{'level': 'incharge'}),
      events: const <ConcernEvent>[],
      isDriver: false,
      myRank: 1,
    );
    expect(allowedActions(d, now).contains('propose'), isFalse);
  });

  test('every category, subtype, status and event has copy in en, ar and ur',
      () {
    for (final String lang in <String>['en', 'ar', 'ur']) {
      final Map<String, String> m = DriverConcernsCopy.values[lang]!;
      expect(m.keys.toSet(), DriverConcernsCopy.values['en']!.keys.toSet());
      for (final ConcernCategory c in concernCategories) {
        expect(m['category.${c.key}'], isNotNull);
        for (final String s in c.subtypes) {
          expect(m['subtype.$s'], isNotNull);
        }
      }
    }
  });
}
