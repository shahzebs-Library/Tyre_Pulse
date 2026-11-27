/// Vehicle Washing entry screen.
///
/// Ported from `mobile/app/(app)/washing.tsx` (`mobile/` is READ-ONLY
/// reference material - see `AGENTS.md` rule "Never edit them from this
/// project"). That screen's own file comment states the design; the parts
/// this port must preserve exactly:
///
/// A driver picks the asset, the screen auto-fills and displays the
/// vehicle's details from `vehicle_fleet`, they choose the wash type, add
/// photos, and save. The wash is ALWAYS dated today (same-day, read-only).
/// The write is offline-safe via the offline command queue, so a wash
/// logged with no signal is never lost. This entry surface is intentionally
/// focused on recording the wash; scheduling remains in the washing history/
/// planning surfaces rather than appearing as a second task above the form.
///
/// # No local reminder notification
///
/// The reference additionally fires a local device notification when the
/// due list is non-empty (`notifyWashDue`). See
/// `features/washing/domain/wash_schedule.dart`'s own library comment for
/// why that is a deliberate, separate decision not folded into this phase -
/// the due list is surfaced here as a plain in-app panel only.
///
/// # Asset scanning stays inside the form
///
/// The QR action uses the shared focused scanner and returns the decoded
/// asset code without navigating away from any work already entered.
///
/// # `cost` / `water_liters` / `duration_min` are never captured here
///
/// See `wash_repository.dart`'s own library comment - `submitWash`'s own
/// comment in the reference states these were "removed per field
/// feedback", and this screen carries no input controls for them either.
///
/// # Five numbered steps, one sticky save button
///
/// The form reads top to bottom as 1 Vehicle, 2 Wash type, 3 Checklist and
/// chemicals, 4 Photos (before and after), 5 Review and save, with a progress
/// line above. Photos are still OPTIONAL and the rules are unchanged: an
/// asset and a wash type are required, chemical names and issue notes must
/// be filled when used. The save button sits pinned at the bottom and names
/// what is still missing ("Pick a vehicle") - tapping it then scrolls to that
/// step instead of failing after the fact.
///
/// Before and after photos are two galleries on screen but are saved as the
/// one ordered `photos` list the record has always had (before first, then
/// after), so nothing about what is stored changes.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/selected_vehicle_card.dart';
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';
import 'package:tyre_pulse/features/washing/data/wash_photo_capture.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/data/wash_repository.dart';
import 'package:tyre_pulse/features/washing/domain/wash_details.dart';
import 'package:tyre_pulse/features/washing/domain/wash_insights.dart';
import 'package:tyre_pulse/features/washing/presentation/wash_history_screen.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_details_form.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_photo_gallery.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_type_grid.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_ui.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_vehicle_status.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';
import 'package:uuid/uuid.dart';

const Duration _kLookupDebounce = Duration(milliseconds: 350);

/// The steps of the wash form, in screen order.
enum _WashStep { vehicle, type, checklist, photos, review }

class WashingScreen extends ConsumerStatefulWidget {
  const WashingScreen({required this.route, super.key});

  /// [WashingRoute] carries no parameters of its own, but the typed route
  /// is still threaded through - matching every other registered screen in
  /// this codebase - so [TpBackFallbacks.forRoute] resolves the SAME way a
  /// future fallback table entry for this route id would, rather than this
  /// screen quietly hard-coding today's answer.
  final WashingRoute route;

  @override
  ConsumerState<WashingScreen> createState() => _WashingScreenState();
}

class _WashingScreenState extends ConsumerState<WashingScreen> {
  static const Uuid _uuid = Uuid();

  final TextEditingController _assetController = TextEditingController();
  final TextEditingController _siteController = TextEditingController();
  final TextEditingController _operatorController = TextEditingController();
  final TextEditingController _bayController = TextEditingController();
  final TextEditingController _odometerController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();

  final Map<_WashStep, GlobalKey> _stepKeys = <_WashStep, GlobalKey>{
    for (final _WashStep step in _WashStep.values) step: GlobalKey(),
  };

  bool _siteTouched = false;
  String? _entryName;
  Timer? _lookupDebounce;
  VehicleAsset? _master;
  String? _vehicleType;
  String? _washType;
  String _status = kWashDefaultStatus;
  Map<String, dynamic> _washDetails = emptyWashDetails();
  final List<String> _beforePaths = <String>[];
  final List<String> _afterPaths = <String>[];
  bool? _capturingBefore;
  bool _submitting = false;
  _WashStep? _attention;

  List<WashRecord> _history = const <WashRecord>[];
  bool _historyLoading = true;
  bool _historyFailed = false;

  late String _sessionKey;

  @override
  void initState() {
    super.initState();
    _sessionKey = _uuid.v4();

    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? legacySite = workspace?.legacySite?.trim();
    if (legacySite != null && legacySite.isNotEmpty) {
      _siteController.text = legacySite;
      _siteTouched = true;
    }

    _assetController.addListener(_onAssetChanged);
    unawaited(_fillOperatorFromProfile(workspace));
    unawaited(_loadHistory());
  }

  @override
  void dispose() {
    _lookupDebounce?.cancel();
    _assetController.removeListener(_onAssetChanged);
    _assetController.dispose();
    _siteController.dispose();
    _operatorController.dispose();
    _bayController.dispose();
    _odometerController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _historyLoading = true;
      _historyFailed = false;
    });
    try {
      final List<WashRecord> rows =
          await ref.read(washRepositoryProvider).listRecentWashes();
      if (!mounted) return;
      setState(() {
        _history = rows;
        _historyLoading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _historyLoading = false;
        _historyFailed = true;
      });
    }
  }

  Future<void> _fillOperatorFromProfile(WorkspaceContext? workspace) async {
    final String userId = workspace?.userId ?? '';
    if (userId.isEmpty) return;
    final String? name =
        await ref.read(washRepositoryProvider).currentUserDisplayName(userId);
    if (!mounted || name == null || name.trim().isEmpty) return;
    setState(() => _entryName = name.trim());
    if (_operatorController.text.trim().isEmpty) {
      _operatorController.text = name.trim();
    }
  }

  void _onAssetChanged() {
    _lookupDebounce?.cancel();
    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      setState(() => _master = null);
      return;
    }
    if (_attention == _WashStep.vehicle) setState(() => _attention = null);
    _lookupDebounce = Timer(
      _kLookupDebounce,
      () => unawaited(_performLookup(asset)),
    );
  }

  Future<void> _performLookup(String asset) async {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final VehicleDetailOutcome outcome =
        await ref.read(vehicleFleetRepositoryProvider).byAssetNo(
              scope: vehicleCacheScopeFor(workspace),
              assetNo: asset,
              country: workspace?.activeCountry,
            );

    if (!mounted) return;
    if (_assetController.text.trim() != asset) return;

    VehicleAsset? resolved;
    if (outcome is VehicleDetailLoaded) {
      resolved = outcome.asset;
    } else if (outcome is VehicleDetailFromCache) {
      resolved = outcome.asset;
    }

    setState(() => _master = resolved);

    if (resolved == null) return;

    final String? resolvedType = resolved.vehicleType?.trim();
    if (resolvedType != null &&
        resolvedType.isNotEmpty &&
        (_vehicleType == null || _vehicleType!.trim().isEmpty)) {
      setState(() => _vehicleType = resolvedType);
    }

    final String? masterSite = resolved.site?.trim();
    if (masterSite != null &&
        masterSite.isNotEmpty &&
        !_siteTouched &&
        _siteController.text.trim().isEmpty) {
      _siteController.text = masterSite;
    }
  }

  void _onSiteEdited(String _) {
    _siteTouched = true;
  }

  int get _photoCount => _beforePaths.length + _afterPaths.length;

  Future<void> _capturePhoto(bool before, WashPhotoSource source) async {
    setState(() => _capturingBefore = before);
    try {
      final CapturedWashPhoto? photo =
          await ref.read(washPhotoCaptureProvider).captureAndStore(
                sessionKey: _sessionKey,
                orderIndex: _photoCount,
                source: source,
              );
      if (!mounted) return;
      if (photo != null) {
        setState(
          () => (before ? _beforePaths : _afterPaths).add(photo.localPath),
        );
      }
    } finally {
      if (mounted) setState(() => _capturingBefore = null);
    }
  }

  /// The first thing still stopping a save, or null when the wash can save.
  _WashStep? get _missingStep {
    if (_assetController.text.trim().isEmpty) return _WashStep.vehicle;
    if (_washType == null) return _WashStep.type;
    if (!validWashDetails(_washDetails)) return _WashStep.checklist;
    return null;
  }

  String _missingLabel(AppLocalizations l10n, _WashStep step) => switch (step) {
        _WashStep.vehicle => l10n.washMissingVehicle,
        _WashStep.type => l10n.washMissingType,
        _ => l10n.washMissingEvidence,
      };

  Future<void> _onSavePressed() async {
    if (_submitting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (ref.read(workspaceContextProvider) == null) {
      _showSnack(l10n.washWorkspaceLoadingMessage);
      return;
    }
    final _WashStep? missing = _missingStep;
    if (missing != null) {
      setState(() => _attention = missing);
      final BuildContext? target = _stepKeys[missing]!.currentContext;
      if (target != null) {
        await Scrollable.ensureVisible(
          target,
          duration: const Duration(milliseconds: 280),
          alignment: 0.05,
        );
      }
      return;
    }
    await _handleSave();
  }

  Future<void> _handleSave() async {
    if (_submitting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);

    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      _showSnack(l10n.washWorkspaceLoadingMessage);
      return;
    }

    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      await _showInfoDialog(
        title: l10n.washAssetRequiredTitle,
        message: l10n.washAssetRequiredMessage,
      );
      return;
    }
    if (_washType == null) {
      await _showInfoDialog(
        title: l10n.washTypeRequiredTitle,
        message: l10n.washTypeRequiredMessage,
      );
      return;
    }

    if (!validWashDetails(_washDetails)) {
      _showSnack(l10n.washEvidenceRequired);
      return;
    }
    final _SavedWash saved = _SavedWash(
      assetNo: asset,
      washType: _washType!,
      photoCount: _photoCount,
      time: _timeLabel(),
    );
    setState(() => _submitting = true);
    try {
      await ref.read(washRepositoryProvider).submitWash(
            workspace: workspace,
            input: SubmitWashInput(
              assetNo: asset,
              vehicleType: _vehicleType,
              site: _siteController.text.trim().isEmpty
                  ? null
                  : _siteController.text.trim(),
              country: workspace.activeCountry,
              washedBy: _operatorController.text.trim().isEmpty
                  ? null
                  : _operatorController.text.trim(),
              washType: _washType,
              status: _status,
              bay: _bayController.text.trim().isEmpty
                  ? null
                  : _bayController.text.trim(),
              odometerKm: _parseNum(_odometerController.text),
              notes: _notesController.text.trim().isEmpty
                  ? null
                  : _notesController.text.trim(),
              photoLocalPaths: <String>[..._beforePaths, ..._afterPaths],
              washDetails: _washDetails,
            ),
          );
      if (!mounted) return;
      _resetForm();
      bool? online;
      try {
        online = await ref.read(washOnlineCheckProvider)();
      } on Object {
        online = null;
      }
      if (!mounted) return;
      await _showSavedSheet(saved, online);
      if (mounted) unawaited(_loadHistory());
    } on Object {
      if (!mounted) return;
      await _showInfoDialog(
        title: l10n.washSaveFailedTitle,
        message: l10n.washTryAgainFallback,
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _showSavedSheet(_SavedWash saved, bool? online) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpBottomSheet.show<void>(
      context: context,
      title: l10n.washSavedTitle,
      builder: (BuildContext sheetContext) => _WashSavedSheet(
        saved: saved,
        online: online,
        onAnother: () => Navigator.of(sheetContext).pop(),
        onHistory: () {
          Navigator.of(sheetContext).pop();
          unawaited(_openHistory());
        },
      ),
    );
  }

  void _resetForm() {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? legacySite = workspace?.legacySite?.trim();

    _lookupDebounce?.cancel();
    _assetController.clear();
    _siteController.text =
        (legacySite != null && legacySite.isNotEmpty) ? legacySite : '';
    _siteTouched = legacySite != null && legacySite.isNotEmpty;
    _bayController.clear();
    _odometerController.clear();
    _notesController.clear();
    setState(() {
      _master = null;
      _vehicleType = null;
      _washType = null;
      _status = kWashDefaultStatus;
      _washDetails = emptyWashDetails();
      _beforePaths.clear();
      _afterPaths.clear();
      _attention = null;
      _sessionKey = _uuid.v4();
    });
    // Operator name is deliberately KEPT - the same driver usually logs
    // several washes in a row, matching the reference's own
    // `resetForm`, which re-seeds it from `profile?.full_name` rather than
    // blanking it.
  }

  Future<void> _openHistory() {
    return Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (BuildContext _) => const WashHistoryScreen(),
      ),
    );
  }

  Future<void> _scanAsset() async {
    final String? code = await showAssetCameraScanner(context);
    if (!mounted || code == null || code.trim().isEmpty) return;
    _assetController.text = code.trim();
    await _performLookup(code.trim());
  }

  Future<void> _showInfoDialog({
    required String title,
    required String message,
  }) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: <Widget>[
          TpButton.primary(
            label: l10n.actionClose,
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
        ],
      ),
    );
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  WashStepState _stateFor(_WashStep step, bool done) {
    if (_attention == step && !done) return WashStepState.attention;
    return done ? WashStepState.done : WashStepState.todo;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final String asset = _assetController.text.trim();

    final bool vehicleDone = asset.isNotEmpty;
    final bool typeDone = _washType != null;
    final bool detailsValid = validWashDetails(_washDetails);
    final int checksDone = washChecklistDone(_washDetails);
    final int checksTotal = detailItems(_washDetails, 'checklist').length;
    final bool checklistDone = detailsValid && checksDone > 0;
    final bool photosDone = _photoCount > 0;
    final _WashStep? missing = _missingStep;
    final bool ready = missing == null;
    final int stepsDone = <bool>[
      vehicleDone,
      typeDone,
      checklistDone,
      photosDone,
      ready,
    ].where((bool v) => v).length;

    final AssetWashInfo? washInfo =
        asset.isEmpty ? null : assetWashInfo(_history, asset);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.washNavTitle,
        subtitle: _todayLabel(),
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            key: WashingScreenKeys.history,
            icon: const Icon(Icons.history_rounded),
            tooltip: l10n.washHistoryTitle,
            onPressed: _openHistory,
          ),
        ],
      ),
      bottomNavigationBar: _SaveBar(
        label: ready ? l10n.washSaveAction : _missingLabel(l10n, missing),
        ready: ready,
        busy: _submitting,
        onPressed: _submitting ? null : _onSavePressed,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          _ProgressHeader(done: stepsDone, total: _WashStep.values.length),
          const SizedBox(height: TpSpace.md),
          _LoggedByBanner(
            name: _entryName ?? l10n.washLoggedBySelf,
            time: _timeLabel(),
          ),
          const SizedBox(height: TpSpace.md),
          WashStepCard(
            key: _stepKeys[_WashStep.vehicle],
            number: 1,
            title: l10n.washStepVehicle,
            state: _stateFor(_WashStep.vehicle, vehicleDone),
            summary: _attention == _WashStep.vehicle && !vehicleDone
                ? l10n.washMissingVehicle
                : null,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (_master == null)
                  TpInput(
                    label: l10n.washAssetLabel,
                    controller: _assetController,
                    hint: l10n.washAssetHint,
                    textCapitalization: TextCapitalization.characters,
                    isRequired: true,
                    prefixIcon: Icons.local_shipping_outlined,
                    suffix: IconButton(
                      key: WashingScreenKeys.scanAsset,
                      tooltip: l10n.scannerTitle,
                      onPressed: _scanAsset,
                      icon: const TpIcon(Icons.qr_code_scanner_rounded),
                    ),
                  )
                else
                  SelectedVehicleCard(
                    asset: _master!,
                    changeLabel: l10n.washChangeVehicle,
                    unavailableLabel: l10n.valueUnavailable,
                    meterValue: _master!.currentKm == null
                        ? null
                        : l10n.meterLogRecentKmValue(
                            formatVehicleOdometer(_master!.currentKm!),
                          ),
                    onChange: () {
                      _assetController.clear();
                      setState(() => _master = null);
                    },
                  ),
                if (asset.isNotEmpty) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  WashVehicleStatus(
                    key: WashingScreenKeys.vehicleStatus,
                    loading: _historyLoading,
                    failed: _historyFailed,
                    info: washInfo,
                  ),
                ],
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: l10n.washSiteLabel,
                  controller: _siteController,
                  hint: l10n.washSiteHint,
                  prefixIcon: Icons.location_on_outlined,
                  onChanged: _onSiteEdited,
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  l10n.washSiteHelp,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          WashStepCard(
            key: _stepKeys[_WashStep.type],
            number: 2,
            title: l10n.washStepType,
            state: _stateFor(_WashStep.type, typeDone),
            summary: typeDone
                ? washTypeName(l10n, _washType!)
                : (_attention == _WashStep.type ? l10n.washMissingType : null),
            child: WashTypeGrid(
              types: kWashTypes,
              selected: _washType,
              onSelected: (String value) => setState(() {
                _washType = value;
                if (_attention == _WashStep.type) _attention = null;
              }),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          WashStepCard(
            key: _stepKeys[_WashStep.checklist],
            number: 3,
            title: l10n.washStepChecklist,
            optionalLabel: l10n.washStepOptional,
            state: detailsValid
                ? (checklistDone ? WashStepState.done : WashStepState.todo)
                : WashStepState.attention,
            summary: detailsValid
                ? l10n.washChecklistProgress(checksDone, checksTotal)
                : l10n.washMissingEvidence,
            child: WashDetailsForm(
              key: ValueKey(_sessionKey),
              value: _washDetails,
              onChanged: (v) => setState(() => _washDetails = v),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          WashStepCard(
            key: _stepKeys[_WashStep.photos],
            number: 4,
            title: l10n.washStepPhotos,
            optionalLabel: l10n.washStepOptional,
            state: photosDone ? WashStepState.done : WashStepState.todo,
            summary:
                l10n.washPhotosCount(_photoCount, WashPhotoCapture.maxPhotos),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.washPhotosOptional,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textSecondary),
                ),
                const SizedBox(height: TpSpace.md),
                _PhotoSlot(
                  key: WashingScreenKeys.beforePhotos,
                  title: l10n.washPhotosBefore,
                  icon: Icons.photo_camera_back_rounded,
                  tone: TpGemTone.amber,
                  paths: _beforePaths,
                  busy: _capturingBefore == true,
                  canAdd: _photoCount < WashPhotoCapture.maxPhotos &&
                      _capturingBefore == null,
                  onAdd: (WashPhotoSource s) => _capturePhoto(true, s),
                  onRemove: (int i) => setState(() => _beforePaths.removeAt(i)),
                ),
                const SizedBox(height: TpSpace.md),
                _PhotoSlot(
                  key: WashingScreenKeys.afterPhotos,
                  title: l10n.washPhotosAfter,
                  icon: Icons.photo_camera_front_rounded,
                  tone: TpGemTone.green,
                  paths: _afterPaths,
                  busy: _capturingBefore == false,
                  canAdd: _photoCount < WashPhotoCapture.maxPhotos &&
                      _capturingBefore == null,
                  onAdd: (WashPhotoSource s) => _capturePhoto(false, s),
                  onRemove: (int i) => setState(() => _afterPaths.removeAt(i)),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          WashStepCard(
            key: _stepKeys[_WashStep.review],
            number: 5,
            title: l10n.washStepReview,
            state: ready ? WashStepState.done : WashStepState.todo,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.washStatusLabel,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(height: TpSpace.xs),
                Wrap(
                  spacing: TpSpace.sm,
                  runSpacing: TpSpace.xs,
                  children: <Widget>[
                    for (final String status in kWashStatusChoices)
                      ChoiceChip(
                        label: Text(_statusLabel(l10n, status)),
                        selected: _status == status,
                        onSelected: (_) => setState(() => _status = status),
                      ),
                  ],
                ),
                Theme(
                  data: Theme.of(context)
                      .copyWith(dividerColor: Colors.transparent),
                  child: Material(
                    type: MaterialType.transparency,
                    child: ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      title: Text(
                        l10n.washMoreDetails,
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      childrenPadding:
                          const EdgeInsets.only(bottom: TpSpace.sm),
                      children: <Widget>[
                        TpInput(
                          label: l10n.washBayLabel,
                          controller: _bayController,
                          hint: l10n.washBayHint,
                        ),
                        const SizedBox(height: TpSpace.md),
                        TpInput(
                          label: l10n.washOdometerLabel,
                          controller: _odometerController,
                          hint: l10n.washOdometerHint,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                        ),
                        const SizedBox(height: TpSpace.md),
                        TpInput(
                          label: l10n.washNotesLabel,
                          controller: _notesController,
                          hint: l10n.washNotesHint,
                          maxLines: 3,
                          textCapitalization: TextCapitalization.sentences,
                        ),
                      ],
                    ),
                  ),
                ),
                _ReviewSummary(
                  key: WashingScreenKeys.review,
                  rows: <(IconData, String, String?)>[
                    (
                      Icons.local_shipping_outlined,
                      l10n.washAssetLabel,
                      asset.isEmpty
                          ? null
                          : <String?>[asset, _vehicleType]
                              .whereType<String>()
                              .join(' · '),
                    ),
                    (
                      Icons.location_on_outlined,
                      l10n.washSiteLabel,
                      _siteController.text.trim().isEmpty
                          ? null
                          : _siteController.text.trim(),
                    ),
                    (
                      Icons.local_car_wash_rounded,
                      l10n.washTypeLabel,
                      _washType == null ? null : washTypeName(l10n, _washType!),
                    ),
                    (
                      Icons.flag_outlined,
                      l10n.washStatusLabel,
                      _statusLabel(l10n, _status),
                    ),
                    (
                      Icons.fact_check_outlined,
                      l10n.washStepChecklist,
                      l10n.washReviewChecklistValue(
                        checksDone,
                        checksTotal,
                        _productsLabel(l10n),
                      ),
                    ),
                    (
                      Icons.photo_library_outlined,
                      l10n.washPhotosLabel,
                      l10n.washPhotosCount(
                        _photoCount,
                        WashPhotoCapture.maxPhotos,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _productsLabel(AppLocalizations l10n) {
    final String status =
        _washDetails['chemical_status'] as String? ?? 'not_recorded';
    if (status == 'used') {
      return l10n.washProductsCount(
        detailItems(_washDetails, 'chemicals').length,
      );
    }
    if (status == 'none') return l10n.washNoChemical;
    return '${l10n.washChemicalUseLabel}: ${l10n.washNotRecorded}';
  }

  static String _todayLabel() {
    final DateTime now = DateTime.now();
    final String y = now.year.toString().padLeft(4, '0');
    final String m = now.month.toString().padLeft(2, '0');
    final String d = now.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  static String _timeLabel() {
    final DateTime now = DateTime.now();
    final String h = now.hour.toString().padLeft(2, '0');
    final String m = now.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  static String _statusLabel(AppLocalizations l10n, String status) {
    switch (status) {
      case 'In Progress':
        return l10n.washStatusInProgress;
      case 'Completed':
        return l10n.washStatusCompleted;
      default:
        return status;
    }
  }
}

abstract final class WashingScreenKeys {
  static const ValueKey<String> scanAsset =
      ValueKey<String>('washing.scanAsset');
  static const ValueKey<String> save = ValueKey<String>('washing.save');
  static const ValueKey<String> history = ValueKey<String>('washing.history');
  static const ValueKey<String> progress = ValueKey<String>('washing.progress');
  static const ValueKey<String> loggedBy = ValueKey<String>('washing.loggedBy');
  static const ValueKey<String> vehicleStatus =
      ValueKey<String>('washing.vehicleStatus');
  static const ValueKey<String> beforePhotos =
      ValueKey<String>('washing.beforePhotos');
  static const ValueKey<String> afterPhotos =
      ValueKey<String>('washing.afterPhotos');
  static const ValueKey<String> review = ValueKey<String>('washing.review');
  static const ValueKey<String> savedSheet =
      ValueKey<String>('washing.savedSheet');
}

/// See `meter_log_screen.dart`'s own `_parseNum` - the same contract, kept
/// as this feature's own copy.
num? _parseNum(String raw) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  return num.tryParse(trimmed);
}

class _ProgressHeader extends StatelessWidget {
  const _ProgressHeader({required this.done, required this.total});

  final int done;
  final int total;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Column(
      key: WashingScreenKeys.progress,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          l10n.washStepProgress(done, total),
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: palette.textSecondary,
                fontWeight: FontWeight.w700,
              ),
        ),
        const SizedBox(height: TpSpace.sm),
        Row(
          children: <Widget>[
            for (int i = 0; i < total; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: TpSpace.xs),
              Expanded(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  height: 6,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(TpRadius.pill),
                    gradient: i < done
                        ? LinearGradient(
                            colors: <Color>[
                              TpGemTone.teal.start,
                              TpGemTone.green.start,
                            ],
                          )
                        : null,
                    color: i < done ? null : palette.border,
                  ),
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }
}

/// Who is logging the wash, shown once: the signed-in user and the time.
class _LoggedByBanner extends StatelessWidget {
  const _LoggedByBanner({required this.name, required this.time});

  final String name;
  final String time;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Container(
      key: WashingScreenKeys.loggedBy,
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: palette.info.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Row(
        children: <Widget>[
          const WashGem(
            icon: Icons.verified_user_rounded,
            tone: TpGemTone.blue,
            size: 36,
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  l10n.washLoggedBy(name, time),
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: palette.info.onSoft,
                        fontWeight: FontWeight.w800,
                      ),
                ),
                Text(
                  l10n.washLoggedByNote,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Icon(Icons.lock_rounded, color: palette.info.onSoft, size: 18),
        ],
      ),
    );
  }
}

class _PhotoSlot extends StatelessWidget {
  const _PhotoSlot({
    required this.title,
    required this.icon,
    required this.tone,
    required this.paths,
    required this.busy,
    required this.canAdd,
    required this.onAdd,
    required this.onRemove,
    super.key,
  });

  final String title;
  final IconData icon;
  final TpGemTone tone;
  final List<String> paths;
  final bool busy;
  final bool canAdd;
  final ValueChanged<WashPhotoSource> onAdd;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            WashGem(icon: icon, tone: tone, size: 32),
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
            Text(
              l10n.washPhotoCountShort(paths.length),
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: palette.textMuted),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        WashPhotoGallery(
          localPaths: paths,
          isCapturing: busy,
          canAdd: canAdd || busy,
          onAdd: onAdd,
          onRemove: onRemove,
          addLabel: l10n.washAddPhoto,
        ),
      ],
    );
  }
}

class _ReviewSummary extends StatelessWidget {
  const _ReviewSummary({required this.rows, super.key});

  final List<(IconData, String, String?)> rows;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            l10n.washReviewTitle,
            style: text.titleSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          for (final (IconData icon, String label, String? value) in rows)
            Padding(
              padding: const EdgeInsets.only(top: TpSpace.sm),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(icon, size: 18, color: palette.textMuted),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          label,
                          style: text.labelSmall
                              ?.copyWith(color: palette.textMuted),
                        ),
                        Text(
                          value ?? l10n.washNotRecorded,
                          style: text.bodyMedium?.copyWith(
                            color: value == null
                                ? palette.warning.base
                                : palette.text,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SaveBar extends StatelessWidget {
  const _SaveBar({
    required this.label,
    required this.ready,
    required this.busy,
    required this.onPressed,
  });

  final String label;
  final bool ready;
  final bool busy;
  final VoidCallback? onPressed;

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
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.md,
          ),
          child: ready
              ? TpButton.primary(
                  key: WashingScreenKeys.save,
                  label: label,
                  icon: Icons.check_circle_outline,
                  isBusy: busy,
                  isFullWidth: true,
                  onPressed: onPressed,
                )
              : TpButton.secondary(
                  key: WashingScreenKeys.save,
                  label: label,
                  icon: Icons.arrow_upward_rounded,
                  isFullWidth: true,
                  onPressed: onPressed,
                ),
        ),
      ),
    );
  }
}

final class _SavedWash {
  const _SavedWash({
    required this.assetNo,
    required this.washType,
    required this.photoCount,
    required this.time,
  });

  final String assetNo;
  final String washType;
  final int photoCount;
  final String time;
}

class _WashSavedSheet extends StatelessWidget {
  const _WashSavedSheet({
    required this.saved,
    required this.online,
    required this.onAnother,
    required this.onHistory,
  });

  final _SavedWash saved;
  final bool? online;
  final VoidCallback onAnother;
  final VoidCallback onHistory;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String message = switch (online) {
      true => l10n.washSavedOnlineMessage,
      false => l10n.washSavedOfflineMessage,
      null => l10n.washSavedOnDevice,
    };
    return SingleChildScrollView(
      key: WashingScreenKeys.savedSheet,
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        0,
        TpSpace.lg,
        TpSpace.lg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              WashGem(
                icon: online == false
                    ? Icons.cloud_off_rounded
                    : Icons.cloud_upload_rounded,
                tone: online == false ? TpGemTone.amber : TpGemTone.green,
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Text(
                  message,
                  style: text.bodyMedium?.copyWith(color: palette.text),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          Container(
            padding: const EdgeInsets.all(TpSpace.md),
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  saved.assetNo,
                  style:
                      text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: TpSpace.xs),
                Wrap(
                  spacing: TpSpace.sm,
                  runSpacing: TpSpace.xs,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    WashTypeChip(type: saved.washType),
                    Text(
                      '${_WashingScreenState._todayLabel()} ${saved.time}',
                      style: text.bodySmall
                          ?.copyWith(color: palette.textSecondary),
                    ),
                    Text(
                      l10n.washPhotoCountShort(saved.photoCount),
                      style: text.bodySmall
                          ?.copyWith(color: palette.textSecondary),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.lg),
          TpButton.primary(
            label: l10n.washLogAnother,
            icon: Icons.add_rounded,
            isFullWidth: true,
            onPressed: onAnother,
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.secondary(
            label: l10n.washHistoryTitle,
            icon: Icons.history_rounded,
            isFullWidth: true,
            onPressed: onHistory,
          ),
        ],
      ),
    );
  }
}
