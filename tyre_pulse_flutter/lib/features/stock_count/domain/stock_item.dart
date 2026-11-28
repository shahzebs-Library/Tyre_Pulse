library;

import 'package:flutter/foundation.dart';

@immutable
final class StockItem {
  const StockItem({
    required this.id,
    this.site,
    this.description,
    this.quantity = 0,
    this.minimum = 0,
    this.critical = 0,
    this.status,
    this.updatedAt,
    this.country,
    this.itemId,
    this.locationId,
    this.reserved,
    this.condition,
    this.ownership,
    this.uom,
    this.locationCode,
    this.itemCode,
  });

  final String id;
  final String? site;
  final String? description;
  final num quantity;
  final num minimum;
  final num critical;
  final String? status;
  final DateTime? updatedAt;

  /// Where and what the line is, so a physical count can be recorded against
  /// it (`inv_pi_capture`) and stock issued from it (`inv_issue`).
  final String? country;
  final String? itemId;
  final String? locationId;

  /// Held for job cards (`qty_reserved`); null when not read.
  final num? reserved;
  final String? condition;
  final String? ownership;

  /// What tells two lines with the same description apart on the shelf:
  /// the unit, the store location (bin) code and the ERP item code. Read
  /// through the `location_id` / `item_id` foreign keys; null when unknown.
  final String? uom;
  final String? locationCode;
  final String? itemCode;

  /// On hand minus reserved, never below zero. A hint for the issue form;
  /// the server decides with the live balance.
  num get available {
    final num free = quantity - (reserved ?? 0);
    return free < 0 ? 0 : free;
  }

  bool get needsReorder => quantity <= minimum;

  bool countedToday(DateTime now) {
    final DateTime? value = updatedAt?.toLocal();
    return value != null &&
        value.year == now.year &&
        value.month == now.month &&
        value.day == now.day;
  }

  StockItem counted(num value, DateTime now) => StockItem(
        id: id,
        site: site,
        description: description,
        quantity: value.floor(),
        minimum: minimum,
        critical: critical,
        status: stockStatus(value.floor(), minimum, critical),
        updatedAt: now,
        country: country,
        itemId: itemId,
        locationId: locationId,
        reserved: reserved,
        condition: condition,
        ownership: ownership,
        uom: uom,
        locationCode: locationCode,
        itemCode: itemCode,
      );
}

String stockStatus(num quantity, num minimum, num critical) {
  if (quantity <= critical) return 'Critical';
  if (quantity <= minimum) return 'Low';
  return 'OK';
}
