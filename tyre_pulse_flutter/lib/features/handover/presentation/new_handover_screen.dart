/// The vehicle handover capture wizard.
///
/// Five steps: Vehicle & drivers -> Condition & damage -> Photos & notes ->
/// Driver signature -> Review & submit. An in-progress draft is auto-saved to a
/// durable device store so a half-filled handover survives the app being killed
/// (`HandoverDraftStore`); on a successful submit the draft is cleared. Submit
/// goes through `HandoverSyncEngine`, which queues the handover durably FIRST
/// and then tries to deliver it - so a handover captured offline is never lost.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart' show TpIdentifierText;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/tp_back.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/handover/data/handover_photo_capture.dart';
import 'package:tyre_pulse/features/handover/data/handover_sync_engine.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_draft.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';
import 'package:tyre_pulse/features/handover/handover_providers.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_copy.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_ui.dart';
import 'package:tyre_pulse/features/handover/presentation/widgets/handover_damage_sheet.dart';
import 'package:tyre_pulse/features/handover/presentation/widgets/handover_photo_grid.dart';
import 'package:tyre_pulse/features/handover/presentation/widgets/handover_signature_pad.dart';
import 'package:uuid/uuid.dart';

enum _HandoverStep { vehicle, condition, photos, signature, review }

class NewHandoverScreen extends ConsumerStatefulWidget {
  const NewHandoverScreen({required this.route, super.key});

  final NewHandoverRoute route;

  @override
  ConsumerState<NewHandoverScreen> createState() => _NewHandoverScreenState();
}

class _NewHandoverScreenState extends ConsumerState<NewHandoverScreen> {
  static const Uuid _uuid = Uuid();
  final String _sessionKey = _uuid.v4();

  _HandoverStep _step = _HandoverStep.vehicle;

  String _assetNo = '';
  HandoverType _handoverType = HandoverType.checkout;
  final TextEditingController _fromDriver = TextEditingController();
  final TextEditingController _toDriver = TextEditingController();
  final TextEditingController _odometer = TextEditingController();
  final TextEditingController _fuel = TextEditingController();
  final TextEditingController _notes = TextEditingController();
  final TextEditingController _assetSearch = TextEditingController();
  HandoverConditionRating? _condition;
  HandoverCleanliness? _cleanliness;
  List<HandoverDamageMarker> _damages = <HandoverDamageMarker>[];
  List<String> _photos = <String>[];
  String? _signature;

  bool _restoring = true;
  bool _submitting = false;
  bool _capturing = false;
  Timer? _saveDebounce;

  @override
  void initState() {
    super.initState();
    final AssetNo? preset = widget.route.assetNo;
    if (preset != null && preset.value.trim().isNotEmpty) {
      _assetNo = preset.value.trim().toUpperCase();
    }
    _fromDriver.addListener(_scheduleSave);
    _toDriver.addListener(_scheduleSave);
    _odometer.addListener(_scheduleSave);
    _fuel.addListener(_scheduleSave);
    _notes.addListener(_scheduleSave);
    unawaited(_restore());
  }

  @override
  void dispose() {
    _saveDebounce?.cancel();
    _fromDriver.dispose();
    _toDriver.dispose();
    _odometer.dispose();
    _fuel.dispose();
    _notes.dispose();
    _assetSearch.dispose();
    super.dispose();
  }

  String get _userKey => ref.read(workspaceContextProvider)?.userId ?? '';

  Future<void> _restore() async {
    final String userKey = _userKey;
    final HandoverDraft? draft =
        userKey.isEmpty ? null : await ref.read(handoverDraftStoreProvider).read(userKey);
    if (!mounted) return;
    setState(() {
      if (draft != null && !draft.isEmpty) {
        // A preset asset from the route wins over a stale draft's asset.
        _assetNo = _assetNo.isNotEmpty ? _assetNo : draft.assetNo;
        _handoverType = draft.handoverType;
        _fromDriver.text = draft.fromDriver;
        _toDriver.text = draft.toDriver;
        _odometer.text = draft.odometerText;
        _fuel.text = draft.fuelText;
        _condition = draft.conditionRating;
        _cleanliness = draft.cleanliness;
        _damages = List<HandoverDamageMarker>.of(draft.damages);
        _photos = List<String>.of(draft.photos);
        _signature = draft.signatureDataUrl;
        _notes.text = draft.notes;
      }
      _restoring = false;
    });
  }

  HandoverDraft get _currentDraft => HandoverDraft(
        assetNo: _assetNo,
        handoverType: _handoverType,
        fromDriver: _fromDriver.text,
        toDriver: _toDriver.text,
        odometerText: _odometer.text,
        fuelText: _fuel.text,
        conditionRating: _condition,
        cleanliness: _cleanliness,
        damages: _damages,
        photos: _photos,
        signatureDataUrl: _signature,
        notes: _notes.text,
      );

  void _scheduleSave() {
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(milliseconds: 400), _saveNow);
  }

  Future<void> _saveNow() async {
    final String userKey = _userKey;
    if (userKey.isEmpty) return;
    try {
      await ref.read(handoverDraftStoreProvider).save(userKey, _currentDraft);
    } on Object {
      // A failed draft save is non-fatal: the submission queue is the durable
      // path for completed work. Never block the wizard on it.
    }
  }

  void _mutate(VoidCallback change) {
    setState(change);
    _scheduleSave();
  }

  // --- navigation -----------------------------------------------------------

  bool get _canLeaveStep {
    switch (_step) {
      case _HandoverStep.vehicle:
        return _assetNo.trim().isNotEmpty;
      case _HandoverStep.condition:
        return _condition != null &&
            (_fromDriver.text.trim().isNotEmpty ||
                _toDriver.text.trim().isNotEmpty);
      case _HandoverStep.photos:
      case _HandoverStep.signature:
      case _HandoverStep.review:
        return true;
    }
  }

  void _next() {
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (!_canLeaveStep) {
      final String message = switch (_step) {
        _HandoverStep.vehicle => l10n.handoverNeedsVehicle,
        _HandoverStep.condition => _condition == null
            ? l10n.handoverNeedsCondition
            : l10n.handoverNeedsDriver,
        _ => '',
      };
      if (message.isNotEmpty) {
        unawaited(
          showHandoverInfoDialog(
            context,
            title: l10n.handoverNewTitle,
            message: message,
          ),
        );
      }
      return;
    }
    final int index = _step.index;
    if (index < _HandoverStep.values.length - 1) {
      setState(() => _step = _HandoverStep.values[index + 1]);
    }
  }

  void _back() {
    final int index = _step.index;
    if (index > 0) {
      setState(() => _step = _HandoverStep.values[index - 1]);
    } else {
      TpBack.pop(context, fallback: TpBackFallbacks.forRoute(widget.route));
    }
  }

  // --- submit ---------------------------------------------------------------

  Future<void> _submit() async {
    if (_submitting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);

    final double? odometerKm = _parseNumber(_odometer.text);
    final double? fuelPct = _parseNumber(_fuel.text);
    if (_odometer.text.trim().isNotEmpty && odometerKm == null) {
      await showHandoverInfoDialog(
        context,
        title: l10n.handoverNewTitle,
        message: l10n.handoverInvalidNumber,
      );
      return;
    }
    if (_fuel.text.trim().isNotEmpty && (fuelPct == null || fuelPct < 0 || fuelPct > 100)) {
      await showHandoverInfoDialog(
        context,
        title: l10n.handoverNewTitle,
        message: l10n.handoverInvalidFuel,
      );
      return;
    }

    final String userId = _userKey;
    final HandoverPayload payload = HandoverPayload(
      assetNo: _assetNo.trim(),
      handoverType: _handoverType,
      fromDriver: _fromDriver.text.trim().isEmpty ? null : _fromDriver.text.trim(),
      toDriver: _toDriver.text.trim().isEmpty ? null : _toDriver.text.trim(),
      handoverAt: DateTime.now().toUtc(),
      odometerKm: odometerKm,
      fuelLevelPct: fuelPct,
      conditionRating: _condition,
      cleanliness: _cleanliness,
      damages: _damages,
      signatureDataUrl: _signature,
      photos: _photos,
      notes: _notes.text.trim(),
      createdBy: userId.isEmpty ? null : userId,
      country: ref.read(activeCountryProvider),
    );

    final List<HandoverSubmitIssue> issues = validateHandoverForSubmit(payload);
    if (issues.isNotEmpty) {
      await showHandoverInfoDialog(
        context,
        title: l10n.handoverNewTitle,
        message: _issueMessage(l10n, issues.first),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final HandoverSubmitResult result =
          await ref.read(handoverSyncEngineProvider).submitNow(
                payload: payload,
                clientUuid: _uuid.v4(),
              );
      // Work is durable now - clear the in-progress draft.
      if (userId.isNotEmpty) {
        await ref.read(handoverDraftStoreProvider).clear(userId);
      }
      ref
        ..invalidate(handoverPendingCountProvider)
        ..invalidate(myHandoversProvider)
        ..invalidate(pendingHandoversProvider);
      if (!mounted) return;

      final (String title, String message) = switch (result.outcome) {
        HandoverSubmitOutcome.deliveredNow => (
            l10n.handoverSubmittedTitle,
            l10n.handoverSubmittedMessage,
          ),
        HandoverSubmitOutcome.queued => (
            l10n.handoverQueuedTitle,
            l10n.handoverQueuedMessage,
          ),
        HandoverSubmitOutcome.queuedWithWarning => (
            l10n.handoverQueuedWarningTitle,
            result.warning?.message ?? l10n.handoverQueuedWarningMessage,
          ),
      };
      await showHandoverInfoDialog(context, title: title, message: message);
      if (mounted) {
        TpBack.pop(context, fallback: TpBackFallbacks.forRoute(widget.route));
      }
    } on Object catch (error) {
      if (!mounted) return;
      final AppError appError =
          handoverAsAppError(error, l10n.handoverSubmitFailedMessage);
      await showHandoverInfoDialog(
        context,
        title: l10n.handoverSubmitFailedTitle,
        message: appError.message,
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  static double? _parseNumber(String text) {
    final String trimmed = text.trim();
    if (trimmed.isEmpty) return null;
    return double.tryParse(trimmed.replaceAll(',', '.'));
  }

  String _issueMessage(AppLocalizations l10n, HandoverSubmitIssue issue) {
    return switch (issue) {
      HandoverSubmitIssue.missingVehicle => l10n.handoverNeedsVehicle,
      HandoverSubmitIssue.missingHandoverType => l10n.handoverNeedsType,
      HandoverSubmitIssue.missingDriver => l10n.handoverNeedsDriver,
      HandoverSubmitIssue.missingConditionRating => l10n.handoverNeedsCondition,
      HandoverSubmitIssue.invalidMeterReading => l10n.handoverInvalidNumber,
      HandoverSubmitIssue.missingSignature => l10n.handoverNeedsSignature,
    };
  }

  // --- build ----------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.handoverNewTitle,
        subtitle: _stepLabel(l10n, _step),
        backFallback: fallback,
        onBack: _back,
      ),
      bottomNavigationBar: _restoring ? null : _bottomBar(l10n),
      body: _restoring
          ? const TpLoadingState()
          : SafeArea(
              bottom: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _StepTrack(step: _step),
                  Expanded(child: _stepBody(l10n)),
                ],
              ),
            ),
    );
  }

  String _stepLabel(AppLocalizations l10n, _HandoverStep step) => switch (step) {
        _HandoverStep.vehicle => l10n.handoverStepVehicle,
        _HandoverStep.condition => l10n.handoverStepCondition,
        _HandoverStep.photos => l10n.handoverStepPhotos,
        _HandoverStep.signature => l10n.handoverStepSignature,
        _HandoverStep.review => l10n.handoverStepReview,
      };

  Widget _bottomBar(AppLocalizations l10n) {
    final TpPalette palette = TpPalette.of(context);
    final bool isReview = _step == _HandoverStep.review;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.sm,
            TpSpace.lg,
            TpSpace.sm,
          ),
          child: Row(
            children: <Widget>[
              Expanded(
                child: TpButton.secondary(
                  label: l10n.actionBack,
                  icon: Icons.arrow_back,
                  onPressed: _submitting ? null : _back,
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: isReview
                    ? TpButton.primary(
                        label: l10n.handoverSubmit,
                        icon: Icons.check_circle_outline,
                        isBusy: _submitting,
                        onPressed: _submitting ? null : () => unawaited(_submit()),
                      )
                    : TpButton.primary(
                        label: l10n.handoverNext,
                        icon: Icons.arrow_forward,
                        onPressed: _next,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stepBody(AppLocalizations l10n) {
    return switch (_step) {
      _HandoverStep.vehicle => _vehicleStep(l10n),
      _HandoverStep.condition => _conditionStep(l10n),
      _HandoverStep.photos => _photosStep(l10n),
      _HandoverStep.signature => _signatureStep(l10n),
      _HandoverStep.review => _reviewStep(l10n),
    };
  }

  // --- step 1: vehicle & drivers -------------------------------------------

  Future<void> _scanAsset() async {
    final String? scanned = await context.push<String>(
      const ScannerRoute().location,
    );
    if (!mounted || scanned == null || scanned.trim().isEmpty) return;
    _mutate(() => _assetNo = scanned.trim().toUpperCase());
  }

  Widget _vehicleStep(AppLocalizations l10n) {
    final AsyncValue<VehicleFleetListOutcome> fleet =
        ref.watch(vehicleFleetListProvider);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        Text(
          l10n.handoverTypeLabel,
          style: Theme.of(context).textTheme.labelLarge,
        ),
        const SizedBox(height: TpSpace.sm),
        TpSegmented<HandoverType>(
          expanded: true,
          value: _handoverType,
          options: <TpSegmentedOption<HandoverType>>[
            TpSegmentedOption<HandoverType>(
              value: HandoverType.checkout,
              label: l10n.handoverTypeCheckout,
              icon: Icons.logout,
            ),
            TpSegmentedOption<HandoverType>(
              value: HandoverType.checkin,
              label: l10n.handoverTypeCheckin,
              icon: Icons.login,
            ),
          ],
          onChanged: (HandoverType t) => _mutate(() => _handoverType = t),
        ),
        const SizedBox(height: TpSpace.lg),
        if (_assetNo.isNotEmpty) ...<Widget>[
          _SelectedAssetCard(
            assetNo: _assetNo,
            asset: _assetFor(_assetNo, fleet),
            onClear: () => _mutate(() => _assetNo = ''),
          ),
          const SizedBox(height: TpSpace.lg),
        ],
        TpButton.secondary(
          label: l10n.handoverScanAsset,
          icon: Icons.qr_code_scanner_rounded,
          onPressed: () => unawaited(_scanAsset()),
        ),
        const SizedBox(height: TpSpace.md),
        TpSearchField(
          controller: _assetSearch,
          hint: l10n.handoverVehicleSearchHint,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: TpSpace.md),
        _AssetResults(
          outcome: fleet,
          query: _assetSearch.text,
          selected: _assetNo,
          onPick: (String code) => _mutate(() => _assetNo = code),
        ),
      ],
    );
  }

  VehicleAsset? _assetFor(
    String code,
    AsyncValue<VehicleFleetListOutcome> fleet,
  ) {
    final List<VehicleAsset> assets = _assetsOf(fleet.valueOrNull);
    final String wanted = code.trim().toUpperCase();
    for (final VehicleAsset a in assets) {
      if ((a.assetNo ?? '').trim().toUpperCase() == wanted) return a;
    }
    return null;
  }

  // --- step 2: condition & damage ------------------------------------------

  Widget _conditionStep(AppLocalizations l10n) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        TpInput(
          label: l10n.handoverFromDriverLabel,
          controller: _fromDriver,
          hint: l10n.handoverDriverHint,
          textCapitalization: TextCapitalization.words,
        ),
        const SizedBox(height: TpSpace.md),
        TpInput(
          label: l10n.handoverToDriverLabel,
          controller: _toDriver,
          hint: l10n.handoverDriverHint,
          textCapitalization: TextCapitalization.words,
        ),
        const SizedBox(height: TpSpace.md),
        Row(
          children: <Widget>[
            Expanded(
              child: TpInput(
                label: l10n.handoverOdometerLabel,
                controller: _odometer,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: TpInput(
                label: l10n.handoverFuelLabel,
                controller: _fuel,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        Text(
          l10n.handoverConditionLabel,
          style: Theme.of(context).textTheme.labelLarge,
        ),
        const SizedBox(height: TpSpace.sm),
        TpSegmented<HandoverConditionRating>(
          expanded: true,
          value: _condition ?? HandoverConditionRating.good,
          options: <TpSegmentedOption<HandoverConditionRating>>[
            for (final HandoverConditionRating r
                in HandoverConditionRating.values)
              TpSegmentedOption<HandoverConditionRating>(
                value: r,
                label: handoverConditionLabel(l10n, r),
              ),
          ],
          onChanged: (HandoverConditionRating r) =>
              _mutate(() => _condition = r),
        ),
        if (_condition == null)
          Padding(
            padding: const EdgeInsets.only(top: TpSpace.xs),
            child: Text(
              l10n.handoverNeedsCondition,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: TpPalette.of(context).textMuted,
                  ),
            ),
          ),
        const SizedBox(height: TpSpace.md),
        Text(
          l10n.handoverCleanlinessLabel,
          style: Theme.of(context).textTheme.labelLarge,
        ),
        const SizedBox(height: TpSpace.sm),
        TpSegmented<HandoverCleanliness>(
          expanded: true,
          value: _cleanliness ?? HandoverCleanliness.clean,
          options: <TpSegmentedOption<HandoverCleanliness>>[
            for (final HandoverCleanliness c in HandoverCleanliness.values)
              TpSegmentedOption<HandoverCleanliness>(
                value: c,
                label: handoverCleanlinessLabel(l10n, c),
              ),
          ],
          onChanged: (HandoverCleanliness c) => _mutate(() => _cleanliness = c),
        ),
        const SizedBox(height: TpSpace.lg),
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                l10n.handoverDamageSectionTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            TpStatusChip(
              status: _damages.isEmpty ? TpStatus.neutral : TpStatus.warning,
              label: '${_damages.length}',
              isCompact: true,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        if (_damages.isEmpty)
          TpCard(
            child: Text(
              l10n.handoverNoDamage,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          )
        else
          for (int i = 0; i < _damages.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.sm),
              child: _DamageRow(
                marker: _damages[i],
                onEdit: () => unawaited(_editDamage(i)),
                onRemove: () =>
                    _mutate(() => _damages = <HandoverDamageMarker>[..._damages]..removeAt(i)),
              ),
            ),
        const SizedBox(height: TpSpace.sm),
        TpButton.secondary(
          label: l10n.handoverAddDamage,
          icon: Icons.add,
          onPressed: () => unawaited(_addDamage()),
        ),
      ],
    );
  }

  Future<void> _addDamage() async {
    final HandoverDamageMarker? marker =
        await showHandoverDamageSheet(context, sessionKey: _sessionKey);
    if (!mounted || marker == null) return;
    _mutate(() => _damages = <HandoverDamageMarker>[..._damages, marker]);
  }

  Future<void> _editDamage(int index) async {
    final HandoverDamageMarker? marker = await showHandoverDamageSheet(
      context,
      sessionKey: _sessionKey,
      initial: _damages[index],
    );
    if (!mounted || marker == null) return;
    _mutate(
      () => _damages = <HandoverDamageMarker>[
        for (int i = 0; i < _damages.length; i++)
          if (i == index) marker else _damages[i],
      ],
    );
  }

  // --- step 3: photos & notes ----------------------------------------------

  Future<void> _addPhoto(HandoverPhotoSource source) async {
    if (_capturing) return;
    setState(() => _capturing = true);
    try {
      final String? path = await ref.read(handoverPhotoCaptureProvider).capture(
            sessionKey: _sessionKey,
            source: source,
          );
      if (!mounted || path == null) return;
      _mutate(() => _photos = <String>[..._photos, path]);
    } on Object {
      // A declined pick is a no-op.
    } finally {
      if (mounted) setState(() => _capturing = false);
    }
  }

  Future<void> _choosePhotoSource() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final HandoverPhotoSource? source = await TpBottomSheet.show<HandoverPhotoSource>(
      context: context,
      title: l10n.handoverPhotosLabel,
      builder: (BuildContext sheetContext) => Padding(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          0,
          TpSpace.lg,
          TpSpace.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TpButton.primary(
              label: l10n.handoverPhotoCamera,
              icon: Icons.photo_camera_outlined,
              onPressed: () =>
                  Navigator.of(sheetContext).pop(HandoverPhotoSource.camera),
            ),
            const SizedBox(height: TpSpace.sm),
            TpButton.secondary(
              label: l10n.handoverPhotoGallery,
              icon: Icons.photo_library_outlined,
              onPressed: () =>
                  Navigator.of(sheetContext).pop(HandoverPhotoSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source != null) await _addPhoto(source);
  }

  Widget _photosStep(AppLocalizations l10n) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        Text(
          l10n.handoverPhotosLabel,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        HandoverPhotoGrid(
          references: _photos,
          onAdd: _capturing ? null : () => unawaited(_choosePhotoSource()),
          onRemove: (int i) =>
              _mutate(() => _photos = <String>[..._photos]..removeAt(i)),
        ),
        const SizedBox(height: TpSpace.lg),
        TpInput(
          label: l10n.handoverNotesLabel,
          controller: _notes,
          hint: l10n.handoverNotesHint,
          maxLines: 4,
          textCapitalization: TextCapitalization.sentences,
        ),
      ],
    );
  }

  // --- step 4: signature ---------------------------------------------------

  Widget _signatureStep(AppLocalizations l10n) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        Text(
          l10n.handoverSignatureLabel,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          l10n.handoverSignatureHint,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: TpPalette.of(context).textMuted,
              ),
        ),
        const SizedBox(height: TpSpace.md),
        TpCard(
          child: HandoverSignaturePad(
            value: _signature,
            height: 200,
            onChanged: (String? dataUrl) => _mutate(() => _signature = dataUrl),
          ),
        ),
      ],
    );
  }

  // --- step 5: review ------------------------------------------------------

  Widget _reviewStep(AppLocalizations l10n) {
    final AsyncValue<VehicleFleetListOutcome> fleet =
        ref.watch(vehicleFleetListProvider);
    final VehicleAsset? asset = _assetFor(_assetNo, fleet);
    final List<(String, String)> rows = <(String, String)>[
      (l10n.handoverTypeLabel, handoverTypeLabel(l10n, _handoverType)),
      (l10n.handoverVehicleLabel, _assetNo.isEmpty ? l10n.valueUnavailable : _assetNo),
      if (_fromDriver.text.trim().isNotEmpty)
        (l10n.handoverFromDriverLabel, _fromDriver.text.trim()),
      if (_toDriver.text.trim().isNotEmpty)
        (l10n.handoverToDriverLabel, _toDriver.text.trim()),
      if (_odometer.text.trim().isNotEmpty)
        (l10n.handoverOdometerLabel, '${_odometer.text.trim()} km'),
      if (_fuel.text.trim().isNotEmpty)
        (l10n.handoverFuelLabel, '${_fuel.text.trim()}%'),
      if (_condition != null)
        (l10n.handoverConditionLabel, handoverConditionLabel(l10n, _condition!)),
      if (_cleanliness != null)
        (l10n.handoverCleanlinessLabel, handoverCleanlinessLabel(l10n, _cleanliness!)),
      (l10n.handoverDamageSectionTitle, '${_damages.length}'),
      (l10n.handoverPhotosLabel, '${_photos.length}'),
      (
        l10n.handoverSignatureLabel,
        _signature == null ? l10n.handoverSignatureMissing : l10n.handoverSignatureSaved,
      ),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        if (asset != null && (asset.make != null || asset.model != null))
          Padding(
            padding: const EdgeInsets.only(bottom: TpSpace.sm),
            child: Text(
              <String?>[asset.make, asset.model]
                  .where((String? v) => v != null && v.trim().isNotEmpty)
                  .join(' '),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: TpPalette.of(context).textMuted,
                  ),
            ),
          ),
        TpCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              for (int i = 0; i < rows.length; i++) ...<Widget>[
                if (i > 0) const Divider(height: TpSpace.lg),
                _ReviewRow(label: rows[i].$1, value: rows[i].$2),
              ],
            ],
          ),
        ),
        if (_notes.text.trim().isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          Text(
            l10n.handoverNotesLabel,
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: TpSpace.xs),
          TpCard(child: Text(_notes.text.trim())),
        ],
      ],
    );
  }

  List<VehicleAsset> _assetsOf(VehicleFleetListOutcome? outcome) {
    return switch (outcome) {
      VehicleFleetListLoaded(assets: final List<VehicleAsset> a) => a,
      VehicleFleetListFromCache(assets: final List<VehicleAsset> a) => a,
      _ => const <VehicleAsset>[],
    };
  }
}

// ---------------------------------------------------------------------------

class _StepTrack extends StatelessWidget {
  const _StepTrack({required this.step});

  final _HandoverStep step;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.sm,
        TpSpace.lg,
        0,
      ),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < _HandoverStep.values.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: 4),
            Expanded(
              child: Container(
                height: 4,
                decoration: BoxDecoration(
                  color:
                      i <= step.index ? palette.primary : palette.borderStrong,
                  borderRadius: BorderRadius.circular(TpRadius.pill),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SelectedAssetCard extends StatelessWidget {
  const _SelectedAssetCard({
    required this.assetNo,
    required this.asset,
    required this.onClear,
  });

  final String assetNo;
  final VehicleAsset? asset;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String? sub = asset == null
        ? null
        : <String?>[asset!.make, asset!.model, asset!.vehicleType]
            .where((String? v) => v != null && v.trim().isNotEmpty)
            .map((String? v) => v!.trim())
            .join(' - ');
    return TpCard(
      background: palette.primarySoft,
      borderColor: palette.primary.withValues(alpha: 0.28),
      child: Row(
        children: <Widget>[
          Icon(Icons.directions_car_filled_outlined, color: palette.primary),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.handoverSelectedAsset,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: palette.textMuted,
                      ),
                ),
                TpIdentifierText(
                  assetNo,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                if (sub != null && sub.isNotEmpty)
                  Text(sub, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          IconButton(
            onPressed: onClear,
            icon: const Icon(Icons.close),
            tooltip: l10n.actionClear,
          ),
        ],
      ),
    );
  }
}

class _AssetResults extends StatelessWidget {
  const _AssetResults({
    required this.outcome,
    required this.query,
    required this.selected,
    required this.onPick,
  });

  final AsyncValue<VehicleFleetListOutcome> outcome;
  final String query;
  final String selected;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return outcome.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: TpSpace.lg),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, __) => TpCard(
        child: Text(
          l10n.handoverVehicleLoadFailed,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
      data: (VehicleFleetListOutcome value) {
        final List<VehicleAsset> all = switch (value) {
          VehicleFleetListLoaded(assets: final List<VehicleAsset> a) => a,
          VehicleFleetListFromCache(assets: final List<VehicleAsset> a) => a,
          _ => const <VehicleAsset>[],
        };
        final String q = query.trim().toLowerCase();
        final List<VehicleAsset> matches = q.isEmpty
            ? all.take(20).toList()
            : all.where((VehicleAsset a) => _matches(a, q)).take(30).toList();
        if (matches.isEmpty) {
          return TpCard(
            child: Text(
              q.isEmpty ? l10n.handoverVehicleStartTyping : l10n.handoverVehicleNoMatch,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final VehicleAsset a in matches)
              Padding(
                padding: const EdgeInsets.only(bottom: TpSpace.xs),
                child: TpCard(
                  onTap: () => onPick((a.assetNo ?? '').trim().toUpperCase()),
                  padding: const EdgeInsets.all(TpSpace.md),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            TpIdentifierText(
                              a.assetNo ?? '',
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                            Text(
                              <String?>[a.make, a.model, a.vehicleType]
                                  .where(
                                    (String? v) => v != null && v.trim().isNotEmpty,
                                  )
                                  .map((String? v) => v!.trim())
                                  .join(' - '),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      if ((a.assetNo ?? '').trim().toUpperCase() ==
                          selected.trim().toUpperCase())
                        Icon(
                          Icons.check_circle,
                          color: TpPalette.of(context).primary,
                        ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }

  static bool _matches(VehicleAsset a, String q) {
    bool has(String? v) => v != null && v.toLowerCase().contains(q);
    return has(a.assetNo) || has(a.make) || has(a.model) || has(a.vehicleType);
  }
}

class _DamageRow extends StatelessWidget {
  const _DamageRow({
    required this.marker,
    required this.onEdit,
    required this.onRemove,
  });

  final HandoverDamageMarker marker;
  final VoidCallback onEdit;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpCard(
      onTap: onEdit,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  '${handoverDamageViewLabel(l10n, marker.view)} - '
                  '${handoverDamageTypeLabel(l10n, marker.type)}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                if (marker.note != null && marker.note!.trim().isNotEmpty)
                  Text(
                    marker.note!.trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          TpStatusChip(
            status: handoverDamageLevelTone(marker.level),
            label: handoverDamageLevelLabel(l10n, marker.level),
            isCompact: true,
          ),
          IconButton(
            onPressed: onRemove,
            icon: const Icon(Icons.close),
            tooltip: l10n.actionClear,
          ),
        ],
      ),
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          flex: 2,
          child: Text(
            label,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: palette.textMuted),
          ),
        ),
        const SizedBox(width: TpSpace.md),
        Expanded(
          flex: 3,
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}
