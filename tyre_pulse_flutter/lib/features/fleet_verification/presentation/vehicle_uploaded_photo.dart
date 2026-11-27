/// The machine's own photo (`vehicle_fleet.image_path`, private bucket
/// `vehicle-photos`) when it has one, else [fallback] (the class artwork).
///
/// The web reads the same column first (`resolveVehiclePhotoPath` in
/// `src/lib/api/vehicle360.js`). Loading or a failed read shows the fallback,
/// never a blank box.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/fleet_verification/fleet_verification_providers.dart';

class VehicleUploadedPhoto extends ConsumerWidget {
  const VehicleUploadedPhoto({
    required this.vehicleId,
    required this.fallback,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.semanticLabel,
    super.key,
  });

  final String vehicleId;
  final Widget fallback;
  final double? width;
  final double? height;
  final BoxFit fit;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? path =
        ref.watch(vehicleImagePathProvider(vehicleId)).asData?.value;
    if (path == null) return fallback;
    final String? url =
        ref.watch(verificationSignedUrlProvider(path)).asData?.value;
    if (url == null) return fallback;
    return Image.network(
      url,
      width: width,
      height: height,
      fit: fit,
      semanticLabel: semanticLabel,
      errorBuilder: (_, __, ___) => fallback,
    );
  }
}
