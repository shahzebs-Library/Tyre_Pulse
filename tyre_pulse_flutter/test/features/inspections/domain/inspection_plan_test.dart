/// Coverage for [InspectionPlan] - the parsing boundary between
/// `get_schedule_adherence` and the crew's own plan list.
///
/// The rules worth pinning here are the honesty ones. A state this build does
/// not recognise must stay visible and uninterpreted rather than defaulting to
/// something that reads as a judgement; a missed plan must keep counting as
/// outstanding after its day has passed; and the crew ordering must put the
/// work that is already late above the work that is merely next.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';

Map<String, dynamic> _row({
  String id = '11111111-1111-1111-1111-111111111111',
  String assetNo = 'TM514',
  String date = '2026-09-25',
  String state = 'Due',
  String? site = 'NHC',
  String? assignedTo = 'user-1',
  Object? daysLate = 0,
  String? matchedInspector,
  String? matchedDate,
}) {
  return <String, dynamic>{
    'id': id,
    'asset_no': assetNo,
    'scheduled_date': date,
    'plan_state': state,
    'site': site,
    'assigned_to': assignedTo,
    'days_late': daysLate,
    'matched_inspector': matchedInspector,
    'matched_date': matchedDate,
  };
}

void main() {
  group('InspectionPlanState.parse', () {
    test('reads every state the server sends, case-insensitively', () {
      expect(InspectionPlanState.parse('Missed'), InspectionPlanState.missed);
      expect(InspectionPlanState.parse('due'), InspectionPlanState.due);
      expect(InspectionPlanState.parse('STARTED'), InspectionPlanState.started);
      expect(
        InspectionPlanState.parse(' Upcoming '),
        InspectionPlanState.upcoming,
      );
      expect(InspectionPlanState.parse('Done'), InspectionPlanState.done);
      expect(
        InspectionPlanState.parse('Cancelled'),
        InspectionPlanState.cancelled,
      );
      // The American spelling is accepted because the app's own vocabulary
      // helpers already fold both.
      expect(
        InspectionPlanState.parse('canceled'),
        InspectionPlanState.cancelled,
      );
    });

    test('an unrecognised state is unknown, never a flattering default', () {
      // If the server grows a state an old build has not been taught, that row
      // must not be silently bucketed as Upcoming - the crew would read it as
      // "nothing to do yet".
      expect(
        InspectionPlanState.parse('SomethingNew'),
        InspectionPlanState.unknown,
      );
      expect(InspectionPlanState.parse(null), InspectionPlanState.unknown);
      expect(InspectionPlanState.parse(''), InspectionPlanState.unknown);
    });

    test('outstanding means work still to do, and missed still counts', () {
      // A plan does not stop needing doing because its day passed.
      expect(InspectionPlanState.missed.isOutstanding, isTrue);
      expect(InspectionPlanState.due.isOutstanding, isTrue);
      expect(InspectionPlanState.upcoming.isOutstanding, isFalse);
      expect(InspectionPlanState.done.isOutstanding, isFalse);
      expect(InspectionPlanState.cancelled.isOutstanding, isFalse);
      // Unknown is not claimed as outstanding - the badge must not assert a
      // meaning this build does not have.
      expect(InspectionPlanState.unknown.isOutstanding, isFalse);
    });
  });

  group('InspectionPlan.fromRow', () {
    test('parses a row and keeps the date day-only', () {
      final InspectionPlan plan = InspectionPlan.fromRow(_row());
      expect(plan.assetNo, 'TM514');
      expect(plan.scheduledDate, DateTime.utc(2026, 9, 25));
      expect(plan.state, InspectionPlanState.due);
      expect(plan.site, 'NHC');
    });

    test('blank text becomes null rather than an empty string', () {
      final InspectionPlan plan = InspectionPlan.fromRow(
        _row(site: '   '),
      );
      // An empty string would render as a stray separator in the subtitle.
      expect(plan.site, isNull);
    });

    test('days_late survives arriving as a string or a double', () {
      expect(InspectionPlan.fromRow(_row(daysLate: '7')).daysLate, 7);
      expect(InspectionPlan.fromRow(_row(daysLate: 7.0)).daysLate, 7);
      expect(InspectionPlan.fromRow(_row(daysLate: null)).daysLate, 0);
    });

    test('an unreadable date does not throw', () {
      // A plan with a broken date is still a plan the crew should see.
      final InspectionPlan plan = InspectionPlan.fromRow(
        _row(date: 'not a date'),
      );
      expect(plan.assetNo, 'TM514');
    });
  });

  group('coveredBySomeoneElse', () {
    test('true when a colleague did the work', () {
      final InspectionPlan plan = InspectionPlan.fromRow(
        _row(state: 'Done', matchedInspector: 'SALMAN AHMED'),
      );
      expect(plan.coveredBySomeoneElse('SAQUIB'), isTrue);
    });

    test('false for the same person, whatever the casing', () {
      final InspectionPlan plan = InspectionPlan.fromRow(
        _row(state: 'Done', matchedInspector: 'SAQUIB'),
      );
      expect(plan.coveredBySomeoneElse('saquib'), isFalse);
    });

    test('false when either name is missing - never guess', () {
      final InspectionPlan plan = InspectionPlan.fromRow(_row(state: 'Done'));
      expect(plan.coveredBySomeoneElse('SAQUIB'), isFalse);
      final InspectionPlan named = InspectionPlan.fromRow(
        _row(state: 'Done', matchedInspector: 'SALMAN AHMED'),
      );
      expect(named.coveredBySomeoneElse(null), isFalse);
    });
  });

  group('comparePlansForCrew', () {
    test('puts already-late work above work that is merely next', () {
      final List<InspectionPlan> plans = <InspectionPlan>[
        InspectionPlan.fromRow(_row(assetNo: 'B', state: 'Upcoming')),
        InspectionPlan.fromRow(_row(assetNo: 'C', state: 'Done')),
        InspectionPlan.fromRow(_row(assetNo: 'A', state: 'Missed')),
        InspectionPlan.fromRow(_row(assetNo: 'D', state: 'Due')),
      ]..sort(comparePlansForCrew);

      expect(
        plans.map((InspectionPlan p) => p.assetNo).toList(),
        <String>['A', 'D', 'B', 'C'],
      );
    });

    test('is stable for the same state and day, so rows do not jump', () {
      final List<InspectionPlan> plans = <InspectionPlan>[
        InspectionPlan.fromRow(_row(assetNo: 'TM900')),
        InspectionPlan.fromRow(_row(assetNo: 'TM100')),
      ]..sort(comparePlansForCrew);
      expect(plans.first.assetNo, 'TM100');
    });
  });

  group('groupPlansByDay', () {
    test('groups by day in date order', () {
      final Map<DateTime, List<InspectionPlan>> byDay = groupPlansByDay(
        <InspectionPlan>[
          InspectionPlan.fromRow(_row(assetNo: 'B', date: '2026-09-26')),
          InspectionPlan.fromRow(_row(assetNo: 'A', date: '2026-09-25')),
          InspectionPlan.fromRow(_row(assetNo: 'C', date: '2026-09-25')),
        ],
      );
      expect(byDay.keys.toList(), <DateTime>[
        DateTime.utc(2026, 9, 25),
        DateTime.utc(2026, 9, 26),
      ]);
      expect(byDay[DateTime.utc(2026, 9, 25)], hasLength(2));
    });
  });

  group('InspectionPlanSummary', () {
    test('counts each state and sums outstanding as missed plus due', () {
      final InspectionPlanSummary summary = InspectionPlanSummary.of(
        <InspectionPlan>[
          InspectionPlan.fromRow(_row(state: 'Missed')),
          InspectionPlan.fromRow(_row(state: 'Missed')),
          InspectionPlan.fromRow(_row(state: 'Due')),
          InspectionPlan.fromRow(_row(state: 'Upcoming')),
          InspectionPlan.fromRow(_row(state: 'Done')),
          InspectionPlan.fromRow(_row(state: 'Cancelled')),
        ],
      );
      expect(summary.total, 6);
      expect(summary.missed, 2);
      expect(summary.due, 1);
      expect(summary.upcoming, 1);
      expect(summary.done, 1);
      // Cancelled is counted in the total but is not work anybody must do.
      expect(summary.outstanding, 3);
    });

    test('an empty list is empty, not zeroed nonsense', () {
      final InspectionPlanSummary summary = InspectionPlanSummary.of(
        const <InspectionPlan>[],
      );
      expect(summary.isEmpty, isTrue);
      expect(summary.outstanding, 0);
    });
  });
}
