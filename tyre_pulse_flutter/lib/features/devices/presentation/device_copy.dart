/// Localised names and messages for the device layer's enums.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';

String deviceKindLabel(AppLocalizations l10n, DeviceKind kind) =>
    switch (kind) {
      DeviceKind.treadGauge => l10n.devicesKindTread,
      DeviceKind.pressureGauge => l10n.devicesKindPressure,
      DeviceKind.combinedGauge => l10n.devicesKindCombined,
      DeviceKind.scanner => l10n.devicesKindScanner,
      DeviceKind.rfidReader => l10n.devicesKindRfid,
      DeviceKind.labelPrinter => l10n.devicesKindPrinter,
    };

IconData deviceKindIcon(DeviceKind kind) => switch (kind) {
      DeviceKind.treadGauge => Icons.straighten_rounded,
      DeviceKind.pressureGauge => Icons.speed_rounded,
      DeviceKind.combinedGauge => Icons.tire_repair_outlined,
      DeviceKind.scanner => Icons.qr_code_scanner_rounded,
      DeviceKind.rfidReader => Icons.sensors_rounded,
      DeviceKind.labelPrinter => Icons.print_outlined,
    };

String deviceTransportLabel(AppLocalizations l10n, DeviceTransport t) =>
    switch (t) {
      DeviceTransport.ble => l10n.devicesTransportBle,
      DeviceTransport.hid => l10n.devicesTransportHid,
      DeviceTransport.network => l10n.devicesTransportNetwork,
      DeviceTransport.simulator => l10n.devicesTransportSimulator,
    };

/// Printer languages are product names, not words, so they are not
/// translated.
String printerLanguageLabel(PrinterLanguage language) => switch (language) {
      PrinterLanguage.zpl => 'ZPL (Zebra)',
      PrinterLanguage.escPos => 'ESC/POS',
      PrinterLanguage.tspl => 'TSPL (TSC)',
    };

/// Left-to-right isolate so "50 \u00d7 25 mm" keeps its order in Arabic/Urdu.
String labelSizeLabel(LabelSize size) =>
    '\u2066${size.widthMm} \u00d7 ${size.heightMm} mm\u2069';

String deviceFailureMessage(AppLocalizations l10n, Object error) {
  if (error is! DeviceFailure) return l10n.devicesErrorNotConnected;
  return switch (error.reason) {
    DeviceFailureReason.bluetoothOff => l10n.devicesBluetoothOff,
    DeviceFailureReason.permissionDenied => l10n.devicesPermissionDenied,
    DeviceFailureReason.unsupported => l10n.devicesErrorUnsupported,
    DeviceFailureReason.notConnected => l10n.devicesErrorNotConnected,
    DeviceFailureReason.timeout => l10n.devicesErrorTimeout,
    DeviceFailureReason.noReading => l10n.devicesErrorNoReading,
    DeviceFailureReason.unreadablePayload => l10n.devicesErrorUnreadable,
    DeviceFailureReason.notConfigured => l10n.devicesErrorNotConfigured,
    DeviceFailureReason.printFailed => l10n.devicesErrorPrintFailed,
    DeviceFailureReason.needsVendorSdk => l10n.devicesErrorVendorSdk,
  };
}

String? radioStateMessage(AppLocalizations l10n, RadioState state) =>
    switch (state) {
      RadioState.ready || RadioState.unknown => null,
      RadioState.off => l10n.devicesBluetoothOff,
      RadioState.unauthorized => l10n.devicesPermissionDenied,
      RadioState.unsupported => l10n.devicesBluetoothUnsupported,
    };

/// "110.5 psi" / "12.4 mm", one decimal, in the reader's locale digits.
String gaugeValueText(AppLocalizations l10n, GaugeReading reading) {
  final String value = reading.rounded.toStringAsFixed(1);
  // First-strong isolate: "110.5 psi" stays in Latin order inside an
  // Arabic sentence, "12.4 مم" follows the Arabic unit.
  final String text = reading.quantity == GaugeQuantity.pressure
      ? l10n.gaugeValuePsi(value)
      : l10n.gaugeValueMm(value);
  return '\u2068$text\u2069';
}
