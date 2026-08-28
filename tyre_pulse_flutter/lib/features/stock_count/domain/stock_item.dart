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
  });

  final String id;
  final String? site;
  final String? description;
  final num quantity;
  final num minimum;
  final num critical;
  final String? status;
  final DateTime? updatedAt;

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
      );
}

String stockStatus(num quantity, num minimum, num critical) {
  if (quantity <= critical) return 'Critical';
  if (quantity <= minimum) return 'Low';
  return 'OK';
}
