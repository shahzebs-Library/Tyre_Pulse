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
}
