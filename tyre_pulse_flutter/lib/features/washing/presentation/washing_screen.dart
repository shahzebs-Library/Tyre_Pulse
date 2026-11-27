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
/// # Four numbered steps built around the vehicle's own picture
///
/// 1 Vehicle (scan or search; the site comes from the vehicle record and
/// cannot be typed). 2 What was washed: the vehicle's wash picture (the
/// owner's illustration for its class, else its plain real fleet photo), the five sides to tap, and small picture
/// chips for exterior body, engine bay, undercarriage, cabin, tyres and
/// rims, mixer drum and hopper (mixers and pumps only) and steam degrease.
/// 3 Photos: at least one before AND one after photo, camera only, each
/// stamped with its device time and, when the phone can tell, GPS. 4 Review
/// and save: a dense summary list; checklist and chemicals fold inside it.
/// The save button is pinned at the bottom and names what is still missing.
///
/// # Audit evidence
///
/// Who (`created_by` and the profile name as `washed_by`), when (server
/// `created_at`, device `captured_at`, wash date locked to today) and where
/// (site from the vehicle record) come from the session and device; the
/// driver edits none of them. Photo stamps and the washed areas and sides
/// live inside the existing `wash_details` jsonb (`photo_evidence`, `areas`,
/// `views`), which the live CHECK accepts with no migration. A saved record
/// is read-only on the phone (see `WashRecordViewer`).
///
/// `wash_type` is derived from the areas by `washTypeForAreas` and stays one
/// of the CHECK values. Washing is done in-house at no charge, so the review
/// shows "No charge" and nothing here treats it as a cost.
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
import 'package:tyre_pulse/features/washing/domain/wash_areas.dart';
import 'package:tyre_pulse/features/washing/domain/wash_details.dart';
import 'package:tyre_pulse/features/washing/domain/wash_evidence.dart';
import 'package:tyre_pulse/features/washing/domain/wash_insights.dart';
import 'package:tyre_pulse/features/washing/domain/wash_schedule.dart';
import 'package:tyre_pulse/features/washing/presentation/wash_history_screen.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_area_grid.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_details_form.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_photo_gallery.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_ui.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_vehicle_status.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_vehicle_views.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';
import 'package:uuid/uuid.dart';

const Duration _kLookupDebounce = Duration(milliseconds: 350);

/// The steps of the wash form, in screen order.
enum _WashStep { vehicle, areas, photos, review }

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
  final TextEditingController _bayController = TextEditingController();
  final TextEditingController _odometerController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();

  final Map<_WashStep, GlobalKey> _stepKeys = <_WashStep, GlobalKey>{
    for (final _WashStep step in _WashStep.values) step: GlobalKey(),
  };

  String? _entryName;
  Timer? _lookupDebounce;
  VehicleAsset? _master;
  String? _vehicleType;
  final Set<WashArea> _areas = <WashArea>{};
  final Set<WashView> _views = <WashView>{};
  bool _waterless = false;
  String _status = kWashDefaultStatus;
  Map<String, dynamic> _washDetails = emptyWashDetails();
  final List<WashShot> _before = <WashShot>[];
  final List<WashShot> _after = <WashShot>[];
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

    _assetController.addListener(_onAssetChanged);
    unawaited(_fillOperatorFromProfile(workspace));
    unawaited(_loadHistory());
  }

  @override
  void dispose() {
    _lookupDebounce?.cancel();
    _assetController.removeListener(_onAssetChanged);
    _assetController.dispose();
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
      setState(() {
        _vehicleType = resolvedType;
        if (!vehicleHasDrumOrHopper(resolvedType)) {
          _areas.remove(WashArea.drumHopper);
        }
      });
    }
  }

  int get _photoCount => _before.length + _after.length;

  /// The site, never typed by the driver: the vehicle record's site, else
  /// the user's own legacy site. Null when neither is known.
  String? get _site {
    final String? fromVehicle = _master?.site?.trim();
    if (fromVehicle != null && fromVehicle.isNotEmpty) return fromVehicle;
    final String? legacy =
        ref.read(workspaceContextProvider)?.legacySite?.trim();
    return (legacy == null || legacy.isEmpty) ? null : legacy;
  }

  /// Camera capture, then a best-effort GPS fix for the stamp. The photo is
  /// kept even when there is no fix; its stamp then says "No GPS".
  Future<void> _capturePhoto(bool before, WashPhotoSource source) async {
    setState(() => _capturingBefore = before);
    try {
      final CapturedWashPhoto? photo =
          await ref.read(washPhotoCaptureProvider).captureAndStore(
                sessionKey: _sessionKey,
                orderIndex: _photoCount,
                source: WashPhotoSource.camera,
              );
      if (!mounted || photo == null) return;
      final fix = await ref.read(washLocateProvider)();
      if (!mounted) return;
      final WashShot shot = WashShot(
        path: photo.localPath,
        stage: before ? WashShotStage.before : WashShotStage.after,
        takenAt: photo.capturedAt,
        latitude: fix?.latitude,
        longitude: fix?.longitude,
        accuracyMeters: fix?.accuracyMeters,
      );
      setState(() {
        (before ? _before : _after).add(shot);
        if (_attention == _WashStep.photos) _attention = null;
      });
    } finally {
      if (mounted) setState(() => _capturingBefore = null);
    }
  }

  /// The first thing still stopping a save, or null when the wash can save.
  _WashStep? get _missingStep {
    if (_assetController.text.trim().isEmpty) return _WashStep.vehicle;
    if (_areas.isEmpty) return _WashStep.areas;
    if (!washPhotosComplete(_before, _after)) return _WashStep.photos;
    if (!validWashDetails(_washDetails)) return _WashStep.review;
    return null;
  }

  /// The `wash_type` that will be stored, derived from the marked areas.
  String? get _washType => washTypeForAreas(_areas, waterless: _waterless);

  /// The `wash_details` payload: checklist/chemicals plus areas and sides.
  Map<String, dynamic> get _detailsPayload => <String, dynamic>{
        ...withWashScope(_washDetails, areas: _areas, views: _views),
        'photo_evidence': washPhotoEvidence(_before, _after),
      };

  void _toggleArea(WashArea area) => setState(() {
        if (!_areas.remove(area)) _areas.add(area);
        if (_attention == _WashStep.areas) _attention = null;
      });

  void _toggleView(WashView view) => setState(() {
        if (!_views.remove(view)) _views.add(view);
      });

  String _missingLabel(AppLocalizations l10n, _WashStep step) => switch (step) {
        _WashStep.vehicle => l10n.washMissingVehicle,
        _WashStep.areas => l10n.washMissingAreas,
        _WashStep.photos => l10n.washMissingPhotos,
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
    final String? washType = _washType;
    if (washType == null) {
      _showSnack(l10n.washMissingAreas);
      return;
    }

    if (!validWashDetails(_washDetails)) {
      _showSnack(l10n.washEvidenceRequired);
      return;
    }
    final _SavedWash saved = _SavedWash(
      assetNo: asset,
      washType: washType,
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
              site: _site,
              country: workspace.activeCountry,
              washedBy: _entryName,
              washType: washType,
              status: _status,
              bay: _bayController.text.trim().isEmpty
                  ? null
                  : _bayController.text.trim(),
              odometerKm: _parseNum(_odometerController.text),
              notes: _notesController.text.trim().isEmpty
                  ? null
                  : _notesController.text.trim(),
              photoLocalPaths: <String>[
                for (final WashShot shot in <WashShot>[..._before, ..._after])
                  shot.path,
              ],
              washDetails: _detailsPayload,
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
    _lookupDebounce?.cancel();
    _assetController.clear();
    _bayController.clear();
    _odometerController.clear();
    _notesController.clear();
    setState(() {
      _master = null;
      _vehicleType = null;
      _areas.clear();
      _views.clear();
      _waterless = false;
      _status = kWashDefaultStatus;
      _washDetails = emptyWashDetails();
      _before.clear();
      _after.clear();
      _attention = null;
      _sessionKey = _uuid.v4();
    });
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
    final bool areasDone = _areas.isNotEmpty;
    final bool detailsValid = validWashDetails(_washDetails);
    final int checksDone = washChecklistDone(_washDetails);
    final int checksTotal = detailItems(_washDetails, 'checklist').length;
    final bool photosDone = washPhotosComplete(_before, _after);
    final _WashStep? missing = _missingStep;
    final bool ready = missing == null;
    final String? washType = _washType;
    final int stepsDone = <bool>[
      vehicleDone,
      areasDone,
      photosDone,
      ready,
    ].where((bool v) => v).length;
    final List<WashArea> offeredAreas = washAreasForVehicle(_vehicleType);

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
                const SizedBox(height: TpSpace.sm),
                _LockedFact(
                  key: WashingScreenKeys.site,
                  icon: Icons.location_on_outlined,
                  label: l10n.washSiteLabel,
                  value: _site ?? l10n.washNotRecorded,
                  note: l10n.washSiteFromVehicle,
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          WashStepCard(
            key: _stepKeys[_WashStep.areas],
            number: 2,
            title: l10n.washStepAreas,
            state: _stateFor(_WashStep.areas, areasDone),
            summary: areasDone
                ? l10n.washRecordedAsType(washTypeName(l10n, washType!))
                : (_attention == _WashStep.areas
                    ? l10n.washMissingAreas
                    : null),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.washAreasHint,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textSecondary),
                ),
                const SizedBox(height: TpSpace.md),
                WashVehicleViews(
                  key: WashingScreenKeys.vehicleViews,
                  master: _master,
                  assetNo: asset.isEmpty ? null : asset,
                  vehicleType: _vehicleType,
                  selected: _views,
                  onToggle: _toggleView,
                  areas: _areas,
                  onSetAll: (bool all) => setState(() {
                    _views.clear();
                    if (all) _views.addAll(WashView.values);
                  }),
                ),
                const SizedBox(height: TpSpace.lg),
                WashAreaGrid(
                  areas: offeredAreas,
                  selected: _areas,
                  onToggle: _toggleArea,
                ),
                const SizedBox(height: TpSpace.sm),
                Material(
                  type: MaterialType.transparency,
                  child: SwitchListTile.adaptive(
                    key: WashingScreenKeys.waterless,
                    contentPadding: EdgeInsets.zero,
                    value: _waterless,
                    title: Text(l10n.washWaterless),
                    onChanged: (bool v) => setState(() => _waterless = v),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          WashStepCard(
            key: _stepKeys[_WashStep.photos],
            number: 3,
            title: l10n.washStepPhotos,
            state: _stateFor(_WashStep.photos, photosDone),
            summary:
                l10n.washPhotosCount(_photoCount, WashPhotoCapture.maxPhotos),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.washPhotosRequired,
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
                  shots: _before,
                  busy: _capturingBefore == true,
                  canAdd: _photoCount < WashPhotoCapture.maxPhotos &&
                      _capturingBefore == null,
                  onAdd: (WashPhotoSource s) => _capturePhoto(true, s),
                  onRemove: (int i) => setState(() => _before.removeAt(i)),
                ),
                const SizedBox(height: TpSpace.md),
                _PhotoSlot(
                  key: WashingScreenKeys.afterPhotos,
                  title: l10n.washPhotosAfter,
                  icon: Icons.photo_camera_front_rounded,
                  tone: TpGemTone.green,
                  shots: _after,
                  busy: _capturingBefore == false,
                  canAdd: _photoCount < WashPhotoCapture.maxPhotos &&
                      _capturingBefore == null,
                  onAdd: (WashPhotoSource s) => _capturePhoto(false, s),
                  onRemove: (int i) => setState(() => _after.removeAt(i)),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          WashStepCard(
            key: _stepKeys[_WashStep.review],
            number: 4,
            title: l10n.washStepReview,
            state: detailsValid
                ? (ready ? WashStepState.done : WashStepState.todo)
                : WashStepState.attention,
            summary: detailsValid ? null : l10n.washMissingEvidence,
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
                const SizedBox(height: TpSpace.md),
                Text(
                  l10n.washStepChecklist,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                KeyedSubtree(
                  key: WashingScreenKeys.checklistSection,
                  child: WashDetailsForm(
                    key: ValueKey(_sessionKey),
                    value: _washDetails,
                    onChanged: (v) => setState(() => _washDetails = v),
                  ),
                ),
                _Folded(
                  title: l10n.washMoreDetails,
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
                      _site,
                    ),
                    (
                      Icons.badge_outlined,
                      l10n.washOperatorLabel,
                      _entryName,
                    ),
                    (
                      Icons.local_car_wash_rounded,
                      l10n.washAreasLabel,
                      _areas.isEmpty
                          ? null
                          : <String>[
                              for (final WashArea a in WashArea.values)
                                if (_areas.contains(a)) washAreaName(l10n, a),
                            ].join(', '),
                    ),
                    (
                      Icons.threesixty_rounded,
                      l10n.washViewsTitle,
                      _views.isEmpty
                          ? null
                          : <String>[
                              for (final WashView v in WashView.values)
                                if (_views.contains(v)) washViewName(l10n, v),
                            ].join(', '),
                    ),
                    (
                      Icons.category_outlined,
                      l10n.washTypeLabel,
                      washType == null ? null : washTypeName(l10n, washType),
                    ),
                    (
                      Icons.flag_outlined,
                      l10n.washStatusLabel,
                      _statusLabel(l10n, _status),
                    ),
                    (
                      Icons.payments_outlined,
                      l10n.washCostLabel,
                      l10n.washCostNoCharge,
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
  static const ValueKey<String> site = ValueKey<String>('washing.site');
  static const ValueKey<String> vehicleViews =
      ValueKey<String>('washing.vehicleViews');
  static const ValueKey<String> waterless =
      ValueKey<String>('washing.waterless');
  static const ValueKey<String> checklistSection =
      ValueKey<String>('washing.checklistSection');
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
    required this.shots,
    required this.busy,
    required this.canAdd,
    required this.onAdd,
    required this.onRemove,
    super.key,
  });

  final String title;
  final IconData icon;
  final TpGemTone tone;
  final List<WashShot> shots;
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
            WashGem(icon: icon, tone: tone, size: 28),
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
              l10n.washPhotoCountShort(shots.length),
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: palette.textMuted),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        WashPhotoGallery(
          localPaths: <String>[for (final WashShot s in shots) s.path],
          cameraOnly: true,
          stamps: <String>[
            for (final WashShot s in shots)
              l10n.washPhotoStamp(
                washStampTime(s.takenAt),
                s.hasGps ? washGpsLabel(s) : l10n.washGpsNone,
              ),
          ],
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

/// A folded section inside the review step (more details).
class _Folded extends StatelessWidget {
  const _Folded({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: Material(
        type: MaterialType.transparency,
        child: ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: Text(title, style: text.labelLarge),
          childrenPadding: const EdgeInsets.only(bottom: TpSpace.sm),
          children: children,
        ),
      ),
    );
  }
}

/// A value the driver cannot change (taken from the session or the vehicle
/// record), shown with a lock so nobody looks for an edit control.
class _LockedFact extends StatelessWidget {
  const _LockedFact({
    required this.icon,
    required this.label,
    required this.value,
    required this.note,
    super.key,
  });

  final IconData icon;
  final String label;
  final String value;
  final String note;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(TpSpace.sm),
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
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
                  '$label: $value',
                  style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                ),
                Text(
                  note,
                  style: text.bodySmall?.copyWith(color: palette.textMuted),
                ),
              ],
            ),
          ),
          Icon(Icons.lock_rounded, size: 16, color: palette.textMuted),
        ],
      ),
    );
  }
}

/// The review as a dense list: one line per fact, label then value, with a
/// thin divider between rows (not cards). Missing values read "Not recorded"
/// in the warning colour.
class _ReviewSummary extends StatelessWidget {
  const _ReviewSummary({required this.rows, super.key});

  final List<(IconData, String, String?)> rows;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(top: TpSpace.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            l10n.washReviewTitle,
            style: text.labelLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          for (int i = 0; i < rows.length; i++) ...<Widget>[
            if (i > 0) Divider(height: 1, color: palette.border),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(rows[i].$1, size: 16, color: palette.textMuted),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        text: '${rows[i].$2}: ',
                        style: text.bodySmall?.copyWith(
                          color: palette.textSecondary,
                        ),
                        children: <InlineSpan>[
                          TextSpan(
                            text: rows[i].$3 ?? l10n.washNotRecorded,
                            style: text.bodySmall?.copyWith(
                              color: rows[i].$3 == null
                                  ? palette.warning.base
                                  : palette.text,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
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
                if (nextWashDue(todayIsoDate())
                    case final String due) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    l10n.washNextDue(due),
                    key: const ValueKey<String>('washing.saved.nextDue'),
                    style: text.bodyMedium?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
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
