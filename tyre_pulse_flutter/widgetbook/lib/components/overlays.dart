import 'package:flutter/material.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

/// The overlays are opened from a button, the way a screen opens them, so
/// the scrim, the shape and the safe-area handling are the real ones.
@widgetbook.UseCase(name: 'Open a sheet', type: TpBottomSheet, path: CataloguePath.overlays)
Widget bottomSheet(BuildContext context) {
  final String title = labelKnob(context, 'Take action');
  final bool dismissible = context.knobs.boolean(label: 'Dismissible', initialValue: true);
  return Center(
    child: Builder(
      builder: (BuildContext inner) => TpButton(
        label: 'Open bottom sheet',
        onPressed: () => TpBottomSheet.show<void>(
          context: inner,
          title: title,
          isDismissible: dismissible,
          builder: (BuildContext sheet) => Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const TpActionRow(label: 'Rotate tyre', icon: Icons.sync),
                const TpActionRow(label: 'Mark as scrap', icon: Icons.delete_outline),
                const SizedBox(height: 12),
                TpButton(
                  label: 'Close',
                  onPressed: () => Navigator.of(sheet).pop(),
                  variant: TpButtonVariant.secondary,
                  isFullWidth: true,
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

@widgetbook.UseCase(name: 'Confirm', type: TpDialog, path: CataloguePath.overlays)
Widget confirmDialog(BuildContext context) {
  final String message = labelKnob(context, 'The inspection will be sent for approval.');
  final bool destructive = context.knobs.boolean(label: 'Destructive', initialValue: false);
  return Center(
    child: Builder(
      builder: (BuildContext inner) => TpButton(
        label: 'Open dialog',
        onPressed: () => TpDialog.confirm(
          context: inner,
          title: destructive ? 'Discard draft?' : 'Submit inspection?',
          message: message,
          isDestructive: destructive,
        ),
      ),
    ),
  );
}
