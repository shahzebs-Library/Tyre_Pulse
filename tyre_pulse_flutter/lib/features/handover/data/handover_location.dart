/// Reads the device position once for a handover signature.
///
/// Never throws and never blocks signing: a refused permission becomes
/// `denied`, anything else that fails becomes `unavailable`, and
/// `sign_handover` records that status honestly instead of a fabricated point.
/// Mirrors `captureLocation` in `src/lib/handoverAuthorization.js`.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

final class HandoverLocationReading {
  const HandoverLocationReading({
    required this.status,
    this.latitude,
    this.longitude,
    this.accuracyMeters,
  });

  const HandoverLocationReading.denied() : this(status: 'denied');
  const HandoverLocationReading.unavailable() : this(status: 'unavailable');

  /// `captured`, `denied` or `unavailable`.
  final String status;
  final double? latitude;
  final double? longitude;
  final double? accuracyMeters;

  bool get captured =>
      status == 'captured' && latitude != null && longitude != null;
}

abstract interface class HandoverLocationReader {
  Future<HandoverLocationReading> read();
}

final Provider<HandoverLocationReader> handoverLocationReaderProvider =
    Provider<HandoverLocationReader>((Ref ref) => GeolocatorHandoverLocation());

final class GeolocatorHandoverLocation implements HandoverLocationReader {
  static const Duration _timeout = Duration(seconds: 15);

  @override
  Future<HandoverLocationReading> read() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return const HandoverLocationReading.unavailable();
      }
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return const HandoverLocationReading.denied();
      }
      final Position p = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: _timeout,
        ),
      ).timeout(_timeout + const Duration(seconds: 1));
      if (!p.latitude.isFinite ||
          !p.longitude.isFinite ||
          p.latitude.abs() > 90 ||
          p.longitude.abs() > 180) {
        return const HandoverLocationReading.unavailable();
      }
      return HandoverLocationReading(
        status: 'captured',
        latitude: p.latitude,
        longitude: p.longitude,
        accuracyMeters:
            p.accuracy.isFinite && p.accuracy >= 0 ? p.accuracy : null,
      );
    } on Object {
      return const HandoverLocationReading.unavailable();
    }
  }
}
