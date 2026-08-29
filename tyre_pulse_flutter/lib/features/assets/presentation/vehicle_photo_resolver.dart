/// Presentation-only artwork selection for a real fleet asset.
///
/// The returned image is never treated as fleet data. It is a visual class
/// illustration chosen from the make/model/type already present on the real
/// [VehicleAsset]. Unknown classes deliberately return `null` so callers can
/// render an honest generic icon instead of showing the wrong vehicle.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

String? vehiclePhotoAsset(VehicleAsset asset) {
  final String type = _searchableVehicleText(asset);
  final String assetNo = asset.assetNo?.trim().toLowerCase() ?? '';
  if (type.contains('transit mixer') ||
      type.contains('tri mixer') ||
      type.contains('tr mixer') ||
      type.contains('concrete mixer') ||
      RegExp(r'^tm[-\s]?\d').hasMatch(assetNo)) {
    return 'assets/vehicle_photos/tri_mixer_perspective.webp';
  }
  if (type.contains('wheel loader') || type.contains('loader')) {
    return 'assets/vehicle_photos/wheel_loader.png';
  }
  if (type.contains('concrete pump') ||
      type.contains('pump truck') ||
      RegExp(r'^cp[-\s]?\d').hasMatch(assetNo)) {
    return 'assets/vehicle_photos/concrete_pump.png';
  }
  if (type.contains('truck mounted pump') || type.contains('boom pump')) {
    return 'assets/vehicle_photos/truck_mounted_pump.png';
  }
  if (type.contains('pickup')) {
    return 'assets/vehicle_photos/pickup.png';
  }
  if (type.contains('bus') || type.contains('coach')) {
    return 'assets/vehicle_photos/staff_bus.png';
  }
  return null;
}

IconData vehicleFallbackIcon(VehicleAsset asset) {
  final String type = _searchableVehicleText(asset);
  if (type.contains('loader')) return Icons.construction_outlined;
  if (type.contains('bus') || type.contains('hiace')) {
    return Icons.directions_bus_outlined;
  }
  if (type.contains('pickup')) return Icons.airport_shuttle_outlined;
  if (type.contains('generator') || type.contains('chiller')) {
    return Icons.precision_manufacturing_outlined;
  }
  if (type.contains('trailer')) return Icons.rv_hookup_outlined;
  return Icons.local_shipping_outlined;
}

String _searchableVehicleText(VehicleAsset asset) => <String?>[
      asset.vehicleType,
      asset.make,
      asset.model,
      asset.assetNo,
    ]
        .whereType<String>()
        .join(' ')
        .toLowerCase()
        .replaceAll(RegExp(r'[-_/]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ');
