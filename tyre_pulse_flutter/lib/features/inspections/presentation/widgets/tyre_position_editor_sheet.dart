/// The focused per-wheel editor - the tap target for one position on the
/// diagram or in the position list, ported from
/// `mobile/components/TyreDetailModal.tsx`'s role in the wizard.
///
/// Every field commits through [onChanged] immediately (no separate Save
/// button), because the caller ([InspectionWizardController.
/// updateTyreReading]) is the single write path that stamps `checked` and
/// persists to the draft - see that method's own doc comment. There is
/// deliberately no local "unsaved changes" state here to lose.
///
/// Layout, top to bottom: the position header (code, plain-language name,
/// a mini axle map, recorded state), the tyre on record for this wheel,
/// then grouped sections - Condition, Measurements, Tyre, Photo, Notes.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart'
    show PhotoCaptureSource;
import 'package:tyre_pulse/features/inspections/data/inspection_previous_tyre_readings.dart'
    show PreviousTyreReading;
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_reading_validation.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_mini_map.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_glyph.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_position_name_labels.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';

/// Where a condition's picture lives. A PNG named after the condition
/// (`good.png`, `worn.png`, `damaged.png`, `puncture.png`, `flat.png`,
/// `missing.png`) replaces the drawn glyph as soon as it is added to the
/// folder; until then the glyph is shown.
String tyreConditionImageAsset(TyreCondition condition) =>
    'assets/tyre_conditions/${condition.name}.png';

/// The stored `TyreReadingCondition` value a picker tile writes for
/// [condition]. The tiles are laid out in [kTyreConditionDisplayOrder]
/// (problems first); the value each one stores never depends on its place.
String tyreReadingConditionValue(TyreCondition condition) =>
    switch (condition) {
      TyreCondition.good => TyreReadingCondition.good,
      TyreCondition.worn => TyreReadingCondition.worn,
      TyreCondition.damaged => TyreReadingCondition.damaged,
      TyreCondition.puncture => TyreReadingCondition.puncture,
      TyreCondition.flat => TyreReadingCondition.flat,
      TyreCondition.missing => TyreReadingCondition.missing,
    };

class TyrePositionEditorSheet extends ConsumerStatefulWidget {
  const TyrePositionEditorSheet({
    required this.reading,
    required this.onChanged,
    required this.onCapturePhoto,
    this.installedTyre,
    this.installedTyreUnavailable = false,
    this.positionLabel,
    this.vehicleType,
    this.assetNo,
    this.currentOdometerKm,
    this.previousReading,
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

  /// The tyre the register says is fitted at this asset + position.
  final TyreFitment? installedTyre;

  /// The register could not be read (offline / failed): the card says
  /// "not loaded" instead of the false claim "no tyre on record".
  final bool installedTyreUnavailable;

  /// The layout vehicle type, for the mini axle map. No map without it.
  final String? vehicleType;

  /// The asset being inspected. When set, the fitted-tyre card is shown
  /// (including its "none on record" state).
  final String? assetNo;

  /// The odometer typed in the inspection header, for "km run since
  /// fitment". Never estimated.
  final double? currentOdometerKm;

  /// This wheel on the asset's last synced inspection.
  final PreviousTyreReading? previousReading;

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
  static const ValueKey<String> fittedTyreCard =
      ValueKey<String>('tyre-position-editor-fitted-tyre');
  static const ValueKey<String> serialDiffers =
      ValueKey<String>('tyre-position-editor-serial-differs');
  static const ValueKey<String> header =
      ValueKey<String>('tyre-position-editor-header');
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

  /// The serial box was pre-filled from the register and the reading does
  /// not carry it yet. The first deliberate change to this wheel carries it
  /// into the reading, so the box never shows a value the saved reading
  /// silently lacks once the wheel is recorded.
  bool _serialFromRegister = false;
  late TyreReadingInput _pressureInput;
  late TyreReadingInput _treadInput;

  @override
  void initState() {
    super.initState();
    _pressureController = TextEditingController(
      text: _formatNumber(widget.reading.pressurePsi),
    );
    _treadController = TextEditingController(
      text: _formatNumber(widget.reading.treadDepthMm),
    );
    final String recorded = (widget.reading.serialNumber ?? '').trim();
    final String fitted = (widget.installedTyre?.serialNo ?? '').trim();
    _serialFromRegister = recorded.isEmpty && fitted.isNotEmpty;
    _serialController = TextEditingController(
      text: recorded.isNotEmpty ? widget.reading.serialNumber : fitted,
    );
    _notesController = TextEditingController(text: widget.reading.notes ?? '');
    _pressureInput = checkTyrePressure(_pressureController.text);
    _treadInput = checkTyreTread(_treadController.text);
  }

  @override
  void dispose() {
    _pressureController.dispose();
    _treadController.dispose();
    _serialController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _emit(TyrePositionReading next) {
    TyrePositionReading out = next;
    if (_serialFromRegister && (out.serialNumber ?? '').trim().isEmpty) {
      out = out.copyWith(serialNumber: _serialController.text.trim());
    }
    _serialFromRegister = false;
    widget.onChanged(out);
  }

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

  void _onPressureChanged(String v) {
    final TyreReadingInput input = checkTyrePressure(v);
    setState(() => _pressureInput = input);
    final TyrePositionReading r = widget.reading;
    // A value that cannot be a reading is not stored - and neither is the
    // previous one, which would otherwise sit behind a different number.
    _emit(
      input.isStorable
          ? r.copyWith(pressurePsi: input.value)
          : r.copyWith(clearPressurePsi: true),
    );
  }

  void _onTreadChanged(String v) {
    final TyreReadingInput input = checkTyreTread(v);
    setState(() => _treadInput = input);
    final TyrePositionReading r = widget.reading;
    _emit(
      input.isStorable
          ? r.copyWith(treadDepthMm: input.value)
          : r.copyWith(clearTreadDepthMm: true),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TyrePositionReading r = widget.reading;
    final String code = widget.positionLabel ?? r.position;
    final String fittedSerial = (widget.installedTyre?.serialNo ?? '').trim();
    final bool differs =
        serialDiffersFromRecord(_serialController.text, fittedSerial);
    final bool showFitted = widget.installedTyre != null ||
        widget.installedTyreUnavailable ||
        (widget.assetNo?.trim().isNotEmpty ?? false);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Flexible(
          child: SingleChildScrollView(
            key: TyrePositionEditorSheetKeys.scrollBody,
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                _PositionHeader(
                  code: code,
                  reading: r,
                  vehicleType: widget.vehicleType,
                  assetNo: widget.assetNo,
                ),
                if (showFitted) ...<Widget>[
                  const SizedBox(height: TpSpace.md),
                  _FittedTyreCard(
                    fitment: widget.installedTyre,
                    unavailable: widget.installedTyreUnavailable,
                    currentOdometerKm: widget.currentOdometerKm,
                  ),
                ],
                const SizedBox(height: TpSpace.md),
                _EditorSection(
                  icon: Icons.fact_check_outlined,
                  title: l10n.inspectionConditionLabel,
                  child: _ConditionGrid(
                    reading: r,
                    onSelect: (String condition) =>
                        _emit(r.copyWith(condition: condition)),
                    statusLabel: (TpStatus s) => _statusLabel(l10n, s),
                  ),
                ),
                const SizedBox(height: TpSpace.md),
                _EditorSection(
                  icon: Icons.speed_outlined,
                  title: l10n.tyreEditorSectionMeasurements,
                  child: _MeasurementFields(
                    pressureController: _pressureController,
                    treadController: _treadController,
                    pressureInput: _pressureInput,
                    treadInput: _treadInput,
                    onPressureChanged: _onPressureChanged,
                    onTreadChanged: _onTreadChanged,
                    previous: widget.previousReading,
                  ),
                ),
                const SizedBox(height: TpSpace.md),
                _EditorSection(
                  icon: Icons.tire_repair_outlined,
                  title: l10n.tyreEditorSectionTyre,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      TpInput(
                        label: l10n.inspectionSerialLabel,
                        controller: _serialController,
                        hint: fittedSerial.isEmpty ? null : fittedSerial,
                        textCapitalization: TextCapitalization.characters,
                        suffix: IconButton(
                          tooltip: l10n.serialSearchTitle,
                          onPressed: _isLookingUpSerial ? null : _lookupSerial,
                          icon: _isLookingUpSerial
                              ? const SizedBox.square(
                                  dimension: 20,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.manage_search_rounded),
                        ),
                        onChanged: (String v) {
                          _serialFromRegister = false;
                          setState(() {});
                          _emit(
                            r.copyWith(
                              serialNumber: v,
                              clearSerialNumber: v.trim().isEmpty,
                            ),
                          );
                        },
                      ),
                      if (differs) ...<Widget>[
                        const SizedBox(height: TpSpace.sm),
                        _InlineNotice(
                          key: TyrePositionEditorSheetKeys.serialDiffers,
                          icon: Icons.swap_horiz_rounded,
                          tone: palette.warning,
                          text: l10n.tyreEditorSerialDiffers(
                            TpDirection.isolateLtr(fittedSerial),
                          ),
                        ),
                      ],
                      if (_serialLookup != null) ...<Widget>[
                        const SizedBox(height: TpSpace.sm),
                        _SerialLookupCard(record: _serialLookup!),
                      ] else if (_serialNotFound) ...<Widget>[
                        const SizedBox(height: TpSpace.sm),
                        Text(
                          l10n.serialSearchEmptyMessage,
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: palette.warning.onSoft,
                                  ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: TpSpace.md),
                _EditorSection(
                  icon: Icons.photo_camera_outlined,
                  title: l10n.inspectionPhotoLabel,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
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
                        _InlineNotice(
                          icon: Icons.image_outlined,
                          text: l10n.inspectionPhotoNone,
                        ),
                      const SizedBox(height: TpSpace.sm),
                      _PhotoButtons(
                        isBusy: widget.isCapturingPhoto,
                        onCapture: widget.onCapturePhoto,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: TpSpace.md),
                _EditorSection(
                  icon: Icons.sticky_note_2_outlined,
                  title: l10n.inspectionNotesLabel,
                  child: TpInput(
                    label: l10n.inspectionNotesLabel,
                    controller: _notesController,
                    maxLines: 3,
                    onChanged: (String v) => _emit(
                      r.copyWith(notes: v, clearNotes: v.trim().isEmpty),
                    ),
                  ),
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

/// A recorded number as typed: `110` not `110.0`, `8.5` kept.
String _formatNumber(double? value) {
  if (value == null) return '';
  return value == value.roundToDouble()
      ? value.toStringAsFixed(0)
      : value.toString();
}

class _PositionHeader extends StatelessWidget {
  const _PositionHeader({
    required this.code,
    required this.reading,
    this.vehicleType,
    this.assetNo,
  });

  final String code;
  final TyrePositionReading reading;
  final String? vehicleType;
  final String? assetNo;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? plainName = tyrePositionPlainName(l10n, code);
    final String? rawType = vehicleType?.trim();
    // Only draw the map when the shared layouts know this vehicle.
    final String? type = rawType != null &&
            rawType.isNotEmpty &&
            kTyreDiagramLayouts[resolveVehicleType(rawType, assetNo)] != null
        ? rawType
        : null;
    final TyreCondition? condition = normaliseCondition(reading.condition);

    return TpCard(
      key: TyrePositionEditorSheetKeys.header,
      background: palette.primarySoft,
      borderColor: palette.primary.withValues(alpha: 0.32),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          if (type != null && type.isNotEmpty) ...<Widget>[
            DecoratedBox(
              decoration: BoxDecoration(
                color: palette.surface,
                borderRadius: BorderRadius.circular(TpRadius.md),
                border: Border.all(
                  color: palette.border,
                  width: TpBorderWidth.hairline,
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(TpSpace.sm),
                child: TyrePositionMiniMap(
                  vehicleType: type,
                  assetNo: assetNo,
                  position: reading.position,
                  semanticLabel: '${l10n.tyreEditorPositionMap}: $code',
                ),
              ),
            ),
            const SizedBox(width: TpSpace.md),
          ] else ...<Widget>[
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
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.tyreEditorEyebrow,
                  style: text.labelMedium?.copyWith(
                    color: palette.textSecondary,
                  ),
                ),
                TpIdentifierText(
                  code,
                  style: text.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                if (plainName != null)
                  Text(
                    plainName,
                    style: text.bodyMedium?.copyWith(color: palette.text),
                  ),
                const SizedBox(height: TpSpace.sm),
                // A wheel nobody has marked yet is not "Good": the default
                // selection below is only a starting point.
                if (reading.checked)
                  TpStatusChip(
                    status: tyreConditionStatus(condition),
                    label: tyreConditionLabel(l10n, condition),
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
        ],
      ),
    );
  }
}

class _FittedTyreCard extends StatelessWidget {
  const _FittedTyreCard({
    required this.fitment,
    required this.unavailable,
    required this.currentOdometerKm,
  });

  final TyreFitment? fitment;
  final bool unavailable;
  final double? currentOdometerKm;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TyreFitment? f = fitment;

    if (f == null) {
      return TpCard(
        key: TyrePositionEditorSheetKeys.fittedTyreCard,
        background: palette.surfaceAlt,
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              unavailable ? Icons.cloud_off_outlined : Icons.info_outline,
              color: palette.textMuted,
              size: TpSizing.iconMd,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    unavailable
                        ? l10n.tyreEditorFittedNotLoaded
                        : l10n.tyreEditorFittedNone,
                    style: text.labelLarge,
                  ),
                  if (unavailable)
                    Text(
                      l10n.tyreEditorFittedNotLoadedHint,
                      style: text.bodySmall?.copyWith(
                        color: palette.textSecondary,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    final String locale = Localizations.localeOf(context).toString();
    final NumberFormat km = NumberFormat.decimalPattern(locale);
    final double? run = kmRunSinceFitment(
      currentOdometerKm: currentOdometerKm,
      kmAtFitment: f.kmAtFitment,
    );
    final String? serial = f.serialNo?.trim();
    final List<String> facts = <String>[
      if (f.brand != null) '${l10n.serialSearchBrand}: ${f.brand}',
      if (f.size != null) '${l10n.serialSearchSize}: ${f.size}',
      if (f.issueDate != null)
        l10n.tyreEditorFittedOn(
          MaterialLocalizations.of(context).formatMediumDate(f.issueDate!),
        ),
      if (f.kmAtFitment != null)
        l10n.tyreEditorKmAtFitment(km.format(f.kmAtFitment!.round())),
      if (run != null) l10n.tyreEditorKmRun(km.format(run.round())),
    ];

    return TpCard(
      key: TyrePositionEditorSheetKeys.fittedTyreCard,
      background: palette.ok.soft,
      borderColor: palette.ok.base.withValues(alpha: 0.5),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.verified_outlined, color: palette.ok.onSoft),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.tyreEditorFittedTitle,
                  style: text.labelMedium?.copyWith(color: palette.ok.onSoft),
                ),
                if (serial != null && serial.isNotEmpty)
                  TpIdentifierText(
                    serial,
                    style: text.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: palette.ok.onSoft,
                    ),
                  )
                else
                  Text(
                    l10n.tyreEditorFittedSerialMissing,
                    style: text.titleSmall?.copyWith(color: palette.ok.onSoft),
                  ),
                if (facts.isNotEmpty) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    facts.join(' · '),
                    style: text.bodySmall?.copyWith(color: palette.ok.onSoft),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One titled group in the editor: an icon, a title and its controls on a
/// tinted surface, so the sheet reads as five clear steps.
class _EditorSection extends StatelessWidget {
  const _EditorSection({
    required this.icon,
    required this.title,
    required this.child,
  });

  final IconData icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      background: palette.surfaceAlt,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.primarySoft,
                  borderRadius: BorderRadius.circular(TpRadius.sm),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.xs),
                  child:
                      Icon(icon, size: TpSizing.iconSm, color: palette.primary),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          child,
        ],
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.icon,
    required this.text,
    this.tone,
    super.key,
  });

  final IconData icon;
  final String text;
  final TpStatusColors? tone;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors? t = tone;
    final Color ink = t?.onSoft ?? palette.textMuted;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: t?.soft ?? palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(
          color: t?.base ?? palette.border,
          width: TpBorderWidth.hairline,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, size: TpSizing.iconMd, color: ink),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                text,
                style:
                    Theme.of(context).textTheme.bodySmall?.copyWith(color: ink),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MeasurementFields extends StatelessWidget {
  const _MeasurementFields({
    required this.pressureController,
    required this.treadController,
    required this.pressureInput,
    required this.treadInput,
    required this.onPressureChanged,
    required this.onTreadChanged,
    required this.previous,
  });

  final TextEditingController pressureController;
  final TextEditingController treadController;
  final TyreReadingInput pressureInput;
  final TyreReadingInput treadInput;
  final ValueChanged<String> onPressureChanged;
  final ValueChanged<String> onTreadChanged;
  final PreviousTyreReading? previous;

  String? _error(AppLocalizations l10n, TyreReadingInput input, String range) =>
      switch (input.state) {
        TyreReadingInputState.invalidNumber => l10n.tyreEditorNumberInvalid,
        TyreReadingInputState.outOfRange => range,
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final Widget pressure = TpInput(
      label: l10n.inspectionPressureLabel,
      controller: pressureController,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      hint: l10n.inspectionPressureHint,
      errorText: _error(l10n, pressureInput, l10n.tyreEditorPressureRange),
      suffix: _UnitSuffix(l10n.tyreEditorUnitPsi),
      onChanged: onPressureChanged,
    );
    final Widget tread = TpInput(
      label: l10n.inspectionTreadLabel,
      controller: treadController,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      hint: l10n.inspectionTreadHint,
      errorText: _error(l10n, treadInput, l10n.tyreEditorTreadRange),
      suffix: _UnitSuffix(l10n.tyreEditorUnitMm),
      onChanged: onTreadChanged,
    );
    final List<String> warnings = <String>[
      if (pressureInput.state == TyreReadingInputState.unusual)
        l10n.tyreEditorPressureUnusual,
      if (treadInput.state == TyreReadingInputState.unusual)
        l10n.tyreEditorTreadUnusual,
    ];
    final String? previousLine = _previousLine(context, l10n);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final double scale = MediaQuery.textScalerOf(context).scale(1);
            // Side by side normally; stacked when the text is large or the
            // card is narrow, so neither label nor unit is cut off.
            if (scale > 1.3 || constraints.maxWidth < 320) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  pressure,
                  const SizedBox(height: TpSpace.md),
                  tread,
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(child: pressure),
                const SizedBox(width: TpSpace.md),
                Expanded(child: tread),
              ],
            );
          },
        ),
        for (final String warning in warnings) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          _InlineNotice(
            icon: Icons.warning_amber_rounded,
            tone: palette.warning,
            text: warning,
          ),
        ],
        if (previousLine != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                Icons.history_rounded,
                size: TpSizing.iconSm,
                color: palette.textSecondary,
              ),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: Text(
                  previousLine,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textSecondary),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  String? _previousLine(BuildContext context, AppLocalizations l10n) {
    final PreviousTyreReading? p = previous;
    if (p == null || !p.hasValue) return null;
    final String values = <String>[
      if (p.pressurePsi != null)
        '${_formatNumber(p.pressurePsi)} ${l10n.tyreEditorUnitPsi}',
      if (p.treadDepthMm != null)
        '${_formatNumber(p.treadDepthMm)} ${l10n.tyreEditorUnitMm}',
    ].join(' · ');
    final DateTime? date = p.inspectionDate;
    if (date == null) return l10n.tyreEditorPreviousReadingUndated(values);
    return l10n.tyreEditorPreviousReading(
      MaterialLocalizations.of(context).formatMediumDate(date),
      values,
    );
  }
}

class _UnitSuffix extends StatelessWidget {
  const _UnitSuffix(this.unit);

  final String unit;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: TpSpace.md),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 64),
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            unit,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: TpPalette.of(context).textSecondary,
                ),
          ),
        ),
      ),
    );
  }
}

class _ConditionGrid extends StatelessWidget {
  const _ConditionGrid({
    required this.reading,
    required this.onSelect,
    required this.statusLabel,
  });

  final TyrePositionReading reading;
  final ValueChanged<String> onSelect;
  final String Function(TpStatus) statusLabel;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        // Three per row normally; two when the text is scaled up or the
        // sheet is narrow, so a word such as "Puncture" is never cut off
        // (text scale 2 on 360dp).
        final double textScale = MediaQuery.textScalerOf(context).scale(1);
        final int columns =
            textScale > 1.3 || constraints.maxWidth < 280 ? 2 : 3;
        final double itemWidth =
            (constraints.maxWidth - (TpSpace.sm * (columns - 1))) / columns;
        return Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            // Problems first, Good last (kTyreConditionDisplayOrder). Only
            // the order on screen changes: each tile still stores its own
            // TyreReadingCondition value.
            for (final TyreCondition condition in kTyreConditionDisplayOrder)
              SizedBox(
                width: itemWidth,
                child: _ConditionTile(
                  condition: condition,
                  label: tyreConditionLabel(l10n, condition),
                  statusLabel: statusLabel(tyreConditionStatus(condition)),
                  isSelected: reading.checked &&
                      reading.condition == tyreReadingConditionValue(condition),
                  onTap: () => onSelect(tyreReadingConditionValue(condition)),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// One condition choice. Image-ready: a PNG at [tyreConditionImageAsset]
/// replaces the drawn glyph when present; the glyph is always the
/// fallback (and shows while the picture loads), so the tile is never
/// blank. Selected = a filled tint of the condition's colour, a heavy
/// coloured outline and a check badge; unselected = the plain surface with
/// a thin coloured outline. The selection is never colour alone.
class _ConditionTile extends StatelessWidget {
  const _ConditionTile({
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
    final AppLocalizations l10n = AppLocalizations.of(context);
    // The condition's own colour (owner, 2026-11-27), not the shared
    // severity band: Damaged, Puncture and Flat are all critical but each
    // gets its own outline, tint and tick.
    final Color band = tyreConditionAccent(condition, palette.brightness);
    final Color tickFill = tyreConditionSelectedFill(condition);
    final bool dark = palette.brightness == Brightness.dark;
    final Color fill = isSelected
        ? Color.alphaBlend(
            band.withValues(alpha: dark ? 0.28 : 0.16),
            palette.surface,
          )
        : palette.surface;
    final BorderRadius radius = BorderRadius.circular(TpRadius.md);

    return Semantics(
      label: '$label, $statusLabel',
      excludeSemantics: true,
      selected: isSelected,
      button: true,
      child: Material(
        color: fill,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: BorderSide(
            color: isSelected ? band : band.withValues(alpha: 0.55),
            width: isSelected ? 2.5 : TpBorderWidth.hairline,
          ),
        ),
        child: InkWell(
          key: ValueKey<String>('tyre-condition-$label'),
          borderRadius: radius,
          onTap: onTap,
          child: Stack(
            children: <Widget>[
              ConstrainedBox(
                constraints: const BoxConstraints(
                  minHeight: 100,
                  minWidth: double.infinity,
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: TpSpace.xs,
                    vertical: TpSpace.sm,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      _ConditionPicture(
                        condition: condition,
                        size: 52,
                        color: band,
                      ),
                      const SizedBox(height: TpSpace.xs),
                      Text(
                        label,
                        maxLines: 3,
                        softWrap: true,
                        textAlign: TextAlign.center,
                        style:
                            Theme.of(context).textTheme.labelMedium?.copyWith(
                                  color: palette.text,
                                  fontWeight: isSelected
                                      ? FontWeight.w800
                                      : FontWeight.w600,
                                ),
                      ),
                    ],
                  ),
                ),
              ),
              if (isSelected)
                PositionedDirectional(
                  top: TpSpace.xs,
                  end: TpSpace.xs,
                  child: Tooltip(
                    message: l10n.tyreEditorConditionSelected,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: tickFill,
                        shape: BoxShape.circle,
                        border: Border.all(color: palette.surface, width: 1.5),
                      ),
                      child: const Padding(
                        padding: EdgeInsets.all(2),
                        child: Icon(
                          Icons.check_rounded,
                          size: 14,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConditionPicture extends StatelessWidget {
  const _ConditionPicture({
    required this.condition,
    required this.size,
    required this.color,
  });

  final TyreCondition? condition;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final Widget glyph =
        TyreConditionGlyph(condition: condition, size: size, color: color);
    final TyreCondition? c = condition;
    if (c == null) return glyph;
    return Image.asset(
      tyreConditionImageAsset(c),
      width: size,
      height: size,
      fit: BoxFit.contain,
      excludeFromSemantics: true,
      // The glyph holds the space until the picture has a frame, and stays
      // when there is no picture yet - never an empty tile.
      frameBuilder: (
        BuildContext context,
        Widget child,
        int? frame,
        bool wasSynchronouslyLoaded,
      ) =>
          (frame == null && !wasSynchronouslyLoaded) ? glyph : child,
      errorBuilder: (BuildContext context, Object error, StackTrace? stack) =>
          glyph,
    );
  }
}

class _PhotoButtons extends StatelessWidget {
  const _PhotoButtons({required this.isBusy, required this.onCapture});

  final bool isBusy;
  final ValueChanged<PhotoCaptureSource> onCapture;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Row(
      children: <Widget>[
        Expanded(
          child: TpButton.secondary(
            label: l10n.inspectionPhotoCamera,
            icon: Icons.camera_alt_outlined,
            isBusy: isBusy,
            onPressed:
                isBusy ? null : () => onCapture(PhotoCaptureSource.camera),
          ),
        ),
        const SizedBox(width: TpSpace.md),
        Expanded(
          child: TpButton.secondary(
            label: l10n.inspectionPhotoGallery,
            icon: Icons.photo_library_outlined,
            isBusy: isBusy,
            onPressed:
                isBusy ? null : () => onCapture(PhotoCaptureSource.gallery),
          ),
        ),
      ],
    );
  }
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
