/// Unit coverage for [nextWashDue] and [washDueList], ported test-case-for
/// -test-case from the intent of `mobile/lib/washSchedule.ts`: local-date
/// parsing/rejection, the one-entry-per-asset latest-wins reduction, the
/// `daysOverdue >= 0` inclusion boundary, and the sort order.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/washing/domain/wash_schedule.dart';

void main() {
  group('nextWashDue', () {
    test('adds the default interval to a valid date', () {
      expect(nextWashDue('2026-01-01'), '2026-01-08');
    });

    test('honours a custom interval', () {
      expect(nextWashDue('2026-01-01', intervalDays: 14), '2026-01-15');
    });

    test('crosses a month boundary correctly', () {
      expect(nextWashDue('2026-01-28'), '2026-02-04');
    });

    test('crosses a year boundary correctly', () {
      expect(nextWashDue('2025-12-29'), '2026-01-05');
    });

    test('returns null for a null date', () {
      expect(nextWashDue(null), isNull);
    });

    test('returns null for an empty string', () {
      expect(nextWashDue(''), isNull);
    });

    test('returns null for a malformed date', () {
      expect(nextWashDue('not-a-date'), isNull);
    });

    test('returns null for an impossible calendar date', () {
      // 2024-02-30 does not exist. The ported JS reference silently rolls
      // this into 2024-03-01; this port rejects it instead - see the
      // library comment on wash_schedule.dart for why.
      expect(nextWashDue('2024-02-30'), isNull);
    });

    test('accepts a longer ISO string by reading only its date prefix', () {
      expect(nextWashDue('2026-01-01T00:00:00.000Z'), '2026-01-08');
    });

    test('a non-positive interval falls back to the default', () {
      expect(nextWashDue('2026-01-01', intervalDays: 0), '2026-01-08');
      expect(nextWashDue('2026-01-01', intervalDays: -3), '2026-01-08');
    });
  });

  group('washDueList - date rejection', () {
    test('an empty or null list produces no due entries', () {
      expect(washDueList(null), isEmpty);
      expect(washDueList(const <WashHistoryRecord>[]), isEmpty);
    });

    test('a record with no asset number is skipped', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: '', washDate: '2026-01-01'),
          WashHistoryRecord(assetNo: null, washDate: '2026-01-01'),
        ],
        now: DateTime.utc(2026, 1, 20),
      );
      expect(due, isEmpty);
    });

    test('a record with an unparseable wash date is skipped', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: 'not-a-date'),
          WashHistoryRecord(assetNo: 'TM515', washDate: null),
        ],
        now: DateTime.utc(2026, 1, 20),
      );
      expect(due, isEmpty);
    });
  });

  group('washDueList - one entry per asset, latest wash wins', () {
    test('the most recent wash date is used, regardless of row order', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-01'),
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-10'),
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-05'),
        ],
        // 7-day default interval: last wash 01-10 -> due 01-17. "Now" is
        // 01-20, three days overdue against the LATEST wash. Using the
        // earliest (01-01) instead would show 12 days overdue.
        now: DateTime.utc(2026, 1, 20),
      );
      expect(due, hasLength(1));
      expect(due.single.lastWashDate, '2026-01-10');
      expect(due.single.daysOverdue, 3);
    });

    test('different assets are tracked independently', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-01'),
          WashHistoryRecord(assetNo: 'TM515', washDate: '2026-01-15'),
        ],
        now: DateTime.utc(2026, 1, 20),
      );
      expect(
        due.map((WashDueEntry e) => e.assetNo),
        <String>['TM514', 'TM515'],
      );
    });
  });

  group('washDueList - the daysOverdue >= 0 inclusion boundary', () {
    test('exactly on the due date is included at 0 days overdue', () {
      // Last wash 01-01 + 7 days = due 01-08. "Now" is exactly 01-08.
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-01'),
        ],
        now: DateTime.utc(2026, 1, 8),
      );
      expect(due, hasLength(1));
      expect(due.single.daysOverdue, 0);
      expect(due.single.nextDueDate, '2026-01-08');
    });

    test('one day before the due date is excluded entirely', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-01'),
        ],
        now: DateTime.utc(2026, 1, 7),
      );
      expect(due, isEmpty);
    });

    test('one day past the due date is included at 1 day overdue', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-01'),
        ],
        now: DateTime.utc(2026, 1, 9),
      );
      expect(due, hasLength(1));
      expect(due.single.daysOverdue, 1);
    });

    test('a custom interval shifts the boundary accordingly', () {
      final List<WashDueEntry> notYet = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-01'),
        ],
        intervalDays: 14,
        now: DateTime.utc(2026, 1, 8),
      );
      expect(notYet, isEmpty);

      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-01'),
        ],
        intervalDays: 14,
        now: DateTime.utc(2026, 1, 15),
      );
      expect(due, hasLength(1));
      expect(due.single.daysOverdue, 0);
    });
  });

  group('washDueList - sort order', () {
    test('most overdue first', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          // Due 01-17, 3 days overdue as of 01-20.
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-10'),
          // Due 01-08, 12 days overdue as of 01-20.
          WashHistoryRecord(assetNo: 'TM515', washDate: '2026-01-01'),
          // Due 01-22 - not yet due as of 01-20, so excluded entirely.
          WashHistoryRecord(assetNo: 'TM516', washDate: '2026-01-15'),
        ],
        now: DateTime.utc(2026, 1, 20),
      );
      expect(
        due.map((WashDueEntry e) => e.assetNo),
        <String>['TM515', 'TM514'],
      );
      expect(due.map((WashDueEntry e) => e.daysOverdue), <int>[12, 3]);
    });

    test('a tie on days overdue breaks by asset number ascending', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM520', washDate: '2026-01-01'),
          WashHistoryRecord(assetNo: 'TM501', washDate: '2026-01-01'),
          WashHistoryRecord(assetNo: 'TM510', washDate: '2026-01-01'),
        ],
        now: DateTime.utc(2026, 1, 20),
      );
      expect(
        due.map((WashDueEntry e) => e.assetNo),
        <String>['TM501', 'TM510', 'TM520'],
      );
    });
  });

  group('washDueList - carries through site and vehicle type', () {
    test('site and vehicle type from the winning row are preserved', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(
            assetNo: 'TM514',
            washDate: '2026-01-01',
            site: 'NHC',
            vehicleType: 'TR-MIXER',
          ),
        ],
        now: DateTime.utc(2026, 1, 20),
      );
      expect(due.single.site, 'NHC');
      expect(due.single.vehicleType, 'TR-MIXER');
    });

    test('a missing site or vehicle type stays null, never fabricated', () {
      final List<WashDueEntry> due = washDueList(
        const <WashHistoryRecord>[
          WashHistoryRecord(assetNo: 'TM514', washDate: '2026-01-01'),
        ],
        now: DateTime.utc(2026, 1, 20),
      );
      expect(due.single.site, isNull);
      expect(due.single.vehicleType, isNull);
    });
  });

  group('WashHistoryRecord and WashDueEntry value semantics', () {
    test('WashHistoryRecord equality is field-based', () {
      const WashHistoryRecord a = WashHistoryRecord(
        assetNo: 'TM514',
        washDate: '2026-01-01',
        site: 'NHC',
        vehicleType: 'TR-MIXER',
      );
      const WashHistoryRecord b = WashHistoryRecord(
        assetNo: 'TM514',
        washDate: '2026-01-01',
        site: 'NHC',
        vehicleType: 'TR-MIXER',
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('WashDueEntry equality is field-based', () {
      const WashDueEntry a = WashDueEntry(
        assetNo: 'TM514',
        lastWashDate: '2026-01-01',
        nextDueDate: '2026-01-08',
        daysOverdue: 3,
      );
      const WashDueEntry b = WashDueEntry(
        assetNo: 'TM514',
        lastWashDate: '2026-01-01',
        nextDueDate: '2026-01-08',
        daysOverdue: 3,
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });
  });
}
