/// The Vehicle 360 header facts that do not live on the `vehicle_fleet` row
/// the list already read: engine hours, the next preventive-maintenance
/// service, open tyre actions and the asset's permits.
///
/// Pure: no Flutter, no Supabase. Every value is decoded from a real row of a
/// real table (see `asset_360_repository.dart` for the reads); nothing here is
/// estimated.
///
/// # What is deliberately NOT derived
///
/// - A "health score out of 100". No table, RPC or agreed formula produces
///   one, and a number invented on the phone would read as a measurement.
///   The header therefore shows no score.
/// - A downtime COST. No downtime rate exists anywhere in the schema, so the
///   cost cards show recorded downtime HOURS instead.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart'
    show parseAssetDate;
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

/// Decodes one `pm_programs` row (the same columns the PM screen reads).
PmPlan? pmPlanFromRow(Map<String, dynamic> row) {
  final String? id = _text(row['id']);
  if (id == null) return null;
  return PmPlan(
    id: id,
    name: _text(row['name']),
    assetNo: _text(row['asset_no']),
    status: _text(row['status']),
    meterSource: _text(row['meter_source']),
    meterInterval: _number(row['meter_interval']),
    nextDue: parseAssetDate(row['next_due']),
    nextDueMeter: _number(row['next_due_meter']),
    priority: _text(row['priority']),
  );
}

/// Which unit a service-due figure is counted in.
enum AssetServiceDueUnit { km, hours, days }

/// The next preventive-maintenance service for one asset.
@immutable
class AssetServiceDue {
  const AssetServiceDue({
    required this.unit,
    required this.remaining,
    required this.planName,
  });

  final AssetServiceDueUnit unit;

  /// Kilometres, engine hours or days left. Zero or less means overdue.
  final int remaining;

  final String? planName;

  bool get isOverdue => remaining < 0;

  @override
  bool operator ==(Object other) =>
      other is AssetServiceDue &&
      other.unit == unit &&
      other.remaining == remaining &&
      other.planName == planName;

  @override
  int get hashCode => Object.hash(unit, remaining, planName);
}

/// The most pressing service among [plans], or null when none can be
/// measured.
///
/// A meter plan is measured against the matching current reading
/// ([currentKm] for `odometer`, [engineHours] for `engine_hours`); without
/// that reading or a `next_due_meter` it falls back to the plan's calendar
/// `next_due` date. A plan with neither is skipped rather than guessed.
///
/// Kilometres, hours and days cannot be compared with each other, so the
/// choice is: an overdue plan first, then the smallest remaining figure in a
/// fixed unit order (km, hours, days). The order is a presentation rule and
/// says so; it is not a claim that 300 km is "sooner" than 20 days.
AssetServiceDue? resolveAssetServiceDue(
  Iterable<PmPlan> plans, {
  required int? currentKm,
  required double? engineHours,
  required DateTime now,
}) {
  final List<AssetServiceDue> candidates = <AssetServiceDue>[];
  for (final PmPlan plan in plans) {
    final String status = plan.status?.trim().toLowerCase() ?? 'active';
    if (status != 'active') continue;
    final num? dueMeter = plan.nextDueMeter;
    AssetServiceDue? due;
    if (dueMeter != null) {
      if (plan.meterSource == 'odometer' && currentKm != null) {
        due = AssetServiceDue(
          unit: AssetServiceDueUnit.km,
          remaining: (dueMeter - currentKm).round(),
          planName: plan.name,
        );
      } else if (plan.meterSource == 'engine_hours' && engineHours != null) {
        due = AssetServiceDue(
          unit: AssetServiceDueUnit.hours,
          remaining: (dueMeter - engineHours).round(),
          planName: plan.name,
        );
      }
    }
    if (due == null) {
      final int? days = plan.daysToDue(now);
      if (days != null) {
        due = AssetServiceDue(
          unit: AssetServiceDueUnit.days,
          remaining: days,
          planName: plan.name,
        );
      }
    }
    if (due != null) candidates.add(due);
  }
  if (candidates.isEmpty) return null;
  candidates.sort((AssetServiceDue a, AssetServiceDue b) {
    if (a.isOverdue != b.isOverdue) return a.isOverdue ? -1 : 1;
    final int byUnit = a.unit.index.compareTo(b.unit.index);
    if (byUnit != 0) return byUnit;
    return a.remaining.compareTo(b.remaining);
  });
  return candidates.first;
}

/// Open tyre actions: `corrective_actions` raised from an inspection tyre
/// defect (V496 `source_type = 'inspection'`) whose status is not closed.
///
/// The closed words mirror V496's partial unique index exactly
/// (`closed`, `resolved`, `cancelled`), so "open" here means the same thing
/// the database means when it refuses a duplicate open action. A blank
/// status is open, as it is to that index.
int countOpenTyreActions(Iterable<Map<String, dynamic>> rows) {
  const Set<String> closed = <String>{'closed', 'resolved', 'cancelled'};
  int open = 0;
  for (final Map<String, dynamic> row in rows) {
    final String status = row['status']?.toString().trim().toLowerCase() ?? '';
    if (!closed.contains(status)) open++;
  }
  return open;
}

/// The permits recorded on the `vehicle_fleet` row.
enum AssetDocumentKind { registration, insurance, operatingCard, driverLicence }

/// How an expiry date reads today.
enum AssetDocumentState { valid, expiringSoon, expired, noExpiry }

/// Days before expiry at which a permit reads "expiring soon".
const int assetDocumentExpiringDays = 30;

@immutable
class AssetDocument {
  const AssetDocument({
    required this.kind,
    this.reference,
    this.issued,
    this.expires,
  });

  final AssetDocumentKind kind;

  /// Plate, insurer / cover type, or operating card number.
  final String? reference;
  final DateTime? issued;
  final DateTime? expires;

  AssetDocumentState stateOn(DateTime now) {
    final DateTime? end = expires;
    if (end == null) return AssetDocumentState.noExpiry;
    final DateTime today = DateTime(now.year, now.month, now.day);
    final int days = DateTime.utc(end.year, end.month, end.day)
        .difference(DateTime.utc(today.year, today.month, today.day))
        .inDays;
    if (days < 0) return AssetDocumentState.expired;
    if (days <= assetDocumentExpiringDays) {
      return AssetDocumentState.expiringSoon;
    }
    return AssetDocumentState.valid;
  }
}

/// Decodes the permit columns of one `vehicle_fleet` row. A permit with no
/// reference and no dates is left out entirely: listing an empty
/// "Insurance" row would read as a document that exists.
List<AssetDocument> assetDocumentsFromRow(Map<String, dynamic> row) {
  final List<AssetDocument> out = <AssetDocument>[];
  void add(
    AssetDocumentKind kind, {
    String? reference,
    Object? issued,
    Object? expires,
  }) {
    final DateTime? i = parseAssetDate(issued);
    final DateTime? e = parseAssetDate(expires);
    if (reference == null && i == null && e == null) return;
    out.add(
      AssetDocument(kind: kind, reference: reference, issued: i, expires: e),
    );
  }

  add(
    AssetDocumentKind.registration,
    reference: _text(row['registration_no']),
  );
  final String? insurer = _text(row['insurance_name']);
  final String? cover = _text(row['insurance_type']);
  add(
    AssetDocumentKind.insurance,
    reference: insurer == null
        ? cover
        : (cover == null ? insurer : '$insurer, $cover'),
    issued: row['insurance_start'],
    expires: row['insurance_expiry'],
  );
  add(
    AssetDocumentKind.operatingCard,
    reference: _text(row['operating_card_no']),
    issued: row['operating_card_issue'],
    expires: row['operating_card_expiry'],
  );
  add(
    AssetDocumentKind.driverLicence,
    issued: row['driver_licence_issue'],
    expires: row['driver_licence_expiry'],
  );
  return out;
}

String? _text(Object? value) {
  final String t = value?.toString().trim() ?? '';
  return t.isEmpty ? null : t;
}

num? _number(Object? value) =>
    value is num ? value : num.tryParse(_text(value) ?? '');
