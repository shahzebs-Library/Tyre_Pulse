/// A GPS fix folded into an inspection, and the honest states around
/// getting one.
///
/// Ported from `mobile/lib/types.ts`'s `GpsFix` and
/// `app/(app)/inspection/new.tsx`'s `LocationStatus` handling: a device
/// fix is captured BEST-EFFORT the moment the inspector reaches the tyre
/// step, and its absence NEVER blocks submission. A permission refusal, a
/// timeout, or no provider available all collapse to the same
/// [InspectionGpsStatus.unavailable] state with a null [InspectionGpsFix] -
/// there is deliberately no distinct "denied" vs "timed out" vs
/// "no provider" state exposed to the rest of this feature, because none of
/// those differences change what the screen does (nothing) or what gets
/// written (four null columns).
library;

import 'package:flutter/foundation.dart';

/// Where a location capture attempt currently stands.
enum InspectionGpsStatus {
  /// Not yet attempted.
  idle,

  /// A fix is being requested. This is the only state that will end by
  /// itself - matching the design system's "loading is the only state that
  /// contains a spinner" rule.
  capturing,

  /// A fix was obtained.
  captured,

  /// Permission was refused, the request timed out, or no location
  /// provider is available. Submission proceeds regardless.
  unavailable,
}

/// A resolved fix. Field names mirror `inspections.gps_lat` /
/// `gps_lng` / `gps_accuracy` / `gps_captured_at` 1:1, so [toColumns]
/// spreads directly into the row payload.
@immutable
class InspectionGpsFix {
  const InspectionGpsFix({
    required this.latitude,
    required this.longitude,
    required this.capturedAt,
    this.accuracyMeters,
  });

  final double latitude;
  final double longitude;

  /// Horizontal accuracy in metres, as reported by the OS. Null when the
  /// platform did not supply one - never fabricated as 0, which would read
  /// as an implausibly perfect fix.
  final double? accuracyMeters;

  final DateTime capturedAt;

  Map<String, Object?> toColumns() {
    return <String, Object?>{
      'gps_lat': latitude,
      'gps_lng': longitude,
      'gps_accuracy': accuracyMeters,
      'gps_captured_at': capturedAt.toIso8601String(),
    };
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is InspectionGpsFix &&
          other.latitude == latitude &&
          other.longitude == longitude &&
          other.accuracyMeters == accuracyMeters &&
          other.capturedAt == capturedAt);

  @override
  int get hashCode =>
      Object.hash(latitude, longitude, accuracyMeters, capturedAt);
}

/// The four `inspections` columns a fix (or its absence) resolves to. A
/// caller with no fix at all gets four nulls, matching
/// `InspectionPayload`'s own doc comment: "Null when the device fix was
/// denied/unavailable - the inspection is never blocked on it."
Map<String, Object?> inspectionGpsColumns(InspectionGpsFix? fix) {
  if (fix == null) {
    return const <String, Object?>{
      'gps_lat': null,
      'gps_lng': null,
      'gps_accuracy': null,
      'gps_captured_at': null,
    };
  }
  return fix.toColumns();
}
