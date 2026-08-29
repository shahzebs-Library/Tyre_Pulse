import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

void main() {
  test('CP fleet numbers resolve to the concrete pump artwork', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-1',
      assetNo: 'CP-045',
    );

    expect(
      vehiclePhotoAsset(asset),
      'assets/vehicle_photos/concrete_pump.png',
    );
  });

  test('unknown fleet classes do not receive a misleading photo', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-2',
      assetNo: 'UNKNOWN-1',
    );

    expect(vehiclePhotoAsset(asset), isNull);
  });

  test('TR-MIXER assets resolve to the real perspective mixer artwork', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-3',
      assetNo: 'TM-214',
      vehicleType: 'TR-MIXER',
    );

    expect(
      vehiclePhotoAsset(asset),
      'assets/vehicle_photos/tri_mixer_perspective.webp',
    );
  });
}
