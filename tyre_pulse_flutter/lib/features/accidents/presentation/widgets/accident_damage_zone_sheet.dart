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

    return SingleChildScrollView(
      key: AccidentDamageZoneSheetKeys.selectedAreaPanel,
      padding: const EdgeInsets.fromLTRB(
        TpSpace.xl,
        TpSpace.xs,
        TpSpace.xl,
        TpSpace.xl,
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
            label: _localized(
              context,
              en: 'Area',
              ar: 'المنطقة',
              ur: 'حصہ',
            ),
            controller: _area,
            isRequired: true,
            prefixIcon: Icons.place_outlined,
            onChanged: (_) => _selectionChanged(),
          ),
          const SizedBox(height: TpSpace.md),
          Text(
            _localized(
              context,
              en: 'Damage type',
              ar: 'نوع الضرر',
              ur: 'نقصان کی قسم',
            ),
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: TpSpace.xs),
          Wrap(
            key: AccidentDamageZoneSheetKeys.damageType,
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              for (final AccidentDamageType type in AccidentDamageType.values)
                ChoiceChip(
                  key: AccidentDamageZoneSheetKeys.damageTypeChip(type),
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
            _localized(
              context,
              en: 'Level',
              ar: 'المستوى',
              ur: 'درجہ',
            ),
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: TpSpace.xs),
          TpSegmented<AccidentDamageSeverity>(
            key: AccidentDamageZoneSheetKeys.level,
            expanded: true,
            value: _severity,
            onChanged: (AccidentDamageSeverity value) =>
                setState(() => _severity = value),
            options: <TpSegmentedOption<AccidentDamageSeverity>>[
              for (final AccidentDamageSeverity severity
                  in AccidentDamageSeverity.values)
                TpSegmentedOption<AccidentDamageSeverity>(
                  value: severity,
                  label: accidentDamageLevelLabel(context, severity),
                ),
            ],
          ),
          if (_suggestion
              case final AccidentDamageSuggestion suggestion) ...<Widget>[
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
                label: _localized(
                  context,
                  en: 'Correction note (optional)',
                  ar: 'ملاحظة التصحيح (اختيارية)',
                  ur: 'تصحیحی نوٹ (اختیاری)',
                ),
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
                _localized(
                  context,
                  en: 'Note (optional)',
                  ar: 'ملاحظة (اختيارية)',
                  ur: 'نوٹ (اختیاری)',
                ),
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
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.textMuted,
                      ),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          _SheetActions(
            hasExistingMark: widget.existing != null,
            canSave: _canSave,
            onRemove: () => Navigator.of(context).pop(
              const AccidentDamageZoneSheetRemoved(),
            ),
            onSave: _save,
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
        _photoError = _localized(
          context,
          en: 'The close-up damage photos could not be updated.',
          ar: 'تعذر تحديث صور الضرر عن قرب.',
          ur: 'نقصان کی قریبی تصاویر اپ ڈیٹ نہیں ہو سکیں۔',
        );
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
                _localized(
                  context,
                  en: markerNumber == null
                      ? 'Selected area'
                      : 'Selected area $markerNumber',
                  ar: markerNumber == null
                      ? 'المنطقة المحددة'
                      : 'المنطقة المحددة $markerNumber',
                  ur: markerNumber == null
                      ? 'منتخب حصہ'
                      : 'منتخب حصہ $markerNumber',
                ),
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
                    _localized(
                      context,
                      en: 'Finder suggestion',
                      ar: 'اقتراح Finder',
                      ur: 'Finder کی تجویز',
                    ),
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
                      label: _localized(
                        context,
                        en: 'Confirm',
                        ar: 'تأكيد',
                        ur: 'تصدیق',
                      ),
                      icon: Icons.check,
                      isCompact: true,
                      onPressed: onConfirm,
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: TpButton.secondary(
                      key: AccidentDamageZoneSheetKeys.correctSuggestion,
                      label: _localized(
                        context,
                        en: 'Correct',
                        ar: 'تصحيح',
                        ur: 'درست کریں',
                      ),
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
                    ? _localized(
                        context,
                        en: 'Confirmed by reporter',
                        ar: 'تم التأكيد بواسطة المبلّغ',
                        ur: 'رپورٹر نے تصدیق کی',
                      )
                    : _localized(
                        context,
                        en: 'Corrected by reporter',
                        ar: 'تم التصحيح بواسطة المبلّغ',
                        ur: 'رپورٹر نے درست کیا',
                      ),
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
        child: Row(
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
                    _localized(
                      context,
                      en: 'Close-up damage photos',
                      ar: 'صور الضرر عن قرب',
                      ur: 'نقصان کی قریبی تصاویر',
                    ),
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                  Text(
                    onPressed == null && count == 0
                        ? _localized(
                            context,
                            en: 'Added from the evidence step',
                            ar: 'تُضاف من خطوة الأدلة',
                            ur: 'ثبوت کے مرحلے سے شامل کی جاتی ہیں',
                          )
                        : _localized(
                            context,
                            en: '$count attached',
                            ar: '$count مرفقة',
                            ur: '$count منسلک',
                          ),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: palette.textMuted,
                        ),
                  ),
                ],
              ),
            ),
            if (onPressed != null)
              TpButton.text(
                key: AccidentDamageZoneSheetKeys.photoAction,
                label: _localized(
                  context,
                  en: count == 0 ? 'Add close-up photo' : 'Add another',
                  ar: count == 0 ? 'إضافة صورة قريبة' : 'إضافة أخرى',
                  ur: count == 0 ? 'قریبی تصویر شامل کریں' : 'مزید شامل کریں',
                ),
                icon: Icons.add_a_photo_outlined,
                isCompact: true,
                isBusy: isBusy,
                onPressed: onPressed,
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
        label: _localized(
          context,
          en: 'Save area and continue',
          ar: 'حفظ المنطقة والمتابعة',
          ur: 'حصہ محفوظ کریں اور جاری رکھیں',
        ),
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
        const SizedBox(width: TpSpace.sm),
        Expanded(
          flex: 2,
          child: TpButton.primary(
            key: AccidentDamageZoneSheetKeys.save,
            label: _localized(
              context,
              en: 'Save marked area',
              ar: 'حفظ المنطقة المحددة',
              ur: 'نشان زدہ حصہ محفوظ کریں',
            ),
            icon: Icons.check,
            isCompact: true,
            onPressed: canSave ? onSave : null,
          ),
        ),
      ],
    );
  }
}

String accidentDamageTypeLabel(
  BuildContext context,
  AccidentDamageType type,
) {
  final String language = Localizations.localeOf(context).languageCode;
  return switch ((language, type)) {
    ('ar', AccidentDamageType.dent) => 'انبعاج',
    ('ar', AccidentDamageType.scratch) => 'خدش',
    ('ar', AccidentDamageType.cracked) => 'متشقق',
    ('ar', AccidentDamageType.broken) => 'مكسور',
    ('ar', AccidentDamageType.missing) => 'مفقود',
    ('ar', AccidentDamageType.bent) => 'منحنٍ',
    ('ar', AccidentDamageType.other) => 'أخرى',
    ('ur', AccidentDamageType.dent) => 'ڈینٹ',
    ('ur', AccidentDamageType.scratch) => 'خراش',
    ('ur', AccidentDamageType.cracked) => 'دراڑ',
    ('ur', AccidentDamageType.broken) => 'ٹوٹا ہوا',
    ('ur', AccidentDamageType.missing) => 'غائب',
    ('ur', AccidentDamageType.bent) => 'مڑا ہوا',
    ('ur', AccidentDamageType.other) => 'دیگر',
    (_, _) => accidentDamageTypeVocabLabel(type),
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
