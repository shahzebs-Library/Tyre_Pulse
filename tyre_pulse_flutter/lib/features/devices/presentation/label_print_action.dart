/// "Print label" for an asset, tyre or stock line: pick a paired thermal
/// printer, or fall back to the system printer / PDF. Renders nothing for
/// anyone without device access.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/device_providers.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';
import 'package:tyre_pulse/core/devices/label_pdf.dart';
import 'package:tyre_pulse/features/devices/presentation/device_copy.dart';

abstract final class LabelPrintKeys {
  static const ValueKey<String> button = ValueKey<String>('label.print');
  static const ValueKey<String> pdfOption = ValueKey<String>('label.print.pdf');
}

/// Signature of the PDF route, so tests can stand in for the OS dialog.
typedef LabelPdfPrinter = Future<bool> Function(LabelData label);

class LabelPrintButton extends ConsumerWidget {
  const LabelPrintButton({
    required this.label,
    this.pdfPrinter = printLabelPdf,
    super.key,
  });

  final LabelData label;
  final LabelPdfPrinter pdfPrinter;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(devicesAccessProvider)) return const SizedBox.shrink();
    final AppLocalizations l10n = AppLocalizations.of(context);
    return IconButton(
      key: LabelPrintKeys.button,
      tooltip: l10n.labelPrint,
      icon: const Icon(Icons.print_outlined),
      onPressed: () => unawaited(_print(context, ref)),
    );
  }

  Future<void> _print(BuildContext context, WidgetRef ref) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger =
        ScaffoldMessenger.maybeOf(context);
    List<PairedDevice> printers;
    try {
      printers = printersIn(await ref.read(pairedDevicesProvider.future));
    } on Object {
      printers = const <PairedDevice>[];
    }
    if (!context.mounted) return;
    final bool unicode = labelNeedsUnicodeFont(label);
    // Object: either a PairedDevice or the PDF sentinel string.
    final Object? choice = await TpBottomSheet.show<Object>(
      context: context,
      title: l10n.labelChoosePrinter,
      builder: (BuildContext sheet) => SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            if (unicode)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
                child: Text(l10n.labelUnicodeNote),
              ),
            for (final PairedDevice p in printers)
              ListTile(
                leading: const Icon(Icons.print_outlined),
                title:
                    Text(p.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                subtitle: Text(
                  '${deviceTransportLabel(l10n, p.transport)} · '
                  '${labelSizeLabel(p.profile.labelSize)}',
                ),
                onTap: () => Navigator.of(sheet).pop(p),
              ),
            ListTile(
              key: LabelPrintKeys.pdfOption,
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: Text(l10n.labelPrintPdf),
              onTap: () => Navigator.of(sheet).pop('pdf'),
            ),
            const SizedBox(height: TpSpace.lg),
          ],
        ),
      ),
    );
    if (choice == null || !context.mounted) return;
    if (choice is PairedDevice) {
      try {
        await ref.read(deviceServiceProvider).printLabel(choice, label);
        messenger?.showSnackBar(
          SnackBar(content: Text(l10n.labelPrinted(choice.name))),
        );
      } on Object catch (error) {
        messenger?.showSnackBar(
          SnackBar(content: Text(deviceFailureMessage(l10n, error))),
        );
      }
      return;
    }
    try {
      await pdfPrinter(label);
    } on Object {
      messenger?.showSnackBar(
        SnackBar(content: Text(l10n.devicesErrorPrintFailed)),
      );
    }
  }
}
