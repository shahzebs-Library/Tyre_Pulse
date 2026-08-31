/// The damage-map section embedded in the accident report form: a
/// Front/Rear/Left/Right/Top view switcher over [VehicleDamageDiagram],
/// opening [showAccidentDamageZoneSheet] on a zone tap.
///
/// Stateless with respect to the marks themselves - [map] and [onChanged]
/// are owned by the caller (the report screen), the same ownership split
/// `TyrePositionReading` uses with the inspection wizard: this widget only
/// decides WHICH view is showing right now.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_damage_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_damage_zone_sheet.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/vehicle_damage_diagram.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

@visibleForTesting
abstract final class AccidentDamageMapSectionKeys {
  static Key viewTab(AccidentDamageView view) =>
      Key('accident.damage.view.${view.name}');
  static const Key diagram = Key('accident.damage.diagram');
  static const Key marksSummary = Key('accident.damage.marksSummary');
}

const List<AccidentDamageView> _viewOrder = <AccidentDamageView>[
  AccidentDamageView.front,
  AccidentDamageView.rear,
  AccidentDamageView.top,
  AccidentDamageView.left,
  AccidentDamageView.right,
];

class AccidentDamageMapSection extends StatefulWidget {
  const AccidentDamageMapSection({
    required this.map,
    required this.onChanged,
    this.vehicle,
    super.key,
  });

  final AccidentDamageMap map;
  final ValueChanged<AccidentDamageMap> onChanged;
  final VehicleAsset? vehicle;

  @override
  State<AccidentDamageMapSection> createState() =>
      _AccidentDamageMapSectionState();
}

class _AccidentDamageMapSectionState extends State<AccidentDamageMapSection> {
  AccidentDamageView _view = AccidentDamageView.front;

  Future<void> _tapPoint(AccidentDamagePoint point) async {
    AccidentDamageMark? existing;
    for (final AccidentDamageMark mark in widget.map.marks) {
      if (mark.effectiveView != point.view || !mark.hasExactPoint) continue;
      final double dx = mark.normalizedX! - point.normalizedX;
      final double dy = mark.normalizedY! - point.normalizedY;
      if (dx * dx + dy * dy <= .0036) {
        existing = mark;
        break;
      }
    }
    final String zoneId = existing?.zoneId ??
        '${point.view.name}_${(point.normalizedX * 1000).round()}_'
            '${(point.normalizedY * 1000).round()}';
    final AccidentDamageMark draft = AccidentDamageMark(
      zoneId: zoneId,
      view: point.view,
      normalizedX: existing?.normalizedX ?? point.normalizedX,
      normalizedY: existing?.normalizedY ?? point.normalizedY,
      areaLabel: existing?.areaLabel ?? _suggestedArea(point),
      severity: existing?.severity ?? AccidentDamageSeverity.minor,
      note: existing?.note,
    );
    final AccidentDamageZoneSheetResult? result =
        await showAccidentDamageZoneSheet(
      context,
      draft: draft,
      existing: existing,
    );
    if (result == null) return;
    switch (result) {
      case AccidentDamageZoneSheetSaved(mark: final AccidentDamageMark mark):
        widget.onChanged(widget.map.withMark(mark));
      case AccidentDamageZoneSheetRemoved():
        widget.onChanged(widget.map.withoutMark(zoneId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(copy('damageMapHint')),
        const SizedBox(height: TpSpace.md),
        SizedBox(
          height: 36,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: <Widget>[
              for (final AccidentDamageView view in _viewOrder)
                Padding(
                  padding: const EdgeInsets.only(right: TpSpace.xs),
                  child: KeyedSubtree(
                    key: AccidentDamageMapSectionKeys.viewTab(view),
                    child: ChoiceChip(
                      label: Text(
                        _viewChipLabel(copy, view),
                      ),
                      selected: _view == view,
                      onSelected: (bool _) => setState(() => _view = view),
                      showCheckmark: false,
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.md),
        KeyedSubtree(
          key: AccidentDamageMapSectionKeys.diagram,
          child: VehicleDamageDiagram(
            view: _view,
            map: widget.map,
            vehicle: widget.vehicle,
            onPointTap: _tapPoint,
          ),
        ),
        const SizedBox(height: TpSpace.md),
        Text(
          widget.map.isEmpty
              ? copy('damageMapNoneMarked')
              : '${widget.map.count} ${copy('damageMapZonesLabel')}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (!widget.map.isEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Column(
            key: AccidentDamageMapSectionKeys.marksSummary,
            children: <Widget>[
              for (final AccidentDamageMark mark in widget.map.marks)
                _DamageMarkSummary(mark: mark, copy: copy),
            ],
          ),
        ],
      ],
    );
  }

  /// The view's own label plus how many of ITS zones are marked, so
  /// switching views never hides a mark the user already made elsewhere -
  /// see `AccidentDamageMap.countForView`'s own doc comment.
  String _viewChipLabel(AccidentCopy copy, AccidentDamageView view) {
    final String label = accidentDamageViewLabel(copy, view);
    final int count = widget.map.exactCountForView(view);
    return count == 0 ? label : '$label ($count)';
  }

  String _suggestedArea(AccidentDamagePoint point) {
    final VehicleAsset? vehicle = widget.vehicle;
    final String description = <String?>[
      vehicle?.vehicleType,
      vehicle?.model,
      vehicle?.make,
      vehicle?.assetNo,
    ].whereType<String>().join(' ').toLowerCase();
    if (description.contains('concrete pump') ||
        description.contains('line pump')) {
      return point.normalizedY < .56 ? 'Boom' : 'Chassis';
    }
    if (description.contains('mixer')) {
      return point.normalizedY < .58 ? 'Mixer drum' : 'Chassis';
    }
    if (description.contains('wheel loader') ||
        description.contains('skid loader')) {
      return point.normalizedY > .48 ? 'Bucket / running gear' : 'Loader body';
    }
    if (description.contains('pickup') ||
        description.contains('double cab') ||
        description.contains('xenon')) {
      return point.normalizedX > .58 ? 'Cargo bed' : 'Cab';
    }
    if (description.contains('bus') || description.contains('hiace')) {
      return 'Bus body';
    }
    if (description.contains('chiller') ||
        description.contains('generator') ||
        description.contains('plant') ||
        description.contains('stationary') ||
        description.contains('placing boom')) {
      return 'Equipment body';
    }
    return 'Vehicle body';
  }
}

class _DamageMarkSummary extends StatelessWidget {
  const _DamageMarkSummary({required this.mark, required this.copy});

  final AccidentDamageMark mark;
  final AccidentCopy copy;

  @override
  Widget build(BuildContext context) {
    final AccidentDamageView? view = mark.effectiveView;
    final String location = <String>[
      if (view != null) accidentDamageViewLabel(copy, view),
      mark.areaLabel ?? accidentDamageZoneLabel(copy, mark.zoneId),
    ].join(' • ');
    final TpStatus tone = switch (mark.severity) {
      AccidentDamageSeverity.minor => TpStatus.info,
      AccidentDamageSeverity.moderate => TpStatus.warning,
      AccidentDamageSeverity.severe => TpStatus.critical,
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  location,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                if (mark.note?.trim().isNotEmpty ?? false)
                  Text(
                    mark.note!.trim(),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                if (mark.hasExactPoint)
                  Text(
                    'X ${(mark.normalizedX! * 100).round()}% / '
                    'Y ${(mark.normalizedY! * 100).round()}%',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          TpStatusChip(
            status: tone,
            label: accidentDamageSeverityLabel(copy, mark.severity),
            isCompact: true,
          ),
        ],
      ),
    );
  }
}
