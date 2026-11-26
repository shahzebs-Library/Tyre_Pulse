/// One row of the stock ledger (`stock_movements`) as the store keeper reads
/// it, plus the pure rules the history screens use: which kind of movement a
/// row is, what the balance was after it, and the in / out / net totals for a
/// period.
///
/// Read only. The ledger is append-only and written by the `inv_*` RPCs and
/// `post_stock_movement` on the server; nothing here decides a balance, it
/// only explains the one the server recorded.
library;

import 'package:flutter/foundation.dart';

/// What a movement was, in the store keeper's words. Derived from the
/// ledger's own `movement_type` and `source_doc_type`, mirroring the server's
/// `inv_movement_kind()`.
enum MovementCategory {
  receipt,
  issue,
  returned,
  transfer,
  adjustment,
  count,
  opening,
  erpLedger,
  other,
}

/// Filter values offered by the history screen. [all] means no type filter.
enum MovementTypeFilter {
  all,
  receipt,
  issue,
  returned,
  transfer,
  adjustment,
  erpLedger
}

/// The ledger `movement_type` values a [MovementTypeFilter] covers, or null
/// for [MovementTypeFilter.all] / [MovementTypeFilter.erpLedger] (the ERP
/// filter is on `source_doc_type`, not the type).
List<String>? movementTypesFor(MovementTypeFilter filter) => switch (filter) {
      MovementTypeFilter.all => null,
      MovementTypeFilter.erpLedger => null,
      MovementTypeFilter.receipt => const <String>[
          'receipt',
          'consignment_receipt',
          'in',
          'initial',
        ],
      MovementTypeFilter.issue => const <String>['issue', 'out', 'scrap'],
      MovementTypeFilter.returned => const <String>[
          'return',
          'issue_return',
          'supplier_return',
        ],
      MovementTypeFilter.transfer => const <String>[
          'transfer_in',
          'transfer_out',
        ],
      MovementTypeFilter.adjustment => const <String>[
          'adjustment_up',
          'adjustment_down',
          'adjustment',
          'stocktake',
          'reversal',
        ],
    };

MovementCategory movementCategoryFor(String? type, String? sourceDocType) {
  final String source = (sourceDocType ?? '').trim().toLowerCase();
  if (source == 'erp_ledger') return MovementCategory.erpLedger;
  return switch ((type ?? '').trim().toLowerCase()) {
    'receipt' ||
    'consignment_receipt' ||
    'in' ||
    'initial' =>
      MovementCategory.receipt,
    'issue' || 'out' || 'scrap' => MovementCategory.issue,
    'return' ||
    'issue_return' ||
    'supplier_return' =>
      MovementCategory.returned,
    'transfer_in' || 'transfer_out' => MovementCategory.transfer,
    'adjustment_up' ||
    'adjustment_down' ||
    'adjustment' ||
    'reversal' =>
      MovementCategory.adjustment,
    'stocktake' => MovementCategory.count,
    'opening' => MovementCategory.opening,
    _ => MovementCategory.other,
  };
}

@immutable
final class StockMovement {
  const StockMovement({
    required this.id,
    required this.type,
    required this.change,
    this.stockId,
    this.site,
    this.description,
    this.sourceDocType,
    this.before,
    this.after,
    this.reason,
    this.reference,
    this.at,
    this.actorId,
    this.actorName,
  });

  factory StockMovement.fromRow(Map<String, dynamic> row) {
    final num change = _number(row['qty_change']) ?? 0;
    return StockMovement(
      id: _text(row['id']) ?? '',
      stockId: _text(row['stock_id']),
      site: _text(row['site']),
      description: _text(row['description']),
      type: _text(row['movement_type']) ?? '',
      sourceDocType: _text(row['source_doc_type']),
      change: change,
      before: _number(row['qty_before']),
      after: _number(row['qty_after']),
      reason: _text(row['reason']),
      reference: _text(row['reference_no']) ?? _text(row['source_doc_id']),
      at: _date(row['effective_at']) ??
          _date(row['posted_at']) ??
          _date(row['created_at']),
      actorId: _text(row['actor_id']) ?? _text(row['created_by']),
    );
  }

  final String id;
  final String? stockId;
  final String? site;
  final String? description;
  final String type;
  final String? sourceDocType;

  /// Signed quantity change: positive into the store, negative out of it.
  final num change;
  final num? before;
  final num? after;
  final String? reason;

  /// GRN, issue number, job card or transfer number, whichever the posting
  /// carried.
  final String? reference;

  /// When the movement took effect (`effective_at`, else `posted_at`, else
  /// `created_at`).
  final DateTime? at;
  final String? actorId;
  final String? actorName;

  MovementCategory get category => movementCategoryFor(type, sourceDocType);

  StockMovement withActorName(String? name) => StockMovement(
        id: id,
        stockId: stockId,
        site: site,
        description: description,
        type: type,
        sourceDocType: sourceDocType,
        change: change,
        before: before,
        after: after,
        reason: reason,
        reference: reference,
        at: at,
        actorId: actorId,
        actorName: name,
      );
}

/// The balance after each movement, newest first, aligned with [movements].
///
/// The ledger's own `qty_after` wins. Without it, `qty_before + qty_change`.
/// Without either, the balance is walked back from the one before it (the
/// newer row), starting from [currentQuantity] — valid only when [movements]
/// is one item's complete, newest-first, unfiltered run; the caller passes
/// [currentQuantity] only then. A value that cannot be known stays null:
/// a guessed running balance is worse than a blank one.
List<num?> resolveBalances(
  List<StockMovement> movements, {
  num? currentQuantity,
}) {
  final List<num?> out = List<num?>.filled(movements.length, null);
  num? newerBalance;
  StockMovement? newer;
  for (int i = 0; i < movements.length; i++) {
    final StockMovement m = movements[i];
    num? value = m.after;
    value ??= m.before == null ? null : m.before! + m.change;
    if (value == null) {
      if (i == 0) {
        value = currentQuantity;
      } else if (newerBalance != null && newer != null) {
        value = newerBalance - newer.change;
      }
    }
    out[i] = value;
    newerBalance = value;
    newer = m;
  }
  return out;
}

@immutable
final class MovementTotals {
  const MovementTotals({
    this.stockIn = 0,
    this.stockOut = 0,
    this.movements = 0,
    this.openings = 0,
  });

  /// Quantity into the store (receipts, returns, transfers in, upward
  /// corrections and ERP postings that added stock).
  final num stockIn;

  /// Quantity out of the store, as a positive number.
  final num stockOut;
  final int movements;

  /// Opening balances are not counted in or out: they establish a balance,
  /// they did not move stock. Reported so the totals can say so.
  final int openings;

  num get net => stockIn - stockOut;

  MovementTotals operator +(MovementTotals other) => MovementTotals(
        stockIn: stockIn + other.stockIn,
        stockOut: stockOut + other.stockOut,
        movements: movements + other.movements,
        openings: openings + other.openings,
      );
}

@immutable
final class PeriodTotals {
  const PeriodTotals({required this.month, required this.totals});

  /// First day of the month, local time.
  final DateTime month;
  final MovementTotals totals;
}

@immutable
final class MovementSummary {
  const MovementSummary({required this.total, required this.byMonth});
  final MovementTotals total;

  /// Newest month first.
  final List<PeriodTotals> byMonth;
}

MovementTotals totalsOf(StockMovement m) {
  if (m.category == MovementCategory.opening) {
    return const MovementTotals(openings: 1);
  }
  if (m.change > 0) return MovementTotals(stockIn: m.change, movements: 1);
  if (m.change < 0) return MovementTotals(stockOut: -m.change, movements: 1);
  return const MovementTotals(movements: 1);
}

/// In / out / net for [movements], overall and per calendar month. Rows with
/// no date count in the total and are left out of the monthly split.
MovementSummary summarizeMovements(Iterable<StockMovement> movements) {
  MovementTotals total = const MovementTotals();
  final Map<DateTime, MovementTotals> months = <DateTime, MovementTotals>{};
  for (final StockMovement m in movements) {
    final MovementTotals t = totalsOf(m);
    total = total + t;
    final DateTime? at = m.at?.toLocal();
    if (at == null) continue;
    final DateTime key = DateTime(at.year, at.month);
    months[key] = (months[key] ?? const MovementTotals()) + t;
  }
  final List<DateTime> keys = months.keys.toList()
    ..sort((DateTime a, DateTime b) => b.compareTo(a));
  return MovementSummary(
    total: total,
    byMonth: <PeriodTotals>[
      for (final DateTime k in keys) PeriodTotals(month: k, totals: months[k]!),
    ],
  );
}

/// Filters for the store history screen and the item detail list.
@immutable
final class StockHistoryQuery {
  const StockHistoryQuery({
    this.stockId,
    this.site,
    this.search,
    this.type = MovementTypeFilter.all,
    this.from,
    this.to,
    this.country,
  });

  final String? stockId;
  final String? site;
  final String? search;
  final MovementTypeFilter type;

  /// Inclusive local dates; [to] covers the whole day.
  final DateTime? from;
  final DateTime? to;
  final String? country;

  /// True when only one item is asked for, with no narrowing filter, so the
  /// list is that item's contiguous ledger and a running balance can be
  /// walked back from the current quantity.
  bool get isContiguousItemRun =>
      stockId != null &&
      type == MovementTypeFilter.all &&
      from == null &&
      to == null &&
      (search ?? '').trim().isEmpty;

  StockHistoryQuery copyWith({
    String? site,
    String? search,
    MovementTypeFilter? type,
    DateTime? from,
    DateTime? to,
    bool clearSite = false,
    bool clearDates = false,
  }) =>
      StockHistoryQuery(
        stockId: stockId,
        site: clearSite ? null : (site ?? this.site),
        search: search ?? this.search,
        type: type ?? this.type,
        from: clearDates ? null : (from ?? this.from),
        to: clearDates ? null : (to ?? this.to),
        country: country,
      );

  @override
  bool operator ==(Object other) =>
      other is StockHistoryQuery &&
      other.stockId == stockId &&
      other.site == site &&
      other.search == search &&
      other.type == type &&
      other.from == from &&
      other.to == to &&
      other.country == country;

  @override
  int get hashCode =>
      Object.hash(stockId, site, search, type, from, to, country);
}

/// Escapes `%`, `_` and `\` so a typed search cannot turn into a wildcard
/// scan.
String escapeLike(String value) =>
    value.replaceAll(r'\', r'\\').replaceAll('%', r'\%').replaceAll('_', r'\_');

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

num? _number(Object? value) =>
    value is num ? value : num.tryParse(_text(value) ?? '');

DateTime? _date(Object? value) => DateTime.tryParse(_text(value) ?? '');
