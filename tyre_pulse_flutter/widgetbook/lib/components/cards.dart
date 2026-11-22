import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

@widgetbook.UseCase(name: 'Variants', type: TpCard, path: CataloguePath.cards)
Widget cardVariants(BuildContext context) {
  final String body = labelKnob(context, 'Front left steer tyre checked at 08:40');
  final TpPalette p = TpPalette.of(context);
  Widget content(String title) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Text(title, style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 4),
      Text(body, style: Theme.of(context).textTheme.bodyMedium),
    ],
  );
  return CatalogueFrame(
    children: <Widget>[
      Labelled('Static', TpCard(child: content('Last inspection'))),
      Labelled('Tappable', TpCard(onTap: noop, child: content('Open job card'))),
      Labelled(
        'Dashed (not measured)',
        TpCard(isDashed: true, child: content('No reading recorded')),
      ),
      Labelled(
        'Status border and tint',
        TpCard(
          borderColor: p.critical.base,
          background: p.critical.soft,
          child: content('Tyre flat - stop the vehicle'),
        ),
      ),
    ],
  );
}

@widgetbook.UseCase(name: 'All statuses', type: TpAssetCard, path: CataloguePath.cards)
Widget assetCards(BuildContext context) {
  final String description = labelKnob(context, 'Transit mixer 10m3');
  final bool tappable = context.knobs.boolean(label: 'Tappable', initialValue: true);
  return CatalogueFrame(
    children: <Widget>[
      for (final TpStatus s in TpStatus.values)
        TpAssetCard(
          asset: TpAssetSummary(
            assetNo: 'TM-10${s.index}',
            description: description,
            siteName: 'NHC Riyadh',
            status: s,
            detail: s == TpStatus.unknown ? null : 'Last checked 2 days ago',
          ),
          onTap: tappable ? noop : null,
        ),
      const TpAssetCard(asset: TpAssetSummary(assetNo: 'GN-7')),
    ],
  );
}

@widgetbook.UseCase(name: 'Count, text, zero, unavailable', type: TpStatCard, path: CataloguePath.cards)
Widget statCards(BuildContext context) {
  final String label = labelKnob(context, 'Open job cards');
  return CatalogueFrame(
    children: <Widget>[
      // Content-sized on purpose: a fixed grid cell clips this card (see the
      // known defect recorded in the render test and the inventory doc).
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: <Widget>[
          TpStatCard.count(
            label: label,
            count: 14,
            caption: 'Since Sunday',
            status: TpStatus.warning,
            icon: Icons.build_outlined,
            onTap: noop,
          ),
          TpStatCard.count(label: 'Critical tyres', count: 0, status: TpStatus.ok),
          TpStatCard.text(
            label: 'Pressure compliance',
            value: '92%',
            caption: '412 readings',
            status: TpStatus.ok,
          ),
          TpStatCard.unavailable(
            label: 'Cost per km',
            caption: 'No meter readings',
            icon: Icons.speed,
          ),
        ],
      ),
    ],
  );
}

@widgetbook.UseCase(name: 'States', type: TpTyreChip, path: CataloguePath.tyres)
Widget tyreChips(BuildContext context) {
  final bool selected = context.knobs.boolean(label: 'Selected', initialValue: false);
  return CatalogueFrame(
    children: <Widget>[
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: <Widget>[
          for (final TpStatus s in TpStatus.values)
            TpTyreChip(
              data: TpTyreChipData(
                position: 'LHF${s.index + 1}',
                serial: s == TpStatus.unknown ? null : 'YMN5062${s.index}',
                status: s,
                detail: s == TpStatus.unknown ? null : '${12 - s.index} mm',
              ),
              isSelected: selected,
              onTap: noop,
            ),
        ],
      ),
    ],
  );
}

/// Shows how the text-scale helpers grow a fixed-height tile. Use the text
/// scale addon at 2.0 to see the extra room appear.
class TextScaledTile extends StatelessWidget {
  const TextScaledTile({super.key});

  @override
  Widget build(BuildContext context) {
    final double height = tpTextScaledExtent(context, base: 88, textHeight: 44);
    return CatalogueFrame(
      children: <Widget>[
        Text('Scale factor ${tpTextScaleFactor(context).toStringAsFixed(2)}, '
            'tile height ${height.toStringAsFixed(0)}'),
        SizedBox(
          height: height,
          child: const TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('Wash type', maxLines: 1, overflow: TextOverflow.ellipsis),
                Text(
                  'Exterior and chassis',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

@widgetbook.UseCase(name: 'Text-scaled fixed tile', type: TextScaledTile, path: CataloguePath.cards)
Widget textScaledTile(BuildContext context) => const TextScaledTile();
