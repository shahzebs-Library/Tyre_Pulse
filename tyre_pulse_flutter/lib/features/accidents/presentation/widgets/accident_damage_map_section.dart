/// The compact five-view damage mapper embedded in the accident report form.
///
/// Marks remain owned by the report screen. This widget owns only the active
/// fixed orthographic view and the selected-area editor lifecycle.
library;

import 'dart:async';

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
  static Key markRow(String markId) => Key('accident.damage.mark.$markId');
  static Key editMark(String markId) =>
      Key('accident.damage.mark.$markId.edit');
  static Key removeMark(String markId) =>
      Key('accident.damage.mark.$markId.remove');
}

/// Optional Finder/automation seam. Returning `null` keeps capture manual.
typedef AccidentDamageSuggestionResolver = FutureOr<AccidentDamageSuggestion?>
    Function(
  AccidentDamagePoint point,
  VehicleAsset? vehicle,
);

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
    this.suggestionResolver,
    this.photoEditor,
    this.reviewerId,
    super.key,
  });

  final AccidentDamageMap map;
  final ValueChanged<AccidentDamageMap> onChanged;
  final VehicleAsset? vehicle;
  final AccidentDamageSuggestionResolver? suggestionResolver;
  final AccidentDamagePhotoEditor? photoEditor;

  /// Stable user id/name written only when a Finder result is reviewed.
  /// No identity is fabricated when this is null.
  final String? reviewerId;

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

    AccidentDamageSuggestion? suggestion = existing?.suggestion;
    final AccidentDamageSuggestionResolver? resolver =
        widget.suggestionResolver;
    if (existing == null && resolver != null) {
      suggestion = await resolver(point, widget.vehicle);
      if (!mounted) return;
    }

    final String zoneId = existing?.zoneId ??
        '${point.view.name}_${(point.normalizedX * 1000).round()}_'
            '${(point.normalizedY * 1000).round()}';
    final AccidentDamageMark draft = AccidentDamageMark(
      zoneId: zoneId,
      view: point.view,
      normalizedX: existing?.normalizedX ?? point.normalizedX,
      normalizedY: existing?.normalizedY ?? point.normalizedY,
      areaLabel: existing?.areaLabel ??
          suggestion?.suggestedArea ??
          _suggestedArea(point),
      damageType: existing?.damageType ??
          suggestion?.suggestedType ??
          AccidentDamageType.other,
      severity: existing?.severity ?? AccidentDamageSeverity.minor,
      note: existing?.note,
      photoReferences: existing?.photoReferences ?? const <String>[],
      suggestion: suggestion,
    );
    await _openEditor(
      draft: draft,
      existing: existing,
      markerNumber: existing == null
          ? widget.map.count + 1
          : widget.map.markerNumberFor(existing.zoneId),
    );
  }

  Future<void> _openEditor({
    required AccidentDamageMark draft,
    required AccidentDamageMark? existing,
    required int? markerNumber,
  }) async {
    final AccidentDamageZoneSheetResult? result =
        await showAccidentDamageZoneSheet(
      context,
      draft: draft,
      existing: existing,
      markerNumber: markerNumber,
      photoEditor: widget.photoEditor,
      reviewerId: widget.reviewerId,
    );
    if (!mounted || result == null) return;
    switch (result) {
      case AccidentDamageZoneSheetSaved(mark: final AccidentDamageMark mark):
        widget.onChanged(widget.map.withMark(mark));
      case AccidentDamageZoneSheetRemoved():
        widget.onChanged(widget.map.withoutMark(draft.zoneId));
    }
  }

  Future<void> _editMark(AccidentDamageMark mark) => _openEditor(
        draft: mark,
        existing: mark,
        markerNumber: widget.map.markerNumberFor(mark.zoneId),
      );

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final List<AccidentDamageMark> marks = widget.map.marks;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(copy('damageMapHint')),
        const SizedBox(height: TpSpace.md),
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: <Widget>[
              for (final AccidentDamageView view in _viewOrder)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: TpSpace.xs),
                  child: KeyedSubtree(
                    key: AccidentDamageMapSectionKeys.viewTab(view),
                    child: ChoiceChip(
                      label: Text(_viewChipLabel(copy, view)),
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
        const SizedBox(height: TpSpace.sm),
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
        if (marks.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Column(
            key: AccidentDamageMapSectionKeys.marksSummary,
            children: <Widget>[
              for (int index = 0; index < marks.length; index++)
                _DamageMarkSummary(
                  number: index + 1,
                  mark: marks[index],
                  copy: copy,
                  onEdit: () => unawaited(_editMark(marks[index])),
                  onRemove: () => widget.onChanged(
                    widget.map.withoutMark(marks[index].zoneId),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }

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
  const _DamageMarkSummary({
    required this.number,
    required this.mark,
    required this.copy,
    required this.onEdit,
    required this.onRemove,
  });

  final int number;
  final AccidentDamageMark mark;
  final AccidentCopy copy;
  final VoidCallback onEdit;
  final VoidCallback onRemove;

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
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors markerColors = palette.forStatus(tone);

    return TpCard(
      key: AccidentDamageMapSectionKeys.markRow(mark.zoneId),
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      padding: const EdgeInsets.all(TpSpace.sm),
      onTap: onEdit,
      child: Row(
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: markerColors.base,
              shape: BoxShape.circle,
            ),
            child: SizedBox.square(
              dimension: 32,
              child: Center(
                child: Text(
                  '$number',
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: markerColors.onBase,
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  location,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                Text(
                  accidentDamageTypeLabel(context, mark.damageType),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: palette.textSecondary,
                      ),
                ),
                if (mark.note?.trim().isNotEmpty ?? false)
                  Text(
                    mark.note!.trim(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                if (mark.photoCount > 0 || mark.suggestion != null)
                  Wrap(
                    spacing: TpSpace.sm,
                    runSpacing: TpSpace.xs,
                    children: <Widget>[
                      if (mark.photoCount > 0)
                        _SummaryMeta(
                          icon: Icons.photo_outlined,
                          label: '${mark.photoCount}',
                        ),
                      if (mark.suggestion case final AccidentDamageSuggestion s)
                        _SummaryMeta(
                          icon: Icons.auto_awesome_outlined,
                          label: _suggestionDecisionLabel(context, s.decision),
                        ),
                    ],
                  ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.xs),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              TpStatusChip(
                status: tone,
                label: accidentDamageSeverityLabel(copy, mark.severity),
                isCompact: true,
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  IconButton(
                    key: AccidentDamageMapSectionKeys.editMark(mark.zoneId),
                    tooltip: _editDamageLabel(context),
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: onEdit,
                  ),
                  IconButton(
                    key: AccidentDamageMapSectionKeys.removeMark(mark.zoneId),
                    tooltip: copy('damageMarkRemove'),
                    visualDensity: VisualDensity.compact,
                    color: palette.critical.base,
                    icon: const Icon(Icons.delete_outline),
                    onPressed: onRemove,
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SummaryMeta extends StatelessWidget {
  const _SummaryMeta({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
        const SizedBox(width: TpSpace.xs),
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.textMuted,
              ),
        ),
      ],
    );
  }
}

String _editDamageLabel(BuildContext context) =>
    switch (Localizations.localeOf(context).languageCode) {
      'ar' => 'تعديل الضرر',
      'ur' => 'نقصان میں ترمیم کریں',
      _ => 'Edit damage',
    };

String _suggestionDecisionLabel(
  BuildContext context,
  AccidentDamageSuggestionDecision decision,
) {
  final String language = Localizations.localeOf(context).languageCode;
  return switch ((language, decision)) {
    ('ar', AccidentDamageSuggestionDecision.pending) => 'بانتظار التأكيد',
    ('ar', AccidentDamageSuggestionDecision.confirmed) => 'مؤكد',
    ('ar', AccidentDamageSuggestionDecision.corrected) => 'مصحح',
    ('ur', AccidentDamageSuggestionDecision.pending) => 'تصدیق زیر التوا',
    ('ur', AccidentDamageSuggestionDecision.confirmed) => 'تصدیق شدہ',
    ('ur', AccidentDamageSuggestionDecision.corrected) => 'درست شدہ',
    (_, AccidentDamageSuggestionDecision.pending) => 'Pending',
    (_, AccidentDamageSuggestionDecision.confirmed) => 'Confirmed',
    (_, AccidentDamageSuggestionDecision.corrected) => 'Corrected',
  };
}
