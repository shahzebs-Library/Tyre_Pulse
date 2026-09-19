/// The damage mapper embedded in the accident report form (mocks M8-M10).
///
/// Marks remain owned by the report screen. This widget owns only the active
/// perspective chip, the selected-area card and the editor lifecycle. The
/// chips follow the shared `familyViewOrder` for the selected asset's family;
/// an unknown family gets the generic five views, never a borrowed one.
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
  /// The chip for one perspective (`front_left` is its own chip).
  static Key perspectiveTab(AccidentDamagePerspective perspective) =>
      Key('accident.damage.view.${perspective.token}');

  /// The chip for a plain orthographic side - kept for callers that only
  /// know the view.
  static Key viewTab(AccidentDamageView view) =>
      perspectiveTab(AccidentDamagePerspective.fromView(view));
  static const Key viewChips = Key('accident.damage.viewChips');
  static const Key diagram = Key('accident.damage.diagram');
  static const Key selectedSummary = Key('accident.damage.selectedSummary');
  static const Key selectedEdit = Key('accident.damage.selected.edit');
  static const Key selectedRemove = Key('accident.damage.selected.remove');
  static const Key marksToggle = Key('accident.damage.marksToggle');
  static const Key marksSummary = Key('accident.damage.marksSummary');
  static const Key viewAll = Key('accident.damage.viewAll');
  static const Key addArea = Key('accident.damage.addArea');
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
  late AccidentDamagePerspective _perspective = _perspectives.first;
  String? _selectedMarkId;
  bool _reviewExpanded = true;

  AccidentDamageAssetClass get _assetClass => widget.vehicle == null
      ? AccidentDamageAssetClass.legacy
      : accidentDamageAssetClassFor(
          assetNo: widget.vehicle!.assetNo,
          vehicleType: widget.vehicle!.vehicleType,
          make: widget.vehicle!.make,
          model: widget.vehicle!.model,
        );

  String get _family => accidentDamageFamilyFor(
        assetClass: _assetClass,
        assetNo: widget.vehicle?.assetNo,
        vehicleType: widget.vehicle?.vehicleType,
        make: widget.vehicle?.make,
        model: widget.vehicle?.model,
      );

  List<AccidentDamagePerspective> get _perspectives =>
      accidentDamagePerspectivesFor(_family);

  AccidentDamageView get _view => _perspective.baseView;

  @override
  void didUpdateWidget(covariant AccidentDamageMapSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A different asset opens on its own family's first view (a pump on
    // Top, a road vehicle on Left); keeping the previous asset's view would
    // land the reporter on a side that means nothing for the new one.
    if (oldWidget.vehicle?.id != widget.vehicle?.id) {
      _perspective = _perspectives.first;
      _selectedMarkId = null;
    }
  }

  Future<void> _addArea() async {
    final AccidentCopy copy = AccidentCopy.of(context);
    final List<AccidentDamageZone> zones = accidentDamageZonesFor(
      _view,
      assetClass: _assetClass,
    ).where((zone) => widget.map.markFor(zone.id) == null).toList();
    final AccidentDamageZone? zone =
        await showModalBottomSheet<AccidentDamageZone>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Text(
                _localized(
                  context,
                  en: 'Add another area',
                  ar: 'إضافة منطقة أخرى',
                  ur: 'ایک اور حصہ شامل کریں',
                ),
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            if (zones.isEmpty)
              Padding(
                padding: const EdgeInsets.all(TpSpace.md),
                child: Text(
                  _localized(
                    context,
                    en: 'All areas in this view are marked. '
                        'Choose another view.',
                    ar: 'تم تحديد كل المناطق في هذا المنظر. اختر منظراً آخر.',
                    ur: 'اس منظر کے تمام حصے نشان زد ہیں۔ دوسرا منظر چنیں۔',
                  ),
                ),
              ),
            for (final AccidentDamageZone zone in zones)
              ListTile(
                title: Text(accidentDamageZoneLabel(copy, zone.id)),
                onTap: () => Navigator.of(context).pop(zone),
              ),
          ],
        ),
      ),
    );
    if (!mounted || zone == null) return;
    await _tapPoint(
      AccidentDamagePoint(
        view: zone.view,
        normalizedX: zone.left + zone.width / 2,
        normalizedY: zone.top + zone.height / 2,
      ),
    );
  }

  Future<void> _tapPoint(AccidentDamagePoint point) async {
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentDamageZone? zone = accidentDamageZoneAt(
      point.view,
      point.normalizedX,
      point.normalizedY,
      assetClass: _assetClass,
    );

    // The artwork includes whitespace, shadows and background. Those pixels
    // are not vehicle components and must never create a generic damage mark.
    // A registered zone is the identity boundary: tapping another component,
    // even one beside an existing pin, always opens that other component.
    if (zone == null) return;

    final AccidentDamageMark? existing = widget.map.markFor(zone.id);

    AccidentDamageSuggestion? suggestion = existing?.suggestion;
    final AccidentDamageSuggestionResolver? resolver =
        widget.suggestionResolver;
    if (existing == null && resolver != null) {
      suggestion = await resolver(point, widget.vehicle);
      if (!mounted) return;
    }

    final AccidentDamageMark draft = AccidentDamageMark(
      zoneId: zone.id,
      view: zone.view,
      // An angled chip (bus Front-left) is recorded as its own perspective;
      // a plain side is fully described by the view.
      perspective: existing != null
          ? existing.perspective
          : (_perspective.isAngled ? _perspective : null),
      normalizedX: existing?.normalizedX ?? point.normalizedX,
      normalizedY: existing?.normalizedY ?? point.normalizedY,
      // Component identity comes from the audited zone catalog, not from a
      // fleet-class guess or a nearby automated suggestion. The reporter can
      // still edit the label in the review sheet when the selected asset has
      // a more specific configured component name.
      areaLabel: existing?.areaLabel ?? accidentDamageZoneLabel(copy, zone.id),
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
        setState(() => _selectedMarkId = mark.zoneId);
        widget.onChanged(widget.map.withMark(mark));
      case AccidentDamageZoneSheetRemoved():
        _removeMark(draft.zoneId);
    }
  }

  Future<void> _editMark(AccidentDamageMark mark) => _openEditor(
        draft: mark,
        existing: mark,
        markerNumber: widget.map.markerNumberFor(mark.zoneId),
      );

  void _removeMark(String zoneId) {
    if (_selectedMarkId == zoneId) {
      setState(() => _selectedMarkId = null);
    }
    widget.onChanged(widget.map.withoutMark(zoneId));
  }

  void _selectPerspective(AccidentDamagePerspective perspective) {
    setState(() {
      _perspective = perspective;
      _selectedMarkId = null;
    });
  }

  Future<void> _viewAllMarks() async {
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentDamageMark? chosen =
        await showModalBottomSheet<AccidentDamageMark>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (BuildContext context) => SafeArea(
        top: false,
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .7,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  TpSpace.lg,
                  0,
                  TpSpace.lg,
                  TpSpace.sm,
                ),
                child: Text(
                  _markedAreasLabel(context, widget.map.count),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
                  children: <Widget>[
                    for (int index = 0;
                        index < widget.map.marks.length;
                        index++)
                      _DamageMarkSummary(
                        number: index + 1,
                        mark: widget.map.marks[index],
                        copy: copy,
                        onEdit: () =>
                            Navigator.of(context).pop(widget.map.marks[index]),
                        onRemove: null,
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted || chosen == null) return;
    final AccidentDamagePerspective? perspective = chosen.effectivePerspective;
    if (perspective != null && _perspectives.contains(perspective)) {
      setState(() {
        _perspective = perspective;
        _selectedMarkId = chosen.zoneId;
      });
    }
    await _editMark(chosen);
  }

  AccidentDamageZone? _zoneOf(String zoneId) {
    for (final AccidentDamageZone zone
        in accidentDamageZonesFor(_view, assetClass: _assetClass)) {
      if (zone.id == zoneId) return zone;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final List<AccidentDamageMark> marks = widget.map.marks;
    final List<AccidentDamageMark> visibleMarks = marks
        .where((mark) => mark.effectivePerspective == _perspective)
        .toList();
    final AccidentDamageMark? selected = visibleMarks
            .where((mark) => mark.zoneId == _selectedMarkId)
            .firstOrNull ??
        visibleMarks.firstOrNull;
    final String? selectedLabel = selected == null
        ? null
        : selected.areaLabel ?? accidentDamageZoneLabel(copy, selected.zoneId);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _PerspectiveChips(
          perspectives: _perspectives,
          selected: _perspective,
          map: widget.map,
          onSelected: _selectPerspective,
        ),
        const SizedBox(height: TpSpace.sm),
        KeyedSubtree(
          key: AccidentDamageMapSectionKeys.diagram,
          child: VehicleDamageDiagram(
            view: _view,
            map: widget.map,
            vehicle: widget.vehicle,
            onPointTap: _tapPoint,
            selectedZoneId: selected?.zoneId,
            selectedAreaLabel: selectedLabel,
            selectedMarkNumber: selected == null
                ? null
                : widget.map.markerNumberFor(selected.zoneId),
            hatchedZone: selected == null ? null : _zoneOf(selected.zoneId),
            perspectiveBadge: _perspective.isAngled
                ? accidentDamagePerspectiveLabel(context, _perspective)
                : null,
          ),
        ),
        if (selected != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          _SelectedAreaCard(
            mark: selected,
            label: selectedLabel!,
            onEdit: () => unawaited(_editMark(selected)),
            onRemove: () => _removeMark(selected.zoneId),
          ),
        ],
        const SizedBox(height: TpSpace.sm),
        TpButton.secondary(
          key: AccidentDamageMapSectionKeys.addArea,
          label: _localized(
            context,
            en: 'Add another area',
            ar: 'إضافة منطقة أخرى',
            ur: 'ایک اور حصہ شامل کریں',
          ),
          icon: Icons.add_circle_outline,
          onPressed: () => unawaited(_addArea()),
          isFullWidth: true,
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          copy('damageMapHint'),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: TpSpace.md),
        _MarksHeader(
          count: marks.length,
          expanded: _reviewExpanded,
          onToggle: marks.isEmpty
              ? null
              : () => setState(() => _reviewExpanded = !_reviewExpanded),
        ),
        if (marks.isNotEmpty && _reviewExpanded) ...<Widget>[
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
                  onRemove: () => _removeMark(marks[index].zoneId),
                ),
            ],
          ),
        ],
        if (marks.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          TpButton.text(
            key: AccidentDamageMapSectionKeys.viewAll,
            label: _localized(
              context,
              en: 'View all ${marks.length} marked '
                  '${marks.length == 1 ? 'area' : 'areas'}',
              ar: 'عرض كل المناطق المحددة (${marks.length})',
              ur: 'تمام ${marks.length} نشان زدہ حصے دیکھیں',
            ),
            icon: Icons.list_alt_outlined,
            onPressed: () => unawaited(_viewAllMarks()),
            isFullWidth: true,
          ),
        ],
      ],
    );
  }
}

class _PerspectiveChips extends StatelessWidget {
  const _PerspectiveChips({
    required this.perspectives,
    required this.selected,
    required this.map,
    required this.onSelected,
  });

  final List<AccidentDamagePerspective> perspectives;
  final AccidentDamagePerspective selected;
  final AccidentDamageMap map;
  final ValueChanged<AccidentDamagePerspective> onSelected;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      key: AccidentDamageMapSectionKeys.viewChips,
      decoration: BoxDecoration(
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(TpRadius.md - 1),
        child: Row(
          children: <Widget>[
            for (int index = 0;
                index < perspectives.length;
                index++) ...<Widget>[
              if (index > 0)
                SizedBox(
                  width: 1,
                  height: 48,
                  child: ColoredBox(color: palette.border),
                ),
              Expanded(
                child: _PerspectiveChip(
                  key: AccidentDamageMapSectionKeys.perspectiveTab(
                    perspectives[index],
                  ),
                  perspective: perspectives[index],
                  selected: selected == perspectives[index],
                  label: accidentDamagePerspectiveLabel(
                    context,
                    perspectives[index],
                  ),
                  count: map.countForPerspective(perspectives[index]),
                  onTap: () => onSelected(perspectives[index]),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PerspectiveChip extends StatelessWidget {
  const _PerspectiveChip({
    required this.perspective,
    required this.selected,
    required this.label,
    required this.count,
    required this.onTap,
    super.key,
  });

  final AccidentDamagePerspective perspective;
  final bool selected;
  final String label;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Material(
      color: selected ? palette.primarySoft : Colors.transparent,
      child: Semantics(
        button: true,
        selected: selected,
        label: count == 0 ? label : '$label, $count',
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: 2,
                vertical: TpSpace.xs,
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Icon(
                    _perspectiveIcon(perspective),
                    size: TpSizing.iconSm,
                    color: selected ? palette.primary : palette.textMuted,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    count == 0 ? label : '$label $count',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: selected
                              ? palette.primary
                              : palette.textSecondary,
                          fontWeight:
                              selected ? FontWeight.w700 : FontWeight.w500,
                        ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

IconData _perspectiveIcon(AccidentDamagePerspective perspective) =>
    switch (perspective) {
      AccidentDamagePerspective.left ||
      AccidentDamagePerspective.right =>
        Icons.airport_shuttle_outlined,
      AccidentDamagePerspective.frontLeft => Icons.rotate_left_outlined,
      AccidentDamagePerspective.front ||
      AccidentDamagePerspective.rear =>
        Icons.directions_car_outlined,
      AccidentDamagePerspective.top => Icons.crop_portrait_outlined,
    };

/// The mock's selected-area card: label, "type · level · photos", Edit and
/// Remove.
class _SelectedAreaCard extends StatelessWidget {
  const _SelectedAreaCard({
    required this.mark,
    required this.label,
    required this.onEdit,
    required this.onRemove,
  });

  final AccidentDamageMark mark;
  final String label;
  final VoidCallback onEdit;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String photos = _localized(
      context,
      en: mark.photoCount == 1 ? '1 photo' : '${mark.photoCount} photos',
      ar: '${mark.photoCount} صور',
      ur: '${mark.photoCount} تصاویر',
    );
    return TpCard(
      key: AccidentDamageMapSectionKeys.selectedSummary,
      padding: const EdgeInsets.all(TpSpace.md),
      borderColor: palette.primary,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            _localized(
              context,
              en: 'Selected area · $label',
              ar: 'المنطقة المحددة · $label',
              ur: 'منتخب حصہ · $label',
            ),
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            '${accidentDamageTypeLabel(context, mark.damageType)} · '
            '${accidentDamageLevelLabel(context, mark.severity)} · '
            '$photos',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: palette.textSecondary,
                ),
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: TpButton.secondary(
                  key: AccidentDamageMapSectionKeys.selectedEdit,
                  label: _localized(
                    context,
                    en: 'Edit',
                    ar: 'تعديل',
                    ur: 'ترمیم',
                  ),
                  icon: Icons.edit_outlined,
                  isCompact: true,
                  onPressed: onEdit,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: TpButton.danger(
                  key: AccidentDamageMapSectionKeys.selectedRemove,
                  label: _localized(
                    context,
                    en: 'Remove',
                    ar: 'إزالة',
                    ur: 'ہٹائیں',
                  ),
                  icon: Icons.delete_outline,
                  isCompact: true,
                  onPressed: onRemove,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// "N marked areas · Review list" - the collapsible header of the list.
class _MarksHeader extends StatelessWidget {
  const _MarksHeader({
    required this.count,
    required this.expanded,
    required this.onToggle,
  });

  final int count;
  final bool expanded;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String title = count == 0
        ? _localized(
            context,
            en: 'No areas marked yet',
            ar: 'لم تُحدد أي منطقة بعد',
            ur: 'ابھی کوئی حصہ نشان زد نہیں',
          )
        : '${_markedAreasLabel(context, count)} · '
            '${_localized(
            context,
            en: 'Review list',
            ar: 'قائمة المراجعة',
            ur: 'جائزہ فہرست',
          )}';
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: AccidentDamageMapSectionKeys.marksToggle,
        onTap: onToggle,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              if (onToggle != null)
                Icon(
                  expanded ? Icons.expand_less : Icons.expand_more,
                  color: palette.textMuted,
                ),
            ],
          ),
        ),
      ),
    );
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
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final AccidentDamagePerspective? perspective = mark.effectivePerspective;
    final String location = <String>[
      if (perspective != null)
        accidentDamagePerspectiveLabel(context, perspective),
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
                label: accidentDamageLevelLabel(context, mark.severity),
                isCompact: true,
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  IconButton(
                    key: AccidentDamageMapSectionKeys.editMark(mark.zoneId),
                    tooltip: _localized(
                      context,
                      en: 'Edit damage',
                      ar: 'تعديل الضرر',
                      ur: 'نقصان میں ترمیم کریں',
                    ),
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: onEdit,
                  ),
                  if (onRemove != null)
                    IconButton(
                      key: AccidentDamageMapSectionKeys.removeMark(mark.zoneId),
                      tooltip: _localized(
                        context,
                        en: 'Remove',
                        ar: 'إزالة',
                        ur: 'ہٹائیں',
                      ),
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

String _markedAreasLabel(BuildContext context, int count) => _localized(
      context,
      en: count == 1 ? '1 marked area' : '$count marked areas',
      ar: '$count مناطق محددة',
      ur: '$count نشان زدہ حصے',
    );

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

String _localized(
  BuildContext context, {
  required String en,
  required String ar,
  required String ur,
}) =>
    switch (Localizations.localeOf(context).languageCode) {
      'ar' => ar,
      'ur' => ur,
      _ => en,
    };
