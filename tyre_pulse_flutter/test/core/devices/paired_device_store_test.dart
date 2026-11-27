import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';
import 'package:tyre_pulse/core/devices/known_device_profiles.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';
import 'package:tyre_pulse/core/devices/paired_device_store.dart';

void main() {
  test('devices round-trip through storage', () {
    final List<PairedDevice> devices = <PairedDevice>[
      PairedDevice(
        id: 'AA:BB',
        name: 'Tread probe',
        kind: DeviceKind.treadGauge,
        transport: DeviceTransport.ble,
        profile: genericBleGaugeProfile(DeviceKind.treadGauge),
      ),
      const PairedDevice(
        id: '10.0.0.5:9100',
        name: 'Store printer',
        kind: DeviceKind.labelPrinter,
        transport: DeviceTransport.network,
        profile: DeviceProfile(
          printerLanguage: PrinterLanguage.tspl,
          labelSize: LabelSize.mm50x30,
          host: '10.0.0.5',
        ),
      ),
    ];
    final List<PairedDevice> back =
        decodePairedDevices(encodePairedDevices(devices));
    expect(back, devices);
    expect(back.first.profile.parseRule?.unit, GaugeUnit.mm);
    expect(back.last.profile.labelSize, LabelSize.mm50x30);
    expect(back.last.profile.printerLanguage, PrinterLanguage.tspl);
  });

  test('one unreadable entry does not lose the rest', () {
    const String raw = '[{"id":"x","kind":"nope","transport":"ble"},'
        '{"id":"y","name":"Ok","kind":"scanner","transport":"hid"}]';
    final List<PairedDevice> back = decodePairedDevices(raw);
    expect(back, hasLength(1));
    expect(back.single.name, 'Ok');
  });

  test('corrupt storage reads as empty', () {
    expect(decodePairedDevices('{not json'), isEmpty);
    expect(decodePairedDevices(null), isEmpty);
  });

  test('the memory store keeps users apart', () async {
    final MemoryPairedDeviceStore store = MemoryPairedDeviceStore();
    await store.save('u1', const <PairedDevice>[
      PairedDevice(
        id: 'a',
        name: 'A',
        kind: DeviceKind.scanner,
        transport: DeviceTransport.hid,
      ),
    ]);
    expect(await store.load('u2'), isEmpty);
    expect(await store.load('u1'), hasLength(1));
  });
}
