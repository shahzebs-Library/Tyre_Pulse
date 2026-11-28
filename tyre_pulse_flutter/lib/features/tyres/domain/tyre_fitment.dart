library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

/// One real `tyre_records` lifecycle row currently fitted to an asset.
@immutable
class TyreFitment {
  const TyreFitment({
    required this.id,
    required this.serialNo,
    required this.positionCode,
    this.brand,
    this.size,
    this.assetNo,
    this.status,
    this.issueDate,
    this.kmAtFitment,
  });

  factory TyreFitment.fromRow(Map<String, Object?> row) {
    final String id = _text(row['id']) ?? '';
    if (id.isEmpty) {
      throw const FormatException('tyre_records fitment row has no id');
    }
    return TyreFitment(
      id: id,
      serialNo: _text(row['serial_no']) ??
          _text(row['serial_number']) ??
          _text(row['tyre_serial']),
      positionCode: _text(row['tyre_position']) ?? _text(row['position']),
      brand: _text(row['brand']),
      size: _text(row['size']),
      assetNo: _text(row['asset_no']),
      status: _text(row['status']),
      issueDate: DateTime.tryParse(_text(row['issue_date']) ?? ''),
      kmAtFitment: _number(row['km_at_fitment']),
    );
  }

  final String id;
  final String? serialNo;
  final String? positionCode;
  final String? brand;
  final String? size;
  final String? assetNo;
  final String? status;
  final DateTime? issueDate;

  /// The vehicle's odometer when this tyre was fitted (`km_at_fitment`),
  /// exactly as recorded. Null when the register does not carry it.
  final double? kmAtFitment;
}

/// Maps V2 `tyre_records` position codes onto the V1 inspection slots without
/// ever rewriting either stored value. Newest duplicate wins deterministically.
Map<String, TyreFitment> fitmentsByInspectionSlot({
  required String vehicleType,
  required String assetNo,
  required Iterable<TyreFitment> fitments,
}) {
  final String layoutKey = resolveVehicleType(vehicleType, assetNo);
  final Map<String, String> slotByCode = <String, String>{
    for (final String slot in diagramPositions(vehicleType, assetNo))
      keyOf(legacyPositionCode(layoutKey, slot)): slot,
  };
  final List<TyreFitment> ordered = fitments.toList()
    ..sort((a, b) {
      final int byDate =
          (a.issueDate ?? DateTime(0)).compareTo(b.issueDate ?? DateTime(0));
      return byDate != 0 ? byDate : a.id.compareTo(b.id);
    });
  final Map<String, TyreFitment> result = <String, TyreFitment>{};
  for (final TyreFitment fitment in ordered) {
    final String? code = fitment.positionCode;
    if (code == null) continue;
    // The shown code first, then a spelling the shared tyre map confirms for
    // that wheel (the concrete pump's LHCO / LHR1-O records).
    final String? slot =
        slotByCode[keyOf(code)] ?? slotForStoredPosition(layoutKey, code);
    if (slot != null) result[slot] = fitment;
  }
  return Map<String, TyreFitment>.unmodifiable(result);
}

double? _number(Object? raw) {
  if (raw is num) return raw.toDouble();
  return double.tryParse(_text(raw) ?? '');
}

String? _text(Object? raw) {
  if (raw == null) return null;
  final String text = raw.toString().trim();
  return text.isEmpty ? null : text;
}
