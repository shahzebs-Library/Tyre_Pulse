import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_type_display.dart';

void main() {
  group('vehicleTypeDisplay', () {
    test('a snake_case storage token reads as words', () {
      expect(vehicleTypeDisplay('WHEEL_LOADER'), 'Wheel Loader');
      expect(vehicleTypeDisplay('skid_steer_loader'), 'Skid Steer Loader');
      expect(vehicleTypeDisplay(' WHEEL__LOADER '), 'Wheel Loader');
    });

    test('fleet codes without underscores are left as recorded', () {
      expect(vehicleTypeDisplay('TR-MIXER'), 'TR-MIXER');
      expect(vehicleTypeDisplay('Pickup'), 'Pickup');
    });

    test('blank is null, never an empty label', () {
      expect(vehicleTypeDisplay(null), isNull);
      expect(vehicleTypeDisplay('   '), isNull);
    });
  });

  group('fleetOpsStatusMatches (the Home off-road rule)', () {
    const VehicleAsset broken =
        VehicleAsset(id: '1', assetNo: 'TM1', opsStatus: 'breakdown');
    const VehicleAsset running =
        VehicleAsset(id: '2', assetNo: 'TM2', opsStatus: 'running');
    const VehicleAsset unknown = VehicleAsset(id: '3', assetNo: 'TM3');

    test('off road matches exactly ops_status = breakdown', () {
      expect(fleetOpsStatusMatches(broken, kFleetOpsStatusOffRoad), isTrue);
      expect(fleetOpsStatusMatches(running, kFleetOpsStatusOffRoad), isFalse);
      expect(fleetOpsStatusMatches(unknown, kFleetOpsStatusOffRoad), isFalse);
    });

    test('no filter matches everything', () {
      expect(fleetOpsStatusMatches(unknown, null), isTrue);
    });
  });
}
