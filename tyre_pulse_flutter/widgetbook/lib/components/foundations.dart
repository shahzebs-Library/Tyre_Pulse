import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/app/theme/tp_typography.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

/// Renders the current [TpPalette]: switch the theme addon to compare light
/// and dark side by side with the same names.
class ColourTokens extends StatelessWidget {
  const ColourTokens({super.key});

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    final List<(String, Color)> roles = <(String, Color)>[
      ('background', p.background),
      ('surface', p.surface),
      ('surfaceAlt', p.surfaceAlt),
      ('surfaceSunken', p.surfaceSunken),
      ('text', p.text),
      ('textSecondary', p.textSecondary),
      ('textMuted', p.textMuted),
      ('textInverse', p.textInverse),
      ('primary', p.primary),
      ('primaryDark', p.primaryDark),
      ('primarySoft', p.primarySoft),
      ('onPrimary', p.onPrimary),
      ('border', p.border),
      ('borderStrong', p.borderStrong),
      ('controlBorder', p.controlBorder),
      ('focus', p.focus),
      ('overlay', p.overlay),
    ];
    return CatalogueFrame(
      title: 'Colour roles (${p.brightness.name})',
      children: <Widget>[
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final (String, Color) r in roles)
              _Swatch(name: r.$1, color: r.$2),
          ],
        ),
        Text('Status', style: Theme.of(context).textTheme.titleMedium),
        for (final TpStatus s in TpStatus.values)
          Row(
            children: <Widget>[
              SizedBox(
                width: 72,
                child: Text(s.name, style: Theme.of(context).textTheme.labelMedium),
              ),
              Expanded(child: _Swatch(name: 'base', color: p.forStatus(s).base)),
              const SizedBox(width: TpSpace.xs),
              Expanded(child: _Swatch(name: 'soft', color: p.forStatus(s).soft)),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: _Swatch(name: 'onSoft', color: p.forStatus(s).onSoft),
              ),
            ],
          ),
      ],
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch({required this.name, required this.color});

  final String name;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    final String hex = color
        .toARGB32()
        .toRadixString(16)
        .padLeft(8, '0')
        .toUpperCase();
    return SizedBox(
      width: 150,
      child: Row(
        children: <Widget>[
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: color,
              border: Border.all(color: p.borderStrong),
              borderRadius: BorderRadius.circular(TpRadius.sm),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  name,
                  style: Theme.of(context).textTheme.labelMedium,
                  overflow: TextOverflow.ellipsis,
                ),
                Text('#$hex', style: Theme.of(context).textTheme.labelSmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class TypeScale extends StatelessWidget {
  const TypeScale({super.key});

  @override
  Widget build(BuildContext context) {
    final TextTheme t = Theme.of(context).textTheme;
    final TpPalette p = TpPalette.of(context);
    final List<(String, TextStyle?)> styles = <(String, TextStyle?)>[
      ('displaySmall', t.displaySmall),
      ('headlineMedium', t.headlineMedium),
      ('headlineSmall', t.headlineSmall),
      ('titleLarge', t.titleLarge),
      ('titleMedium', t.titleMedium),
      ('bodyLarge', t.bodyLarge),
      ('bodyMedium', t.bodyMedium),
      ('labelLarge', t.labelLarge),
      ('labelMedium', t.labelMedium),
      ('labelSmall', t.labelSmall),
      ('identifier', TpTypography.identifier(p)),
    ];
    final String sample = labelKnob(context, 'Inspection saved on this device');
    return CatalogueFrame(
      title: 'Type scale',
      children: <Widget>[
        for (final (String, TextStyle?) s in styles)
          Labelled(
            '${s.$1}  ${s.$2?.fontSize?.toStringAsFixed(0)} / '
            'w${s.$2?.fontWeight?.value}',
            Text(s.$1 == 'identifier' ? 'TM-1042  LHF1  YMN50625' : sample,
                style: s.$2),
          ),
      ],
    );
  }
}

class SpacingAndRadius extends StatelessWidget {
  const SpacingAndRadius({super.key});

  @override
  Widget build(BuildContext context) {
    final TpPalette p = TpPalette.of(context);
    const List<(String, double)> space = <(String, double)>[
      ('xs', TpSpace.xs),
      ('sm', TpSpace.sm),
      ('md', TpSpace.md),
      ('lg', TpSpace.lg),
      ('xl', TpSpace.xl),
      ('xxl', TpSpace.xxl),
      ('xxxl', TpSpace.xxxl),
      ('huge', TpSpace.huge),
    ];
    const List<(String, double)> radii = <(String, double)>[
      ('sm', TpRadius.sm),
      ('md', TpRadius.md),
      ('lg', TpRadius.lg),
      ('xl', TpRadius.xl),
      ('pill', TpRadius.pill),
    ];
    return CatalogueFrame(
      title: 'Spacing, radius and sizing',
      children: <Widget>[
        for (final (String, double) s in space)
          Row(
            children: <Widget>[
              Expanded(child: Text('TpSpace.${s.$1} ${s.$2.toStringAsFixed(0)}')),
              Container(width: s.$2 * 4, height: TpSpace.md, color: p.primary),
            ],
          ),
        Wrap(
          spacing: TpSpace.md,
          runSpacing: TpSpace.md,
          children: <Widget>[
            for (final (String, double) r in radii)
              Container(
                width: 88,
                height: 56,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: p.surfaceAlt,
                  border: Border.all(color: p.borderStrong),
                  borderRadius: BorderRadius.circular(r.$2),
                ),
                child: Text('radius ${r.$1}'),
              ),
          ],
        ),
        Labelled(
          'TpSizing.minTouchTarget 48 / controlHeight 52 / compact 40',
          Wrap(
            spacing: TpSpace.sm,
            children: <Widget>[
              for (final double h in <double>[
                TpSizing.minTouchTarget,
                TpSizing.controlHeight,
                TpSizing.controlHeightCompact,
              ])
                Container(
                  width: 72,
                  height: h,
                  alignment: Alignment.center,
                  color: p.primarySoft,
                  child: Text(h.toStringAsFixed(0)),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

@widgetbook.UseCase(
  name: 'Colour roles',
  type: ColourTokens,
  path: CataloguePath.foundations,
)
Widget colourTokens(BuildContext context) => const ColourTokens();

@widgetbook.UseCase(
  name: 'Type scale',
  type: TypeScale,
  path: CataloguePath.foundations,
)
Widget typeScale(BuildContext context) => const TypeScale();

@widgetbook.UseCase(
  name: 'Spacing, radius and sizing',
  type: SpacingAndRadius,
  path: CataloguePath.foundations,
)
Widget spacingAndRadius(BuildContext context) => const SpacingAndRadius();
