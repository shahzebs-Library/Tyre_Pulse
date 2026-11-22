/// Stock transfers between locations, as the phone sees them.
///
/// docs/inventory/07: `stock_transfers` + `stock_transfer_lines`, statuses
/// dispatched | in_transit | partially_received | completed | cancelled, and
/// the only writers are `inv_transfer_dispatch` / `inv_transfer_receive`.
/// Physical stock never goes negative on the server; the phone never computes
/// a balance, it only reports what was sent and what arrived.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

num? _num(Object? value) =>
    value is num ? value : num.tryParse(_text(value) ?? '');

@immutable
final class StockTransferLine {
  const StockTransferLine({
    required this.id,
    this.itemId,
    this.itemCode,
    this.description,
    this.serialNo,
    this.qtyDispatched,
    this.qtyReceived,
  });

  factory StockTransferLine.fromJson(Map<String, Object?> json) =>
      StockTransferLine(
        id: _text(json['id']) ?? '',
        itemId: _text(json['item_id']),
        itemCode: _text(json['item_code']) ?? _embedded(json, 'item_code'),
        description: _text(json['description']) ?? _embedded(json, 'item_name'),
        serialNo: _text(json['serial_no']),
        qtyDispatched: _num(json['qty_dispatched'] ?? json['qty']),
        qtyReceived: _num(json['qty_received']),
      );

  final String id;
  final String? itemId;
  final String? itemCode;
  final String? description;
  final String? serialNo;
  final num? qtyDispatched;
  final num? qtyReceived;

  String get display => description ?? itemCode ?? serialNo ?? itemId ?? id;

  /// What is still to arrive. Null when the dispatched quantity is unknown.
  num? get outstanding {
    if (qtyDispatched == null) return null;
    final num left = qtyDispatched! - (qtyReceived ?? 0);
    return left < 0 ? 0 : left;
  }
}

@immutable
final class StockTransfer {
  const StockTransfer({
    required this.id,
    this.reference,
    this.status,
    this.fromLabel,
    this.toLabel,
    this.dispatchedAt,
    this.lines = const <StockTransferLine>[],
  });

  factory StockTransfer.fromJson(Map<String, Object?> json) {
    final Object? lines = json['stock_transfer_lines'] ?? json['lines'];
    return StockTransfer(
      id: _text(json['id']) ?? '',
      reference: _text(json['ref'] ?? json['transfer_no'] ?? json['reference']),
      status: _text(json['status']),
      fromLabel: _text(
        json['from_location_code'] ??
            json['from_site'] ??
            json['from_location_id'],
      ),
      toLabel: _text(
        json['to_location_code'] ?? json['to_site'] ?? json['to_location_id'],
      ),
      dispatchedAt: DateTime.tryParse(_text(json['dispatched_at']) ?? ''),
      lines: <StockTransferLine>[
        if (lines is List)
          for (final Object? row in lines)
            if (row is Map)
              StockTransferLine.fromJson(Map<String, Object?>.from(row)),
      ],
    );
  }

  final String id;
  final String? reference;
  final String? status;
  final String? fromLabel;
  final String? toLabel;
  final DateTime? dispatchedAt;
  final List<StockTransferLine> lines;

  bool get awaitingReceipt => const <String>{
        'dispatched',
        'in_transit',
        'partially_received',
      }.contains(status);
}

/// One line the dispatcher adds by scanning.
@immutable
final class DispatchLineDraft {
  const DispatchLineDraft({required this.code, this.qty = 1});

  final String code;
  final num qty;

  DispatchLineDraft withQty(num value) =>
      DispatchLineDraft(code: code, qty: value);
}

/// What the receiver reports for one transfer line.
@immutable
final class ReceiveLineDraft {
  const ReceiveLineDraft({
    required this.lineId,
    required this.receivedQty,
    this.condition = CountCondition.good,
    this.remarks,
  });

  final String lineId;
  final num receivedQty;
  final CountCondition condition;
  final String? remarks;

  Map<String, Object?> toJson() => <String, Object?>{
        'line_id': lineId,
        'received_qty': receivedQty,
        'condition': condition.wire,
        'remarks': (remarks ?? '').trim().isEmpty ? null : remarks!.trim(),
      };
}

/// Validates a dispatch before it is sent. Returns a copy key for the
/// problem, or null when it can be sent.
String? dispatchProblem({
  required String? fromLocationId,
  required String? toLocationId,
  required List<DispatchLineDraft> lines,
}) {
  if (fromLocationId == null) return 'needFrom';
  if (toLocationId == null) return 'needTo';
  if (fromLocationId == toLocationId) return 'sameLocation';
  if (lines.isEmpty) return 'needLines';
  if (lines.any((DispatchLineDraft l) => l.qty <= 0)) return 'invalidQty';
  return null;
}

/// Validates a receipt. A received quantity above what is outstanding is a
/// receiving discrepancy the server records, but the phone refuses negatives.
String? receiveProblem(List<ReceiveLineDraft> lines) {
  if (lines.isEmpty) return 'needLines';
  if (lines.any((ReceiveLineDraft l) => l.receivedQty < 0)) {
    return 'invalidQty';
  }
  return null;
}

/// A value from the `itm` item-master embed of a transfer line.
String? _embedded(Map<String, Object?> json, String key) {
  final Object? itm = json['itm'];
  return itm is Map ? _text(itm[key]) : null;
}
