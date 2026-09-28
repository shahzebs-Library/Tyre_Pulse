/// Compact selected-area editor opened from [VehicleDamageDiagram].
///
/// The sheet owns no persistence or media I/O. It returns one immutable mark
/// and exposes [AccidentDamagePhotoEditor] as the integration seam for the
/// report's configurable evidence checklist (notably `photo_damage_closeup`).
///
/// Layout follows the owner's M9 area sheet: damage type chips in the shared
/// `damageTypes` order, a Minor / Moderate / Major level, close-up photos,
/// an optional 200-character note and one save action.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_damage_copy.dart';

/// Opens the host report's photo/evidence picker and returns the complete set
/// of references that belong to [mark]. Returning `null` leaves them unchanged.
typedef AccidentDamagePhotoEditor = Future<List<String>?> Function(
  AccidentDamageMark mark,
);

@visibleForTesting
abstract final class AccidentDamageZoneSheetKeys {
  static const Key selectedAreaPanel = Key('accident.damage.selectedAreaPanel');
  static const Key damageType = Key('accident.damage.damageType');
  static Key damageTypeChip(AccidentDamageType type) =>
      Key('accident.damage.damageType.${type.name}');
  static const Key level = Key('accident.damage.level');
  static const Key note = Key('accident.damage.note');
  static const Key noteCounter = Key('accident.damage.noteCounter');
  static const Key suggestion = Key('accident.damage.suggestion');
  static const Key confirmSuggestion =
      Key('accident.damage.suggestion.confirm');
  static const Key correctSuggestion =
      Key('accident.damage.suggestion.correct');
  static const Key photoAction = Key('accident.damage.photos.action');
  static const Key save = Key('accident.damage.save');
  static const Key remove = Key('accident.damage.remove');
}

/// Opens the selected-area panel, seeded from [existing] when this point
/// already carries a mark.
Future<AccidentDamageZoneSheetResult?> showAccidentDamageZoneSheet(
  BuildContext context, {
  required AccidentDamageMark draft,
  required AccidentDamageMark? existing,
  int? markerNumber,
  AccidentDamagePhotoEditor? photoEditor,
  String? reviewerId,
}) {
  return showModalBottomSheet<AccidentDamageZoneSheetResult>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (BuildContext context) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        top: false,
        child: _AccidentDamageZoneSheet(
          draft: draft,
          existing: existing,
          markerNumber: markerNumber,
          photoEditor: photoEditor,
          reviewerId: reviewerId,
        ),
      ),
    ),
  );
}

/// What the sheet resolved to: a mark to save, or a deliberate removal.
sealed class AccidentDamageZoneSheetResult {
  const AccidentDamageZoneSheetResult();
}

final class AccidentDamageZoneSheetSaved extends AccidentDamageZoneSheetResult {
  const AccidentDamageZoneSheetSaved(this.mark);

  final AccidentDamageMark mark;
}

final class AccidentDamageZoneSheetRemoved
    extends AccidentDamageZoneSheetResult {
  const AccidentDamageZoneSheetRemoved();
}

class _AccidentDamageZoneSheet extends StatefulWidget {
  const _AccidentDamageZoneSheet({
    required this.draft,
    required this.existing,
    required this.markerNumber,
    required this.photoEditor,
    required this.reviewerId,
  });

  final AccidentDamageMark draft;
  final AccidentDamageMark? existing;
  final int? markerNumber;
  final AccidentDamagePhotoEditor? photoEditor;
  final String? reviewerId;

  @override
  State<_AccidentDamageZoneSheet> createState() =>
      _AccidentDamageZoneSheetState();
}

class _AccidentDamageZoneSheetState extends State<_AccidentDamageZoneSheet> {
  late AccidentDamageType _damageType = widget.draft.damageType;
  late AccidentDamageSeverity _severity = widget.draft.severity;
  late final TextEditingController _area = TextEditingController(
    text: widget.draft.areaLabel ?? '',
  );
  late final TextEditingController _note = TextEditingController(
    text: _clipNote(widget.draft.note ?? ''),
  );
  late final TextEditingController _correctionNote = TextEditingController(
    text: widget.draft.suggestion?.correctionNote ?? '',
  );
  late List<String> _photoReferences = widget.draft.photoReferences;
  late AccidentDamageSuggestionDecision _suggestionDecision =
      widget.draft.suggestion?.decision ??
          AccidentDamageSuggestionDecision.pending;
  late DateTime? _reviewedAt = widget.draft.suggestion?.reviewedAt;
  bool _editingPhotos = false;
  String? _photoError;

  AccidentDamageSuggestion? get _suggestion => widget.draft.suggestion;

  bool get _canSave =>
      _area.text.trim().isNotEmpty &&
      (_suggestion == null ||
          _suggestionDecision != AccidentDamageSuggestionDecision.pending);

  static String _clipNote(String raw) {
    const int max = accidentDamageNoteMaxLength;
    return raw.length <= max ? raw : raw.substring(0, max);
  }

  @override
  void dispose() {
    _area.dispose();
    _note.dispose();
    _correctionNote.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final TpPalette palette = TpPalette.of(context);

    // The body scrolls; the actions stay pinned beneath it. With the type
    // chips, level chips, photos and a 200-character note above them, "Save
    // marked area" otherwise scrolls off a phone-height sheet and the mock's
    // always-reachable action is lost.
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.9,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Flexible(
            child: SingleChildScrollView(
              key: AccidentDamageZoneSheetKeys.selectedAreaPanel,
              padding: const EdgeInsets.fromLTRB(
                TpSpace.xl,
                TpSpace.xs,
                TpSpace.xl,
                TpSpace.md,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _SelectedPointHeader(
                    draft: widget.draft,
                    markerNumber: widget.markerNumber,
                    copy: copy,
                  ),
                  const SizedBox(height: TpSpace.lg),
                  TpInput(
                    label: AppLocalizations.of(context).designAccZoneArea,
                    controller: _area,
                    isRequired: true,
                    prefixIcon: Icons.place_outlined,
                    onChanged: (_) => _selectionChanged(),
                  ),
                  const SizedBox(height: TpSpace.md),
                  Text(
                    AppLocalizations.of(context).designAccZoneDamageType,
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Wrap(
                    key: AccidentDamageZoneSheetKeys.damageType,
                    spacing: TpSpace.sm,
                    runSpacing: TpSpace.xs,
                    children: <Widget>[
                      for (final AccidentDamageType type
                          in AccidentDamageType.values)
                        ChoiceChip(
                          key: AccidentDamageZoneSheetKeys.damageTypeChip(type),
                          avatar: Icon(
                            accidentDamageTypeIcon(type),
                            size: TpSizing.iconSm,
                          ),
                          label: Text(accidentDamageTypeLabel(context, type)),
                          selected: _damageType == type,
                          onSelected: (bool selected) {
                            if (!selected) return;
                            setState(() => _damageType = type);
                            _selectionChanged();
                          },
                        ),
                    ],
                  ),
                  const SizedBox(height: TpSpace.md),
                  Text(
                    AppLocalizations.of(context).designAccZoneLevel,
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                  const SizedBox(height: TpSpace.xs),
                  AccidentDamageLevelSelector(
                    key: AccidentDamageZoneSheetKeys.level,
                    value: _severity,
                    onChanged: (AccidentDamageSeverity value) =>
                        setState(() => _severity = value),
                  ),
                  if (_suggestion
                      case final AccidentDamageSuggestion
                          suggestion) ...<Widget>[
                    const SizedBox(height: TpSpace.md),
                    _SuggestionPanel(
                      suggestion: suggestion,
                      decision: _suggestionDecision,
                      onConfirm: _confirmSuggestion,
                      onCorrect: _markSuggestionCorrected,
                    ),
                    if (_suggestionDecision ==
                        AccidentDamageSuggestionDecision.corrected) ...<Widget>[
                      const SizedBox(height: TpSpace.md),
                      TpInput(
                        label: AppLocalizations.of(context)
                            .designAccZoneCorrectionNote,
                        controller: _correctionNote,
                        maxLines: 2,
                      ),
                    ],
                  ],
                  const SizedBox(height: TpSpace.md),
                  _PhotoReferenceRow(
                    count: _photoReferences.length,
                    isBusy: _editingPhotos,
                    onPressed: widget.photoEditor == null ? null : _editPhotos,
                  ),
                  if (_photoError != null) ...<Widget>[
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      _photoError!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.critical.base,
                          ),
                    ),
                  ],
                  const SizedBox(height: TpSpace.md),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        AppLocalizations.of(context).designAccZoneNote,
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                      const SizedBox(height: TpSpace.xs),
                      TextField(
                        key: AccidentDamageZoneSheetKeys.note,
                        controller: _note,
                        maxLines: 2,
                        maxLength: accidentDamageNoteMaxLength,
                        textCapitalization: TextCapitalization.sentences,
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: palette.surface,
                          // The live "n/200" counter is rendered once, below.
                          counterText: '',
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: TpSpace.lg,
                            vertical: TpSpace.md,
                          ),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(TpRadius.md),
                            borderSide: BorderSide(color: palette.borderStrong),
                          ),
                        ),
                      ),
                      const SizedBox(height: TpSpace.xs),
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: Text(
                          '${_note.text.length}/$accidentDamageNoteMaxLength',
                          key: AccidentDamageZoneSheetKeys.noteCounter,
                          style:
                              Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: palette.textMuted,
                                  ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              TpSpace.xl,
              TpSpace.sm,
              TpSpace.xl,
              TpSpace.xl,
            ),
            child: _SheetActions(
              hasExistingMark: widget.existing != null,
              canSave: _canSave,
              onRemove: () => Navigator.of(context).pop(
                const AccidentDamageZoneSheetRemoved(),
              ),
              onSave: _save,
            ),
          ),
        ],
      ),
    );
  }

  void _selectionChanged() {
    final AccidentDamageSuggestion? suggestion = _suggestion;
    if (suggestion != null &&
        !suggestion.matchesSelection(
          type: _damageType,
          area: _area.text,
        )) {
      _markSuggestionCorrected();
      return;
    }
    setState(() {});
  }

  void _confirmSuggestion() {
    final AccidentDamageSuggestion? suggestion = _suggestion;
    if (suggestion == null) return;
    setState(() {
      if (suggestion.suggestedType case final AccidentDamageType type) {
        _damageType = type;
      }
      if (suggestion.suggestedArea case final String area) {
        _area.text = area;
      }
      _suggestionDecision = AccidentDamageSuggestionDecision.confirmed;
      _reviewedAt = DateTime.now().toUtc();
    });
  }

  void _markSuggestionCorrected() {
    if (_suggestion == null) return;
    setState(() {
      _suggestionDecision = AccidentDamageSuggestionDecision.corrected;
      _reviewedAt = DateTime.now().toUtc();
    });
  }

  Future<void> _editPhotos() async {
    final AccidentDamagePhotoEditor? editor = widget.photoEditor;
    if (editor == null || _editingPhotos) return;
    setState(() {
      _editingPhotos = true;
      _photoError = null;
    });
    try {
      final List<String>? next = await editor(_currentMark());
      if (!mounted || next == null) return;
      setState(() {
        _photoReferences = List<String>.unmodifiable(
          next.where((String reference) => reference.trim().isNotEmpty),
        );
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _photoError =
            AppLocalizations.of(context).designAccZonePhotoUpdateFailed;
      });
    } finally {
      if (mounted) setState(() => _editingPhotos = false);
    }
  }

  AccidentDamageMark _currentMark() {
    AccidentDamageSuggestion? suggestion = _suggestion;
    if (suggestion != null &&
        _suggestionDecision != AccidentDamageSuggestionDecision.pending) {
      suggestion = suggestion.reviewed(
        decision: _suggestionDecision,
        reviewedAt: _reviewedAt ?? DateTime.now().toUtc(),
        reviewedBy: widget.reviewerId,
        correctionNote: _correctionNote.text,
      );
    }
    final String note = _clipNote(_note.text.trim());
    return widget.draft.copyWith(
      damageType: _damageType,
      severity: _severity,
      note: note,
      clearNote: note.isEmpty,
      areaLabel: _area.text.trim(),
      photoReferences: _photoReferences,
      suggestion: suggestion,
    );
  }

  void _save() {
    if (!_canSave) return;
    Navigator.of(context).pop(
      AccidentDamageZoneSheetSaved(_currentMark()),
    );
  }
}

class _SelectedPointHeader extends StatelessWidget {
  const _SelectedPointHeader({
    required this.draft,
    required this.markerNumber,
    required this.copy,
  });

  final AccidentDamageMark draft;
  final int? markerNumber;
  final AccidentCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AccidentDamagePerspective? perspective = draft.effectivePerspective;
    return Row(
      children: <Widget>[
        DecoratedBox(
          decoration: BoxDecoration(
            color: palette.primary,
            shape: BoxShape.circle,
          ),
          child: SizedBox.square(
            dimension: 40,
            child: Center(
              child: markerNumber == null
                  ? Icon(
                      Icons.place,
                      color: palette.onPrimary,
                      size: TpSizing.iconMd,
                    )
                  : Text(
                      '$markerNumber',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            color: palette.onPrimary,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
            ),
          ),
        ),
        const SizedBox(width: TpSpace.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                markerNumber == null
                    ? AppLocalizations.of(context).designAccZoneSelectedArea
                    : AppLocalizations.of(context)
                        .designAccZoneSelectedAreaNumber(markerNumber!),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(
                perspective == null
                    ? accidentDamageZoneLabel(copy, draft.zoneId)
                    : accidentDamagePerspectiveLabel(context, perspective),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: palette.textSecondary,
                    ),
              ),
              if (draft.hasExactPoint)
                Text(
                  'X ${(draft.normalizedX! * 100).round()}% / '
                  'Y ${(draft.normalizedY! * 100).round()}%',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: palette.textMuted,
                      ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SuggestionPanel extends StatelessWidget {
  const _SuggestionPanel({
    required this.suggestion,
    required this.decision,
    required this.onConfirm,
    required this.onCorrect,
  });

  final AccidentDamageSuggestion suggestion;
  final AccidentDamageSuggestionDecision decision;
  final VoidCallback onConfirm;
  final VoidCallback onCorrect;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final List<String> details = <String>[
      if (suggestion.suggestedArea case final String area) area,
      if (suggestion.suggestedType case final AccidentDamageType type)
        accidentDamageTypeLabel(context, type),
      '${(suggestion.confidence * 100).round()}%',
    ];
    final bool isPending = decision == AccidentDamageSuggestionDecision.pending;
    return DecoratedBox(
      key: AccidentDamageZoneSheetKeys.suggestion,
      decoration: BoxDecoration(
        color: palette.info.soft,
        border: Border.all(color: palette.info.base),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  Icons.auto_awesome_outlined,
                  size: TpSizing.iconMd,
                  color: palette.info.onSoft,
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Text(
                    AppLocalizations.of(context).designAccZoneFinderSuggestion,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: palette.info.onSoft,
                        ),
                  ),
                ),
                Flexible(
                  child: Text(
                    suggestion.source,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: palette.info.onSoft,
                        ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.xs),
            Text(
              details.join(' • '),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: palette.info.onSoft,
                  ),
            ),
            if (isPending) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              Row(
                children: <Widget>[
                  Expanded(
                    child: TpButton.primary(
                      key: AccidentDamageZoneSheetKeys.confirmSuggestion,
                      label: AppLocalizations.of(context).designAccZoneConfirm,
                      icon: Icons.check,
                      isCompact: true,
                      onPressed: onConfirm,
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: TpButton.secondary(
                      key: AccidentDamageZoneSheetKeys.correctSuggestion,
                      label: AppLocalizations.of(context).designAccZoneCorrect,
                      icon: Icons.edit_outlined,
                      isCompact: true,
                      onPressed: onCorrect,
                    ),
                  ),
                ],
              ),
            ] else ...<Widget>[
              const SizedBox(height: TpSpace.xs),
              Text(
                decision == AccidentDamageSuggestionDecision.confirmed
                    ? AppLocalizations.of(context)
                        .designAccZoneConfirmedByReporter
                    : AppLocalizations.of(context)
                        .designAccZoneCorrectedByReporter,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: palette.info.onSoft,
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PhotoReferenceRow extends StatelessWidget {
  const _PhotoReferenceRow({
    required this.count,
    required this.isBusy,
    required this.onPressed,
  });

  final int count;
  final bool isBusy;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(
          TpSpace.md,
          TpSpace.xs,
          TpSpace.xs,
          TpSpace.xs,
        ),
        // Text and action stack vertically: on a 400px phone in Urdu the
        // button label and the caption do not fit on one line.
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  Icons.photo_camera_outlined,
                  size: TpSizing.iconMd,
                  color: palette.textSecondary,
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        AppLocalizations.of(context).designAccZoneCloseUpPhotos,
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                      Text(
                        onPressed == null && count == 0
                            ? AppLocalizations.of(context)
                                .designAccZoneAddedFromEvidence
                            : AppLocalizations.of(context)
                                .designAccZoneAttachedCount(count),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: palette.textMuted,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (onPressed != null)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TpButton.text(
                  key: AccidentDamageZoneSheetKeys.photoAction,
                  label: count == 0
                      ? AppLocalizations.of(context).designAccZoneAddCloseUp
                      : AppLocalizations.of(context).designAccZoneAddAnother,
                  icon: Icons.add_a_photo_outlined,
                  isCompact: true,
                  isBusy: isBusy,
                  onPressed: onPressed,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SheetActions extends StatelessWidget {
  const _SheetActions({
    required this.hasExistingMark,
    required this.canSave,
    required this.onRemove,
    required this.onSave,
  });

  final bool hasExistingMark;
  final bool canSave;
  final VoidCallback onRemove;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    if (!hasExistingMark) {
      return TpButton.primary(
        key: AccidentDamageZoneSheetKeys.save,
        label: AppLocalizations.of(context).designAccZoneSaveAndContinue,
        icon: Icons.check,
        isFullWidth: true,
        onPressed: canSave ? onSave : null,
      );
    }
    return Row(
      children: <Widget>[
        Expanded(
          child: TpButton.danger(
            key: AccidentDamageZoneSheetKeys.remove,
            label: AppLocalizations.of(context).designAccZoneRemove,
            icon: Icons.delete_outline,
            isCompact: true,
            onPressed: onRemove,
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          flex: 2,
          child: TpButton.primary(
            key: AccidentDamageZoneSheetKeys.save,
            label: AppLocalizations.of(context).designAccZoneSaveMarked,
            icon: Icons.check,
            isCompact: true,
            onPressed: canSave ? onSave : null,
          ),
        ),
      ],
    );
  }
}

/// The status tone of a damage level: Minor reads ok, Moderate warning and
/// Major (stored `severe`) critical, matching the owner's mock.
TpStatus accidentDamageLevelTone(AccidentDamageSeverity severity) =>
    switch (severity) {
      AccidentDamageSeverity.minor => TpStatus.ok,
      AccidentDamageSeverity.moderate => TpStatus.warning,
      AccidentDamageSeverity.severe => TpStatus.critical,
    };

/// Minor / Moderate / Major as one exclusive control. The selected option is
/// tinted with its status colour and keeps its text label and a check icon,
/// so colour is never the only signal.
class AccidentDamageLevelSelector extends StatelessWidget {
  const AccidentDamageLevelSelector({
    required this.value,
    required this.onChanged,
    super.key,
  });

  final AccidentDamageSeverity? value;
  final ValueChanged<AccidentDamageSeverity>? onChanged;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      children: <Widget>[
        for (final AccidentDamageSeverity severity
            in AccidentDamageSeverity.values) ...<Widget>[
          if (severity.index > 0) const SizedBox(width: TpSpace.sm),
          Expanded(
            child: _LevelOption(
              severity: severity,
              selected: severity == value,
              colors: palette.forStatus(accidentDamageLevelTone(severity)),
              palette: palette,
              onTap: onChanged == null ? null : () => onChanged!(severity),
            ),
          ),
        ],
      ],
    );
  }
}

class _LevelOption extends StatelessWidget {
  const _LevelOption({
    required this.severity,
    required this.selected,
    required this.colors,
    required this.palette,
    required this.onTap,
  });

  final AccidentDamageSeverity severity;
  final bool selected;
  final TpStatusColors colors;
  final TpPalette palette;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final String label = accidentDamageLevelLabel(context, severity);
    final Color foreground = selected ? colors.onSoft : palette.text;
    return Semantics(
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        key: ValueKey<String>('accident.damageZone.level.${severity.name}'),
        color: selected ? colors.soft : palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(
            // controlBorder keeps the unselected outline above 3:1 (WCAG 1.4.11).
            color: selected ? colors.base : palette.controlBorder,
            width: selected ? TpBorderWidth.strong : TpBorderWidth.hairline,
          ),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: TpSizing.minTouchTarget,
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Icon(
                    selected ? Icons.check_circle_rounded : Icons.circle,
                    size: selected ? TpSizing.iconSm : 10,
                    color: colors.base,
                  ),
                  const SizedBox(width: TpSpace.xs),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color: foreground,
                            fontWeight:
                                selected ? FontWeight.w800 : FontWeight.w600,
                          ),
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

String accidentDamageTypeLabel(
  BuildContext context,
  AccidentDamageType type,
) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return switch (type) {
    AccidentDamageType.dent => l10n.designAccDamageTypeDent,
    AccidentDamageType.scratch => l10n.designAccDamageTypeScratch,
    AccidentDamageType.cracked => l10n.designAccDamageTypeCracked,
    AccidentDamageType.broken => l10n.designAccDamageTypeBroken,
    AccidentDamageType.missing => l10n.designAccDamageTypeMissing,
    AccidentDamageType.bent => l10n.designAccDamageTypeBent,
    AccidentDamageType.other => l10n.designAccDamageTypeOther,
  };
}

/// Icon for a damage-type chip; the label is always shown beside it.
IconData accidentDamageTypeIcon(AccidentDamageType type) => switch (type) {
      AccidentDamageType.dent => Icons.compress_rounded,
      AccidentDamageType.scratch => Icons.gesture_rounded,
      AccidentDamageType.cracked => Icons.broken_image_outlined,
      AccidentDamageType.broken => Icons.heart_broken_outlined,
      AccidentDamageType.missing => Icons.remove_circle_outline,
      AccidentDamageType.bent => Icons.turn_right_rounded,
      AccidentDamageType.other => Icons.more_horiz_rounded,
    };
