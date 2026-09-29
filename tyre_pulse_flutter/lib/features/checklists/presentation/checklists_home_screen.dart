/// "Checklists" - the templates this operator may fill, their open
/// assignments, and any unfinished work worth resuming.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_detail_screen.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_due.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/checklists/presentation/checklist_history_screen.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_reading.dart';
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';

abstract final class ChecklistsHomeScreenKeys {
  static const Key brandHeader = ValueKey<String>('checklists.brand-header');
  static const Key searchField = ValueKey<String>('checklists.asset-search');
  static const Key selectedAsset = ValueKey<String>(
    'checklists.selected-asset',
  );
  static const Key languageSelector = ValueKey<String>(
    'checklists.language-selector',
  );
  static const Key requiredForAsset = ValueKey<String>(
    'checklists.required-for-asset',
  );
  static const Key tyreInspection = ValueKey<String>(
    'checklists.tyre-inspection',
  );
  static const Key history = ValueKey<String>('checklists.history');
  static const Key masterDataVerified = ValueKey<String>(
    'checklists.master-data-verified',
  );
  static const Key assetMeters = ValueKey<String>('checklists.asset-meters');
  static const Key meterReading = ValueKey<String>('checklists.meter-reading');
  static const Key meterRecord = ValueKey<String>('checklists.meter-record');
  static const Key pendingApprovals = ValueKey<String>(
    'checklists.pending-approvals',
  );
}

class ChecklistsHomeScreen extends ConsumerStatefulWidget {
  const ChecklistsHomeScreen({super.key});

  @override
  ConsumerState<ChecklistsHomeScreen> createState() =>
      _ChecklistsHomeScreenState();
}

enum _ChecklistHomeFailure { workspaceLoading, loadFailed }

class _ChecklistsHomeScreenState extends ConsumerState<ChecklistsHomeScreen> {
  bool _loading = true;
  _ChecklistHomeFailure? _failure;
  List<ChecklistTemplateRecord> _templates = const <ChecklistTemplateRecord>[];
  List<ChecklistAssignmentRecord> _assignments =
      const <ChecklistAssignmentRecord>[];
  List<ChecklistDraftHeader> _drafts = const <ChecklistDraftHeader>[];
  String _query = '';
  String? _selectedAssetNo;
  bool _libraryExpanded = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failure = null;
    });

    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      setState(() {
        _loading = false;
        _failure = _ChecklistHomeFailure.workspaceLoading;
      });
      return;
    }

    try {
      final remote = ref.read(checklistRemoteRepositoryProvider);
      final drafts = ref.read(checklistDraftRepositoryProvider);
      final String? role =
          workspace.role.rawValue.isEmpty ? null : workspace.role.rawValue;

      final List<ChecklistTemplateRecord> templates =
          await remote.listTemplates(
        country: workspace.activeCountry,
        role: role,
        isSuperAdmin: workspace.isSuperAdmin,
      );
      final List<ChecklistAssignmentRecord> assignments =
          (await remote.listAssignments(
        country: workspace.activeCountry,
        role: role,
        isSuperAdmin: workspace.isSuperAdmin,
      ))
              .where((ChecklistAssignmentRecord a) => a.isOpen)
              .toList(growable: false);
      final List<ChecklistDraftHeader> allDrafts = await drafts.draftsForUser(
        workspace.userId,
      );

      final List<ChecklistDraftHeader> realDrafts = <ChecklistDraftHeader>[];
      for (final ChecklistDraftHeader d in allDrafts) {
        final bool hasContent = await drafts.hasContent(d.draftKey);
        if (hasContent) realDrafts.add(d);
      }

      if (!mounted) return;
      setState(() {
        _templates = templates;
        _assignments = assignments;
        _drafts = realDrafts;
        final List<String> candidates = _assetNumbers(
          assignments: assignments,
          drafts: realDrafts,
        );
        if (_selectedAssetNo == null && candidates.length == 1) {
          _selectedAssetNo = candidates.single;
        }
        _loading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failure = _ChecklistHomeFailure.loadFailed;
      });
    }
  }

  void _openTemplate(ChecklistTemplateRecord record, {String? assetNo}) {
    final String? id = record.template.id;
    if (id == null) return;
    GoRouter.of(context).push(
      ChecklistFillRoute(
        templateId: TemplateId(id),
        assetNo: assetNo == null ? null : AssetNo(assetNo),
        siteName: _siteForAsset(assetNo),
      ).location,
    );
  }

  void _openAssignment(ChecklistAssignmentRecord assignment) {
    final String? templateId = assignment.templateId;
    if (templateId == null) return;
    GoRouter.of(context).push(
      ChecklistFillRoute(
        templateId: TemplateId(templateId),
        assignmentId: AssignmentId(assignment.id),
        siteName: assignment.site == null ? null : SiteName(assignment.site!),
        assetNo:
            assignment.assetNo == null ? null : AssetNo(assignment.assetNo!),
      ).location,
    );
  }

  void _resumeDraft(ChecklistDraftHeader draft) {
    GoRouter.of(context).push(
      ChecklistFillRoute(
        templateId: TemplateId(draft.templateId),
        assetNo: draft.assetNo.isEmpty ? null : AssetNo(draft.assetNo),
        draftKey: DraftKey(draft.draftKey),
      ).location,
    );
  }

  void _openHistory({String? assetNo}) {
    if (assetNo == null || assetNo.trim().isEmpty) {
      GoRouter.of(context).push(const ChecklistHistoryRoute().location);
      return;
    }
    // Same history screen, opened already filtered to this asset. The route
    // carries no parameters, so it is pushed directly (as the vehicle card
    // already does for the vehicle detail screen).
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (BuildContext context) =>
            ChecklistHistoryScreen(initialSearch: assetNo.trim()),
      ),
    );
  }

  void _openMeterLog(String assetNo) {
    GoRouter.of(context).push(
      MeterLogRoute(
        assetNo: AssetNo(assetNo),
        siteName: _siteForAsset(assetNo),
      ).location,
    );
  }

  void _openInspectionApprovals() {
    GoRouter.of(context).push(const InspectionApprovalsRoute().location);
  }

  void _openTyreInspection({String? assetNo}) {
    GoRouter.of(context).push(
      NewInspectionRoute(
        assetNo: assetNo == null ? null : AssetNo(assetNo),
        siteName: _siteForAsset(assetNo),
      ).location,
    );
  }

  Future<void> _openScanner() async {
    final String? scanned = await showAssetCameraScanner(context);
    if (!mounted || scanned == null || scanned.trim().isEmpty) return;
    await _selectVerifiedAsset(scanned);
  }

  void _openVehicle(String assetNo) {
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (BuildContext context) =>
            VehicleDetailScreen(assetNo: assetNo),
      ),
    );
  }

  SiteName? _siteForAsset(String? assetNo) {
    if (assetNo == null) return null;
    for (final ChecklistAssignmentRecord assignment in _assignments) {
      if (_sameAsset(assignment.assetNo, assetNo)) {
        final String? site = assignment.site;
        if (site != null && site.trim().isNotEmpty) return SiteName(site);
      }
    }
    for (final ChecklistDraftHeader draft in _drafts) {
      if (_sameAsset(draft.assetNo, assetNo)) {
        final String? site = draft.site;
        if (site != null && site.trim().isNotEmpty) return SiteName(site);
      }
    }
    return null;
  }

  void _updateSearch(String value) {
    final String query = value.trim();
    final List<String> candidates = _assetNumbers(
      assignments: _assignments,
      drafts: _drafts,
    );
    String? exact;
    for (final String candidate in candidates) {
      if (_sameAsset(candidate, query)) {
        exact = candidate;
        break;
      }
    }
    setState(() {
      _query = query;
      if (exact != null) _selectedAssetNo = exact;
    });
  }

  Future<void> _submitSearch(String value) async {
    final String query = value.trim();
    if (query.isEmpty) return;
    await _selectVerifiedAsset(query);
  }

  Future<void> _selectVerifiedAsset(String rawAssetNo) async {
    final String query = rawAssetNo.trim();
    if (query.isEmpty) return;

    final List<String> localCandidates = _assetNumbers(
      assignments: _assignments,
      drafts: _drafts,
    );
    for (final String candidate in localCandidates) {
      if (_sameAsset(candidate, query)) {
        _selectAsset(candidate);
        return;
      }
    }

    final AppLocalizations l10n = AppLocalizations.of(context);
    try {
      final VehicleDetailOutcome outcome = await ref.read(
        vehicleDetailProvider(query).future,
      );
      if (!mounted) return;
      switch (outcome) {
        case VehicleDetailLoaded(asset: final VehicleAsset asset):
        case VehicleDetailFromCache(asset: final VehicleAsset asset):
          _selectAsset(
            asset.assetNo?.trim().isNotEmpty == true
                ? asset.assetNo!.trim()
                : query,
          );
          return;
        case VehicleDetailNotFound():
          _showLookupMessage(l10n.vehiclesNotFoundMessage);
          return;
        case VehicleDetailFailed(error: final AppError error):
          _showLookupMessage(error.message);
          return;
      }
    } on Object {
      if (!mounted) return;
      _showLookupMessage(l10n.stateErrorMessage);
    }
  }

  void _showLookupMessage(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  void _selectAsset(String assetNo) {
    setState(() {
      _selectedAssetNo = assetNo;
      _query = '';
    });
  }

  Future<void> _refresh() async {
    final String? selectedAssetNo = _selectedAssetNo;
    if (selectedAssetNo != null) {
      ref.invalidate(vehicleDetailProvider(selectedAssetNo));
    }
    ref.invalidate(checklistPendingSyncCountProvider);
    if (selectedAssetNo != null) {
      ref.invalidate(lastChecklistOdometerProvider(selectedAssetNo));
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final workspace = ref.watch(workspaceContextProvider);
    final String? selectedAssetNo = _selectedAssetNo;
    final AsyncValue<VehicleDetailOutcome>? selectedVehicle =
        selectedAssetNo == null
            ? null
            : ref.watch(vehicleDetailProvider(selectedAssetNo));
    final AsyncValue<int> pendingSyncCount = ref.watch(
      checklistPendingSyncCountProvider,
    );
    final bool canScan =
        workspace != null && ref.watch(canAccessModuleProvider(ModuleKey.scan));
    final bool canInspect = workspace != null &&
        ref.watch(canAccessModuleProvider(ModuleKey.inspect));
    final bool canOpenVehicles = workspace != null &&
        ref.watch(canAccessModuleProvider(ModuleKey.vehicles));
    final bool canLogMeter = workspace != null &&
        ref.watch(canAccessModuleProvider(ModuleKey.meter));
    // Pending tyre-inspection sign-offs only for someone the server would
    // actually let sign (V606) - the same gate Home uses.
    final bool canSignInspections = workspace != null &&
        ref.watch(canAccessModuleProvider(ModuleKey.approvals)) &&
        ref.watch(homeCanSignInspectionApprovalsProvider);
    final int? pendingInspectionApprovals = canInspect && canSignInspections
        ? ref
            .watch(homePendingInspectionApprovalsProvider)
            .whenOrNull(data: (HomePendingApprovals value) => value.count)
        : null;
    final AsyncValue<LastOdometerReading?>? lastOdometer =
        canLogMeter && selectedAssetNo != null
            ? ref.watch(lastChecklistOdometerProvider(selectedAssetNo))
            : null;
    // Engine hours for the selected-asset card. `vehicle_fleet` has no hours
    // column, so the newest `engine_hours_logs` row is the only real source.
    // Read under the same meter-log gate as the odometer row; a failed or
    // empty read hides the fact rather than inventing one.
    final double? lastEngineHours = canLogMeter && selectedAssetNo != null
        ? ref
            .watch(lastChecklistEngineHoursProvider(selectedAssetNo))
            .whenOrNull(data: (double? value) => value)
        : null;

    return TpScaffold(
      backFallback: TpRoutePaths.home,
      body: _body(
        l10n,
        selectedVehicle: selectedVehicle,
        pendingSyncCount: pendingSyncCount,
        canScan: canScan,
        canInspect: canInspect,
        canOpenVehicles: canOpenVehicles,
        lastOdometer: lastOdometer,
        lastEngineHours: lastEngineHours,
        pendingInspectionApprovals: pendingInspectionApprovals,
      ),
    );
  }

  Widget _body(
    AppLocalizations l10n, {
    required AsyncValue<VehicleDetailOutcome>? selectedVehicle,
    required AsyncValue<int> pendingSyncCount,
    required bool canScan,
    required bool canInspect,
    required bool canOpenVehicles,
    required AsyncValue<LastOdometerReading?>? lastOdometer,
    required double? lastEngineHours,
    required int? pendingInspectionApprovals,
  }) {
    if (_loading) return const TpLoadingState();

    final bool nothingAtAll =
        _templates.isEmpty && _assignments.isEmpty && _drafts.isEmpty;
    final List<String> candidates = _assetNumbers(
      assignments: _assignments,
      drafts: _drafts,
    );
    final String? selectedAssetNo = _selectedAssetNo;
    final List<String> searchMatches = _query.isEmpty
        ? const <String>[]
        : candidates
            .where(
              (String assetNo) =>
                  assetNo.toLowerCase().contains(_query.toLowerCase()),
            )
            .toList(growable: false);
    VehicleAsset? selectedVehicleAsset;
    Widget? selectedVehicleState;
    bool selectedVehicleIsLive = selectedAssetNo == null;
    // True only when the asset was read live from the fleet register
    // (`vehicle_fleet`), never for a cached copy.
    bool selectedVehicleVerified = false;
    selectedVehicle?.when(
      loading: () {
        selectedVehicleState = const LinearProgressIndicator();
      },
      error: (Object error, StackTrace stackTrace) {
        selectedVehicleState = TpErrorState(
          error: error is AppError
              ? error
              : AppError(
                  kind: AppErrorKind.unknown,
                  message: l10n.stateErrorMessage,
                  isRetryable: true,
                ),
          onRetry: selectedAssetNo == null
              ? null
              : () => ref.invalidate(vehicleDetailProvider(selectedAssetNo)),
        );
      },
      data: (VehicleDetailOutcome outcome) {
        switch (outcome) {
          case VehicleDetailLoaded(asset: final VehicleAsset asset):
            selectedVehicleAsset = asset;
            selectedVehicleIsLive = true;
            selectedVehicleVerified = true;
            break;
          case VehicleDetailFromCache(
              asset: final VehicleAsset asset,
              cachedAt: final DateTime? cachedAt,
            ):
            selectedVehicleAsset = asset;
            selectedVehicleState = TpOfflineCachedState(
              cachedAtLabel: _formatCachedAt(cachedAt),
              onRetry: selectedAssetNo == null
                  ? null
                  : () =>
                      ref.invalidate(vehicleDetailProvider(selectedAssetNo)),
            );
            break;
          case VehicleDetailNotFound():
            selectedVehicleState = TpEmptyState(
              title: l10n.vehiclesNotFoundTitle,
              message: l10n.vehiclesNotFoundMessage,
            );
            break;
          case VehicleDetailFailed(error: final AppError error):
            selectedVehicleState = isBackendUnavailableError(error)
                ? TpBackendUnavailableState(
                    onRetry: selectedAssetNo == null
                        ? null
                        : () => ref.invalidate(
                              vehicleDetailProvider(selectedAssetNo),
                            ),
                  )
                : TpErrorState(
                    error: error,
                    onRetry: selectedAssetNo == null
                        ? null
                        : () => ref.invalidate(
                              vehicleDetailProvider(selectedAssetNo),
                            ),
                  );
            break;
        }
      },
    );
    final List<ChecklistDraftHeader> selectedDrafts = <ChecklistDraftHeader>[
      for (final ChecklistDraftHeader draft in _drafts)
        if (draft.assetNo.trim().isEmpty ||
            selectedAssetNo == null ||
            _sameAsset(draft.assetNo, selectedAssetNo))
          draft,
    ];
    final List<ChecklistAssignmentRecord> selectedAssignments =
        <ChecklistAssignmentRecord>[
      for (final ChecklistAssignmentRecord assignment in _assignments)
        if (assignment.assetNo?.trim().isEmpty != false ||
            selectedAssetNo == null ||
            _sameAsset(assignment.assetNo, selectedAssetNo))
          assignment,
    ];
    final String selectedLanguage = ref.watch(checklistContentLanguageProvider);
    final workspace = ref.watch(workspaceContextProvider);
    final bool queueIsClear = pendingSyncCount.maybeWhen(
      data: (int count) => count == 0,
      orElse: () => false,
    );
    final bool isSynced =
        _failure == null && selectedVehicleIsLive && queueIsClear;

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          _ChecklistHubHeader(
            fullName: workspace?.fullName,
            title: l10n.checklistsHomeTitle,
            syncedLabel: l10n.inspectionStatusSynced,
            isSynced: isSynced,
          ),
          const SizedBox(height: TpSpace.lg),
          _ChecklistAssetSearch(
            key: ChecklistsHomeScreenKeys.searchField,
            hint: l10n.checklistsAssetSearchHint,
            onChanged: _updateSearch,
            onSubmitted: _submitSearch,
            onScan: canScan ? _openScanner : null,
          ),
          if (searchMatches.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final String assetNo in searchMatches.take(6))
                  ActionChip(
                    label: TpIdentifierText(assetNo),
                    onPressed: () => _selectAsset(assetNo),
                  ),
              ],
            ),
          ],
          if (selectedAssetNo != null) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            _SelectedChecklistAssetCard(
              assetNo: selectedAssetNo,
              vehicle: selectedVehicleAsset,
              fallbackSite: _siteForAsset(selectedAssetNo)?.value,
              engineHours: lastEngineHours,
              verified: selectedVehicleVerified,
              onTap:
                  canOpenVehicles ? () => _openVehicle(selectedAssetNo) : null,
            ),
            if (selectedVehicleState != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 240),
                child: selectedVehicleState!,
              ),
            ],
            const SizedBox(height: TpSpace.lg),
          ],
          _ChecklistLanguageSelector(
            selected: selectedLanguage,
            onSelected: (String language) => ref
                .read(checklistContentLanguageProvider.notifier)
                .select(language),
          ),
          const SizedBox(height: TpSpace.xs),
          _LanguageStorageHint(message: l10n.checklistsLanguageStorageHint),
          const SizedBox(height: TpSpace.lg),
          if (_failure != null)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.lg),
              child: _InlineWarning(
                message: switch (_failure!) {
                  _ChecklistHomeFailure.workspaceLoading =>
                    l10n.checklistWorkspaceLoadingMessage,
                  _ChecklistHomeFailure.loadFailed =>
                    l10n.checklistsLoadErrorMessage,
                },
                onRetry: _load,
              ),
            ),
          if (nothingAtAll && _failure == null)
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.32,
              child: TpEmptyState(
                title: l10n.checklistsEmptyTitle,
                message: l10n.checklistsEmptyMessage,
                icon: Icons.checklist_outlined,
              ),
            ),
          if (selectedDrafts.isNotEmpty ||
              selectedAssignments.isNotEmpty ||
              lastOdometer != null) ...<Widget>[
            _SectionHeader(
              label: selectedAssetNo == null
                  ? l10n.checklistsAssignmentsSection
                  : l10n.checklistsRequiredForAsset,
            ),
            _RequiredChecklistCard(
              key: ChecklistsHomeScreenKeys.requiredForAsset,
              drafts: selectedDrafts,
              assignments: selectedAssignments,
              templates: _templates,
              now: DateTime.now(),
              onDraftTap: _resumeDraft,
              onAssignmentTap: _openAssignment,
              meterRow: lastOdometer == null || selectedAssetNo == null
                  ? null
                  : _MeterReadingRow(
                      reading: lastOdometer,
                      onRecord: () => _openMeterLog(selectedAssetNo),
                    ),
            ),
            const SizedBox(height: TpSpace.lg),
          ],
          if (_templates.isNotEmpty) ...<Widget>[
            _ChecklistHubLink(
              icon: Icons.menu_book_outlined,
              title: l10n.checklistsGeneralLibraryTitle,
              subtitle: l10n.checklistsGeneralLibrarySubtitle,
              badge: l10n.checklistsAvailableCount(_templates.length),
              expanded: _libraryExpanded,
              onTap: () => setState(() {
                _libraryExpanded = !_libraryExpanded;
              }),
            ),
            if (_libraryExpanded) ...<Widget>[
              const SizedBox(height: TpSpace.md),
              for (final ChecklistTemplateRecord t in _templates)
                _TemplateRow(
                  record: t,
                  l10n: l10n,
                  onTap: () => _openTemplate(t, assetNo: selectedAssetNo),
                ),
            ],
            const SizedBox(height: TpSpace.sm),
          ],
          if (canInspect) ...<Widget>[
            _ChecklistHubLink(
              key: ChecklistsHomeScreenKeys.tyreInspection,
              icon: Icons.tire_repair_outlined,
              title: l10n.checklistsTyreInspectionTitle,
              subtitle: l10n.checklistsTyreInspectionSubtitle,
              trailing: (pendingInspectionApprovals ?? 0) > 0
                  ? _PendingApprovalChip(
                      count: pendingInspectionApprovals!,
                      onTap: _openInspectionApprovals,
                    )
                  : null,
              onTap: () => _openTyreInspection(assetNo: selectedAssetNo),
            ),
            const SizedBox(height: TpSpace.sm),
          ],
          _ChecklistHubLink(
            key: ChecklistsHomeScreenKeys.history,
            icon: Icons.description_outlined,
            title: selectedAssetNo == null
                ? l10n.checklistsHistoryAction
                : l10n.checklistsAssetHistoryTitle(selectedAssetNo),
            onTap: () => _openHistory(assetNo: selectedAssetNo),
          ),
        ],
      ),
    );
  }
}

List<String> _assetNumbers({
  required List<ChecklistAssignmentRecord> assignments,
  required List<ChecklistDraftHeader> drafts,
}) {
  final Map<String, String> unique = <String, String>{};
  for (final ChecklistAssignmentRecord assignment in assignments) {
    final String? value = assignment.assetNo?.trim();
    if (value != null && value.isNotEmpty) {
      unique.putIfAbsent(value.toLowerCase(), () => value);
    }
  }
  for (final ChecklistDraftHeader draft in drafts) {
    final String value = draft.assetNo.trim();
    if (value.isNotEmpty) {
      unique.putIfAbsent(value.toLowerCase(), () => value);
    }
  }
  return unique.values.toList(growable: false);
}

String? _formatCachedAt(DateTime? cachedAt) {
  if (cachedAt == null) return null;
  final DateTime local = cachedAt.toLocal();
  final String hh = local.hour.toString().padLeft(2, '0');
  final String mm = local.minute.toString().padLeft(2, '0');
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-'
      '${local.day.toString().padLeft(2, '0')} $hh:$mm';
}

bool _sameAsset(String? left, String? right) {
  final String a = left?.trim().toLowerCase() ?? '';
  final String b = right?.trim().toLowerCase() ?? '';
  return a.isNotEmpty && a == b;
}

Color _checklistAccent(TpPalette palette) =>
    palette.brightness == Brightness.light
        ? const Color(0xFF0648D9)
        : palette.primary;

Color _checklistNavy(TpPalette palette) =>
    palette.brightness == Brightness.light
        ? const Color(0xFF082B70)
        : palette.text;

String _initials(String? fullName) {
  final List<String> parts = (fullName ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((String part) => part.isNotEmpty)
      .toList(growable: false);
  if (parts.isEmpty) return 'TP';
  if (parts.length == 1) {
    return parts.first.substring(0, 1).toUpperCase();
  }
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

String _formatInteger(int value) {
  final String raw = value.toString();
  final StringBuffer result = StringBuffer();
  for (int i = 0; i < raw.length; i += 1) {
    if (i > 0 && (raw.length - i) % 3 == 0) result.write(',');
    result.write(raw[i]);
  }
  return result.toString();
}

class _ChecklistHubHeader extends StatelessWidget {
  const _ChecklistHubHeader({
    required this.fullName,
    required this.title,
    required this.syncedLabel,
    required this.isSynced,
  });

  final String? fullName;
  final String title;
  final String syncedLabel;
  final bool isSynced;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color navy = _checklistNavy(palette);
    return Column(
      key: ChecklistsHomeScreenKeys.brandHeader,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Image.asset(
              'assets/login/figma_brand_pulse.png',
              width: 40,
              height: 28,
              fit: BoxFit.contain,
              excludeFromSemantics: true,
            ),
            const SizedBox(width: TpSpace.xs),
            Text(
              'TYRE\nPULSE',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: navy,
                    fontWeight: FontWeight.w900,
                    fontSize: 18,
                    height: 0.9,
                    letterSpacing: 0.4,
                  ),
            ),
            const Spacer(),
            Semantics(
              label: fullName,
              child: Stack(
                clipBehavior: Clip.none,
                children: <Widget>[
                  CircleAvatar(
                    radius: 25,
                    backgroundColor: palette.primary,
                    foregroundColor: palette.onPrimary,
                    child: Text(
                      _initials(fullName),
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            color: palette.onPrimary,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                  ),
                  PositionedDirectional(
                    end: -2,
                    bottom: -2,
                    child: Container(
                      width: 14,
                      height: 14,
                      decoration: BoxDecoration(
                        color: palette.ok.base,
                        shape: BoxShape.circle,
                        border: Border.all(color: palette.surface, width: 2),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.xxl),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: <Widget>[
            Expanded(
              child: Text(
                title,
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      color: navy,
                      fontSize: 32,
                      height: 1.1,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.7,
                    ),
              ),
            ),
            if (isSynced)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(Icons.sync_rounded, color: palette.ok.base, size: 22),
                  const SizedBox(width: TpSpace.xs),
                  Text(
                    syncedLabel,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: palette.ok.base,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

class _ChecklistAssetSearch extends StatelessWidget {
  const _ChecklistAssetSearch({
    required this.hint,
    required this.onChanged,
    required this.onSubmitted,
    required this.onScan,
    super.key,
  });

  final String hint;
  final ValueChanged<String> onChanged;
  final ValueChanged<String> onSubmitted;
  final VoidCallback? onScan;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TextField(
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      textInputAction: TextInputAction.search,
      style: Theme.of(context).textTheme.bodyLarge,
      decoration: InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: palette.surface,
        prefixIcon: const Icon(Icons.search_rounded, size: 28),
        suffixIcon: onScan == null
            ? null
            : IconButton(
                tooltip: AppLocalizations.of(context).scannerTitle,
                onPressed: onScan,
                icon: Icon(
                  Icons.qr_code_scanner_rounded,
                  color: palette.primary,
                  size: 26,
                ),
              ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: TpSpace.lg,
          vertical: TpSpace.lg,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          borderSide: BorderSide(color: palette.borderStrong),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          borderSide: BorderSide(color: _checklistAccent(palette), width: 2),
        ),
      ),
    );
  }
}

class _SelectedChecklistAssetCard extends StatelessWidget {
  const _SelectedChecklistAssetCard({
    required this.assetNo,
    required this.vehicle,
    required this.fallbackSite,
    required this.onTap,
    this.engineHours,
    this.verified = false,
  });

  final String assetNo;
  final VehicleAsset? vehicle;
  final String? fallbackSite;
  final VoidCallback? onTap;

  /// Newest `engine_hours_logs` reading, or null when none was read.
  final double? engineHours;

  /// The asset was read live from the fleet register (`vehicle_fleet`).
  final bool verified;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final VehicleAsset? asset = vehicle;
    final String? photo = asset == null ? null : vehiclePhotoAsset(asset);
    final String details = <String?>[
      asset?.vehicleType,
      asset?.make,
      asset?.model,
    ].whereType<String>().where((String value) => value.isNotEmpty).join(' · ');
    final String? site = asset?.site ?? fallbackSite;
    final String? km = asset?.currentKm == null
        ? null
        : '${_formatInteger(asset!.currentKm!)} km';
    final String? hours = engineHours == null
        ? null
        : '${_formatInteger(engineHours!.round())} h';
    // The mock's "68,420 km / 8,742 h": each half only when it was recorded.
    final String metersText =
        <String?>[km, hours].whereType<String>().join(' / ');
    final String? meters = metersText.isEmpty ? null : metersText;

    return Semantics(
      button: onTap != null,
      label: '$assetNo $details',
      child: InkWell(
        key: ChecklistsHomeScreenKeys.selectedAsset,
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.md),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: TpSpace.lg),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              ClipRRect(
                borderRadius: BorderRadius.circular(TpRadius.md),
                child: SizedBox(
                  width: 112,
                  height: 88,
                  child: photo == null
                      ? ColoredBox(
                          color: palette.surfaceSunken,
                          child: Icon(
                            asset == null
                                ? Icons.local_shipping_outlined
                                : vehicleFallbackIcon(asset),
                            size: 48,
                            color: palette.textMuted,
                          ),
                        )
                      : Image.asset(
                          photo,
                          fit: BoxFit.contain,
                          filterQuality: FilterQuality.high,
                        ),
                ),
              ),
              const SizedBox(width: TpSpace.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      details.isEmpty ? assetNo : '$assetNo · $details',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            color: _checklistNavy(palette),
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    if (site != null && site.isNotEmpty) ...<Widget>[
                      const SizedBox(height: TpSpace.xs),
                      _AssetFact(icon: Icons.location_on_outlined, value: site),
                    ],
                    if (meters != null) ...<Widget>[
                      const SizedBox(height: TpSpace.xs),
                      _AssetFact(
                        key: ChecklistsHomeScreenKeys.assetMeters,
                        icon: Icons.speed_outlined,
                        value: meters,
                      ),
                    ],
                    if (verified) ...<Widget>[
                      const SizedBox(height: TpSpace.xs),
                      Row(
                        key: ChecklistsHomeScreenKeys.masterDataVerified,
                        children: <Widget>[
                          Icon(
                            Icons.verified_user_outlined,
                            size: TpSizing.iconMd,
                            color: palette.ok.base,
                          ),
                          const SizedBox(width: TpSpace.xs),
                          Expanded(
                            child: Text(
                              AppLocalizations.of(context)
                                  .checklistsMasterDataVerified,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(
                                    color: palette.ok.base,
                                    fontWeight: FontWeight.w600,
                                  ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              if (onTap != null)
                Icon(
                  Icons.chevron_right_rounded,
                  color: _checklistNavy(palette),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AssetFact extends StatelessWidget {
  const _AssetFact({required this.icon, required this.value, super.key});

  final IconData icon;
  final String value;

  @override
  Widget build(BuildContext context) {
    final Color ink = TpPalette.of(context).textSecondary;
    return Row(
      children: <Widget>[
        Icon(icon, size: TpSizing.iconMd, color: ink),
        const SizedBox(width: TpSpace.xs),
        Expanded(
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: ink, fontWeight: FontWeight.w500),
          ),
        ),
      ],
    );
  }
}

class _ChecklistLanguageSelector extends StatelessWidget {
  const _ChecklistLanguageSelector({
    required this.selected,
    required this.onSelected,
  });

  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color accent = _checklistAccent(palette);
    return Container(
      key: ChecklistsHomeScreenKeys.languageSelector,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Row(
        children: <Widget>[
          for (int index = 0; index < kChecklistLangs.length; index += 1)
            Expanded(
              child: _ChecklistLanguageOption(
                language: kChecklistLangs[index],
                selected: selected == kChecklistLangs[index].code,
                accent: accent,
                showGlobe: index == 0,
                showDivider: index > 0,
                onTap: () => onSelected(kChecklistLangs[index].code),
              ),
            ),
        ],
      ),
    );
  }
}

class _ChecklistLanguageOption extends StatelessWidget {
  const _ChecklistLanguageOption({
    required this.language,
    required this.selected,
    required this.accent,
    required this.showGlobe,
    required this.showDivider,
    required this.onTap,
  });

  final ChecklistLang language;
  final bool selected;
  final Color accent;
  final bool showGlobe;
  final bool showDivider;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      selected: selected,
      button: true,
      label: language.label,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 52),
          decoration: BoxDecoration(
            color: selected ? accent.withValues(alpha: 0.06) : null,
            // The selected option is marked by a 1.5px accent outline, not
            // only a faint tint: a 6% tint alone fails non-text contrast.
            border: selected
                ? Border.all(color: accent, width: 1.5)
                : BorderDirectional(
                    start: showDivider
                        ? BorderSide(color: palette.border)
                        : BorderSide.none,
                  ),
            borderRadius: selected ? BorderRadius.circular(TpRadius.md) : null,
          ),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (showGlobe) ...<Widget>[
                Icon(Icons.language_rounded, size: 20, color: accent),
                const SizedBox(width: TpSpace.xs),
              ],
              Flexible(
                child: Text(
                  language.native,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: selected ? accent : palette.textSecondary,
                        fontWeight:
                            selected ? FontWeight.w800 : FontWeight.w500,
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

class _LanguageStorageHint extends StatelessWidget {
  const _LanguageStorageHint({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
      child: Row(
        children: <Widget>[
          Icon(Icons.info_outline_rounded, size: 18, color: palette.textMuted),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: palette.textSecondary,
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RequiredChecklistCard extends StatelessWidget {
  const _RequiredChecklistCard({
    required this.drafts,
    required this.assignments,
    required this.templates,
    required this.now,
    required this.onDraftTap,
    required this.onAssignmentTap,
    this.meterRow,
    super.key,
  });

  final List<ChecklistDraftHeader> drafts;
  final List<ChecklistAssignmentRecord> assignments;
  final List<ChecklistTemplateRecord> templates;
  final DateTime now;
  final ValueChanged<ChecklistDraftHeader> onDraftTap;
  final ValueChanged<ChecklistAssignmentRecord> onAssignmentTap;
  final Widget? meterRow;

  ChecklistTemplateRecord? _templateFor(String? id) {
    if (id == null) return null;
    for (final ChecklistTemplateRecord t in templates) {
      if (t.template.id == id) return t;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String locale = Localizations.localeOf(context).toLanguageTag();
    // Overdue and due-today first, then by due day; undated last. Keeps the
    // one thing to do now at the top, as the approved mock shows.
    final List<(ChecklistAssignmentRecord, ChecklistDue)> ordered =
        <(ChecklistAssignmentRecord, ChecklistDue)>[
      for (final ChecklistAssignmentRecord a in assignments)
        (
          a,
          classifyChecklistDue(dueDate: a.dueDate, status: a.status, now: now),
        ),
    ]..sort((a, b) => _dueRank(a.$2).compareTo(_dueRank(b.$2)));

    final List<Widget> rows = <Widget>[
      for (final ChecklistDraftHeader draft in drafts)
        _RequiredChecklistRow(
          icon: Icons.fact_check_outlined,
          title: draft.templateName,
          subtitle: l10n.checklistResumeProgress(draft.filled, draft.total),
          actionLabel: l10n.checklistResumeAction,
          prominentAction: true,
          onTap: () => onDraftTap(draft),
        ),
      for (final (ChecklistAssignmentRecord a, ChecklistDue due) in ordered)
        _RequiredChecklistRow(
          icon: _assignmentIcon(a),
          title: a.templateName ?? '',
          subtitle: _assignmentSubtitle(
            l10n,
            cadence: cadenceFor(_templateFor(a.templateId)?.minIntervalDays),
            minIntervalDays: _templateFor(a.templateId)?.minIntervalDays,
            site: a.site,
          ),
          status: _dueLabel(l10n, due, locale) ??
              _assignmentStatusLabel(l10n, a.status),
          statusTone: _dueTone(due),
          showClock: due.kind != ChecklistDueKind.none &&
              due.kind != ChecklistDueKind.unparsed,
          actionLabel: l10n.checklistStartAction,
          prominentAction: due.isActionableNow,
          onTap: () => onAssignmentTap(a),
        ),
      if (meterRow != null) meterRow!,
    ];

    return TpCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          for (int index = 0; index < rows.length; index += 1) ...<Widget>[
            rows[index],
            if (index < rows.length - 1)
              Divider(
                height: 1,
                indent: TpSpace.lg,
                endIndent: TpSpace.lg,
                color: TpPalette.of(context).border,
              ),
          ],
        ],
      ),
    );
  }
}

int _dueRank(ChecklistDue due) => switch (due.kind) {
      ChecklistDueKind.overdue => 0,
      ChecklistDueKind.today => 1,
      ChecklistDueKind.tomorrow => 2,
      ChecklistDueKind.later => 3,
      ChecklistDueKind.unparsed => 4,
      ChecklistDueKind.none => 5,
    };

String? _dueLabel(AppLocalizations l10n, ChecklistDue due, String locale) {
  return switch (due.kind) {
    ChecklistDueKind.overdue => l10n.homeOverdueMetric,
    ChecklistDueKind.today => l10n.clMockDueNow,
    ChecklistDueKind.tomorrow => l10n.clMockDueTomorrow,
    ChecklistDueKind.later =>
      l10n.clMockDueOn(DateFormat('d MMM', locale).format(due.date!)),
    ChecklistDueKind.unparsed => due.raw,
    ChecklistDueKind.none => null,
  };
}

TpStatus _dueTone(ChecklistDue due) => switch (due.kind) {
      ChecklistDueKind.overdue => TpStatus.critical,
      ChecklistDueKind.today || ChecklistDueKind.tomorrow => TpStatus.warning,
      _ => TpStatus.neutral,
    };

String _assignmentSubtitle(
  AppLocalizations l10n, {
  required ChecklistCadence cadence,
  required int? minIntervalDays,
  required String? site,
}) {
  final String? cadenceLabel = switch (cadence) {
    ChecklistCadence.daily => l10n.clMockCadenceDaily,
    ChecklistCadence.weekly => l10n.clMockCadenceWeekly,
    ChecklistCadence.monthly => l10n.clMockCadenceMonthly,
    ChecklistCadence.everyNDays => l10n.clMockCadenceEveryDays(
        minIntervalDays ?? 0,
      ),
    ChecklistCadence.none => null,
  };
  return <String?>[cadenceLabel, site]
      .whereType<String>()
      .where((String value) => value.trim().isNotEmpty)
      .join('  •  ');
}

String? _assignmentStatusLabel(AppLocalizations l10n, String? rawStatus) {
  return switch (rawStatus?.trim().toLowerCase()) {
    'overdue' => l10n.homeOverdueMetric,
    'pending' => l10n.inspectionApprovalsPendingBadge,
    'in_progress' || 'in progress' => l10n.inspectionWorkflowInProgress,
    'completed' => l10n.myPlansCompleted,
    _ => null,
  };
}

IconData _assignmentIcon(ChecklistAssignmentRecord assignment) {
  final String searchable = '${assignment.templateName ?? ''} '
          '${assignment.templateId ?? ''}'
      .toLowerCase();
  if (searchable.contains('odometer') || searchable.contains('meter')) {
    return Icons.speed_outlined;
  }
  if (searchable.contains('safety')) return Icons.assignment_outlined;
  return Icons.fact_check_outlined;
}

class _RowIcon extends StatelessWidget {
  const _RowIcon({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: palette.primarySoft,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Icon(icon, color: _checklistNavy(palette), size: 24),
    );
  }
}

class _RowTexts extends StatelessWidget {
  const _RowTexts({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: _checklistNavy(palette),
                fontWeight: FontWeight.w800,
              ),
        ),
        if (subtitle.isNotEmpty) ...<Widget>[
          const SizedBox(height: 2),
          Text(
            subtitle,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: palette.textSecondary),
          ),
        ],
      ],
    );
  }
}

class _RequiredChecklistRow extends StatelessWidget {
  const _RequiredChecklistRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.actionLabel,
    required this.onTap,
    this.status,
    this.statusTone = TpStatus.neutral,
    this.showClock = false,
    this.prominentAction = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String? status;
  final TpStatus statusTone;
  final bool showClock;
  final String actionLabel;

  /// A filled button (the thing to do now) instead of a quiet chevron.
  final bool prominentAction;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color accent = _checklistAccent(palette);
    final Color statusColor = statusTone == TpStatus.neutral
        ? palette.textMuted
        : palette.forStatus(statusTone).base;
    final Widget statusWidget = status == null || status!.isEmpty
        ? const SizedBox.shrink()
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (showClock) ...<Widget>[
                Icon(Icons.schedule_rounded, size: 18, color: statusColor),
                const SizedBox(width: 4),
              ],
              Flexible(
                child: Text(
                  status!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: statusColor,
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
            ],
          );
    return Semantics(
      button: true,
      label: '$title. ${status ?? ''}',
      excludeSemantics: false,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.lg),
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final Widget action = prominentAction
                  ? FilledButton(
                      onPressed: onTap,
                      style: FilledButton.styleFrom(
                        backgroundColor: accent,
                        foregroundColor: palette.onPrimary,
                        minimumSize: const Size(64, 44),
                        padding: const EdgeInsets.symmetric(
                          horizontal: TpSpace.md,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(TpRadius.md),
                        ),
                      ),
                      child: Text(actionLabel),
                    )
                  : Icon(
                      Icons.chevron_right_rounded,
                      color: accent,
                      semanticLabel: actionLabel,
                    );
              // Narrow or large-text: status and action move under the
              // title rather than squeezing it to nothing.
              final bool stacked =
                  constraints.maxWidth < (prominentAction ? 340 : 280) ||
                      MediaQuery.textScalerOf(context).scale(1) > 1.15;
              if (stacked) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        _RowIcon(icon: icon),
                        const SizedBox(width: TpSpace.md),
                        Expanded(
                          child: _RowTexts(title: title, subtitle: subtitle),
                        ),
                      ],
                    ),
                    const SizedBox(height: TpSpace.sm),
                    Padding(
                      padding: const EdgeInsetsDirectional.only(start: 56),
                      child: Row(
                        children: <Widget>[
                          Expanded(child: statusWidget),
                          const SizedBox(width: TpSpace.sm),
                          action,
                        ],
                      ),
                    ),
                  ],
                );
              }
              return Row(
                children: <Widget>[
                  _RowIcon(icon: icon),
                  const SizedBox(width: TpSpace.md),
                  Expanded(child: _RowTexts(title: title, subtitle: subtitle)),
                  const SizedBox(width: TpSpace.sm),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 104),
                    child: statusWidget,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  action,
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

/// "Odometer & hour-meter reading" - the last odometer date actually
/// recorded in `odometer_logs` for this asset, and a Record action into the
/// meter log. Loading shows a quiet line; a read that failed says it could
/// not check, which is a different fact from "no reading recorded yet".
class _MeterReadingRow extends StatelessWidget {
  const _MeterReadingRow({required this.reading, required this.onRecord});

  final AsyncValue<LastOdometerReading?> reading;
  final VoidCallback onRecord;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String locale = Localizations.localeOf(context).toLanguageTag();
    // Riverpod retries a failed read, which can surface as "loading" while
    // it still carries the error: a failure is reported as a failure either
    // way, never as a spinner and never as "no reading".
    final String subtitle = reading.hasError && !reading.hasValue
        ? l10n.clFixMeterUnreadable
        : reading.when(
            loading: () => l10n.stateLoading,
            error: (Object error, StackTrace stackTrace) =>
                l10n.clFixMeterUnreadable,
            data: (LastOdometerReading? value) {
              final DateTime? at = value?.readingDate == null
                  ? null
                  : DateTime.tryParse(value!.readingDate!);
              return at == null
                  ? l10n.clMockMeterNoReading
                  : l10n.clMockMeterLastRecorded(
                      DateFormat('d MMM', locale).format(at),
                    );
            },
          );
    return InkWell(
      key: ChecklistsHomeScreenKeys.meterReading,
      onTap: onRecord,
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Row(
          children: <Widget>[
            const _RowIcon(icon: Icons.speed_outlined),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: _RowTexts(
                title: l10n.clMockMeterRowTitle,
                subtitle: subtitle,
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            OutlinedButton(
              key: ChecklistsHomeScreenKeys.meterRecord,
              onPressed: onRecord,
              style: OutlinedButton.styleFrom(
                foregroundColor: _checklistAccent(palette),
                side: BorderSide(color: _checklistAccent(palette), width: 1.5),
                minimumSize: const Size(64, 44),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
              ),
              child: Text(l10n.clMockMeterRecord),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Pending approval N" on the tyre-inspection row, opening the inspection
/// approvals queue. Shown only to a person who can actually sign.
class _PendingApprovalChip extends StatelessWidget {
  const _PendingApprovalChip({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors =
        TpPalette.of(context).forStatus(TpStatus.warning);
    final String label = AppLocalizations.of(context).clMockPendingApproval;
    return Semantics(
      button: true,
      label: '$label $count',
      excludeSemantics: true,
      child: InkWell(
        key: ChecklistsHomeScreenKeys.pendingApprovals,
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.pill),
        child: Container(
          constraints: const BoxConstraints(minHeight: 36),
          padding: const EdgeInsetsDirectional.fromSTEB(
            TpSpace.sm,
            4,
            4,
            4,
          ),
          decoration: BoxDecoration(
            color: colors.soft,
            borderRadius: BorderRadius.circular(TpRadius.pill),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: colors.onSoft,
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
              const SizedBox(width: TpSpace.xs),
              Container(
                constraints: const BoxConstraints(minWidth: 24),
                height: 24,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                decoration: BoxDecoration(
                  color: colors.base,
                  borderRadius: BorderRadius.circular(TpRadius.pill),
                ),
                alignment: Alignment.center,
                child: Text(
                  count > 99 ? '99+' : '$count',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: colors.onBase,
                        fontWeight: FontWeight.w800,
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

class _ChecklistHubLink extends StatelessWidget {
  const _ChecklistHubLink({
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.badge,
    this.trailing,
    this.expanded = false,
    super.key,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final String? badge;

  /// An extra action beside the chevron (the pending-approval chip).
  final Widget? trailing;
  final bool expanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color accent = _checklistAccent(palette);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.lg),
        decoration: BoxDecoration(
          border: Border.symmetric(
            horizontal: BorderSide(color: palette.border),
          ),
        ),
        child: Row(
          children: <Widget>[
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.09),
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Icon(icon, color: _checklistNavy(palette), size: 27),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: _checklistNavy(palette),
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  if (subtitle != null && subtitle!.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: palette.textSecondary),
                    ),
                  ],
                ],
              ),
            ),
            if (badge != null) ...<Widget>[
              const SizedBox(width: TpSpace.sm),
              _CountChip(label: badge!, status: TpStatus.info),
            ],
            if (trailing != null) ...<Widget>[
              const SizedBox(width: TpSpace.sm),
              Flexible(child: trailing!),
            ],
            const SizedBox(width: TpSpace.xs),
            Icon(
              expanded
                  ? Icons.expand_less_rounded
                  : Icons.chevron_right_rounded,
              color: accent,
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelLarge
            ?.copyWith(color: TpPalette.of(context).textMuted),
      ),
    );
  }
}

class _InlineWarning extends StatelessWidget {
  const _InlineWarning({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpStatusColors colors =
        TpPalette.of(context).forStatus(TpStatus.warning);
    return Container(
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(Icons.warning_amber_outlined, color: colors.onSoft),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  message,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: colors.onSoft),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TpButton.text(label: l10n.actionRetry, onPressed: onRetry),
          ),
        ],
      ),
    );
  }
}

class _TemplateRow extends StatelessWidget {
  const _TemplateRow({
    required this.record,
    required this.l10n,
    required this.onTap,
  });

  final ChecklistTemplateRecord record;
  final AppLocalizations l10n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final int count =
        record.template.fields.where((field) => field.type != 'section').length;
    final String searchable = <String?>[
      record.template.name,
      record.category,
    ].whereType<String>().join(' ').toLowerCase();
    final bool tyreWorkflow =
        searchable.contains('tyre') || searchable.contains('tire');
    final bool usesPhotos = record.template.fields.any(
      (field) => field.type == 'photo' || field.allowPhoto,
    );
    final TpStatus chipStatus = tyreWorkflow
        ? TpStatus.info
        : count > 24
            ? TpStatus.warning
            : count > 0
                ? TpStatus.ok
                : TpStatus.neutral;
    final String subtitle = record.description ?? record.category ?? '';
    final String? footer =
        usesPhotos ? l10n.checklistPhotosOnFailure : record.docPrefix;

    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.md),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      onTap: onTap,
      child: _ChecklistRowLayout(
        icon: tyreWorkflow
            ? Icons.tire_repair_outlined
            : usesPhotos
                ? Icons.photo_camera_outlined
                : Icons.fact_check_outlined,
        status: chipStatus,
        title: record.template.name ?? '',
        subtitle: subtitle,
        footer: footer,
        chip: _CountChip(
          label: (tyreWorkflow
                  ? l10n.checklistPositionCount(count)
                  : l10n.checklistItemCount(count))
              .toUpperCase(),
          status: chipStatus,
        ),
        actionLabel: l10n.checklistStartAction,
        actionColor: palette.primary,
        actionFilled: true,
        onPressed: onTap,
      ),
    );
  }
}

class _ChecklistRowLayout extends StatelessWidget {
  const _ChecklistRowLayout({
    required this.icon,
    required this.status,
    required this.title,
    required this.subtitle,
    required this.footer,
    required this.chip,
    required this.actionLabel,
    required this.actionColor,
    required this.actionFilled,
    required this.onPressed,
  });

  final IconData icon;
  final TpStatus status;
  final String title;
  final String subtitle;
  final String? footer;
  final Widget chip;
  final String actionLabel;
  final Color actionColor;
  final bool actionFilled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors iconColors = palette.forStatus(status);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: <Widget>[
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: iconColors.soft,
                shape: BoxShape.circle,
                border: Border.all(
                  color: iconColors.base.withValues(alpha: 0.18),
                ),
              ),
              child: Icon(icon, color: iconColors.base, size: 28),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w700,
                          height: 22 / 16,
                        ),
                  ),
                  if (subtitle.trim().isNotEmpty) ...<Widget>[
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.textMuted,
                            fontWeight: FontWeight.w600,
                            height: 16 / 12,
                            letterSpacing: 0.2,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            chip,
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                footer ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w600,
                      height: 16 / 12,
                      letterSpacing: 0.2,
                    ),
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Theme(
              data: Theme.of(context).copyWith(
                colorScheme: Theme.of(context)
                    .colorScheme
                    .copyWith(primary: actionColor),
              ),
              child: TpButton(
                label: actionLabel,
                variant: actionFilled
                    ? TpButtonVariant.primary
                    : TpButtonVariant.secondary,
                isCompact: true,
                onPressed: onPressed,
              ),
            ),
            const SizedBox(width: TpSpace.xs),
            Icon(
              Icons.arrow_forward_rounded,
              color: actionColor,
              size: TpSizing.iconSm,
            ),
          ],
        ),
      ],
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.label, required this.status});

  final String label;
  final TpStatus status;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(status);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.sm,
          vertical: 6,
        ),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: colors.onSoft,
                fontWeight: FontWeight.w700,
                height: 16 / 12,
                letterSpacing: 0.2,
              ),
        ),
      ),
    );
  }
}
