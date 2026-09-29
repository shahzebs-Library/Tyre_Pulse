/// One vehicle, in full.
///
/// # This screen has NO route, and that is deliberate
///
/// `routes.dart` declares [VehiclesRoute] and never a `vehicleDetail`
/// counterpart - verified by reading the whole file and `app_router.dart`'s
/// route tree, where every OTHER list (`workOrders`, `accidentDashboard`,
/// `checklists`, `activityHistory`) declares a nested detail route and
/// `vehicles` does not. Registering a new route id was outside this change's
/// remit - the task that produced this file was explicit that `routes.dart`
/// is not to be edited, and that a missing route should be noted rather than
/// invented. So this screen is reached the same way the equivalent inline
/// expansion works in the production `mobile/app/(app)/vehicles.tsx`: pushed
/// directly from [VehiclesListScreen] with a plain [Navigator.push], onto
/// the Home branch's own nested Navigator (branch 0 in `app_router.dart`),
/// rather than through a named go_router location.
///
/// # Why that changes how Back is wired here
///
/// A screen reached via `context.go`/`context.push` gets its guard AND its
/// system-back handling from `app_router.dart`'s `_GuardedScreen` and
/// `TpScaffold`'s `backFallback`, both of which resolve through
/// [TpBack.of], i.e. through the ambient [GoRouter]. This screen was never
/// declared to that router, so:
///
/// - [TpModuleGuard] is applied EXPLICITLY here, because there is no
///   `_GuardedScreen` wrapper doing it automatically the way there is for
///   [VehiclesListScreen]. Permissions can change while this screen is
///   already open - an administrator revoking `vehicles` access mid-session
///   - and without its own guard this screen would keep rendering after
///   that.
/// - The page's own [TpScaffold] carries NO `backFallback`. A real
///   [Navigator] push put this screen on screen, so real history already
///   exists on the nearest Navigator, and Flutter's own default Back
///   handling (hardware button, predictive-back gesture, and the framework
///   default an omitted `backFallback` leaves in place - see
///   `tp_scaffold.dart`'s own doc) already pops it correctly. Setting
///   `backFallback` here would route that through [TpBack]/[GoRouter]
///   instead, and this environment has no way to compile-run the app and
///   confirm how `GoRouter.canPop()` behaves for a route it was never told
///   about - safer to rely on the plain Flutter mechanism that is
///   unambiguously correct for a plainly-pushed screen with real history.
/// - The app bar's chevron is wired explicitly to
///   `Navigator.of(context).maybePop()` for the same reason, using
///   [TpAppBar.onBack] - the override hook that file's own doc says exists
///   for exactly a screen that needs to run Back itself.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/module_guard.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart'
    show AssetScope;
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_360_facts.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart'
    show formatAssetMoney;
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_financial_report_screen.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_insights_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_360_share.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/vehicle_360_panels.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/vehicle_multiview_board.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/report_issue/presentation/report_issue_copy.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/create_work_order_sheet.dart';

class VehicleDetailScreen extends StatelessWidget {
  const VehicleDetailScreen({required this.assetNo, super.key});

  /// `vehicle_fleet.asset_no`, exact. See the library comment: this is the
  /// only identifier a re-fetchable detail screen can be keyed by.
  final String assetNo;

  @override
  Widget build(BuildContext context) {
    return TpModuleGuard(
      guard: TpRouteGuards.forRouteId(TpRouteId.vehicles),
      backFallback: TpRoutePaths.vehicles,
      child: _VehicleDetailBody(assetNo: assetNo),
    );
  }
}

class _VehicleDetailBody extends ConsumerWidget {
  const _VehicleDetailBody({required this.assetNo});

  final String assetNo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<VehicleDetailOutcome> outcomeAsync = ref.watch(
      vehicleDetailProvider(assetNo),
    );

    return TpScaffold(
      // A softly tinted canvas so the white hero, metric and detail cards
      // carry the mock's depth.
      backgroundColor: TpPalette.of(context).surfaceAlt,
      appBar: TpAppBar(
        title: l10n.vehiclesDetailSubtitle,
        onBack: () => Navigator.of(context).maybePop(),
        actions: switch (outcomeAsync) {
          AsyncData<VehicleDetailOutcome>(
            value: VehicleDetailLoaded(asset: final VehicleAsset asset),
          ) =>
            <Widget>[_Vehicle360AppBarActions(asset: asset)],
          _ => null,
        },
      ),
      body: _buildBody(context, ref, l10n, outcomeAsync),
    );
  }

  /// The same seven-state policy as [VehiclesListScreen]'s
  /// `_buildBody` - see that method's doc for the full reasoning, repeated
  /// here only where it differs:
  ///
  /// - [VehicleDetailNotFound] maps to [TpEmptyState], not [TpErrorState].
  ///   The query ran and answered "no such row", which is a fact about the
  ///   fleet register, not a malfunction - mirroring
  ///   `SupabaseFailure.isNoRowsFound`'s own distinction. Rendering it as an
  ///   error would tell a technician something is broken when the honest
  ///   answer is that the asset number does not exist in this scope.
  Widget _buildBody(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    AsyncValue<VehicleDetailOutcome> outcomeAsync,
  ) {
    return outcomeAsync.when(
      loading: () => const TpLoadingState(),
      error: (Object error, StackTrace stackTrace) => TpErrorState(
        error: error is AppError ? error : _unexpectedError(l10n),
        onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
      ),
      data: (VehicleDetailOutcome outcome) => switch (outcome) {
        VehicleDetailLoaded(asset: final VehicleAsset asset) => _DetailView(
            asset: asset,
            l10n: l10n,
          ),
        VehicleDetailFromCache(cachedAt: final DateTime? cachedAt) =>
          TpOfflineCachedState(
            cachedAtLabel: _formatCachedAt(cachedAt),
            onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
          ),
        VehicleDetailNotFound() => TpEmptyState(
            title: l10n.vehiclesNotFoundTitle,
            message: l10n.vehiclesNotFoundMessage,
          ),
        VehicleDetailFailed(error: final AppError error) =>
          isBackendUnavailableError(error)
              ? TpBackendUnavailableState(
                  onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
                )
              : TpErrorState(
                  error: error,
                  onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
                ),
      },
    );
  }

  static AppError _unexpectedError(AppLocalizations l10n) => AppError(
        kind: AppErrorKind.unknown,
        message: l10n.stateErrorMessage,
        isRetryable: true,
      );

  static String? _formatCachedAt(DateTime? cachedAt) {
    if (cachedAt == null) {
      return null;
    }
    final DateTime local = cachedAt.toLocal();
    final String hh = local.hour.toString().padLeft(2, '0');
    final String mm = local.minute.toString().padLeft(2, '0');
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-'
        '${local.day.toString().padLeft(2, '0')} $hh:$mm';
  }
}

@visibleForTesting
abstract final class VehicleDetailScreenKeys {
  static const Key overviewTab = Key('vehicle_detail.tab.overview');
  static const Key timelineTab = Key('vehicle_detail.tab.timeline');
  static const Key costsTab = Key('vehicle_detail.tab.costs');
  static const Key documentsTab = Key('vehicle_detail.tab.documents');
  static const Key tyreMap = Key('vehicle_detail.tyre_map');
  static const Key tyreMapNotRecorded =
      Key('vehicle_detail.tyre_map.not_recorded');
  static const Key details = Key('vehicle_detail.details');
  static const Key reportIssue = Key('vehicle_detail.report_issue');
  static const Key createWorkOrder = Key('vehicle_detail.create_work_order');
  static const Key multiViewBoard = Key('vehicle_detail.multi_view_board');
  static const Key hero = Key('vehicle_detail.hero');
  static const Key heroPhoto = Key('vehicle_detail.hero_photo');
  static const Key heroMeters = Key('vehicle_detail.hero_meters');
  static const Key inspectNow = Key('vehicle_detail.inspect_now');
  static const Key openFinancialReport =
      Key('vehicle_detail.open_financial_report');
  static const Key draftReadiness = Key('vehicle_detail.draft_readiness');
  static const Key actionBar = Key('vehicle_detail.action_bar');
  static const Key moreActions = Key('vehicle_detail.more_actions');
  static const Key share = Key('vehicle_detail.share');
  static const Key alerts = Key('vehicle_detail.alerts');
  static const Key serviceDue = Key('vehicle_detail.alerts.service_due');
  static const Key tyreActions = Key('vehicle_detail.alerts.tyre_actions');
}

enum _AssetDetailTab { overview, timeline, costs, documents }

/// The app bar's Share and overflow actions, drawn only once the asset has
/// loaded (there is nothing to share before that).
///
/// Share hands the operating system a PDF of the asset summary the screen
/// prints. The overflow carries "Inspect now" and the financial report: the
/// owner's mock gives the sticky bar to Report issue and Create work order,
/// so the inspection entry point moves here instead of disappearing.
class _Vehicle360AppBarActions extends ConsumerStatefulWidget {
  const _Vehicle360AppBarActions({required this.asset});

  final VehicleAsset asset;

  @override
  ConsumerState<_Vehicle360AppBarActions> createState() =>
      _Vehicle360AppBarActionsState();
}

enum _OverflowAction { inspect, financialReport }

class _Vehicle360AppBarActionsState
    extends ConsumerState<_Vehicle360AppBarActions> {
  bool _sharing = false;

  VehicleAsset get asset => widget.asset;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final MaterialLocalizations material = MaterialLocalizations.of(context);
    final String? assetCode = vehicle360Present(asset.assetNo);
    final bool canInspect = ref.watch(
      canAccessModuleProvider(ModuleKey.inspect),
    );
    final List<_OverflowAction> overflow = <_OverflowAction>[
      if (canInspect && assetCode != null) _OverflowAction.inspect,
      if (asset.hasNavigableAssetNo) _OverflowAction.financialReport,
    ];
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        IconButton(
          key: VehicleDetailScreenKeys.share,
          tooltip: material.shareButtonLabel,
          onPressed: _sharing ? null : _share,
          icon: const Icon(Icons.ios_share_rounded),
        ),
        if (overflow.isNotEmpty)
          PopupMenuButton<_OverflowAction>(
            key: VehicleDetailScreenKeys.moreActions,
            tooltip: material.moreButtonTooltip,
            icon: const Icon(Icons.more_vert_rounded),
            onSelected: (_OverflowAction action) => switch (action) {
              _OverflowAction.inspect => _startInspection(assetCode!),
              _OverflowAction.financialReport => _openReport(),
            },
            itemBuilder: (BuildContext context) =>
                <PopupMenuEntry<_OverflowAction>>[
              for (final _OverflowAction action in overflow)
                PopupMenuItem<_OverflowAction>(
                  key: switch (action) {
                    _OverflowAction.inspect =>
                      VehicleDetailScreenKeys.inspectNow,
                    _OverflowAction.financialReport =>
                      VehicleDetailScreenKeys.openFinancialReport,
                  },
                  value: action,
                  child: Row(
                    children: <Widget>[
                      Icon(
                        switch (action) {
                          _OverflowAction.inspect => Icons.fact_check_outlined,
                          _OverflowAction.financialReport =>
                            Icons.insights_outlined,
                        },
                      ),
                      const SizedBox(width: TpSpace.md),
                      Flexible(
                        child: Text(
                          switch (action) {
                            _OverflowAction.inspect => l10n.vehiclesInspectNow,
                            _OverflowAction.financialReport =>
                              l10n.fleetMockOpenFinReport,
                          },
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
      ],
    );
  }

  /// Opens the inspection capture form already pointed at THIS asset.
  ///
  /// `context.go`, the same navigation Home and serial search use for
  /// [NewInspectionRoute]: the form lives on the Inspect branch, and the
  /// wizard keys its draft by user + asset, so an existing draft for this
  /// asset resumes rather than starting over.
  void _startInspection(String assetCode) {
    final String? site = vehicle360Present(asset.site);
    context.go(
      NewInspectionRoute(
        assetNo: AssetNo(assetCode),
        siteName: site == null ? null : SiteName(site),
      ).location,
    );
  }

  void _openReport() {
    unawaited(
      Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (BuildContext _) => AssetFinancialReportScreen(asset: asset),
        ),
      ),
    );
  }

  Future<void> _share() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger =
        ScaffoldMessenger.maybeOf(context);
    final String? code = vehicle360Present(asset.assetNo);
    final double? hours = code == null
        ? null
        : switch (ref.read(
            assetEngineHoursProvider(
              assetScopeFor(asset, ref.read(activeCountryProvider)),
            ),
          )) {
            AsyncData<double?>(:final double? value) => value,
            _ => null,
          };
    setState(() => _sharing = true);
    try {
      final AppLocalizations en =
          await AppLocalizations.delegate.load(const Locale('en'));
      final pw.Document doc = buildVehicle360SummaryPdf(
        asset: asset,
        en: en,
        engineHours: hours,
      );
      await Printing.sharePdf(
        bytes: await doc.save(),
        filename: 'vehicle-360-${code ?? 'asset'}.pdf',
      );
    } on Object {
      messenger?.showSnackBar(
        SnackBar(content: Text(l10n.fleet360ShareError)),
      );
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }
}

/// The Vehicle 360 layout from the owner's mock: identity header, the
/// alerts strip, Overview / Timeline / Costs / Documents tabs, and the sticky
/// Report issue + Create work order bar. The complete master record remains
/// on the Overview tab, so visual parity never removes operational data.
class _DetailView extends ConsumerStatefulWidget {
  const _DetailView({required this.asset, required this.l10n});

  final VehicleAsset asset;
  final AppLocalizations l10n;

  @override
  ConsumerState<_DetailView> createState() => _DetailViewState();
}

class _DetailViewState extends ConsumerState<_DetailView> {
  _AssetDetailTab _selectedTab = _AssetDetailTab.overview;

  VehicleAsset get asset => widget.asset;
  AppLocalizations get l10n => widget.l10n;

  @override
  Widget build(BuildContext context) {
    final String? photo = vehiclePhotoAsset(asset);
    final String? assetCode = vehicle360Present(asset.assetNo);
    final String? displayStatus =
        vehicle360Present(asset.opsStatus) ?? vehicle360Present(asset.status);
    final bool canReportIssue = ref.watch(
      canAccessModuleProvider(ModuleKey.reportIssue),
    );
    final bool canCreateWorkOrder = ref.watch(
      canAccessModuleProvider(ModuleKey.workorders),
    );
    // A readiness ring is shown ONLY for a real, on-device draft of this
    // asset. Someone who cannot inspect cannot own one, so the draft store
    // is not even read for them. Loading and a failed local read both
    // render no ring: the ring is a supplementary resume hint, and its
    // absence claims nothing, whereas a guessed 0% would.
    final bool canInspect = ref.watch(
      canAccessModuleProvider(ModuleKey.inspect),
    );
    final InspectionDraftSummary? draft = canInspect && assetCode != null
        ? switch (ref.watch(vehicleInspectionDraftProvider(assetCode))) {
            AsyncData<InspectionDraftSummary?>(:final value) => value,
            _ => null,
          }
        : null;

    // Header facts beyond the fleet row. Each is supplementary: loading or a
    // failed read shows nothing, never a guessed figure.
    final AssetScope? scope = assetCode == null
        ? null
        : assetScopeFor(asset, ref.watch(activeCountryProvider));
    final double? loggedHours = scope == null
        ? null
        : switch (ref.watch(assetEngineHoursProvider(scope))) {
            AsyncData<double?>(:final double? value) => value,
            _ => null,
          };
    final double? engineHours = loggedHours ??
        (scope == null
            ? null
            : _fleetHours(ref.watch(assetDocumentsRowProvider(asset.id))));
    final AssetServiceDue? serviceDue = scope == null
        ? null
        : switch (ref.watch(
            assetServiceDueProvider(
              (
                scope: scope,
                currentKm: asset.currentKm,
                engineHours: engineHours,
              ),
            ),
          )) {
            AsyncData<AssetServiceDue?>(:final AssetServiceDue? value) => value,
            _ => null,
          };
    final int? tyreActions = scope == null
        ? null
        : switch (ref.watch(assetTyreActionsProvider(scope))) {
            AsyncData<int?>(:final int? value) => value,
            _ => null,
          };
    final bool canOpenPm = ref.watch(canAccessModuleProvider(ModuleKey.pm));
    final bool canOpenTasks =
        ref.watch(canAccessModuleProvider(ModuleKey.tasks));

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double horizontalPadding =
            constraints.maxWidth >= 720 ? TpSpace.xxl : TpSpace.lg;
        // A Column, not a Stack over a guessed bottom padding: the action
        // bar lays out at its own height (which grows with the reader's
        // text size), and the scrolling content ends exactly above it, so
        // the last field is never hidden behind the bar.
        return Column(
          children: <Widget>[
            Expanded(
              child: ListView(
                padding: EdgeInsets.fromLTRB(
                  horizontalPadding,
                  TpSpace.md,
                  horizontalPadding,
                  assetCode == null ? TpSpace.xxxl : TpSpace.lg,
                ),
                children: <Widget>[
                  Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 760),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          _AssetHeroCard(
                            asset: asset,
                            photo: photo,
                            status: displayStatus,
                            engineHours: engineHours,
                            draft: draft,
                            l10n: l10n,
                          ),
                          if (serviceDue != null ||
                              (tyreActions != null &&
                                  tyreActions > 0)) ...<Widget>[
                            const SizedBox(height: TpSpace.md),
                            _AssetAlertStrip(
                              serviceDue: serviceDue,
                              tyreActions: tyreActions,
                              onServiceDue: canOpenPm
                                  ? () => context.push(
                                        const PreventiveMaintenanceRoute()
                                            .location,
                                      )
                                  : null,
                              onTyreActions: canOpenTasks
                                  ? () => context.push(
                                        const TasksRoute().location,
                                      )
                                  : null,
                            ),
                          ],
                          const SizedBox(height: TpSpace.md),
                          _AssetTabs(
                            selected: _selectedTab,
                            labels: <_AssetDetailTab, String>{
                              _AssetDetailTab.overview:
                                  l10n.tyreDetailSectionOverview,
                              _AssetDetailTab.timeline:
                                  l10n.fleetMockTabTimeline,
                              _AssetDetailTab.costs: l10n.fleetMockTabCosts,
                              _AssetDetailTab.documents:
                                  l10n.fleet360TabDocuments,
                            },
                            onSelect: (_AssetDetailTab tab) =>
                                setState(() => _selectedTab = tab),
                          ),
                          const SizedBox(height: TpSpace.md),
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 160),
                            child: switch (_selectedTab) {
                              _AssetDetailTab.overview => _OverviewPanel(
                                  key: const ValueKey<String>('overview'),
                                  asset: asset,
                                  fields: vehicle360Fields(l10n, asset),
                                  l10n: l10n,
                                ),
                              // The mock's timeline view closes on the
                              // financial snapshot, so a reader scrolling
                              // the history sees what it cost without
                              // switching tabs.
                              _AssetDetailTab.timeline => Column(
                                  key: const ValueKey<String>('timeline'),
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: <Widget>[
                                    AssetTimelinePanel(asset: asset),
                                    if (asset.hasNavigableAssetNo) ...<Widget>[
                                      const SizedBox(height: TpSpace.md),
                                      AssetCostSnapshotPanel(asset: asset),
                                    ],
                                  ],
                                ),
                              _AssetDetailTab.costs => AssetCostSnapshotPanel(
                                  key: const ValueKey<String>('costs'),
                                  asset: asset,
                                ),
                              _AssetDetailTab.documents => AssetDocumentsPanel(
                                  key: const ValueKey<String>('documents'),
                                  asset: asset,
                                ),
                            },
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (assetCode != null && (canReportIssue || canCreateWorkOrder))
              _StickyAssetActions(
                reportLabel: ReportIssueCopy.of(context)('title'),
                workOrderLabel: l10n.workOrderNewTitle,
                onReportIssue:
                    canReportIssue ? () => _reportIssue(context) : null,
                onCreateWorkOrder: canCreateWorkOrder
                    ? () => unawaited(
                          showCreateWorkOrderSheet(
                            context,
                            initialAssetNo: assetCode,
                          ),
                        )
                    : null,
              ),
          ],
        );
      },
    );
  }

  /// `vehicle_fleet.current_hours`, the imported meter value, used only when
  /// no `engine_hours_logs` reading exists.
  static double? _fleetHours(AsyncValue<Map<String, dynamic>?> row) {
    final Object? raw = switch (row) {
      AsyncData<Map<String, dynamic>?>(:final Map<String, dynamic>? value) =>
        value?['current_hours'],
      _ => null,
    };
    final double? hours = raw is num
        ? raw.toDouble()
        : (raw is String ? double.tryParse(raw.trim()) : null);
    return hours != null && hours > 0 ? hours : null;
  }

  void _reportIssue(BuildContext context) {
    final String? code = asset.assetNo;
    if (code == null || code.trim().isEmpty) return;
    context.push(
      ReportIssueRoute(
        assetNo: AssetNo(code),
        siteName: asset.site?.trim().isEmpty == false
            ? SiteName(asset.site!.trim())
            : null,
      ).location,
    );
  }
}

/// The identity header, composed after the owner's Vehicle 360 mock: the
/// vehicle picture on the leading side; the asset code, make and model, the
/// site, the operational status pill and the odometer | engine-hours line on
/// the trailing side.
///
/// Every value is real: the `vehicle_fleet` row, plus the latest
/// `engine_hours_logs` reading. The mock's "Health score /100" ring is NOT
/// drawn - no table, RPC or agreed formula produces one, and a score
/// invented on the phone would read as a measurement. The readiness ring
/// appears only when [draft] is a genuine on-device inspection draft.
class _AssetHeroCard extends StatelessWidget {
  const _AssetHeroCard({
    required this.asset,
    required this.photo,
    required this.status,
    required this.engineHours,
    required this.draft,
    required this.l10n,
  });

  final VehicleAsset asset;
  final String? photo;
  final String? status;
  final double? engineHours;
  final InspectionDraftSummary? draft;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? makeModel = vehicle360Join(<String?>[
      asset.make,
      vehicle360Present(asset.model) ?? vehicle360Present(asset.vehicleType),
    ]);
    final String? site = vehicle360Present(asset.site);
    final String? km = asset.currentKm == null
        ? null
        : '${formatVehicleOdometer(asset.currentKm!)} km';
    final String? hours = vehicle360HoursLabel(engineHours);
    final InspectionDraftSummary? liveDraft = draft;

    return Container(
      key: VehicleDetailScreenKeys.hero,
      padding: const EdgeInsets.all(TpSpace.lg),
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.xl),
        border: Border.all(color: palette.border),
        boxShadow: <BoxShadow>[_softLift(palette)],
      ),
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final double proportional = constraints.maxWidth * 0.42;
          final double photoWidth = proportional < 110
              ? 110
              : (proportional > 260 ? 260 : proportional);
          final double photoHeight = photoWidth * 0.8;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: <Widget>[
                  _HeroPhoto(
                    asset: asset,
                    photo: photo,
                    width: photoWidth,
                    height: photoHeight,
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        TpIdentifierText(
                          asset.displayIdentity ?? l10n.vehiclesUnknownAsset,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: text.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.3,
                            color: palette.text,
                          ),
                        ),
                        if (makeModel != null) ...<Widget>[
                          const SizedBox(height: 2),
                          Text(
                            makeModel,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodyMedium?.copyWith(
                              color: palette.textSecondary,
                            ),
                          ),
                        ],
                        if (site != null) ...<Widget>[
                          const SizedBox(height: TpSpace.xs),
                          Row(
                            children: <Widget>[
                              Icon(
                                Icons.location_on_outlined,
                                size: TpSizing.iconSm,
                                color: palette.textSecondary,
                              ),
                              const SizedBox(width: TpSpace.xs),
                              Flexible(
                                child: Text(
                                  site,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: text.labelMedium?.copyWith(
                                    color: palette.textSecondary,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                        if (status != null) ...<Widget>[
                          const SizedBox(height: TpSpace.sm),
                          TpStatusChip(
                            status: vehicleStatusTone(status),
                            label: status!,
                            isCompact: true,
                          ),
                        ],
                        if (km != null || hours != null) ...<Widget>[
                          const SizedBox(height: TpSpace.sm),
                          _HeroMeters(km: km, hours: hours),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              if (liveDraft != null && liveDraft.total > 0) ...<Widget>[
                const SizedBox(height: TpSpace.md),
                _DraftReadiness(draft: liveDraft, l10n: l10n),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// `68,420 km | 8,742 h`, each with its own meter icon. A meter that was
/// never read is left out rather than printed as 0.
class _HeroMeters extends StatelessWidget {
  const _HeroMeters({required this.km, required this.hours});

  final String? km;
  final String? hours;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? style = Theme.of(context).textTheme.labelMedium?.copyWith(
          color: palette.textSecondary,
          fontWeight: FontWeight.w600,
        );
    Widget meter(IconData icon, String value) => Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: TpSizing.iconSm, color: palette.textSecondary),
            const SizedBox(width: TpSpace.xs),
            Flexible(
              child: Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: style,
              ),
            ),
          ],
        );
    return Wrap(
      key: VehicleDetailScreenKeys.heroMeters,
      spacing: TpSpace.sm,
      runSpacing: TpSpace.xs,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: <Widget>[
        if (km != null) meter(Icons.speed_rounded, km!),
        if (km != null && hours != null)
          ExcludeSemantics(
            child: SizedBox(
              height: 14,
              child: VerticalDivider(width: 1, color: palette.borderStrong),
            ),
          ),
        if (hours != null) meter(Icons.hourglass_empty_rounded, hours!),
      ],
    );
  }
}

/// The bordered two-cell strip under the header: the next preventive
/// maintenance service and the open tyre actions. A cell appears only when
/// its figure was actually read; a cell opens its own module only when the
/// person may open it.
class _AssetAlertStrip extends StatelessWidget {
  const _AssetAlertStrip({
    required this.serviceDue,
    required this.tyreActions,
    required this.onServiceDue,
    required this.onTyreActions,
  });

  final AssetServiceDue? serviceDue;
  final int? tyreActions;
  final VoidCallback? onServiceDue;
  final VoidCallback? onTyreActions;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final AssetServiceDue? due = serviceDue;
    final int actions = tyreActions ?? 0;
    final List<Widget> cells = <Widget>[
      if (due != null)
        _AlertCell(
          key: VehicleDetailScreenKeys.serviceDue,
          icon: Icons.schedule_rounded,
          label: _serviceDueLabel(l10n, due),
          tone: due.isOverdue ? TpStatus.critical : TpStatus.warning,
          onTap: onServiceDue,
        ),
      if (actions > 0)
        _AlertCell(
          key: VehicleDetailScreenKeys.tyreActions,
          icon: Icons.tire_repair_outlined,
          label: l10n.fleet360AlertTyreActions(actions),
          tone: TpStatus.warning,
          onTap: onTyreActions,
        ),
    ];
    return DecoratedBox(
      key: VehicleDetailScreenKeys.alerts,
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.lg),
        border: Border.all(color: palette.border),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (int i = 0; i < cells.length; i++) ...<Widget>[
              if (i > 0)
                VerticalDivider(
                  width: 1,
                  indent: TpSpace.sm,
                  endIndent: TpSpace.sm,
                  color: palette.border,
                ),
              Expanded(child: cells[i]),
            ],
          ],
        ),
      ),
    );
  }

  static String _serviceDueLabel(AppLocalizations l10n, AssetServiceDue due) {
    if (due.isOverdue) return l10n.fleet360AlertServiceOverdue;
    final String amount = formatAssetMoney(due.remaining.toDouble());
    return switch (due.unit) {
      AssetServiceDueUnit.km => l10n.fleet360AlertServiceDueKm(amount),
      AssetServiceDueUnit.hours => l10n.fleet360AlertServiceDueHours(amount),
      AssetServiceDueUnit.days => l10n.fleet360AlertServiceDueDays(
          due.remaining,
        ),
    };
  }
}

class _AlertCell extends StatelessWidget {
  const _AlertCell({
    required this.icon,
    required this.label,
    required this.tone,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String label;
  final TpStatus tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return Semantics(
      button: onTap != null,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.lg),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: TpSpace.sm,
              vertical: TpSpace.sm,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Icon(icon, size: TpSizing.iconSm, color: colors.base),
                const SizedBox(width: TpSpace.xs),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: colors.onSoft,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The class illustration from [vehiclePhotoAsset], or - for a class with
/// no verified artwork, including tyreless plant - the honest generic icon.
class _HeroPhoto extends StatelessWidget {
  const _HeroPhoto({
    required this.asset,
    required this.photo,
    required this.width,
    required this.height,
  });

  final VehicleAsset asset;
  final String? photo;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String? image = photo;
    final TpStatusColors glow = palette.info;
    // A soft sky wash behind the illustration, so the vehicle sits on the
    // card the way the mock's hero photograph does rather than floating on
    // flat white.
    return Container(
      key: VehicleDetailScreenKeys.heroPhoto,
      width: width,
      height: height,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TpRadius.lg),
        gradient: RadialGradient(
          center: const Alignment(0, -0.15),
          radius: 0.85,
          colors: <Color>[
            glow.soft,
            glow.soft.withValues(alpha: 0.35),
            palette.surface.withValues(alpha: 0),
          ],
          stops: const <double>[0, 0.6, 1],
        ),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: <Widget>[
          if (image == null)
            Container(
              width: height * 0.62,
              height: height * 0.62,
              decoration: BoxDecoration(
                color: palette.primarySoft,
                shape: BoxShape.circle,
              ),
              child: Icon(
                vehicleFallbackIcon(asset),
                size: height * 0.36,
                color: palette.primary,
              ),
            )
          else
            Image.asset(
              image,
              width: width,
              height: height,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.high,
              semanticLabel: asset.displayIdentity,
            ),
        ],
      ),
    );
  }
}

/// Progress of the signed-in user's own unfinished draft for this asset:
/// the wizard's recorded `filled` of `total` positions, never re-derived.
class _DraftReadiness extends StatelessWidget {
  const _DraftReadiness({required this.draft, required this.l10n});

  final InspectionDraftSummary draft;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final int total = draft.total;
    final int filled =
        draft.filled < 0 ? 0 : (draft.filled > total ? total : draft.filled);
    final double ratio = total == 0 ? 0 : filled / total;
    final int percent = (ratio * 100).round();
    final String progress = l10n.inspectionResumeProgress(filled, total);
    return Semantics(
      key: VehicleDetailScreenKeys.draftReadiness,
      container: true,
      label: '${l10n.inspectionDraftLabel}, $progress',
      child: ExcludeSemantics(
        child: Row(
          children: <Widget>[
            SizedBox(
              width: 68,
              height: 68,
              child: Stack(
                alignment: Alignment.center,
                children: <Widget>[
                  SizedBox.expand(
                    child: CircularProgressIndicator(
                      value: ratio,
                      strokeWidth: 7,
                      strokeCap: StrokeCap.round,
                      backgroundColor: palette.primarySoft,
                      color: palette.forStatus(TpStatus.ok).base,
                    ),
                  ),
                  Text(
                    '$percent%',
                    style: text.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: palette.text,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: TpSpace.sm,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: palette.info.soft,
                      borderRadius: BorderRadius.circular(TpRadius.sm),
                    ),
                    child: Text(
                      l10n.inspectionDraftLabel,
                      style: text.labelSmall?.copyWith(
                        color: palette.info.onSoft,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    progress,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: text.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: palette.primary,
                    ),
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

class _AssetTabs extends StatelessWidget {
  const _AssetTabs({
    required this.selected,
    required this.labels,
    required this.onSelect,
  });

  final _AssetDetailTab selected;
  final Map<_AssetDetailTab, String> labels;
  final ValueChanged<_AssetDetailTab> onSelect;

  static Key _keyOf(_AssetDetailTab tab) => switch (tab) {
        _AssetDetailTab.overview => VehicleDetailScreenKeys.overviewTab,
        _AssetDetailTab.timeline => VehicleDetailScreenKeys.timelineTab,
        _AssetDetailTab.costs => VehicleDetailScreenKeys.costsTab,
        _AssetDetailTab.documents => VehicleDetailScreenKeys.documentsTab,
      };

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Row(
        children: <Widget>[
          for (final _AssetDetailTab tab in _AssetDetailTab.values)
            _AssetTabButton(
              key: _keyOf(tab),
              label: labels[tab] ?? '',
              selected: selected == tab,
              onTap: () => onSelect(tab),
            ),
        ],
      ),
    );
  }
}

class _AssetTabButton extends StatelessWidget {
  const _AssetTabButton({
    required this.label,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: selected ? palette.primary : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: selected ? palette.primary : palette.textMuted,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                ),
          ),
        ),
      ),
    );
  }
}

class _OverviewPanel extends StatelessWidget {
  const _OverviewPanel({
    required this.asset,
    required this.fields,
    required this.l10n,
    super.key,
  });

  final VehicleAsset asset;
  final List<(String, String?)> fields;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        KeyedSubtree(
          key: VehicleDetailScreenKeys.multiViewBoard,
          child: VehicleMultiViewBoard(
            asset: asset,
            title: l10n.vehiclesMultiViewTitle,
            hint: l10n.vehiclesMultiViewHint,
            zoomLabel: l10n.vehiclesMultiViewZoom,
            closeLabel: l10n.actionClose,
          ),
        ),
        const SizedBox(height: TpSpace.lg),
        _SectionHeading(label: l10n.inspectionConditionLabel),
        const SizedBox(height: TpSpace.sm),
        _AssetTyreMap(asset: asset),
        const SizedBox(height: TpSpace.lg),
        _SectionHeading(label: l10n.tyreDetailSectionOverview),
        const SizedBox(height: TpSpace.sm),
        TpCard(
          key: VehicleDetailScreenKeys.details,
          padding: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              for (int i = 0; i < fields.length; i++)
                _FieldRow(
                  label: fields[i].$1,
                  value: fields[i].$2,
                  showDivider: i < fields.length - 1,
                  borderColor: palette.border,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AssetTyreMap extends StatelessWidget {
  const _AssetTyreMap({required this.asset});

  final VehicleAsset asset;

  @override
  Widget build(BuildContext context) {
    final String vehicleType = asset.vehicleType?.trim() ?? '';
    final List<String> positions = diagramPositions(vehicleType, asset.assetNo);
    final AppLocalizations l10n = AppLocalizations.of(context);
    // This map is drawn from the layout alone - the asset screen carries no
    // tyre readings - so every wheel is honestly "not recorded", which the
    // design system paints in its distinct [TpStatus.unknown] tone (the same
    // tone the inspection capture legend uses for "Not recorded"). The
    // diagram's compact legend lists only Good / Monitor / Critical, so
    // without this key every wheel would be an unexplained colour that reads
    // as an alert. The key states what the colour means instead of repainting
    // unmeasured wheels to look like a result.
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        KeyedSubtree(
          key: VehicleDetailScreenKeys.tyreMap,
          child: VehicleTyreDiagram(
            vehicleType: vehicleType,
            assetNo: asset.assetNo,
            positions: positions,
            tyreData: const <String, Map<String, Object?>>{},
            width: 150,
            compact: true,
          ),
        ),
        if (positions.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Center(
            child: TpStatusChip(
              key: VehicleDetailScreenKeys.tyreMapNotRecorded,
              status: TpStatus.unknown,
              label: l10n.tyreDiagramListNotRecorded,
              isCompact: true,
            ),
          ),
        ],
      ],
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    // The mock's bold sentence-case section title, led by a short green
    // accent bar.
    return Semantics(
      header: true,
      child: Row(
        children: <Widget>[
          Container(
            width: 4,
            height: 16,
            decoration: BoxDecoration(
              color: palette.primary,
              borderRadius: BorderRadius.circular(TpRadius.pill),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              label,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The sticky bar from the mock: an outlined "Report issue" and the filled
/// "Create work order". An action the person may not use is not offered at
/// all (AGENTS.md rule 7: a control that would only be refused does
/// nothing); the remaining one then takes the full width.
class _StickyAssetActions extends StatelessWidget {
  const _StickyAssetActions({
    required this.reportLabel,
    required this.workOrderLabel,
    required this.onReportIssue,
    required this.onCreateWorkOrder,
  });

  final String reportLabel;
  final String workOrderLabel;
  final VoidCallback? onReportIssue;
  final VoidCallback? onCreateWorkOrder;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final VoidCallback? report = onReportIssue;
    final VoidCallback? createWorkOrder = onCreateWorkOrder;
    return Container(
      key: VehicleDetailScreenKeys.actionBar,
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.sm,
        TpSpace.lg,
        TpSpace.md,
      ),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: _shadowTint(palette),
            offset: const Offset(0, -4),
            blurRadius: 12,
            spreadRadius: -4,
          ),
        ],
      ),
      child: Row(
        children: <Widget>[
          if (report != null)
            Expanded(
              child: TpButton.secondary(
                key: VehicleDetailScreenKeys.reportIssue,
                label: reportLabel,
                icon: Icons.warning_amber_rounded,
                isFullWidth: true,
                onPressed: report,
              ),
            ),
          if (report != null && createWorkOrder != null)
            const SizedBox(width: TpSpace.md),
          if (createWorkOrder != null)
            Expanded(
              child: _PrimaryLift(
                child: TpButton.primary(
                  key: VehicleDetailScreenKeys.createWorkOrder,
                  label: workOrderLabel,
                  icon: Icons.add_box_outlined,
                  isFullWidth: true,
                  onPressed: createWorkOrder,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _FieldRow extends StatelessWidget {
  const _FieldRow({
    required this.label,
    required this.value,
    required this.showDivider,
    required this.borderColor,
  });

  final String label;
  final String? value;
  final bool showDivider;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    // A genuinely unmeasured field renders the design system's own
    // placeholder rather than a blank line or an invented value - spec
    // section 32: a dash, never a fabricated "0" or empty space that reads
    // as a rendering fault.
    final String display = value?.trim().isNotEmpty == true
        ? value!.trim()
        : l10n.valueNotMeasured;

    return Container(
      decoration: showDivider
          ? BoxDecoration(
              border: Border(bottom: BorderSide(color: borderColor)),
            )
          : null,
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      child: Row(
        children: <Widget>[
          Expanded(flex: 2, child: Text(label, style: text.labelMedium)),
          Expanded(
            flex: 3,
            child: Text(
              display,
              style: text.bodyLarge,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}

/// The shadow tint this screen uses: a faint navy lift on the light theme,
/// a plain dark drop on the dark theme (a light-ink shadow would glow).
Color _shadowTint(TpPalette palette) => palette.brightness == Brightness.dark
    ? Colors.black.withValues(alpha: 0.45)
    : palette.text.withValues(alpha: 0.07);

/// The quiet card lift shared by the hero and the metric cards.
BoxShadow _softLift(TpPalette palette) => BoxShadow(
      color: _shadowTint(palette),
      offset: const Offset(0, 4),
      blurRadius: 14,
      spreadRadius: -6,
    );

/// A soft brand-green glow under the one primary action on this screen
/// (the sticky bar's "Inspect now").
class _PrimaryLift extends StatelessWidget {
  const _PrimaryLift({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TpRadius.md),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: palette.primary.withValues(
              alpha: palette.brightness == Brightness.dark ? 0.35 : 0.3,
            ),
            offset: const Offset(0, 6),
            blurRadius: 16,
            spreadRadius: -4,
          ),
        ],
      ),
      child: child,
    );
  }
}
