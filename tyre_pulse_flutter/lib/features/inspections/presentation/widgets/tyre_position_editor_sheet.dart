/// The focused per-wheel editor - the tap target for one position on the
/// diagram or in the position list, ported from
/// `mobile/components/TyreDetailModal.tsx`'s role in the wizard.
///
/// Every field commits through [onChanged] immediately (no separate Save
/// button), because the caller ([InspectionWizardController.
/// updateTyreReading]) is the single write path that stamps `checked` and
/// persists to the draft - see that method's own doc comment. There is
/// deliberately no local "unsaved changes" state here to lose.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart'
    show PhotoCaptureSource;
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';

class TyrePositionEditorSheet extends StatefulWidget {
  const TyrePositionEditorSheet({
    required this.reading,
    required this.onChanged,
    required this.onCapturePhoto,
    this.isCapturingPhoto = false,
    super.key,
  });

  final TyrePositionReading reading;
  final ValueChanged<TyrePositionReading> onChanged;
  final ValueChanged<PhotoCaptureSource> onCapturePhoto;
  final bool isCapturingPhoto;

  @override
  State<TyrePositionEditorSheet> createState() =>
      _TyrePositionEditorSheetState();
}

class _TyrePositionEditorSheetState extends State<TyrePositionEditorSheet> {
  late final TextEditingController _pressureController;
  late final TextEditingController _treadController;
  late final TextEditingController _serialController;
  late final TextEditingController _notesController;

  @override
  void initState() {
    super.initState();
    _pressureController = TextEditingController(
      text: widget.reading.pressurePsi?.toString() ?? '',
    );
    _treadController = TextEditingController(
      text: widget.reading.treadDepthMm?.toString() ?? '',
    );
    _serialController =
        TextEditingController(text: widget.reading.serialNumber ?? '');
    _notesController =
        TextEditingController(text: widget.reading.notes ?? '');
  }

  @override
  void dispose() {
    _pressureController.dispose();
    _treadController.dispose();
    _serialController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _emit(TyrePositionReading next) => widget.onChanged(next);

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TyrePositionReading r = widget.reading;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(r.position, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: TpSpace.lg),

          Text(l10n.inspectionConditionLabel,
              style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (final String condition in TyreReadingCondition.all)
                _ConditionChip(
                  label: tyreConditionLabel(
                    l10n,
                    normaliseCondition(condition),
                  ),
                  status: tyreConditionStatus(normaliseCondition(condition)),
                  isSelected: r.condition == condition,
                  onTap: () => _emit(r.copyWith(condition: condition)),
                ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),

          Row(
            children: <Widget>[
              Expanded(
                child: TpInput(
                  label: l10n.inspectionPressureLabel,
                  controller: _pressureController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  hint: l10n.inspectionPressureHint,
                  onChanged: (String v) {
                    final double? parsed = double.tryParse(v.trim());
                    _emit(
                      r.copyWith(
                        pressurePsi: parsed,
                        clearPressurePsi: v.trim().isEmpty,
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: TpInput(
                  label: l10n.inspectionTreadLabel,
                  controller: _treadController,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  hint: l10n.inspectionTreadHint,
                  onChanged: (String v) {
                    final double? parsed = double.tryParse(v.trim());
                    _emit(
                      r.copyWith(
                        treadDepthMm: parsed,
                        clearTreadDepthMm: v.trim().isEmpty,
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),

          TpInput(
            label: l10n.inspectionSerialLabel,
            controller: _serialController,
            textCapitalization: TextCapitalization.characters,
            onChanged: (String v) => _emit(
              r.copyWith(
                serialNumber: v,
                clearSerialNumber: v.trim().isEmpty,
              ),
            ),
          ),
          const SizedBox(height: TpSpace.lg),

          Text(l10n.inspectionPhotoLabel,
              style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: TpSpace.sm),
          if (r.hasPhoto)
            _PhotoPreview(reading: r)
          else
            Text(
              l10n.inspectionPhotoNone,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: palette.textMuted),
            ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: TpButton.secondary(
                  label: l10n.inspectionPhotoCamera,
                  icon: Icons.camera_alt_outlined,
                  isBusy: widget.isCapturingPhoto,
                  onPressed: widget.isCapturingPhoto
                      ? null
                      : () => widget.onCapturePhoto(PhotoCaptureSource.camera),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: TpButton.secondary(
                  label: l10n.inspectionPhotoGallery,
                  icon: Icons.photo_library_outlined,
                  isBusy: widget.isCapturingPhoto,
                  onPressed: widget.isCapturingPhoto
                      ? null
                      : () =>
                          widget.onCapturePhoto(PhotoCaptureSource.gallery),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),

          TpInput(
            label: l10n.inspectionNotesLabel,
            controller: _notesController,
            maxLines: 3,
            onChanged: (String v) => _emit(
              r.copyWith(notes: v, clearNotes: v.trim().isEmpty),
            ),
          ),
          const SizedBox(height: TpSpace.xl),

          TpButton.primary(
            label: l10n.actionClose,
            isFullWidth: true,
            onPressed: () => Navigator.of(context).maybePop(),
          ),
        ],
      ),
    );
  }
}

class _ConditionChip extends StatelessWidget {
  const _ConditionChip({
    required this.label,
    required this.status,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final TpStatus status;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(status);
    return GestureDetector(
      onTap: onTap,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: isSelected ? colors.base : colors.soft,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          border: Border.all(color: colors.base, width: TpBorderWidth.strong),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.lg,
            vertical: TpSpace.sm,
          ),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: isSelected ? colors.onBase : colors.onSoft,
                  fontWeight: FontWeight.w700,
                ),
          ),
        ),
      ),
    );
  }
}

class _PhotoPreview extends StatelessWidget {
  const _PhotoPreview({required this.reading});

  final TyrePositionReading reading;

  @override
  Widget build(BuildContext context) {
    final String? url = reading.photoUrl;
    final String? local = reading.photoLocalPath;
    final ImageProvider? provider = url != null
        ? NetworkImage(url)
        : (local != null ? FileImage(File(local)) : null);
    if (provider == null) return const SizedBox.shrink();
    return ClipRRect(
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: Image(
        image: provider,
        height: 140,
        width: double.infinity,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stack) => const SizedBox.shrink(),
      ),
    );
  }
}
