/// Pure page-boundary arithmetic for the tyre records register.
///
/// # Why this is its own file
///
/// PostgREST caps every response at 1000 rows regardless of `.limit()`, so
/// paging is done with `.range(from, to)`, and a `.range()` window that is
/// off by one either repeats a row across two pages or silently skips one.
/// That is exactly the class of defect artifact 01 (`docs/flutter-migration/
/// 01-feature-inventory.md`, section 5.19) records against this codebase's
/// history: "a WRONG ANSWER that looks right" - a fleet count that
/// under-counted every site rollup, a site-filter list that changed between
/// loads.
///
/// The actual Supabase query builder cannot be constructed or exercised in
/// this environment (no Flutter SDK or pub cache - see the note in
/// `../data/tyre_records_repository.dart`), so the one part of "does this
/// page correctly?" that CAN be proven with full confidence, independent of
/// any uncertainty about the exact `supabase_flutter` API surface, is kept
/// here as ordinary arithmetic and is exhaustively tested in isolation.
///
/// # What this does NOT prove
///
/// `.range()` alone is not sufficient for correctness - the query must also
/// be ordered on a column with a UNIQUE tiebreak, or two rows tied on the
/// primary sort key can land on either side of a page boundary in either
/// order. That half of the guarantee is a property of the ORDER BY the
/// repository issues (`issue_date` then `id`, `id` being the tyre record's
/// primary key and therefore globally unique - unlike `asset_no`, which
/// artifact 01 records is unique only per country), not of this arithmetic.
/// The controller-level paging test exercises that half by simulating tied
/// data across a page boundary.
library;

/// The exact page size the production register uses
/// (`mobile/app/(app)/records/index.tsx`, `const PAGE = 30`). Kept as one
/// named constant so the repository, the controller and every test agree
/// on it without re-typing the number.
const int kTyreRecordsPageSize = 30;

/// The inclusive `[from, to]` row window PostgREST's `.range()` expects for
/// [pageIndex], given [pageSize] rows per page.
///
/// `pageIndex` is zero-based, matching the production screen's own `page`
/// state. Throws [ArgumentError] for a negative page index or a non-positive
/// page size: both would silently produce a window that reads past data it
/// should not, and a range that never terminates is worse than a loud
/// refusal to compute one.
({int from, int to}) rangeForPage(
  int pageIndex, {
  int pageSize = kTyreRecordsPageSize,
}) {
  if (pageIndex < 0) {
    throw ArgumentError.value(pageIndex, 'pageIndex', 'must not be negative');
  }
  if (pageSize < 1) {
    throw ArgumentError.value(pageSize, 'pageSize', 'must be at least 1');
  }
  final int from = pageIndex * pageSize;
  final int to = from + pageSize - 1;
  return (from: from, to: to);
}
