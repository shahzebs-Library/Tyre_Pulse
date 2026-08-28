library;

import 'package:flutter/foundation.dart';

@immutable
final class RcaRecord {
  const RcaRecord({
    required this.id,
    this.assetNo,
    this.tyreSerial,
    this.brand,
    this.site,
    this.failureDate,
    this.kmAtFailure,
    this.rootCause,
    this.contributingFactors = const <String>[],
    this.createdAt,
  });

  final String id;
  final String? assetNo;
  final String? tyreSerial;
  final String? brand;
  final String? site;
  final String? failureDate;
  final num? kmAtFailure;
  final String? rootCause;
  final List<String> contributingFactors;
  final DateTime? createdAt;
}

abstract final class RcaFactor {
  static const List<String> all = <String>[
    'Under-inflation',
    'Over-inflation',
    'Overload',
    'Misalignment',
    'Road hazard',
    'Manufacturing defect',
    'Driver behaviour',
    'Worn out',
    'Brake issue',
  ];
}
