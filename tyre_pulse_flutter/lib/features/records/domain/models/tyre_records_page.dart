/// One page of the tyre records register.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';

@immutable
final class TyreRecordsPage {
  const TyreRecordsPage({required this.items, required this.hasMore});

  /// An empty, exhausted page. Useful as a safe starting value and in tests.
  static const TyreRecordsPage empty =
      TyreRecordsPage(items: <TyreRecord>[], hasMore: false);

  final List<TyreRecord> items;

  /// Whether another page might exist beyond this one.
  ///
  /// Derived by the repository from whether THIS page came back full
  /// (`items.length == pageSize`), never from a separate total-row count.
  /// That is deliberately the same signal the production screen uses
  /// (`setHasMore(rows.length === PAGE)`) and it degrades correctly on its
  /// own: a full final page reports `hasMore: true`, the next fetch returns
  /// zero rows, and [hasMore] becomes false then. The one-page delay this
  /// causes is a fetch that returns nothing, never a fetch that is skipped
  /// when it should not have been.
  final bool hasMore;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TyreRecordsPage &&
          other.hasMore == hasMore &&
          _sameItems(other.items, items);

  @override
  int get hashCode => Object.hash(hasMore, items.length);

  @override
  String toString() =>
      'TyreRecordsPage(${items.length} items, hasMore: $hasMore)';
}

bool _sameItems(List<TyreRecord> a, List<TyreRecord> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
