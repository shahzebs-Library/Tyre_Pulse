/// Pure page-boundary arithmetic, exhaustively checked.
///
/// This is the ONE piece of "does paging work" that this delivery can prove
/// with full certainty, independent of the `supabase_flutter` API surface
/// this environment cannot verify against an installed SDK - see
/// `lib/features/records/data/tyre_records_repository.dart`'s library
/// comment.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/records/domain/tyre_records_paging.dart';

void main() {
  group('kTyreRecordsPageSize', () {
    test('is exactly 30, matching the production register', () {
      // mobile/app/(app)/records/index.tsx: `const PAGE = 30`. Confirmed
      // independently by docs/flutter-migration/01-feature-inventory.md
      // section 2.5 ("Paged tyre list (30/page)").
      expect(kTyreRecordsPageSize, 30);
    });
  });

  group('rangeForPage', () {
    test('page zero starts at row zero', () {
      expect(rangeForPage(0), (from: 0, to: 29));
    });

    test('page one starts immediately after page zero ends', () {
      expect(rangeForPage(1), (from: 30, to: 59));
    });

    test('page two continues the same pattern', () {
      expect(rangeForPage(2), (from: 60, to: 89));
    });

    test('adjacent pages never overlap and never leave a gap', () {
      // The property that actually matters: for every consecutive pair of
      // pages, the next page's `from` is exactly one past the previous
      // page's `to`. An off-by-one here is precisely what repeats or
      // drops a row across the boundary.
      for (int page = 0; page < 50; page++) {
        final ({int from, int to}) current = rangeForPage(page);
        final ({int from, int to}) next = rangeForPage(page + 1);
        expect(
          next.from,
          current.to + 1,
          reason: 'page $page ends at ${current.to}, '
              'page ${page + 1} must start at ${current.to + 1}',
        );
      }
    });

    test('every page window is exactly kTyreRecordsPageSize rows wide', () {
      for (int page = 0; page < 20; page++) {
        final ({int from, int to}) range = rangeForPage(page);
        expect(range.to - range.from + 1, kTyreRecordsPageSize);
      }
    });

    test('honours an explicit pageSize', () {
      expect(rangeForPage(0, pageSize: 10), (from: 0, to: 9));
      expect(rangeForPage(1, pageSize: 10), (from: 10, to: 19));
      expect(rangeForPage(3, pageSize: 7), (from: 21, to: 27));
    });

    test('pageSize of 1 still tiles without overlap or gap', () {
      expect(rangeForPage(0, pageSize: 1), (from: 0, to: 0));
      expect(rangeForPage(1, pageSize: 1), (from: 1, to: 1));
      expect(rangeForPage(5, pageSize: 1), (from: 5, to: 5));
    });

    test('refuses a negative page index rather than computing a negative '
        'range', () {
      expect(() => rangeForPage(-1), throwsArgumentError);
    });

    test('refuses a non-positive page size', () {
      expect(() => rangeForPage(0, pageSize: 0), throwsArgumentError);
      expect(() => rangeForPage(0, pageSize: -5), throwsArgumentError);
    });
  });
}
