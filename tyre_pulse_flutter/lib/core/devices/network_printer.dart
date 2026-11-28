/// Raw TCP printing (port 9100, "JetDirect"), which every networked Zebra,
/// TSC and ESC/POS printer accepts. Needs no package: `dart:io` sockets.
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:tyre_pulse/core/devices/device_adapters.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';

final class NetworkPrinterAdapter implements PrinterAdapter {
  const NetworkPrinterAdapter({this.timeout = const Duration(seconds: 8)});

  final Duration timeout;

  @override
  Future<void> send(PairedDevice printer, Uint8List bytes) async {
    final String? host = printer.profile.host;
    if (host == null || host.isEmpty) {
      throw const DeviceFailure(DeviceFailureReason.notConfigured);
    }
    Socket? socket;
    try {
      socket =
          await Socket.connect(host, printer.profile.port, timeout: timeout);
      socket.add(bytes);
      await socket.flush().timeout(timeout);
    } on TimeoutException catch (error) {
      throw DeviceFailure(DeviceFailureReason.timeout, '$error');
    } on SocketException catch (error) {
      throw DeviceFailure(DeviceFailureReason.printFailed, '$error');
    } finally {
      await socket?.close();
    }
  }
}
