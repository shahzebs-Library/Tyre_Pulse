import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_due.dart';

void main() {
  final DateTime now = DateTime(2026, 9, 28, 10, 30);

  ChecklistDue classify(String? due, {String? status}) =>
      classifyChecklistDue(dueDate: due, status: status, now: now);

  group('classifyChecklistDue', () {
    test('a bare date is read as that calendar day, not shifted via UTC', () {
      final ChecklistDue d = classify('2026-09-29');
      expect(d.kind, ChecklistDueKind.tomorrow);
      expect(d.date, DateTime(2026, 9, 29));
    });

    test('bare dates: today, later and past', () {
      expect(classify('2026-09-28').kind, ChecklistDueKind.today);
      expect(classify('2026-10-05').kind, ChecklistDueKind.later);
      expect(classify('2026-09-27').kind, ChecklistDueKind.overdue);
    });

    test('a timestamptz is converted to the local calendar day first', () {
      const String raw = '2026-09-29T12:00:00Z';
      final DateTime local = DateTime.parse(raw).toLocal();
      final ChecklistDue d = classify(raw);
      expect(d.date, DateTime(local.year, local.month, local.day));
    });

    test('overdue status with no date is overdue, not none', () {
      final ChecklistDue d = classify(null, status: ' Overdue ');
      expect(d.kind, ChecklistDueKind.overdue);
      expect(d.date, isNull);
      expect(d.isActionableNow, isTrue);
    });

    test('an overdue status wins over a future date', () {
      expect(
        classify('2026-10-05', status: 'overdue').kind,
        ChecklistDueKind.overdue,
      );
    });

    test('no due date and no overdue status is none', () {
      expect(classify(null).kind, ChecklistDueKind.none);
      expect(classify('   ').kind, ChecklistDueKind.none);
    });

    test('an unparseable value is kept verbatim, never guessed', () {
      final ChecklistDue d = classify('next week');
      expect(d.kind, ChecklistDueKind.unparsed);
      expect(d.raw, 'next week');
      expect(d.isActionableNow, isFalse);
    });

    test('the day before a DST change still reads tomorrow as tomorrow', () {
      // 25 Oct -> 26 Oct 2026 crosses the EU clock change; local midnights
      // may be 25 hours apart, which must not shift the day count.
      final ChecklistDue d = classifyChecklistDue(
        dueDate: '2026-10-26',
        status: null,
        now: DateTime(2026, 10, 25, 23, 50),
      );
      expect(d.kind, ChecklistDueKind.tomorrow);
      final ChecklistDue spring = classifyChecklistDue(
        dueDate: '2026-03-30',
        status: null,
        now: DateTime(2026, 3, 29, 0, 10),
      );
      expect(spring.kind, ChecklistDueKind.tomorrow);
    });
  });

  group('cadenceFor', () {
    test('maps min_interval_days to a cadence', () {
      expect(cadenceFor(null), ChecklistCadence.none);
      expect(cadenceFor(0), ChecklistCadence.none);
      expect(cadenceFor(-3), ChecklistCadence.none);
      expect(cadenceFor(1), ChecklistCadence.daily);
      expect(cadenceFor(7), ChecklistCadence.weekly);
      expect(cadenceFor(28), ChecklistCadence.monthly);
      expect(cadenceFor(31), ChecklistCadence.monthly);
      expect(cadenceFor(10), ChecklistCadence.everyNDays);
      expect(cadenceFor(32), ChecklistCadence.everyNDays);
    });
  });
}
