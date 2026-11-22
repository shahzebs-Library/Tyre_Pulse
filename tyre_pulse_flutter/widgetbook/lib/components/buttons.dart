import 'package:flutter/material.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

Widget _variant(
  BuildContext context,
  TpButtonVariant variant,
  String english,
  IconData icon,
) {
  final String label = labelKnob(context, english);
  final bool compact = context.knobs.boolean(label: 'Compact', initialValue: false);
  return CatalogueFrame(
    children: <Widget>[
      Labelled(
        'Default',
        TpButton(label: label, onPressed: noop, variant: variant, isCompact: compact),
      ),
      Labelled(
        'With icon',
        TpButton(
          label: label,
          onPressed: noop,
          variant: variant,
          icon: icon,
          isCompact: compact,
        ),
      ),
      Labelled(
        'Disabled (onPressed null)',
        TpButton(
          label: label,
          onPressed: null,
          variant: variant,
          icon: icon,
          isCompact: compact,
        ),
      ),
      Labelled(
        'Busy',
        TpButton(
          label: label,
          onPressed: noop,
          variant: variant,
          isBusy: true,
          isCompact: compact,
        ),
      ),
      Labelled(
        'Full width',
        TpButton(
          label: label,
          onPressed: noop,
          variant: variant,
          icon: icon,
          isFullWidth: true,
          isCompact: compact,
        ),
      ),
    ],
  );
}

@widgetbook.UseCase(name: 'Primary', type: TpButton, path: CataloguePath.buttons)
Widget buttonPrimary(BuildContext context) =>
    _variant(context, TpButtonVariant.primary, 'Save inspection', Icons.check);

@widgetbook.UseCase(name: 'Secondary', type: TpButton, path: CataloguePath.buttons)
Widget buttonSecondary(BuildContext context) =>
    _variant(context, TpButtonVariant.secondary, 'Scan asset', Icons.qr_code_scanner);

@widgetbook.UseCase(name: 'Danger', type: TpButton, path: CataloguePath.buttons)
Widget buttonDanger(BuildContext context) =>
    _variant(context, TpButtonVariant.danger, 'Reject', Icons.close);

@widgetbook.UseCase(name: 'Text', type: TpButton, path: CataloguePath.buttons)
Widget buttonText(BuildContext context) =>
    _variant(context, TpButtonVariant.text, 'View history', Icons.history);

@widgetbook.UseCase(name: 'All variants side by side', type: TpButton, path: CataloguePath.buttons)
Widget buttonAll(BuildContext context) {
  return CatalogueFrame(
    children: <Widget>[
      for (final TpButtonVariant v in TpButtonVariant.values)
        Labelled(
          v.name,
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              TpButton(label: 'Enabled', onPressed: noop, variant: v),
              TpButton(label: 'Disabled', onPressed: null, variant: v),
              TpButton(label: 'Busy', onPressed: noop, variant: v, isBusy: true),
              TpButton(
                label: 'Compact',
                onPressed: noop,
                variant: v,
                isCompact: true,
              ),
            ],
          ),
        ),
    ],
  );
}

@widgetbook.UseCase(
  name: 'Bottom action rail',
  type: TpBottomActionRail,
  path: CataloguePath.buttons,
)
Widget bottomActionRail(BuildContext context) {
  final String primary = labelKnob(context, 'Approve');
  final bool busy = context.knobs.boolean(label: 'Primary busy', initialValue: false);
  final bool disabled = context.knobs.boolean(label: 'Disabled', initialValue: false);
  return Align(
    alignment: Alignment.bottomCenter,
    child: TpBottomActionRail(
      secondaryLabel: 'Return',
      primaryLabel: primary,
      secondaryIcon: Icons.undo,
      primaryIcon: Icons.check,
      primaryBusy: busy,
      onSecondary: disabled ? null : noop,
      onPrimary: disabled ? null : noop,
    ),
  );
}
