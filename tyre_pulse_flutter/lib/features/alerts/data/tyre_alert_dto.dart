/// Verified `tyre_records` projection used by the Alerts feature.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';

final class TyreAlertDto {
  const TyreAlertDto({
    required this.id,
    required this.riskLevel,
    this.assetNo,
    this.site,
    this.brand,
    this.position,
    this.serialNo,
    this.treadDepthMm,
    this.issueDate,
  });

  factory TyreAlertDto.fromRow(Map<String, dynamic> row) {
    final String id = _text(row['id']) ?? '';
    final String risk = _text(row['risk_level']) ?? '';
    if (id.isEmpty || (risk != 'Critical' && risk != 'High')) {
      throw AppError(
        kind: AppErrorKind.validation,
        message: 'A tyre alert could not be read. Refresh and try again.',
        technical: 'Invalid tyre alert row id=$id risk=$risk',
      );
    }
    return TyreAlertDto(
      id: id,
      riskLevel: risk,
      assetNo: _text(row['asset_no']),
      site: _text(row['site']),
      brand: _text(row['brand']),
      position: _text(row['position']) ?? _text(row['tyre_position']),
      serialNo: _text(row['serial_no']),
      treadDepthMm: _number(row['tread_depth']),
      issueDate: _text(row['issue_date']),
    );
  }

  final String id;
  final String riskLevel;
  final String? assetNo;
  final String? site;
  final String? brand;
  final String? position;
  final String? serialNo;
  final num? treadDepthMm;
  final String? issueDate;

  TyreAlert toDomain() => TyreAlert(
        id: id,
        riskLevel: riskLevel,
        assetNo: assetNo,
        site: site,
        brand: brand,
        position: position,
        serialNo: serialNo,
        treadDepthMm: treadDepthMm,
        issueDate: issueDate,
      );

  static String? _text(Object? raw) {
    if (raw is! String) return null;
    final String value = raw.trim();
    return value.isEmpty ? null : value;
  }

  static num? _number(Object? raw) {
    if (raw is num && raw.isFinite) return raw;
    if (raw is String) return num.tryParse(raw.trim());
    return null;
  }
}
