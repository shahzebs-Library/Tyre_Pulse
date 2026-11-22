import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

@widgetbook.UseCase(
  name: 'Domain icon set',
  type: TpAssetIcon,
  path: CataloguePath.foundations,
)
Widget assetIconSet(BuildContext context) {
  final TpPalette palette = TpPalette.of(context);
  final double size = context.knobs.double.slider(
    label: 'Size',
    initialValue: TpIconSize.lg,
    min: TpIconSize.sm,
    max: TpIconSize.xl,
    divisions: 4,
  );
  return CatalogueFrame(
    title: 'Domain icons, 16 to 32 pt',
    children: <Widget>[
      Wrap(
        spacing: 20,
        runSpacing: 20,
        children: <Widget>[
          for (final TpAssetIconKind kind in TpAssetIconKind.values)
            Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpAssetIcon(kind, size: size, color: palette.primary),
                const SizedBox(height: 6),
                Text(kind.name, style: Theme.of(context).textTheme.labelSmall),
              ],
            ),
        ],
      ),
    ],
  );
}
