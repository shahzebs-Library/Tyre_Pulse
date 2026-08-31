import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/domain/approval_date_grouping.dart';

InspectionApprovalItem _item(String id, String? createdAt) =>
    InspectionApprovalItem(id: id, createdAt: createdAt);

void main() {
  final DateTime now = DateTime(2026, 8, 30, 16);

  group('groupApprovalsByDate', () {
    test('splits today, yesterday and an older date into their own groups', () {
      final List<ApprovalDateGroup> groups = groupApprovalsByDate(
        <InspectionApprovalItem>[
          _item('a', '2026-08-30T09:00:00.000Z'),
          _item('b', '2026-08-30T07:00:00.000Z'),
          _item('c', '2026-08-29T20:00:00.000Z'),
          _item('d', '2026-07-20T10:00:00.000Z'),
        ],
        now: now,
        todayLabel: 'Today',
        yesterdayLabel: 'Yesterday',
        unknownLabel: 'Unknown',
      );

      expect(groups, hasLength(3));
      expect(groups[0].label, 'Today');
      expect(groups[0].items.map((InspectionApprovalItem i) => i.id), <String>[
        'a',
        'b',
      ]);
      expect(groups[1].label, 'Yesterday');
      expect(groups[1].items.map((InspectionApprovalItem i) => i.id), <String>[
        'c',
      ]);
      expect(groups[2].label, '2026-07-20');
      expect(groups[2].items.map((InspectionApprovalItem i) => i.id), <String>[
        'd',
      ]);
    });

    test('an unparsable or missing createdAt groups under unknownLabel', () {
      final List<ApprovalDateGroup> groups = groupApprovalsByDate(
        <InspectionApprovalItem>[
          _item('a', null),
          _item('b', 'not-a-date'),
          _item('c', '2026-08-30T09:00:00.000Z'),
        ],
        now: now,
        todayLabel: 'Today',
        yesterdayLabel: 'Yesterday',
        unknownLabel: 'Unknown',
      );

      expect(groups, hasLength(2));
      expect(groups[0].label, 'Unknown');
      expect(groups[0].items, hasLength(2));
      expect(groups[1].label, 'Today');
    });

    test('an empty list produces no groups', () {
      expect(
        groupApprovalsByDate(
          const <InspectionApprovalItem>[],
          now: now,
          todayLabel: 'Today',
          yesterdayLabel: 'Yesterday',
          unknownLabel: 'Unknown',
        ),
        isEmpty,
      );
    });

    test('does not merge two non-adjacent runs sharing the same label', () {
      // Newest-first input where "today" appears, then an older date, then
      // today again (a clock skew or backfilled row) - each contiguous run
      // must stay its own section rather than one group silently absorbing
      // items that are not actually adjacent in the sorted list.
      final List<ApprovalDateGroup> groups = groupApprovalsByDate(
        <InspectionApprovalItem>[
          _item('a', '2026-08-30T09:00:00.000Z'),
          _item('b', '2026-07-01T09:00:00.000Z'),
          _item('c', '2026-08-30T08:00:00.000Z'),
        ],
        now: now,
        todayLabel: 'Today',
        yesterdayLabel: 'Yesterday',
        unknownLabel: 'Unknown',
      );

      expect(groups.map((ApprovalDateGroup g) => g.label), <String>[
        'Today',
        '2026-07-01',
        'Today',
      ]);
    });

    test(
      'midnight boundary: 00:00 local today is Today, 23:59 local '
      'yesterday is Yesterday',
      () {
      final DateTime justAfterMidnightToday =
          DateTime(now.year, now.month, now.day, 0, 0, 1);
      final DateTime justBeforeMidnightYesterday = DateTime(
        now.year,
        now.month,
        now.day - 1,
        23,
        59,
      );
      final List<ApprovalDateGroup> groups = groupApprovalsByDate(
        <InspectionApprovalItem>[
          _item('a', justAfterMidnightToday.toUtc().toIso8601String()),
          _item('b', justBeforeMidnightYesterday.toUtc().toIso8601String()),
        ],
        now: now,
        todayLabel: 'Today',
        yesterdayLabel: 'Yesterday',
        unknownLabel: 'Unknown',
      );

      expect(groups.map((ApprovalDateGroup g) => g.label), <String>[
        'Today',
        'Yesterday',
      ]);
    });
  });
}
