/// "Read from gauge": pick the gauge, take one reading, and ask before it is
/// used. The reading is never written silently - the person always sees
/// which device measured what, and what it replaces.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/device_providers.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';
import 'package:tyre_pulse/features/devices/presentation/device_copy.dart';

abstract final class GaugeReadKeys {
  static const ValueKey<String> readPressure =
      ValueKey<String>('gauge.read.pressure');
  static const ValueKey<String> readTread =
      ValueKey<String>('gauge.read.tread');
  static const ValueKey<String> useReading = ValueKey<String>('gauge.read.use');
  static const ValueKey<String> hidField = ValueKey<String>('gauge.read.hid');
}

/// Runs the whole flow. Returns the confirmed reading, or null when the
/// person cancelled, no gauge is set up, or the read failed (each of which
/// has already been explained on screen).
Future<GaugeReading?> readFromGauge(
  BuildContext context,
  WidgetRef ref, {
  required GaugeQuantity quantity,
  required String positionLabel,
  double? currentValue,
}) async {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(context);
  List<PairedDevice> all;
  try {
    all = await ref.read(pairedDevicesProvider.future);
  } on Object {
    all = const <PairedDevice>[];
  }
  final List<PairedDevice> gauges = gaugesFor(all, quantity);
  if (!context.mounted) return null;
  if (gauges.isEmpty) {
    messenger?.showSnackBar(SnackBar(content: Text(l10n.gaugeNoGauge)));
    return null;
  }
  final PairedDevice? gauge =
      gauges.length == 1 ? gauges.single : await _pickGauge(context, gauges);
  if (gauge == null || !context.mounted) return null;

  GaugeReading? reading;
  if (gauge.transport == DeviceTransport.hid) {
    reading = await _captureKeyboardReading(context, gauge, quantity);
  } else {
    try {
      reading = await _withProgress(
        context,
        l10n.gaugeReadingFrom(gauge.name),
        ref.read(deviceServiceProvider).readGauge(gauge, quantity),
      );
    } on Object catch (error) {
      messenger?.showSnackBar(
        SnackBar(content: Text(deviceFailureMessage(l10n, error))),
      );
      return null;
    }
  }
  if (reading == null || !context.mounted) return null;

  final bool confirmed = await _confirm(
    context,
    gauge: gauge,
    reading: reading,
    positionLabel: positionLabel,
    currentValue: currentValue,
  );
  return confirmed ? reading : null;
}

Future<PairedDevice?> _pickGauge(
  BuildContext context,
  List<PairedDevice> gauges,
) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return TpBottomSheet.show<PairedDevice>(
    context: context,
    title: l10n.gaugePickTitle,
    builder: (BuildContext sheet) => SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (final PairedDevice g in gauges)
            ListTile(
              leading: Icon(deviceKindIcon(g.kind)),
              title: Text(g.name, maxLines: 2, overflow: TextOverflow.ellipsis),
              subtitle: Text(
                '${deviceKindLabel(l10n, g.kind)} · '
                '${deviceTransportLabel(l10n, g.transport)}',
              ),
              onTap: () => Navigator.of(sheet).pop(g),
            ),
          const SizedBox(height: TpSpace.lg),
        ],
      ),
    ),
  );
}

Future<T> _withProgress<T>(
  BuildContext context,
  String message,
  Future<T> work,
) async {
  final NavigatorState nav = Navigator.of(context, rootNavigator: true);
  unawaited(
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      useRootNavigator: true,
      builder: (BuildContext dialog) => PopScope(
        canPop: false,
        child: AlertDialog(
          content: Row(
            children: <Widget>[
              const SizedBox.square(
                dimension: 24,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              ),
              const SizedBox(width: TpSpace.lg),
              Expanded(child: Text(message)),
            ],
          ),
        ),
      ),
    ),
  );
  try {
    return await work;
  } finally {
    nav.pop();
  }
}

Future<GaugeReading?> _captureKeyboardReading(
  BuildContext context,
  PairedDevice gauge,
  GaugeQuantity quantity,
) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final GaugeParseRule rule = quantity == GaugeQuantity.pressure
      ? GaugeParseRule.asciiPressure
      : GaugeParseRule.asciiTread;
  return showDialog<GaugeReading>(
    context: context,
    useRootNavigator: true,
    builder: (BuildContext dialog) {
      String? error;
      final TextEditingController controller = TextEditingController();
      return StatefulBuilder(
        builder: (BuildContext context, StateSetter setState) {
          void submit(String value) {
            final GaugeReading? reading = parseGaugePayload(
              Uint8List.fromList(value.trim().codeUnits),
              rule,
            );
            if (reading == null || reading.quantity != quantity) {
              setState(() => error = l10n.devicesErrorUnreadable);
              controller.clear();
              return;
            }
            Navigator.of(dialog).pop(reading);
          }

          return AlertDialog(
            title: Text(l10n.gaugeHidTitle),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(l10n.gaugeHidMessage(gauge.name)),
                const SizedBox(height: TpSpace.md),
                TextField(
                  key: GaugeReadKeys.hidField,
                  controller: controller,
                  autofocus: true,
                  textInputAction: TextInputAction.done,
                  decoration: InputDecoration(
                    labelText: l10n.gaugeHidField,
                    errorText: error,
                  ),
                  onSubmitted: submit,
                ),
              ],
            ),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.of(dialog).pop(),
                child: Text(l10n.actionCancel),
              ),
            ],
          );
        },
      );
    },
  );
}

Future<bool> _confirm(
  BuildContext context, {
  required PairedDevice gauge,
  required GaugeReading reading,
  required String positionLabel,
  double? currentValue,
}) async {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final String value = gaugeValueText(l10n, reading);
  final String? old = currentValue == null
      ? null
      : gaugeValueText(
          l10n,
          GaugeReading(
            quantity: reading.quantity,
            value: currentValue,
            sourceUnit: reading.quantity == GaugeQuantity.pressure
                ? GaugeUnit.psi
                : GaugeUnit.mm,
          ),
        );
  final bool? ok = await showDialog<bool>(
    context: context,
    useRootNavigator: true,
    builder: (BuildContext dialog) => AlertDialog(
      title: Text(l10n.gaugeConfirmTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(l10n.gaugeConfirmBody(gauge.name, value, positionLabel)),
          if (old != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(l10n.gaugeConfirmReplace(old)),
          ],
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(dialog).pop(false),
          child: Text(l10n.actionCancel),
        ),
        FilledButton(
          key: GaugeReadKeys.useReading,
          onPressed: () => Navigator.of(dialog).pop(true),
          child: Text(l10n.gaugeUseReading),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// The two "Read from gauge" buttons under the pressure and tread fields.
/// Renders nothing for anyone without device access, and nothing when the
/// sheet is built outside a [ProviderScope] (some isolated widget harnesses),
/// so the sheet behaves exactly as before for everyone else.
class GaugeReadButtons extends StatelessWidget {
  const GaugeReadButtons({
    required this.onReadPressure,
    required this.onReadTread,
    super.key,
  });

  final VoidCallback onReadPressure;
  final VoidCallback onReadTread;

  @override
  Widget build(BuildContext context) {
    try {
      ProviderScope.containerOf(context, listen: false);
    } on StateError {
      return const SizedBox.shrink();
    }
    return Consumer(
      builder: (BuildContext context, WidgetRef ref, Widget? _) {
        if (!ref.watch(devicesAccessProvider)) return const SizedBox.shrink();
        final AppLocalizations l10n = AppLocalizations.of(context);
        return Padding(
          padding: const EdgeInsets.only(top: TpSpace.sm),
          child: Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              TpButton.secondary(
                key: GaugeReadKeys.readPressure,
                label: l10n.gaugeReadPressure,
                icon: Icons.bluetooth_searching_rounded,
                isCompact: true,
                onPressed: onReadPressure,
              ),
              TpButton.secondary(
                key: GaugeReadKeys.readTread,
                label: l10n.gaugeReadTread,
                icon: Icons.bluetooth_searching_rounded,
                isCompact: true,
                onPressed: onReadTread,
              ),
            ],
          ),
        );
      },
    );
  }
}
