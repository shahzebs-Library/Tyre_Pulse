/// Profiles for devices that follow a published or de-facto standard, so they
/// work without a vendor SDK. Brand-specific gauges (Bartec, Translogik TLGX,
/// and the like) publish their GATT layout to integrators; add each one here
/// as a [DeviceProfile] once its spec is in hand. Nothing in this file is
/// guessed for a named brand.
library;

import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';

/// Bluetooth SIG Battery Service and Battery Level characteristic.
const String batteryServiceUuid = '0000180f-0000-1000-8000-00805f9b34fb';
const String batteryLevelCharacteristicUuid =
    '00002a19-0000-1000-8000-00805f9b34fb';

/// Nordic UART Service: the de-facto serial-over-BLE profile many gauges use
/// to send ASCII readings. TX (device to phone) notifies.
const String nordicUartServiceUuid = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const String nordicUartTxCharacteristicUuid =
    '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

/// Zebra Link-OS "Parser" service on BLE mobile printers (ZQ series).
const String zebraParserServiceUuid = '38eb4a80-c570-11e3-9507-0002a5d5c51b';
const String zebraWriteCharacteristicUuid =
    '38eb4a82-c570-11e3-9507-0002a5d5c51b';

/// The service/characteristic most generic BLE ESC/POS and TSPL printers
/// expose for writes.
const String genericPrinterServiceUuid = '000018f0-0000-1000-8000-00805f9b34fb';
const String genericPrinterWriteCharacteristicUuid =
    '00002af1-0000-1000-8000-00805f9b34fb';

/// A generic BLE gauge speaking ASCII over Nordic UART. The right default for
/// an unknown gauge: if it is not NUS/ASCII the test read says so and the
/// admin enters the characteristic and rule from the vendor's sheet.
DeviceProfile genericBleGaugeProfile(DeviceKind kind) => DeviceProfile(
      serviceUuid: nordicUartServiceUuid,
      characteristicUuid: nordicUartTxCharacteristicUuid,
      parseRule: kind == DeviceKind.treadGauge
          ? GaugeParseRule.asciiTread
          : GaugeParseRule.asciiPressure,
    );

const DeviceProfile zebraBlePrinterProfile = DeviceProfile(
  serviceUuid: zebraParserServiceUuid,
  characteristicUuid: zebraWriteCharacteristicUuid,
  printerLanguage: PrinterLanguage.zpl,
);

DeviceProfile genericBlePrinterProfile(PrinterLanguage language) =>
    DeviceProfile(
      serviceUuid: genericPrinterServiceUuid,
      characteristicUuid: genericPrinterWriteCharacteristicUuid,
      printerLanguage: language,
    );

/// Picks a printer profile from what the device advertises.
DeviceProfile printerProfileFor(DiscoveredDevice device) {
  final List<String> services =
      device.services.map((String s) => s.toLowerCase()).toList();
  if (services.contains(zebraParserServiceUuid)) return zebraBlePrinterProfile;
  return genericBlePrinterProfile(PrinterLanguage.escPos);
}

/// The default label size for new printers.
const LabelSize defaultLabelSize = LabelSize.mm50x25;
