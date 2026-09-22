/// "Checklists" - the templates this operator may fill, their open
/// assignments, and any unfinished work worth resuming.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
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
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';

abstract final class ChecklistsHomeScreenKeys {
  static const Key brandHeader = ValueKey<String>('checklists.brand-header');
  static const Key searchField = ValueKey<String>('checklists.asset-search');
  static const Key selectedAsset =
      ValueKey<String>('checklists.selected-asset');
  static const Key languageSelector =
      ValueKey<String>('checklists.language-selector');
  static const Key requiredForAsset =
      ValueKey<String>('checklists.required-for-asset');
  static const Key tyreInspection =
      ValueKey<String>('checklists.tyre-inspection');
  static const Key history = ValueKey<String>('checklists.history');
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

  void _openTemplate(
    ChecklistTemplateRecord record, {
    String? assetNo,
  }) {
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

  void _openHistory() {
    GoRouter.of(context).push(const ChecklistHistoryRoute().location);
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
      final VehicleDetailOutcome outcome =
          await ref.read(vehicleDetailProvider(query).future);
      if (!mounted) return;
      switch (outcome) {
        case VehicleDetailLoaded(asset: final VehicleAsset asset):
        case VehicleDetailFromCache(asset: final VehicleAsset asset):
          _selectAsset(asset.assetNo?.trim().isNotEmpty == true
              ? asset.assetNo!.trim()
              : query);
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
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
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
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? selectedAssetNo = _selectedAssetNo;
    final AsyncValue<VehicleDetailOutcome>? selectedVehicle =
        selectedAssetNo == null
            ? null
            : ref.watch(vehicleDetailProvider(selectedAssetNo));
    final AsyncValue<int> pendingSyncCount = ref.watch(
      checklistPendingSyncCountProvider,
    );
    final bool canScan = ref.watch(
      canAccessModuleProvider(ModuleKey.scan),
    );
    final bool canInspect = ref.watch(
      canAccessModuleProvider(ModuleKey.inspect),
    );
    final bool canOpenVehicles = ref.watch(
      canAccessModuleProvider(ModuleKey.vehicles),
    );

    return TpScaffold(
      backFallback: TpRoutePaths.home,
      body: _body(
        l10n,
        selectedVehicle: selectedVehicle,
        pendingSyncCount: pendingSyncCount,
        canScan: canScan,
        canInspect: canInspect,
        canOpenVehicles: canOpenVehicles,
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
    final String selectedLanguage = ref.watch(
      checklistContentLanguageProvider,
    );
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
              onTap: canOpenVehicles
                  ? () => _openVehicle(selectedAssetNo)
                  : null,
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
              selectedAssignments.isNotEmpty) ...<Widget>[
            _SectionHeader(
              label: selectedAssetNo == null
                  ? l10n.checklistsAssignmentsSection
                  : l10n.checklistsRequiredForAsset,
            ),
            _RequiredChecklistCard(
              key: ChecklistsHomeScreenKeys.requiredForAsset,
              drafts: selectedDrafts,
              assignments: selectedAssignments,
              onDraftTap: _resumeDraft,
              onAssignmentTap: _openAssignment,
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
              onTap: () => _openTyreInspection(assetNo: selectedAssetNo),
            ),
            const SizedBox(height: TpSpace.sm),
          ],
          _ChecklistHubLink(
            key: ChecklistsHomeScreenKeys.history,
            icon: Icons.description_outlined,
            title: l10n.checklistsHistoryAction,
            onTap: _openHistory,
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
  });

  final String assetNo;
  final VehicleAsset? vehicle;
  final String? fallbackSite;
  final VoidCallback? onTap;

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
                    if (km != null) ...<Widget>[
                      const SizedBox(height: TpSpace.xs),
                      _AssetFact(icon: Icons.speed_outlined, value: km),
                    ],
                  ],
                ),
              ),
              if (onTap != null)
                Icon(
                  Directionality.of(context) == TextDirection.rtl
                      ? Icons.chevron_left_rounded
                      : Icons.chevron_right_rounded,
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
  const _AssetFact({
    required this.icon,
    required this.value,
    this.color,
  });

  final IconData icon;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final Color ink = color ?? TpPalette.of(context).textSecondary;
    return Row(
      children: <Widget>[
        Icon(icon, size: TpSizing.iconMd, color: ink),
        const SizedBox(width: TpSpace.xs),
        Expanded(
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: ink,
                  fontWeight: FontWeight.w500,
                ),
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
            border: BorderDirectional(
              start: showDivider
                  ? BorderSide(color: palette.border)
                  : BorderSide.none,
            ),
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
    required this.onDraftTap,
    required this.onAssignmentTap,
    super.key,
  });

  final List<ChecklistDraftHeader> drafts;
  final List<ChecklistAssignmentRecord> assignments;
  final ValueChanged<ChecklistDraftHeader> onDraftTap;
  final ValueChanged<ChecklistAssignmentRecord> onAssignmentTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<Widget> rows = <Widget>[
      for (final ChecklistDraftHeader draft in drafts)
        _RequiredChecklistRow(
          icon: Icons.fact_check_outlined,
          title: draft.templateName,
          subtitle: l10n.checklistResumeProgress(draft.filled, draft.total),
          status: '${draft.filled}/${draft.total}',
          actionLabel: l10n.checklistResumeAction,
          onTap: () => onDraftTap(draft),
        ),
      for (final ChecklistAssignmentRecord assignment in assignments)
        _RequiredChecklistRow(
          icon: _assignmentIcon(assignment),
          title: assignment.templateName ?? '',
          subtitle: <String?>[assignment.site, assignment.dueDate]
              .whereType<String>()
              .where((String value) => value.isNotEmpty)
              .join('  •  '),
          status: _assignmentStatusLabel(l10n, assignment.status),
          urgent: assignment.status?.trim().toLowerCase() == 'overdue',
          actionLabel: l10n.checklistStartAction,
          onTap: () => onAssignmentTap(assignment),
        ),
    ];

    return TpCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          for (int index = 0; index < rows.length; index += 1) ...<Widget>[
            rows[index],
            if (index < rows.length - 1)
              Divider(height: 1, color: TpPalette.of(context).border),
          ],
        ],
      ),
    );
  }
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

class _RequiredChecklistRow extends StatelessWidget {
  const _RequiredChecklistRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.status,
    required this.actionLabel,
    required this.onTap,
    this.urgent = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String? status;
  final String actionLabel;
  final VoidCallback onTap;
  final bool urgent;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color accent = _checklistAccent(palette);
    final Color statusColor = urgent ? palette.warning.base : palette.textMuted;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Row(
          children: <Widget>[
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: palette.primarySoft,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Icon(icon, color: _checklistNavy(palette), size: 24),
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
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            SizedBox(
              width: 92,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  if (status != null && status!.isNotEmpty)
                    Text(
                      status!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: statusColor,
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: <Widget>[
                      Flexible(
                        child: Text(
                          actionLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style:
                              Theme.of(context).textTheme.labelLarge?.copyWith(
                                    color: accent,
                                    fontWeight: FontWeight.w800,
                                  ),
                        ),
                      ),
                      const SizedBox(width: TpSpace.xs),
                      Icon(
                        Directionality.of(context) == TextDirection.rtl
                            ? Icons.chevron_left_rounded
                            : Icons.chevron_right_rounded,
                        color: accent,
                        size: 22,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
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
    this.expanded = false,
    super.key,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final String? badge;
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
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            if (badge != null) ...<Widget>[
              const SizedBox(width: TpSpace.sm),
              _CountChip(label: badge!, status: TpStatus.info),
            ],
            const SizedBox(width: TpSpace.xs),
            Icon(
              expanded
                  ? Icons.expand_less_rounded
                  : Directionality.of(context) == TextDirection.rtl
                      ? Icons.chevron_left_rounded
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
                colorScheme: Theme.of(context).colorScheme.copyWith(
                      primary: actionColor,
                    ),
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
              Directionality.of(context) == TextDirection.rtl
                  ? Icons.arrow_back_rounded
                  : Icons.arrow_forward_rounded,
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
