library;

import 'package:tyre_pulse/features/rca/domain/rca_record.dart';

final class RcaRecordDto {
  const RcaRecordDto(this.row);

  final Map<String, dynamic> row;

  RcaRecord toDomain() => RcaRecord(
        id: _text(row['id']) ?? '',
        assetNo: _text(row['asset_no']),
        tyreSerial: _text(row['tyre_serial']),
        brand: _text(row['brand']),
        site: _text(row['site']),
        failureDate: _text(row['failure_date']),
        kmAtFailure: row['km_at_failure'] is num
            ? row['km_at_failure'] as num
            : num.tryParse(_text(row['km_at_failure']) ?? ''),
        rootCause: _text(row['root_cause']),
        contributingFactors: _strings(row['contributing_factors']),
        createdAt: DateTime.tryParse(_text(row['created_at']) ?? ''),
      );
}

String? _text(Object? raw) {
  final String value = raw?.toString().trim() ?? '';
  return value.isEmpty ? null : value;
}

List<String> _strings(Object? raw) {
  if (raw is! Iterable<Object?>) return const <String>[];
  return <String>[
    for (final Object? value in raw)
      if (_text(value) case final String item) item,
  ];
}
