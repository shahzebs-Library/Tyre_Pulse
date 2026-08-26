/// A best-effort GPS fix, via `geolocator`.
///
/// Mirrors `mobile/lib/location.ts`'s `captureInspectionLocation` exactly:
/// "never throws and never blocks: on any failure the status flips to
/// 'unavailable' and submit proceeds without coordinates." Every failure
/// path here - permission denied, permission denied forever, location
/// services switched off, a timeout, an unrecognised platform exception -
/// collapses to the SAME [InspectionGpsStatus.unavailable] outcome with a
/// null fix, because none of those differences change what the caller
/// does next.
///
/// # Package choice
///
/// `geolocator` is the standard, most widely used Flutter package for a
/// current-position read with built-in permission integration
/// (`checkPermission`/`requestPermission`), pre-authorised by this
/// feature's task brief. A separate `permission_handler` dependency was
/// deliberately NOT added: `geolocator` already exposes the permission
/// check/request calls this feature needs, and reaching for a second
/// package to pre-flight a permission this package already asks for
/// itself would be exactly the "package added to shorten five lines"
/// spec section 64 warns against.
///
/// # UNVERIFIED against real source
///
/// Written against this project's best understanding of `geolocator`'s
/// long-stable public surface (`Geolocator.checkPermission`,
/// `requestPermission`, `isLocationServiceEnabled`,
/// `getCurrentPosition(locationSettings:)`, `LocationSettings`,
/// `LocationAccuracy.balanced`) rather than against installed source - see
/// `inspection_photo_capture.dart`'s own note on the same limitation and
/// its cause (no Flutter SDK/pub cache here, artifact/risk R1).
library;

import 'dart:async';

import 'package:geolocator/geolocator.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';

/// The outcome of one capture attempt.
class GpsCaptureResult {
  const GpsCaptureResult({required this.status, this.fix});

  final InspectionGpsStatus status;
  final InspectionGpsFix? fix;
}

final class InspectionGpsSource {
  /// A generous but bounded wait - the RN source does not block Save on a
  /// slow radio, and this mirrors that by giving up rather than hanging
  /// the tyre step indefinitely.
  static const Duration _timeout = Duration(seconds: 12);

  Future<GpsCaptureResult> captureFix() async {
    try {
      final bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        return const GpsCaptureResult(
          status: InspectionGpsStatus.unavailable,
        );
      }

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return const GpsCaptureResult(
          status: InspectionGpsStatus.unavailable,
        );
      }

      final Position position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.balanced,
          timeLimit: _timeout,
        ),
      ).timeout(_timeout);

      return GpsCaptureResult(
        status: InspectionGpsStatus.captured,
        fix: InspectionGpsFix(
          latitude: position.latitude,
          longitude: position.longitude,
          accuracyMeters: position.accuracy.isFinite
              ? position.accuracy
              : null,
          capturedAt: DateTime.now().toUtc(),
        ),
      );
    } on Object {
      // Every other failure - a timeout, a platform exception, a
      // provider that answered with nonsense - degrades to the same
      // honest "not available" outcome. See the library comment.
      return const GpsCaptureResult(status: InspectionGpsStatus.unavailable);
    }
  }
}
