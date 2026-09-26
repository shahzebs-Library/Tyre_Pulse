/// Workshop Live Control - the evidence attached to an activity event:
/// optional photos on Report Problem / Request Parts, and a best-effort GPS
/// fix on every event.
///
/// Rule-for-rule port of the evidence half of `mobile/app/(app)/workshop.tsx`
/// + `mobile/lib/workshopApi.ts` (READ-ONLY reference, see `AGENTS.md`):
///
/// - `allowsPhoto(a)`: only `report_problem` and `request_parts` offer a
///   photo, at most three (`<PhotoCapture max={3} />`).
/// - `noteWithPhotos(note, refs)`: `tech_activity_events` has NO photos
///   column (`MIGRATIONS_V291_WORKSHOP_LIVE_CONTROL.sql`), so the permanent
///   storage refs are folded into the free-text `note` as
///   `"Photos: <ref> | <ref>"` on its own line - the only honest place to
///   keep them without inventing a column. The exact format matters: the
///   web foreman dashboard reads the same `note` text.
/// - GPS: one best-effort fix, which must NEVER block an action. A missing
///   reading is written as `null` (known-absent), never `0` - a `0,0` fix is
///   a real point in the Gulf of Guinea.
///
/// Pure Dart: no Flutter, no I/O of its own.
library;

import 'dart:async';

import 'package:tyre_pulse/features/workshop/domain/workshop_live.dart';

/// Mirrors mobile `<PhotoCapture max={3} />` on the workshop note modal.
const int kWorkshopMaxPhotos = 3;

/// Mirrors mobile `allowsPhoto(a)`.
bool workshopActionAllowsPhoto(WorkshopTechAction action) =>
    action.event == 'report_problem' || action.event == 'request_parts';

/// Mirrors mobile `noteWithPhotos`: the trimmed note, then (on its own line)
/// `Photos: ` + the refs joined by ` | `. Blank refs are ignored; `null`
/// when there is neither a note nor a ref.
String? workshopNoteWithPhotos(String? note, List<String>? photoRefs) {
  final List<String> parts = <String>[];
  final String? base = note?.trim();
  if (base != null && base.isNotEmpty) parts.add(base);
  final List<String> refs = <String>[
    for (final String r in photoRefs ?? const <String>[])
      if (r.trim().isNotEmpty) r.trim(),
  ];
  if (refs.isNotEmpty) parts.add('Photos: ${refs.join(' | ')}');
  return parts.isEmpty ? null : parts.join('\n');
}

/// One device fix, in the `tech_activity_events.gps_lat` / `gps_lng` shape.
final class WorkshopGpsReading {
  const WorkshopGpsReading({required this.lat, required this.lng});

  final double lat;
  final double lng;

  /// A reading is only usable when both halves are finite and inside the
  /// valid lat/lng ranges; anything else is treated as "no reading".
  static WorkshopGpsReading? tryCreate(double? lat, double? lng) {
    if (lat == null || lng == null) return null;
    if (!lat.isFinite || !lng.isFinite) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return WorkshopGpsReading(lat: lat, lng: lng);
  }
}

/// A best-effort locator: resolves a reading, or `null` when none is
/// available. Implementations may still throw or hang - see
/// [captureWorkshopGps].
typedef WorkshopLocator = Future<WorkshopGpsReading?> Function();

/// The outer guard every GPS read goes through. Never throws and never
/// waits longer than [timeout]: a denied permission, a disabled provider, a
/// slow radio or an exception all resolve to `null`, and the event records
/// without coordinates exactly as mobile's `captureInspectionLocation`
/// contract says.
Future<WorkshopGpsReading?> captureWorkshopGps(
  WorkshopLocator locate, {
  Duration timeout = const Duration(seconds: 15),
}) async {
  try {
    // `.then<WorkshopGpsReading?>` widens the future first: a locator
    // typed `Future<WorkshopGpsReading>` would otherwise reject the null
    // timeout value with a covariance TypeError.
    return await locate()
        .then<WorkshopGpsReading?>((WorkshopGpsReading? r) => r)
        .timeout(timeout, onTimeout: () => null);
  } on Object {
    return null;
  }
}
