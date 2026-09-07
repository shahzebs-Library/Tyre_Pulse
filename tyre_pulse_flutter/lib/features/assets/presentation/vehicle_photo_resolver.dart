/// Presentation-only artwork selection for a real fleet asset.
///
/// The returned image is never treated as fleet data. It is a visual class
/// illustration chosen from the make/model/type already present on the real
/// [VehicleAsset]. Unknown classes deliberately return `null` so callers can
/// render an honest generic icon instead of showing the wrong vehicle.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/features/assets/domain/asset_classes.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_multiview_catalog.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart'
    show isTyrelessEquipment;

enum _VehicleVisualKind {
  mixer,
  concretePump,
  linePump,
  wheelLoader,
  skidLoader,
  pickup,
  bus,
  trailer,
  generator,
  chiller,
  batchingPlant,
  placingBoom,
  stationaryPump,
  towablePump,
  genericRoadVehicle,
  tyrelessEquipment,
  unknown,
}

String? vehiclePhotoAsset(VehicleAsset asset) {
  return vehiclePhotoAssetFor(
    assetNo: asset.assetNo,
    vehicleType: asset.vehicleType,
    make: asset.make,
    model: asset.model,
  );
}

/// Resolves front/three-quarter fleet artwork from verified master fields.
///
/// Make and model are intentionally considered before a broad imported type.
/// This matters for real rows such as `TOYOTA HIACE / PICKUP`: the known Hiace
/// identity is stronger than the legacy generic type and must never show a
/// different pickup body. Branded artwork is returned only when the stored
/// make/model positively identifies that brand.
String? vehiclePhotoAssetFor({
  String? assetNo,
  String? vehicleType,
  String? make,
  String? model,
}) {
  final String description = _searchableVehicleDescriptionFor(
    vehicleType: vehicleType,
    make: make,
    model: model,
  );

  switch (_vehicleVisualKindFor(
    assetNo: assetNo,
    vehicleType: vehicleType,
    make: make,
    model: model,
  )) {
    case _VehicleVisualKind.mixer:
      return 'assets/vehicle_photos/tri_mixer_perspective.webp';
    case _VehicleVisualKind.concretePump:
      return 'assets/vehicle_photos/concrete_pump.png';
    case _VehicleVisualKind.linePump:
      return 'assets/vehicle_photos/truck_mounted_pump.png';
    case _VehicleVisualKind.wheelLoader:
      if (!_matchesIdentity(description, const <String>['sany']) &&
          !_isGenericWheelLoaderIdentity(make: make, model: model)) {
        return null;
      }
      return 'assets/vehicle_photos/wheel_loader.png';
    case _VehicleVisualKind.skidLoader:
      if (!_matchesIdentity(
        description,
        const <String>['cat', 'caterpillar', 'caterpiller', 'catapiller'],
      )) {
        return null;
      }
      return 'assets/vehicle_photos/skid_loader_fleet.jpeg';
    case _VehicleVisualKind.pickup:
      if (description.contains('mitsubishi')) {
        return 'assets/vehicle_photos/mitsubishi_double_cab_front.jpeg';
      }
      if (description.contains('tata') || description.contains('xenon')) {
        return 'assets/vehicle_photos/tata_xenon_double_cab.jpeg';
      }
      // The legacy generic pickup asset is a top-down body and cannot prove a
      // make/model. A truthful class icon is better than showing it as a Nissan,
      // Toyota, Maxus or another known fleet brand.
      return null;
    case _VehicleVisualKind.bus:
      if (description.contains('hiace') || description.contains('hi ace')) {
        return 'assets/vehicle_photos/hiace_fleet.jpeg';
      }
      if (description.contains('ashok')) {
        return 'assets/vehicle_photos/ashok_bus_fleet.jpeg';
      }
      if (description.contains('tata')) {
        return 'assets/vehicle_photos/tata_bus_fleet.jpeg';
      }
      return _brandIsMissing(make)
          ? 'assets/vehicle_photos/staff_bus.png'
          : null;
    case _VehicleVisualKind.generator:
      if (!_matchesIdentity(description, const <String>['sany'])) {
        return null;
      }
      return 'assets/vehicle_photos/generator_fleet.jpeg';
    case _VehicleVisualKind.chiller:
      if (description.contains('industrial') ||
          description.contains('water chiller') ||
          description.contains('lg')) {
        if (!_matchesIdentity(description, const <String>['lg'])) {
          return null;
        }
        return 'assets/vehicle_photos/industrial_chiller_fleet.jpeg';
      }
      if (!_matchesIdentity(description, const <String>['snowkey'])) {
        return null;
      }
      return 'assets/vehicle_photos/chiller_fleet.jpeg';
    case _VehicleVisualKind.batchingPlant:
      if (!_matchesIdentity(description, const <String>['sany'])) {
        return null;
      }
      return 'assets/vehicle_photos/batching_plant_fleet.jpeg';
    case _VehicleVisualKind.placingBoom:
      if (!_matchesIdentity(description, const <String>['hamac'])) {
        return null;
      }
      return 'assets/vehicle_photos/placing_boom_vertical.jpeg';
    case _VehicleVisualKind.stationaryPump:
      if (!_matchesIdentity(description, const <String>['sany'])) {
        return null;
      }
      return 'assets/vehicle_photos/stationary_pump_fleet.jpeg';
    case _VehicleVisualKind.towablePump:
      if (!_matchesIdentity(description, const <String>['sany'])) {
        return null;
      }
      return 'assets/vehicle_photos/towable_pump_fleet.jpeg';
    case _VehicleVisualKind.trailer:
    case _VehicleVisualKind.genericRoadVehicle:
    case _VehicleVisualKind.tyrelessEquipment:
    case _VehicleVisualKind.unknown:
      // There is no truthful photo for these classes in the current bundle.
      // Let the caller render the class-appropriate icon instead of borrowing
      // artwork from a materially different asset.
      return null;
  }
}

/// Resolves the five-view reference board used by asset detail, inspection,
/// approval and accident-damage flows.
///
/// The source fleet record wins over the asset-number prefix, matching
/// [vehiclePhotoAsset]. Axle-specific pump artwork is selected explicitly;
/// an unknown road class returns `null` instead of showing the wrong body.
String? vehicleMultiViewAsset(VehicleAsset asset) {
  return vehicleMultiViewAssetFor(
    assetNo: asset.assetNo,
    vehicleType: asset.vehicleType,
    make: asset.make,
    model: asset.model,
  );
}

/// Resolves the same truthful five-view artwork from a read-only business
/// record that carries vehicle classification fields but is not itself a
/// complete `vehicle_fleet` row (for example a submitted inspection).
///
/// Keeping this field-based boundary avoids fabricating a [VehicleAsset.id]
/// solely to render presentation artwork on approval and summary screens.
String? vehicleMultiViewAssetFor({
  String? assetNo,
  String? vehicleType,
  String? make,
  String? model,
}) {
  final String description = _searchableVehicleDescriptionFor(
    vehicleType: vehicleType,
    make: make,
    model: model,
  );

  switch (_vehicleVisualKindFor(
    assetNo: assetNo,
    vehicleType: vehicleType,
    make: make,
    model: model,
  )) {
    case _VehicleVisualKind.mixer:
      return _multiViewCatalogPath('transit-mixer-3axle');
    case _VehicleVisualKind.concretePump:
      if (_mentionsAxleCount(description, 4)) {
        return _multiViewCatalogPath('white-concrete-pump-4axle');
      }
      if (_mentionsAxleCount(description, 5) || description.contains('sany')) {
        if (!_matchesIdentity(description, const <String>['sany'])) {
          return null;
        }
        return _multiViewCatalogPath('sany-concrete-pump-5axle');
      }
      // The class alone does not prove which of the two incompatible pump
      // bodies is installed. Returning no board is safer than inventing an
      // axle count for inspection or accident marking.
      return null;
    case _VehicleVisualKind.linePump:
      return _multiViewCatalogPath('line-pump-4axle');
    case _VehicleVisualKind.wheelLoader:
      if (!_matchesIdentity(description, const <String>['sany']) &&
          !_isGenericWheelLoaderIdentity(make: make, model: model)) {
        return null;
      }
      return _multiViewCatalogPath('sany-wheel-loader');
    case _VehicleVisualKind.skidLoader:
      if (!_matchesIdentity(
        description,
        const <String>['cat', 'caterpillar', 'caterpiller', 'catapiller'],
      )) {
        return null;
      }
      return _multiViewCatalogPath('cat-skid-loader');
    case _VehicleVisualKind.pickup:
      if (description.contains('mitsubishi')) {
        return _multiViewCatalogPath('mitsubishi-double-cab');
      }
      if (description.contains('tata') || description.contains('xenon')) {
        return _multiViewCatalogPath('tata-xenon-double-cab');
      }
      return _brandIsMissing(make)
          ? _multiViewCatalogPath('generic-double-cab')
          : null;
    case _VehicleVisualKind.bus:
      if (description.contains('hiace') || description.contains('hi ace')) {
        return _multiViewCatalogPath('toyota-hiace');
      }
      if (description.contains('ashok')) {
        return _multiViewCatalogPath('ashok-leyland-bus');
      }
      if (description.contains('tata')) {
        return _multiViewCatalogPath('tata-staff-bus');
      }
      return _brandIsMissing(make)
          ? _multiViewCatalogPath('generic-staff-bus')
          : null;
    case _VehicleVisualKind.generator:
      if (!_matchesIdentity(description, const <String>['sany'])) {
        return null;
      }
      return _multiViewCatalogPath('sany-generator');
    case _VehicleVisualKind.chiller:
      if (description.contains('industrial') ||
          description.contains('water chiller') ||
          description.contains('lg')) {
        if (!_matchesIdentity(description, const <String>['lg'])) {
          return null;
        }
        return _multiViewCatalogPath('industrial-chiller');
      }
      if (!_matchesIdentity(description, const <String>['snowkey'])) {
        return null;
      }
      return _multiViewCatalogPath('snowkey-chiller');
    case _VehicleVisualKind.batchingPlant:
      if (!_matchesIdentity(description, const <String>['sany'])) {
        return null;
      }
      return _multiViewCatalogPath('sany-batching-plant');
    case _VehicleVisualKind.placingBoom:
      if (!_matchesIdentity(description, const <String>['hamac'])) {
        return null;
      }
      return _multiViewCatalogPath('placing-boom');
    case _VehicleVisualKind.stationaryPump:
      if (!_matchesIdentity(description, const <String>['sany'])) {
        return null;
      }
      return _multiViewCatalogPath('sany-stationary-pump');
    case _VehicleVisualKind.towablePump:
      if (!_matchesIdentity(description, const <String>['sany'])) {
        return null;
      }
      return _multiViewCatalogPath('sany-towable-pump');
    case _VehicleVisualKind.trailer:
    case _VehicleVisualKind.genericRoadVehicle:
    case _VehicleVisualKind.tyrelessEquipment:
    case _VehicleVisualKind.unknown:
      return null;
  }
}

IconData vehicleFallbackIcon(VehicleAsset asset) {
  return vehicleFallbackIconFor(
    assetNo: asset.assetNo,
    vehicleType: asset.vehicleType,
    make: asset.make,
    model: asset.model,
  );
}

IconData vehicleFallbackIconFor({
  String? assetNo,
  String? vehicleType,
  String? make,
  String? model,
}) {
  switch (_vehicleVisualKindFor(
    assetNo: assetNo,
    vehicleType: vehicleType,
    make: make,
    model: model,
  )) {
    case _VehicleVisualKind.wheelLoader:
    case _VehicleVisualKind.skidLoader:
      return Icons.construction_outlined;
    case _VehicleVisualKind.bus:
      return Icons.directions_bus_outlined;
    case _VehicleVisualKind.pickup:
      return Icons.airport_shuttle_outlined;
    case _VehicleVisualKind.tyrelessEquipment:
    case _VehicleVisualKind.generator:
    case _VehicleVisualKind.chiller:
    case _VehicleVisualKind.batchingPlant:
    case _VehicleVisualKind.placingBoom:
    case _VehicleVisualKind.stationaryPump:
      return Icons.precision_manufacturing_outlined;
    case _VehicleVisualKind.towablePump:
      return Icons.rv_hookup_outlined;
    case _VehicleVisualKind.trailer:
      return Icons.rv_hookup_outlined;
    case _VehicleVisualKind.mixer:
    case _VehicleVisualKind.concretePump:
    case _VehicleVisualKind.linePump:
    case _VehicleVisualKind.genericRoadVehicle:
    case _VehicleVisualKind.unknown:
      return Icons.local_shipping_outlined;
  }
}

bool _isGenericWheelLoaderIdentity({String? make, String? model}) {
  final String identity = _normalise(
    <String?>[make, model].whereType<String>().join(' '),
  );
  return identity.isEmpty || identity == 'wheel loader' || identity == 'loader';
}

_VehicleVisualKind _vehicleVisualKindFor({
  String? assetNo,
  String? vehicleType,
  String? make,
  String? model,
}) {
  final String makeAndModel = _normalise(
    <String?>[make, model].whereType<String>().join(' '),
  );
  final _VehicleVisualKind? identifiedModel =
      _kindFromKnownMakeOrModel(makeAndModel);
  if (identifiedModel != null) return identifiedModel;

  final String description = _searchableVehicleDescriptionFor(
    vehicleType: vehicleType,
    make: make,
    model: model,
  );
  final _VehicleVisualKind? described = _kindFromDescription(
    description,
    explicitVehicleType: _normalise(vehicleType),
  );
  if (described != null) return described;

  switch (assetClassOf(assetNo)) {
    case 'TM':
      return _VehicleVisualKind.mixer;
    case 'CP':
    case 'MP':
      return _VehicleVisualKind.concretePump;
    case 'LP':
      return _VehicleVisualKind.linePump;
    case 'WL':
      return _VehicleVisualKind.wheelLoader;
    case 'SL':
      return _VehicleVisualKind.skidLoader;
    case 'PL':
      return _VehicleVisualKind.pickup;
    case 'BH':
    case 'MB':
      return _VehicleVisualKind.bus;
    case 'GN':
      return _VehicleVisualKind.generator;
    case 'BP':
      return _VehicleVisualKind.batchingPlant;
    case 'IP':
      return _VehicleVisualKind.tyrelessEquipment;
    case 'SP':
      return _VehicleVisualKind.stationaryPump;
    case 'PB':
      return _VehicleVisualKind.placingBoom;
    default:
      return _VehicleVisualKind.unknown;
  }
}

/// Model identities are stronger than broad legacy types imported from old
/// spreadsheets. This is deliberately a short allow-list of models that are
/// present in the verified fleet data, not a heuristic vehicle classifier.
_VehicleVisualKind? _kindFromKnownMakeOrModel(String value) {
  if (value.contains('hiace') || value.contains('hi ace')) {
    return _VehicleVisualKind.bus;
  }
  if (value.contains('xenon') ||
      value.contains('l200') ||
      value.contains('triton') ||
      value.contains('maxus t 60') ||
      value.contains('maxus t60')) {
    return _VehicleVisualKind.pickup;
  }
  return null;
}

_VehicleVisualKind? _kindFromDescription(
  String value, {
  required String explicitVehicleType,
}) {
  if (value.isEmpty) return null;

  if (value.contains('towable') && value.contains('pump')) {
    return _VehicleVisualKind.towablePump;
  }

  // This check must precede every pump/plant keyword. A placing boom or a
  // stationary pump is fixed equipment and must never receive truck artwork.
  if (isTyrelessEquipment(value)) {
    if (value.contains('generator') || value.contains('genset')) {
      return _VehicleVisualKind.generator;
    }
    if (value.contains('chiller')) return _VehicleVisualKind.chiller;
    if (value.contains('batch') || value.contains('plant')) {
      return _VehicleVisualKind.batchingPlant;
    }
    if (value.contains('placing') && value.contains('boom')) {
      return _VehicleVisualKind.placingBoom;
    }
    if (value.contains('stationary') && value.contains('pump')) {
      return _VehicleVisualKind.stationaryPump;
    }
    return _VehicleVisualKind.tyrelessEquipment;
  }
  if (value.contains('transit mixer') ||
      value.contains('tri mixer') ||
      value.contains('tr mixer') ||
      value.contains('concrete mixer')) {
    return _VehicleVisualKind.mixer;
  }
  if (value.contains('line pump') ||
      (value.contains('truck mounted') && value.contains('pump'))) {
    return _VehicleVisualKind.linePump;
  }
  if (value.contains('boom pump') ||
      value.contains('concrete pump') ||
      value.contains('pump truck') ||
      value.contains('mobile pump')) {
    return _VehicleVisualKind.concretePump;
  }
  if (value.contains('skid loader') || value.contains('skid steer')) {
    return _VehicleVisualKind.skidLoader;
  }
  if (value.contains('wheel loader') ||
      value.contains('front end loader') ||
      explicitVehicleType == 'loader') {
    return _VehicleVisualKind.wheelLoader;
  }
  if (value.contains('pickup') ||
      value.contains('pick up') ||
      value.contains('double cabin') ||
      value.contains('double cab') ||
      value.contains('xenon') ||
      (value.contains('mitsubishi') &&
          (value.contains('l200') || value.contains('triton')))) {
    return _VehicleVisualKind.pickup;
  }
  if (value.contains('bus') ||
      value.contains('coach') ||
      value.contains('coaster') ||
      value.contains('hiace') ||
      value.contains('hi ace') ||
      value.contains('minibus') ||
      value.contains('mini bus') ||
      value.contains('32 seater') ||
      value.contains('62 seater')) {
    return _VehicleVisualKind.bus;
  }
  if (value.contains('trailer')) return _VehicleVisualKind.trailer;
  if (value.contains('truck') ||
      value.contains('canter') ||
      value.contains('tanker') ||
      value.contains('crane')) {
    return _VehicleVisualKind.genericRoadVehicle;
  }
  return null;
}

String _searchableVehicleDescriptionFor({
  String? vehicleType,
  String? make,
  String? model,
}) =>
    _normalise(
      <String?>[
        vehicleType,
        make,
        model,
      ].whereType<String>().join(' '),
    );

String _normalise(String? value) => (value ?? '')
    .toLowerCase()
    .replaceAll(RegExp(r'[-_/]+'), ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

String? _multiViewCatalogPath(String id) =>
    vehicleMultiViewCatalogEntry(id)?.assetPath;

bool _mentionsAxleCount(String description, int count) {
  final String word = switch (count) {
    4 => 'four',
    5 => 'five',
    _ => '$count',
  };
  return description.contains('$count axle') ||
      description.contains('${count}axle') ||
      description.contains('$word axle');
}

bool _matchesIdentity(String description, List<String> acceptedIdentities) =>
    description.isNotEmpty && acceptedIdentities.any(description.contains);

bool _brandIsMissing(String? make) {
  final String normalised = _normalise(make);
  return normalised.isEmpty ||
      normalised == 'n a' ||
      normalised == 'na' ||
      normalised == 'unknown';
}
