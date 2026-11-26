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
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart'
    show PhotoCaptureSource;
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_glyph.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_risk_colors.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';

class TyrePositionEditorSheet extends ConsumerStatefulWidget {
  const TyrePositionEditorSheet({
    required this.reading,
    required this.onChanged,
    required this.onCapturePhoto,
    this.installedTyre,
    this.positionLabel,
    this.isCapturingPhoto = false,
    super.key,
  });

  /// The code the diagram prints on this wheel (for example `LHF1`). The
  /// reading carries the internal slot id (`F1L`), which a fitter has never
  /// seen on the vehicle map, so the header shows this when it is known.
  final String? positionLabel;

  final TyrePositionReading reading;
  final ValueChanged<TyrePositionReading> onChanged;
  final ValueChanged<PhotoCaptureSource> onCapturePhoto;
  final bool isCapturingPhoto;
  final TyreFitment? installedTyre;

  @override
  ConsumerState<TyrePositionEditorSheet> createState() =>
      _TyrePositionEditorSheetState();
}

/// Stable targets for device-sized layout and interaction regression tests.
abstract final class TyrePositionEditorSheetKeys {
  static const ValueKey<String> scrollBody =
      ValueKey<String>('tyre-position-editor-scroll-body');
  static const ValueKey<String> closeAction =
      ValueKey<String>('tyre-position-editor-close-action');
}

class _TyrePositionEditorSheetState
    extends ConsumerState<TyrePositionEditorSheet> {
  late final TextEditingController _pressureController;
  late final TextEditingController _treadController;
  late final TextEditingController _serialController;
  late final TextEditingController _notesController;
  TyreLookupRecord? _serialLookup;
  bool _isLookingUpSerial = false;
  bool _serialNotFound = false;

  @override
  void initState() {
    super.initState();
    _pressureController = TextEditingController(
      text: widget.reading.pressurePsi?.toString() ?? '',
    );
    _treadController = TextEditingController(
      text: widget.reading.treadDepthMm?.toString() ?? '',
    );
    // Only the RECORDED serial goes in the box. The fitted serial from the
    // register used to be pre-filled here too, but never emitted, so the
    // field showed a value the reading did not carry. It is shown as the
    // hint instead, and "look up" confirms it into the reading.
    _serialController = TextEditingController(
      text: widget.reading.serialNumber ?? '',
    );
    _notesController = TextEditingController(text: widget.reading.notes ?? '');
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

  Future<void> _lookupSerial() async {
    final String typed = _serialController.text.trim();
    final String serial = typed.isNotEmpty
        ? typed
        : (widget.installedTyre?.serialNo ?? '').trim();
    if (serial.isEmpty || _isLookingUpSerial) return;
    if (typed.isEmpty) _serialController.text = serial;
    setState(() {
      _isLookingUpSerial = true;
      _serialNotFound = false;
    });
    try {
      final TyreLookupRecord? record =
          await ref.read(tyreLookupRepositoryProvider).lookupBySerial(serial);
      if (!mounted) return;
      setState(() {
        _serialLookup = record;
        _serialNotFound = record == null;
      });
      if (record != null) {
        _emit(widget.reading.copyWith(serialNumber: serial));
      }
    } on Object {
      if (mounted) setState(() => _serialNotFound = true);
    } finally {
      if (mounted) setState(() => _isLookingUpSerial = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TyrePositionReading r = widget.reading;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Flexible(
          child: SingleChildScrollView(
            key: TyrePositionEditorSheetKeys.scrollBody,
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpCard(
                  background: palette.primarySoft,
                  borderColor: palette.primary.withValues(alpha: 0.32),
                  padding: const EdgeInsets.all(TpSpace.md),
                  child: Row(
                    children: <Widget>[
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: palette.primary,
                          borderRadius: BorderRadius.circular(TpRadius.md),
                        ),
                        child: SizedBox.square(
                          dimension: 48,
                          child: TpIcon(
                            Icons.tire_repair_outlined,
                            color: palette.onPrimary,
                          ),
                        ),
                      ),
                      const SizedBox(width: TpSpace.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              l10n.inspectionTyrePositionsTitle,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(
                                    color: palette.textSecondary,
                                  ),
                            ),
                            TpIdentifierText(
                              widget.positionLabel ?? r.position,
                              style: Theme.of(context)
                                  .textTheme
                                  .headlineSmall
                                  ?.copyWith(fontWeight: FontWeight.w800),
                            ),
                          ],
                        ),
                      ),
                      // A wheel nobody has marked yet is not "Good": the
                      // default selection below is only a starting point.
                      if (r.checked)
                        TpStatusChip(
                          status: tyreConditionStatus(
                            normaliseCondition(r.condition),
                          ),
                          label: tyreConditionLabel(
                            l10n,
                            normaliseCondition(r.condition),
                          ),
                          isCompact: true,
                        )
                      else
                        TpStatusChip(
                          status: TpStatus.unknown,
                          label: l10n.tyreDetailFieldNotRecorded,
                          isCompact: true,
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: TpSpace.lg),
                Text(
                  l10n.inspectionConditionLabel,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.sm),
                LayoutBuilder(
                  builder: (BuildContext context, BoxConstraints constraints) {
                    final double itemWidth =
                        (constraints.maxWidth - (TpSpace.sm * 2)) / 3;
                    return Wrap(
                      spacing: TpSpace.sm,
                      runSpacing: TpSpace.sm,
                      children: <Widget>[
                        for (final String condition in TyreReadingCondition.all)
                          SizedBox(
                            width: itemWidth,
                            child: _ConditionChip(
                              condition: normaliseCondition(condition),
                              label: tyreConditionLabel(
                                l10n,
                                normaliseCondition(condition),
                              ),
                              statusLabel: _statusLabel(
                                l10n,
                                tyreConditionStatus(
                                  normaliseCondition(condition),
                                ),
                              ),
                              isSelected: r.checked && r.condition == condition,
                              onTap: () =>
                                  _emit(r.copyWith(condition: condition)),
                            ),
                          ),
                      ],
                    );
                  },
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
                  hint: widget.installedTyre?.serialNo,
                  textCapitalization: TextCapitalization.characters,
                  suffix: IconButton(
                    tooltip: l10n.serialSearchTitle,
                    onPressed: _isLookingUpSerial ? null : _lookupSerial,
                    icon: _isLookingUpSerial
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.manage_search_rounded),
                  ),
                  onChanged: (String v) => _emit(
                    r.copyWith(
                      serialNumber: v,
                      clearSerialNumber: v.trim().isEmpty,
                    ),
                  ),
                ),
                if (_serialLookup != null) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  _SerialLookupCard(record: _serialLookup!),
                ] else if (_serialNotFound) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  Text(
                    l10n.serialSearchEmptyMessage,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: palette.warning.onSoft,
                        ),
                  ),
                ],
                const SizedBox(height: TpSpace.lg),
                Text(
                  l10n.inspectionPhotoLabel,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.sm),
                if (r.hasPhoto)
                  _PhotoPreview(
                    reading: r,
                    onRemove: () => _emit(
                      r.copyWith(
                        clearPhotoLocalPath: true,
                        clearPhotoUrl: true,
                      ),
                    ),
                  )
                else
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: palette.surfaceAlt,
                      borderRadius: BorderRadius.circular(TpRadius.md),
                      border: Border.all(
                        color: palette.border,
                        width: TpBorderWidth.hairline,
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: TpSpace.md,
                        vertical: TpSpace.lg,
                      ),
                      child: Row(
                        children: <Widget>[
                          Icon(
                            Icons.image_outlined,
                            size: TpSizing.iconMd,
                            color: palette.textMuted,
                          ),
                          const SizedBox(width: TpSpace.sm),
                          Expanded(
                            child: Text(
                              l10n.inspectionPhotoNone,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(color: palette.textMuted),
                            ),
                          ),
                        ],
                      ),
                    ),
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
                            : () => widget
                                .onCapturePhoto(PhotoCaptureSource.camera),
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
                            : () => widget
                                .onCapturePhoto(PhotoCaptureSource.gallery),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: TpSpace.lg),
                TpInput(
                  label: l10n.inspectionNotesLabel,
                  controller: _notesController,
                  maxLines: 3,
                  onChanged: (String v) =>
                      _emit(r.copyWith(notes: v, clearNotes: v.trim().isEmpty)),
                ),
                const SizedBox(height: TpSpace.lg),
              ],
            ),
          ),
        ),
        _StickyEditorAction(
          label: r.checked ? l10n.inspectionTyreEditorSave : l10n.actionClose,
          onPressed: () {
            FocusManager.instance.primaryFocus?.unfocus();
            Navigator.of(context).maybePop();
          },
        ),
      ],
    );
  }

  String _statusLabel(AppLocalizations l10n, TpStatus status) =>
      switch (status) {
        TpStatus.ok => l10n.statusOk,
        TpStatus.warning => l10n.statusWarning,
        TpStatus.critical => l10n.statusCritical,
        TpStatus.info => l10n.statusInfo,
        TpStatus.neutral => l10n.statusNeutral,
        TpStatus.unknown => l10n.statusUnknown,
      };
}

class _SerialLookupCard extends StatelessWidget {
  const _SerialLookupCard({required this.record});

  final TyreLookupRecord record;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final List<String> details = <String>[
      if (record.brand != null) '${l10n.serialSearchBrand}: ${record.brand}',
      if (record.size != null) '${l10n.serialSearchSize}: ${record.size}',
      if (record.assetNo != null)
        '${l10n.serialSearchAsset}: ${record.assetNo}',
      if (record.bestPosition != null)
        '${l10n.serialSearchPosition}: ${record.bestPosition}',
    ];
    return TpCard(
      background: palette.ok.soft,
      borderColor: palette.ok.base,
      padding: const EdgeInsets.all(TpSpace.sm),
      child: Row(
        children: <Widget>[
          Icon(Icons.verified_rounded, color: palette.ok.onSoft),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              details.isEmpty ? l10n.serialSearchFound : details.join(' · '),
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: palette.ok.onSoft),
            ),
          ),
        ],
      ),
    );
  }
}

class _StickyEditorAction extends StatelessWidget {
  const _StickyEditorAction({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.fromLTRB(
          TpSpace.xl,
          TpSpace.sm,
          TpSpace.xl,
          TpSpace.md,
        ),
        child: TpButton.primary(
          key: TyrePositionEditorSheetKeys.closeAction,
          label: label,
          isFullWidth: true,
          onPressed: onPressed,
        ),
      ),
    );
  }
}

class _ConditionChip extends StatelessWidget {
  const _ConditionChip({
    required this.condition,
    required this.label,
    required this.statusLabel,
    required this.isSelected,
    required this.onTap,
  });

  final TyreCondition? condition;
  final String label;
  final String statusLabel;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    // One fixed colour and one picture per condition (shared tyre map), so
    // a tyre man who cannot read the word still knows which button is
    // which. Selected = filled in the deep band colour with white ink (at
    // least 4.5:1 in light and dark) and a heavy outline; not selected =
    // the card surface with the coloured picture and a coloured border.
    final Color band = tyreRiskBaseColor(
      tyreConditionTone(condition),
      palette.brightness,
    );
    final Color fill =
        isSelected ? tyreConditionSelectedFill(condition) : palette.surface;
    final Color ink = isSelected ? Colors.white : palette.text;
    return Semantics(
      label: '$label, $statusLabel',
      excludeSemantics: true,
      selected: isSelected,
      button: true,
      child: Material(
        color: fill,
        elevation: isSelected ? 3 : 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(
            color: isSelected ? palette.text : band,
            width: isSelected ? 3 : TpBorderWidth.strong,
          ),
        ),
        child: InkWell(
          key: ValueKey<String>('tyre-condition-$label'),
          borderRadius: BorderRadius.circular(TpRadius.md),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 72),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: TpSpace.xs,
                vertical: TpSpace.sm,
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  TyreConditionGlyph(
                    condition: condition,
                    size: 30,
                    color: isSelected ? Colors.white : band,
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: ink,
                          fontWeight: FontWeight.w800,
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

class _PhotoPreview extends ConsumerWidget {
  const _PhotoPreview({required this.reading, required this.onRemove});

  final TyrePositionReading reading;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    String? url = reading.photoUrl;
    if (url != null && needsPrivateStorageResolution(url)) {
      final String reference = url;
      final resolved = ref.watch(privateStorageImageUrlProvider(reference));
      if (resolved.isLoading) return const CircularProgressIndicator();
      if (resolved.hasError) {
        return Row(
          children: <Widget>[
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: l10n.actionRetry,
              onPressed: () =>
                  ref.invalidate(privateStorageImageUrlProvider(reference)),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline),
              tooltip: l10n.actionCancel,
              onPressed: onRemove,
            ),
          ],
        );
      }
      url = resolved.value;
    }
    final String? local = reading.photoLocalPath;
    final ImageProvider? provider = url != null
        ? NetworkImage(url)
        : (local != null ? FileImage(File(local)) : null);
    if (provider == null) return const SizedBox.shrink();

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(
          color: palette.border,
          width: TpBorderWidth.hairline,
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(TpRadius.md - 1),
        child: Stack(
          children: <Widget>[
            Image(
              image: provider,
              height: 150,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stack) => const SizedBox.shrink(),
            ),
            Positioned(
              top: TpSpace.sm,
              right: TpSpace.sm,
              child: Material(
                color: Colors.black54,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: onRemove,
                  child: Tooltip(
                    message: l10n.actionCancel,
                    child: const Padding(
                      padding: EdgeInsets.all(TpSpace.sm),
                      child: Icon(
                        Icons.delete_outline,
                        size: TpSizing.iconSm,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
