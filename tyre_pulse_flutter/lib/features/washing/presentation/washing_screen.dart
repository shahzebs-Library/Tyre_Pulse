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
/// logged with no signal is never lost. A "Due for wash" section lists
/// vehicles past their wash interval, derived on-device from
/// `WashRepository.listRecentWashes` via `wash_schedule.dart`'s
/// [washDueList].
///
/// # No local reminder notification
///
/// The reference additionally fires a local device notification when the
/// due list is non-empty (`notifyWashDue`). See
/// `features/washing/domain/wash_schedule.dart`'s own library comment for
/// why that is a deliberate, separate decision not folded into this phase -
/// the due list is surfaced here as a plain in-app panel only.
///
/// # Asset scanning is a plain typed field, not a camera scanner
///
/// Same disclosed simplification, for the same reasons, as
/// `features/meter_logs/presentation/meter_log_screen.dart`'s own library
/// comment: a debounced text field reaches `VehicleFleetRepository
/// .byAssetNo` 350ms after typing stops, matching the reference's own
/// debounce window, rather than embedding a second copy of the full-screen
/// camera scanner mid-form.
///
/// # `cost` / `water_liters` / `duration_min` are never captured here
///
/// See `wash_repository.dart`'s own library comment - `submitWash`'s own
/// comment in the reference states these were "removed per field
/// feedback", and this screen carries no input controls for them either.
///
/// # Single step, no review sheet
///
/// Unlike `MeterLogScreen`, the reference washing screen has no confirm
/// -then-photograph split - photos, wash type and status are all captured
/// on the one screen and "Save Wash" submits directly. This port keeps that
/// shape: `WashPhotoGallery` sits inline, and photos are OPTIONAL (the
/// reference passes no gauge-photo requirement for a wash the way the
/// meter-log odometer photo is required).
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
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/washing/data/wash_photo_capture.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/data/wash_repository.dart';
import 'package:tyre_pulse/features/washing/domain/wash_schedule.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_photo_gallery.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_recent_sheet.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';
import 'package:uuid/uuid.dart';

const Duration _kLookupDebounce = Duration(milliseconds: 350);

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

  bool _siteTouched = false;
  Timer? _lookupDebounce;
  VehicleAsset? _master;
  String? _vehicleType;
  String? _washType;
  String _status = kWashDefaultStatus;
  final List<String> _photoPaths = <String>[];
  bool _capturingPhoto = false;
  bool _submitting = false;

  bool _loadingDue = true;
  AppError? _dueError;
  List<WashDueEntry> _due = const <WashDueEntry>[];

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
    unawaited(_loadDue());
    unawaited(_fillOperatorFromProfile(workspace));
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

  Future<void> _fillOperatorFromProfile(WorkspaceContext? workspace) async {
    final String userId = workspace?.userId ?? '';
    if (userId.isEmpty) return;
    final String? name =
        await ref.read(washRepositoryProvider).currentUserDisplayName(userId);
    if (!mounted || name == null || name.trim().isEmpty) return;
    if (_operatorController.text.trim().isEmpty) {
      _operatorController.text = name.trim();
    }
  }

  Future<void> _loadDue() async {
    setState(() {
      _loadingDue = true;
      _dueError = null;
    });
    try {
      final List<WashRecord> recent =
          await ref.read(washRepositoryProvider).listRecentWashes();
      final List<WashDueEntry> due = washDueList(<WashHistoryRecord>[
        for (final WashRecord w in recent)
          WashHistoryRecord(
            assetNo: w.assetNo,
            washDate: w.washDate,
            site: w.site,
            vehicleType: w.vehicleType,
          ),
      ]);
      if (!mounted) return;
      setState(() {
        _due = due;
        _loadingDue = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      setState(() {
        _dueError = _asAppError(error, l10n.washDueLoadErrorMessage);
        _loadingDue = false;
      });
    }
  }

  static AppError _asAppError(Object error, String fallbackMessage) {
    if (error is AppError) return error;
    return AppError(
      kind: AppErrorKind.unknown,
      message: fallbackMessage,
      technical: error.toString(),
      cause: error,
      isRetryable: true,
    );
  }

  void _onAssetChanged() {
    _lookupDebounce?.cancel();
    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      setState(() => _master = null);
      return;
    }
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

  void _selectDueAsset(WashDueEntry entry) {
    _assetController.text = entry.assetNo;
    if (entry.site != null && !_siteTouched) {
      _siteController.text = entry.site!;
    }
  }

  void _onSiteEdited(String _) {
    _siteTouched = true;
  }

  Future<void> _capturePhoto(WashPhotoSource source) async {
    setState(() => _capturingPhoto = true);
    try {
      final CapturedWashPhoto? photo =
          await ref.read(washPhotoCaptureProvider).captureAndStore(
                sessionKey: _sessionKey,
                orderIndex: _photoPaths.length,
                source: source,
              );
      if (!mounted) return;
      if (photo != null) {
        setState(() => _photoPaths.add(photo.localPath));
      }
    } finally {
      if (mounted) setState(() => _capturingPhoto = false);
    }
  }

  void _removePhoto(int index) {
    setState(() => _photoPaths.removeAt(index));
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
              photoLocalPaths: _photoPaths,
            ),
          );
      if (!mounted) return;
      _showSnack(l10n.washSavedMessage);
      _resetForm();
      unawaited(_loadDue());
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
      _photoPaths.clear();
      _sessionKey = _uuid.v4();
    });
    // Operator name is deliberately KEPT - the same driver usually logs
    // several washes in a row, matching the reference's own
    // `resetForm`, which re-seeds it from `profile?.full_name` rather than
    // blanking it.
  }

  Future<void> _openRecentWashes() {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpBottomSheet.show<void>(
      context: context,
      title: l10n.washRecentTitle,
      builder: (BuildContext sheetContext) => const WashRecentSheet(),
    );
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

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.washNavTitle,
        subtitle: _todayLabel(),
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.history),
            tooltip: l10n.washRecentTitle,
            onPressed: _openRecentWashes,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          _DueForWashCard(
            loading: _loadingDue,
            error: _dueError,
            due: _due,
            onRetry: _loadDue,
            onSelect: _selectDueAsset,
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpInput(
                  label: l10n.washAssetLabel,
                  controller: _assetController,
                  hint: l10n.washAssetHint,
                  textCapitalization: TextCapitalization.characters,
                  isRequired: true,
                ),
                if (_master != null) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  _MasterInfoLine(master: _master!, l10n: l10n),
                ],
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: l10n.washSiteLabel,
                  controller: _siteController,
                  hint: l10n.washSiteHint,
                  onChanged: _onSiteEdited,
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  l10n.washSiteHelp,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: TpPalette.of(context).textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.washDateLabel,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.sm),
                Row(
                  children: <Widget>[
                    Icon(
                      Icons.calendar_today_outlined,
                      color: TpPalette.of(context).textSecondary,
                      size: TpSizing.iconSm,
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: Text(
                        l10n.washDateTodayLine(_todayLabel()),
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    ),
                    Icon(
                      Icons.lock_outline,
                      color: TpPalette.of(context).textMuted,
                      size: TpSizing.iconSm,
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: TpDropdown<String>(
              label: l10n.washTypeLabel,
              value: _washType,
              isRequired: true,
              items: <TpDropdownItem<String>>[
                for (final String type in kWashTypes)
                  TpDropdownItem<String>(
                    value: type,
                    label: _washTypeLabel(l10n, type),
                  ),
              ],
              onChanged: (String? value) => setState(() => _washType = value),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: TpDropdown<String>(
              label: l10n.washStatusLabel,
              value: _status,
              items: <TpDropdownItem<String>>[
                for (final String status in kWashStatusChoices)
                  TpDropdownItem<String>(
                    value: status,
                    label: _statusLabel(l10n, status),
                  ),
              ],
              onChanged: (String? value) =>
                  setState(() => _status = value ?? kWashDefaultStatus),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.washPhotosLabel,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.sm),
                WashPhotoGallery(
                  localPaths: _photoPaths,
                  isCapturing: _capturingPhoto,
                  onAdd: _capturePhoto,
                  onRemove: _removePhoto,
                  addLabel: l10n.washAddPhoto,
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.washDetailsLabel,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.sm),
                TpInput(
                  label: l10n.washOperatorLabel,
                  controller: _operatorController,
                  hint: l10n.washOperatorHint,
                ),
                const SizedBox(height: TpSpace.md),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Expanded(
                      child: TpInput(
                        label: l10n.washBayLabel,
                        controller: _bayController,
                        hint: l10n.washBayHint,
                      ),
                    ),
                    const SizedBox(width: TpSpace.md),
                    Expanded(
                      child: TpInput(
                        label: l10n.washOdometerLabel,
                        controller: _odometerController,
                        hint: l10n.washOdometerHint,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: TpInput(
              label: l10n.washNotesLabel,
              controller: _notesController,
              hint: l10n.washNotesHint,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
          ),
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.washSaveAction,
            icon: Icons.check_circle_outline,
            isBusy: _submitting,
            isFullWidth: true,
            onPressed: _submitting ? null : _handleSave,
          ),
        ],
      ),
    );
  }

  static String _todayLabel() {
    final DateTime now = DateTime.now();
    final String y = now.year.toString().padLeft(4, '0');
    final String m = now.month.toString().padLeft(2, '0');
    final String d = now.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  static String _washTypeLabel(AppLocalizations l10n, String type) {
    switch (type) {
      case 'Exterior':
        return l10n.washTypeExterior;
      case 'Interior':
        return l10n.washTypeInterior;
      case 'Full':
        return l10n.washTypeFull;
      case 'Engine Bay':
        return l10n.washTypeEngineBay;
      case 'Undercarriage':
        return l10n.washTypeUndercarriage;
      case 'Steam':
        return l10n.washTypeSteam;
      case 'Waterless':
        return l10n.washTypeWaterless;
      default:
        return type;
    }
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

/// See `meter_log_screen.dart`'s own `_parseNum` - the same contract, kept
/// as this feature's own copy.
num? _parseNum(String raw) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  return num.tryParse(trimmed);
}

class _MasterInfoLine extends StatelessWidget {
  const _MasterInfoLine({required this.master, required this.l10n});

  final VehicleAsset master;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String joinedMakeModel = <String?>[
      master.make,
      master.model,
    ].where((String? v) => v != null && v.trim().isNotEmpty).join(' ');
    final String? makeModel = joinedMakeModel.isEmpty ? null : joinedMakeModel;

    final List<String> parts = <String>[
      if (master.vehicleType != null && master.vehicleType!.trim().isNotEmpty)
        master.vehicleType!,
      if (makeModel != null) makeModel,
      if (master.fleetNumber != null && master.fleetNumber!.trim().isNotEmpty)
        l10n.washMasterFleetNumber(master.fleetNumber!),
      if (master.site != null && master.site!.trim().isNotEmpty) master.site!,
    ];
    if (parts.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.md,
        vertical: TpSpace.sm,
      ),
      decoration: BoxDecoration(
        color: palette.info.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.info.base),
      ),
      child: Text(
        parts.join(' · '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: palette.info.onSoft, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _DueForWashCard extends StatelessWidget {
  const _DueForWashCard({
    required this.loading,
    required this.error,
    required this.due,
    required this.onRetry,
    required this.onSelect,
  });

  final bool loading;
  final AppError? error;
  final List<WashDueEntry> due;
  final VoidCallback onRetry;
  final ValueChanged<WashDueEntry> onSelect;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.water_drop_outlined, color: palette.info.base),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  l10n.washDueTitle,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
              ),
              if (!loading && error == null && due.isNotEmpty)
                TpStatusChip(
                  status: TpStatus.warning,
                  label: due.length.toString(),
                  isCompact: true,
                ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          if (loading)
            const SizedBox(
              height: 20,
              child: Align(
                alignment: Alignment.centerLeft,
                child: SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            )
          else if (error != null)
            TpButton.text(
              label: error!.message,
              icon: Icons.refresh,
              onPressed: onRetry,
            )
          else if (due.isEmpty)
            Row(
              children: <Widget>[
                Icon(
                  Icons.check_circle_outline,
                  color: palette.ok.base,
                  size: TpSizing.iconSm,
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Text(
                    l10n.washDueNone,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            )
          else
            for (final WashDueEntry entry in due.take(8))
              _DueRow(entry: entry, onTap: () => onSelect(entry)),
        ],
      ),
    );
  }
}

class _DueRow extends StatelessWidget {
  const _DueRow({required this.entry, required this.onTap});

  final WashDueEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String meta = <String>[
      entry.daysOverdue == 0
          ? l10n.washDueToday
          : l10n.washDueOverdue(entry.daysOverdue),
      if (entry.site != null) entry.site!,
    ].join(' · ');

    return TpCard(
      onTap: onTap,
      margin: const EdgeInsets.only(top: TpSpace.sm),
      background: palette.surfaceAlt,
      child: Row(
        children: <Widget>[
          Icon(
            Icons.directions_car_outlined,
            color: palette.warning.base,
            size: TpSizing.iconSm,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  entry.assetNo,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  meta,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: palette.textMuted),
        ],
      ),
    );
  }
}
