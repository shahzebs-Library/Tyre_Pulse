import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:widgetbook_workspace/app_assets.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('app artwork keys resolve to the tyre_pulse package', () async {
    final ByteData data = await TyrePulseAssetBundle()
        .load('assets/vehicle_photos/ashok_bus_fleet.jpeg');
    expect(data.lengthInBytes, greaterThan(0));
  });
}
