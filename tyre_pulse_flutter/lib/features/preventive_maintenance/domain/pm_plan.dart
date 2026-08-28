library;

import 'package:flutter/foundation.dart';

enum PmDueBand { overdue, dueSoon, ok, none }

@immutable
final class PmPlan {
  const PmPlan({
    required this.id,
    this.name,
    this.assetNo,
    this.assetCategory,
    this.site,
    this.status,
    this.intervalType,
    this.intervalValue,
    this.meterSource,
    this.meterInterval,
    this.nextDue,
    this.nextDueMeter,
    this.priority,
    this.estimatedCost,
  });

  final String id;
  final String? name;
  final String? assetNo;
  final String? assetCategory;
  final String? site;
  final String? status;
  final String? intervalType;
  final num? intervalValue;
  final String? meterSource;
  final num? meterInterval;
  final DateTime? nextDue;
  final num? nextDueMeter;
  final String? priority;
  final num? estimatedCost;

  int? daysToDue(DateTime now) {
    final DateTime? due = nextDue;
    if (due == null) return null;
    final DateTime today = DateTime.utc(now.year, now.month, now.day);
    final DateTime target = DateTime.utc(due.year, due.month, due.day);
    return target.difference(today).inDays;
  }

  PmDueBand dueBand(DateTime now) {
    final int? days = daysToDue(now);
    if (days == null) return PmDueBand.none;
    if (days < 0) return PmDueBand.overdue;
    if (days <= 14) return PmDueBand.dueSoon;
    return PmDueBand.ok;
  }

  String get meterUnit => switch (meterSource) {
        'odometer' => 'km',
        'engine_hours' => 'h',
        _ => '',
      };
}

enum PmServiceOutcome { completed, partial, deferred, failed }

final class RecordPmServiceInput {
  const RecordPmServiceInput({
    required this.programId,
    required this.serviceDate,
    required this.outcome,
    this.meterReading,
    this.performedBy,
    this.workshop,
    this.site,
    this.partsCost,
    this.labourCost,
    this.findings,
  });

  final String programId;
  final DateTime serviceDate;
  final PmServiceOutcome outcome;
  final num? meterReading;
  final String? performedBy;
  final String? workshop;
  final String? site;
  final num? partsCost;
  final num? labourCost;
  final String? findings;
}
