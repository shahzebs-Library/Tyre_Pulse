/// The `inspections` row this feature writes, and the pure rules that
/// decide whether it is ready to send.
///
/// Ported from `mobile/lib/types.ts`'s `InspectionPayload` and the save
/// guard in `app/(app)/inspection/new.tsx`'s `handleSubmit` (lines
/// 482-517), field for field and rule for rule:
///
/// 1. Site, an effective vehicle (asset number) and an inspector name are
///    required before anything else is checked - `validateHeader` in the
///    RN source.
/// 2. At least one tyre position must have been touched at all
///    (`recordedCount === 0` guard) - a completely untouched sheet must
///    never be saved, online or queued.
/// 3. [TyreCompletenessResult.ok] must be `true`, using the SAME
///    `tyreCompleteness` engine `VehicleTyreDiagram` renders from -
///    checked BEFORE the signature so an inspector is sent back to the
///    tyres rather than being asked to sign for wheels nobody looked at.
///    Capture uses `requireEvidence: true`: every physical tyre must be
///    deliberately checked before review. Pressure remains optional, so an
///    inspector can explicitly confirm a Good tyre without a gauge, but a
///    seeded unchecked Good value can never pass as an inspection result.
/// 4. A signature is required last.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';

/// One reason a sheet is not ready to submit, in the order
/// [validateInspectionForSubmit] checks them. A pure code, never prose -
/// the presentation layer decides the sentence, in the user's language.
enum InspectionSubmitIssue {
  missingSite,
  missingVehicle,
  missingInspectorName,
  noTyreTouched,
  tyresIncomplete,
  missingSignature,
}

/// The full `inspections` row. Column names match the table 1:1.
@immutable
class InspectionPayload {
  const InspectionPayload({
    required this.title,
    required this.site,
    required this.assetNo,
    required this.vehicleType,
    required this.inspector,
    required this.inspectionDate,
    required this.scheduledDate,
    required this.tyreConditions,
    this.createdBy,
    this.inspectionType = 'Routine',
    this.notes = '',
    this.findings,
    this.odometerKm,
    this.hourMeter,
    this.inspectorSignature,
    this.approvalStatus,
    this.status = 'In Progress',
    this.country,
    this.gpsFix,
  });

  final String title;
  final String site;
  final String assetNo;
  final String vehicleType;
  final String inspector;
  final String? createdBy;
  final DateTime inspectionDate;
  final DateTime scheduledDate;
  final String inspectionType;

  /// Keyed by position id/code, exactly the shape
  /// `features/tyre_diagram` reads and [TyrePositionReading.toEntry]
  /// writes.
  final Map<String, TyrePositionReading> tyreConditions;

  final String notes;
  final String? findings;

  /// Kilometres. `Number('')` is 0 and 0 IS finite (artifact rule 5.22), so
  /// this is `int?` and a blank field is represented as `null`, never as
  /// `0` - a zero here is a real reading (an asset with a reset or brand
  /// new odometer), and folding "not entered" into it fabricates fleet
  /// history.
  final int? odometerKm;
  final double? hourMeter;

  /// Self-contained SVG or `data:` URL. Required before submit - see
  /// [validateInspectionForSubmit].
  final String? inspectorSignature;

  /// `pending_approval` once actually submitted. Left null while the
  /// payload is still being assembled so a half-built value can never be
  /// accidentally written.
  final String? approvalStatus;

  final String status;
  final String? country;
  final InspectionGpsFix? gpsFix;

  InspectionPayload copyWith({
    String? title,
    String? site,
    String? assetNo,
    String? vehicleType,
    String? inspector,
    String? createdBy,
    DateTime? inspectionDate,
    DateTime? scheduledDate,
    String? inspectionType,
    Map<String, TyrePositionReading>? tyreConditions,
    String? notes,
    String? findings,
    bool clearFindings = false,
    int? odometerKm,
    bool clearOdometerKm = false,
    double? hourMeter,
    bool clearHourMeter = false,
    String? inspectorSignature,
    String? approvalStatus,
    String? status,
    String? country,
    InspectionGpsFix? gpsFix,
    bool clearGpsFix = false,
  }) {
    return InspectionPayload(
      title: title ?? this.title,
      site: site ?? this.site,
      assetNo: assetNo ?? this.assetNo,
      vehicleType: vehicleType ?? this.vehicleType,
      inspector: inspector ?? this.inspector,
      createdBy: createdBy ?? this.createdBy,
      inspectionDate: inspectionDate ?? this.inspectionDate,
      scheduledDate: scheduledDate ?? this.scheduledDate,
      inspectionType: inspectionType ?? this.inspectionType,
      tyreConditions: tyreConditions ?? this.tyreConditions,
      notes: notes ?? this.notes,
      findings: clearFindings ? null : (findings ?? this.findings),
      odometerKm: clearOdometerKm ? null : (odometerKm ?? this.odometerKm),
      hourMeter: clearHourMeter ? null : (hourMeter ?? this.hourMeter),
      inspectorSignature: inspectorSignature ?? this.inspectorSignature,
      approvalStatus: approvalStatus ?? this.approvalStatus,
      status: status ?? this.status,
      country: country ?? this.country,
      gpsFix: clearGpsFix ? null : (gpsFix ?? this.gpsFix),
    );
  }

  /// The raw `tyre_conditions` map this row carries, in the exact shape
  /// [tyreCompleteness] and [VehicleTyreDiagram] expect.
  Map<String, Object?> tyreConditionsJson() => <String, Object?>{
        for (final MapEntry<String, TyrePositionReading> e
            in tyreConditions.entries)
          e.key: e.value.toEntry(),
      };

  /// The full row, ready to `.insert()` / `.upsert()`. `client_uuid` is
  /// added by the caller at the point of the actual write (the sync
  /// engine, `SupabaseTables.inspections`), never baked in here, because
  /// this type has no opinion about which attempt (the immediate online
  /// try, or a later queued retry) is writing it.
  Map<String, Object?> toRow() {
    final String isoDate = _isoDate(inspectionDate);
    return <String, Object?>{
      'title': title,
      'site': site,
      'asset_no': assetNo,
      'vehicle_type': vehicleType,
      'inspector': inspector,
      'created_by': createdBy,
      'inspection_date': isoDate,
      'scheduled_date': _isoDate(scheduledDate),
      'inspection_type': inspectionType,
      'tyre_conditions': tyreConditionsJson(),
      'notes': notes,
      'findings': findings,
      'odometer_km': odometerKm,
      'hour_meter': hourMeter,
      'inspector_signature': inspectorSignature,
      'approval_status': approvalStatus,
      'status': status,
      'country': country,
      ...inspectionGpsColumns(gpsFix),
    };
  }

  static String _isoDate(DateTime d) => '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}

/// How many positions in [tyreConditions] the inspector actually touched.
/// Drives the on-screen "N of M" progress chip only - never the submit
/// gate. See [TyrePositionReading.isTouched].
int touchedPositionCount(Map<String, TyrePositionReading> tyreConditions) {
  return tyreConditions.values.where((r) => r.isTouched).length;
}

/// Tyre inspection capture is stricter than legacy/read-only diagram views:
/// every resolved physical position must contain deliberate evidence, while a
/// pressure reading remains optional.
const TyreCompletenessOptions kInspectionCompletenessOptions =
    TyreCompletenessOptions(requireEvidence: true);

/// Runs [tyreCompleteness] over [payload] with the capture policy above.
TyreCompletenessResult inspectionCompleteness(InspectionPayload payload) {
  return tyreCompleteness(
    payload.vehicleType,
    payload.assetNo,
    payload.tyreConditionsJson(),
    kInspectionCompletenessOptions,
  );
}

/// Every reason [payload] is not yet ready to submit, in check order. An
/// empty list means it may be submitted. Mirrors the RN screen's ORDER
/// deliberately: header first, then "touched at all", then completeness,
/// then signature - so a caller that stops at the first issue sends the
/// inspector to fix things in the same sequence the production screen
/// does.
List<InspectionSubmitIssue> validateInspectionForSubmit(
  InspectionPayload payload,
) {
  final List<InspectionSubmitIssue> issues = <InspectionSubmitIssue>[];

  if (payload.site.trim().isEmpty) {
    issues.add(InspectionSubmitIssue.missingSite);
  }
  if (payload.assetNo.trim().isEmpty) {
    issues.add(InspectionSubmitIssue.missingVehicle);
  }
  if (payload.inspector.trim().isEmpty) {
    issues.add(InspectionSubmitIssue.missingInspectorName);
  }

  // The three checks above are structural prerequisites for the two below
  // (completeness and "touched at all" need a real vehicle type to mean
  // anything), but they do not short-circuit each other here - a caller
  // wants the FULL set of what is wrong, not just the first thing. Only
  // the actual UI flow enforces "fix the header before I show you the
  // tyres" ordering, by virtue of being a wizard.
  if (touchedPositionCount(payload.tyreConditions) == 0) {
    issues.add(InspectionSubmitIssue.noTyreTouched);
  } else if (!inspectionCompleteness(payload).ok) {
    issues.add(InspectionSubmitIssue.tyresIncomplete);
  }

  if (payload.inspectorSignature == null ||
      payload.inspectorSignature!.trim().isEmpty) {
    issues.add(InspectionSubmitIssue.missingSignature);
  }

  return issues;
}
