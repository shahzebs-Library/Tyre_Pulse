/// UHF RFID readers.
///
/// What works today without any vendor SDK: a reader (or a rugged handheld
/// with a built-in UHF engine) set to keyboard/HID output types the tag's
/// EPC and Enter, which the scanner screen's handheld listener resolves like
/// a camera scan (see `hid_scan_listener.dart`).
///
/// What does not: bulk inventory sweeps, read power, tag filtering. Those need
/// the reader vendor's SDK behind a platform channel - Zebra RFID SDK (RFD40,
/// MC3390R), Chainway UHF SDK (C72), Translogik TLGX. TODO(devices): integrate
/// the chosen vendor's SDK as an [RfidReaderAdapter] once the customer picks a
/// reader; until then this adapter refuses honestly and never invents a read.
library;

import 'package:tyre_pulse/core/devices/device_adapters.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';

final class VendorSdkRequiredRfidAdapter implements RfidReaderAdapter {
  const VendorSdkRequiredRfidAdapter();

  static const DeviceFailure _failure =
      DeviceFailure(DeviceFailureReason.needsVendorSdk);

  @override
  Stream<String> tagReads(PairedDevice reader) =>
      Stream<String>.error(_failure);

  @override
  Future<void> startInventory(PairedDevice reader) async => throw _failure;

  @override
  Future<void> stopInventory(PairedDevice reader) async {}
}
