import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/washing/domain/wash_areas.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_vehicle_views.dart';

String? sample(String type, {String? make, String? model, String? asset}) =>
    vehicleWashSampleAssetFor(
      assetNo: asset,
      vehicleType: type,
      make: make,
      model: model,
    );

void main() {
  test('vehicle classes map to the owner wash pictures', () {
    expect(sample('TR-MIXER'), 'assets/wash_types/exterior.png');
    expect(sample('WHEEL LOADER'), 'assets/wash_vehicles/wheel_loader.png');
    expect(sample('FORKLIFT'), 'assets/wash_vehicles/forklift.png');
    expect(
      sample('BUS', model: 'TOYOTA HIACE'),
      'assets/wash_vehicles/hiace_van.png',
    );
  });

  test('classes with no sample return null so the real photo stays', () {
    expect(sample('SANY GENERATOR'), isNull);
    expect(sample('SPECIAL RIG'), isNull);
  });

  test('special pictures only swap in for matching areas', () {
    const String van = 'assets/wash_vehicles/hiace_van.png';
    expect(washSampleForAreas(van, <WashArea>{}), van);
    expect(
      washSampleForAreas(van, <WashArea>{WashArea.cabin}),
      'assets/wash_vehicles/van_interior_wash.png',
    );
    expect(
      washSampleForAreas(
        'assets/wash_vehicles/wheel_loader.png',
        <WashArea>{WashArea.undercarriage},
      ),
      'assets/wash_vehicles/loader_mud_flush.png',
    );
    expect(
      washSampleForAreas(
        'assets/wash_vehicles/forklift.png',
        <WashArea>{WashArea.steam},
      ),
      'assets/wash_vehicles/forklift_degrease.png',
    );
  });
}
