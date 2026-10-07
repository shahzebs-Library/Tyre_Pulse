/// The Home branch root - the real Home hub.
///
/// # Layout: owner-approved mock 07 ("Home - Today's work")
///
/// Top to bottom: a header (initials avatar, greeting and first name,
/// site and country, and the offline-queue sync status), a full-width
/// "New inspection" call to action, the accident command shortcut, a
/// "Today's work" timeline and the quick actions. The bottom bar is NOT
/// drawn here: the shared shell bar (`app/router/shell_tabs.dart`, Home /
/// Inspect / Approvals / Accidents / Profile) is exactly the bar the mock
/// shows, and `app/router/app_shell.dart` no longer hides it on Home.
///
/// # Real data only (AGENTS.md rules 1, 4 and 6)
///
/// Every timeline row comes from a real source, and only that source:
///
/// - DRAFT - the newest inspection draft with progress for this user
///   ([homeLatestInspectionDraftProvider], read-only over the inspections
///   feature's local draft store).
/// - CRITICAL - the first critical tyre alert ([tyreAlertsProvider]).
/// - AWAITING SIGNATURE - an exact server count of pending inspection
///   approvals ([homePendingInspectionApprovalsProvider]), shown only to a
///   role that `decide_inspection_approval` would actually let sign
///   ([homeCanSignInspectionApprovalsProvider]).
///
/// Below the timeline, "Your recent inspections" ([homeRecentAssetsProvider])
/// is the mock's "Recent assets" strip, derived honestly from the signed-in
/// user's own latest inspections: each card's status is the worst tyre
/// condition THAT inspection recorded, and the section is labelled for what
/// it is rather than as a live fleet state.
///
/// - SCHEDULED / DUE TODAY / OVERDUE - the next open item on today's plan,
///   from the same `myWorkSnapshotProvider` "My tasks" and "Today's field
///   plan" render (checklist assignments for the role, this person's
///   inspection plans, work orders and corrective actions, drafts on this
///   device), with a count of the rest. This is the mock's "Daily checklist"
///   row and mocks 08/09's "current assignment", read only for a person who
///   can open the plan (calendar or tasks module).
///
/// Below the recent strip, mock 10's "Operational summary": inspections due
/// (this person's plans due today, overdue or in progress), pending sync
/// (the local queue), tyres needing attention (active High/Critical tyre
/// records, a bounded page of 300 shown as `300+`) and approvals awaiting
/// the person. A tile appears only for a source the person can read, and a
/// failed read says "Could not check" instead of showing 0.
///
/// The mock's "Fleet pulse" Good/Attention/Critical/Not-checked counts have
/// NO data source this app can read: the only fleet aggregate (`get_mobile_analytics`, V479) counts
/// `tyre_records.risk_level`, which is essentially unpopulated, so those
/// counts would read as an unrated fleet rather than a measurement. They are
/// not rendered.
///
/// # Staying current while mounted
///
/// Home stays mounted beneath every screen it opens, so its sources refresh
/// on pull-to-refresh, when the app resumes, and when Home becomes visible
/// again (its [TickerMode] turns back on after a tab switch or a pop). The
/// draft source is a live Drift watch on top of that, so a submitted or
/// discarded draft leaves the timeline without any refresh at all.
/// There is no connectivity provider either, so the header never claims
/// "Online": it states only what the local queue knows (all synced, N
/// waiting, or could not check).
///
/// A source that failed is said to have failed ("Could not check"), never
/// rendered as an empty timeline, because "we could not look" and "there
/// is nothing" are opposite claims.
///
/// # Navigation: push within Home's own branch, `go` across a branch
///
/// `TpShell.destinations` (`app/router/shell_tabs.dart`) declares NINE
/// branches: `home`, `newInspection`, `inspectionApprovals`,
/// `accidentDashboard`, `meterLog`, `washing`, `activityHistory`,
/// `checklists`, `profile`. A routeId that owns one of those branches is
/// reached with `context.go(...)` - it genuinely crosses from branch 0 into
/// another branch. A routeId with NO branch of its own - `serialSearch`,
/// `tyreRecords`, `vehicles`, `workOrders`, `checklistApprovals`, `scanner`,
/// `tyreChange` - is nested inside Home's OWN branch (0) and is reached with
/// `context.push(...)` so Home stays on the stack underneath it with real
/// history.
///
/// The full permission-gated module catalogue ([_kHomeSections]) is reached
/// from the "More" quick action. Registry-only modules with no implemented
/// screen are excluded so a Home control can never lead to a placeholder.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/auth/auth_providers.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';
import 'package:tyre_pulse/features/home/home_layout.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_board.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';
import 'package:tyre_pulse/features/my_work/presentation/my_work_widgets.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';

/// Real local time in production; overridden for deterministic goldens.
///
/// Drives the greeting and every relative time on the timeline, so a golden
/// that pins it renders the same "10m ago" on every run.
final homeHeaderClockProvider = Provider<DateTime Function()>(
  (Ref ref) => DateTime.now,
);

/// Stable finders for Home's visual regions.
@visibleForTesting
abstract final class HomeScreenKeys {
  static const Key hero = Key('home.hero');
  static const Key syncStatus = Key('home.sync');
  static const Key newInspection = Key('home.newInspection');
  static const Key todaysWork = Key('home.todaysWork');
  static const Key recentAssets = Key('home.recentAssets');
  static const Key summary = Key('home.summary');

  /// One operational-summary tile: `inspections`, `sync`, `tyres`,
  /// `approvals`.
  static Key summaryTile(String id) => Key('home.summary.$id');
  static const Key refresh = Key('home.refresh');

  /// One timeline row: `draft`, `critical`, `approvals`, `unavailable`,
  /// `loading`, `empty` or `none` (no work source applies to this role).
  static Key workRow(String id) => Key('home.work.$id');

  /// One card in "Your recent inspections", keyed by asset code.
  static Key recentAsset(String assetNo) => Key('home.recent.$assetNo');

  static Key action(String id) => Key('home.action.$id');
}

/// The tile catalogue the "More" sheet lists, filtered by
/// [visibleHomeSections].
///
/// `const`, and deliberately declared ONCE at file scope rather than rebuilt
/// per frame - it carries no `BuildContext` and nothing here changes at
/// runtime; only which of its entries survive the access filter does.
const List<HomeSectionSpec> _kHomeSections = <HomeSectionSpec>[
  HomeSectionSpec(
    id: 'field',
    tiles: <HomeTileSpec>[
      // First in the field section deliberately: "what am I supposed to do
      // today" is the question a crew opens the app with, and until this tile
      // existed the answer was only visible to whoever planned the work.
      HomeTileSpec(id: 'myPlans', module: ModuleKey.inspect),
      HomeTileSpec(id: 'scanner', module: ModuleKey.scan),
      HomeTileSpec(id: 'serial', module: ModuleKey.serial),
      HomeTileSpec(id: 'meter', module: ModuleKey.meter),
      HomeTileSpec(id: 'washing', module: ModuleKey.washing),
      HomeTileSpec(id: 'tyreChange', module: ModuleKey.tyreChange),
      HomeTileSpec(id: 'checklists', module: ModuleKey.checklists),
      HomeTileSpec(id: 'checklistHistory', module: ModuleKey.checklists),
      HomeTileSpec(id: 'reportIssue', module: ModuleKey.reportIssue),
    ],
  ),
  HomeSectionSpec(
    id: 'fleet',
    tiles: <HomeTileSpec>[
      HomeTileSpec(id: 'records', module: ModuleKey.records),
      HomeTileSpec(id: 'vehicles', module: ModuleKey.vehicles),
      HomeTileSpec(id: 'history', module: ModuleKey.history),
      HomeTileSpec(id: 'alerts', module: ModuleKey.alerts),
      HomeTileSpec(id: 'calendar', module: ModuleKey.calendar),
    ],
  ),
  HomeSectionSpec(
    id: 'maintenance',
    tiles: <HomeTileSpec>[
      HomeTileSpec(id: 'accidents', module: ModuleKey.accidents),
      HomeTileSpec(id: 'reportAccident', module: ModuleKey.reportAccident),
      HomeTileSpec(id: 'workorders', module: ModuleKey.workorders),
      HomeTileSpec(id: 'rca', module: ModuleKey.rca),
      HomeTileSpec(id: 'tasks', module: ModuleKey.tasks),
      HomeTileSpec(id: 'stock', module: ModuleKey.stock),
      HomeTileSpec(id: 'pm', module: ModuleKey.pm),
      HomeTileSpec(id: 'workshop', module: ModuleKey.workshop),
      HomeTileSpec(id: 'workshopStatus', module: ModuleKey.workshopStatus),
    ],
  ),
  HomeSectionSpec(
    id: 'management',
    tiles: <HomeTileSpec>[
      HomeTileSpec(id: 'overview', module: ModuleKey.overview),
      HomeTileSpec(id: 'reports', module: ModuleKey.reports),
      HomeTileSpec(id: 'analytics', module: ModuleKey.analytics),
      HomeTileSpec(id: 'team', module: ModuleKey.team),
    ],
  ),
  HomeSectionSpec(
    id: 'approvals',
    tiles: <HomeTileSpec>[
      HomeTileSpec(id: 'inspectionApprovals', module: ModuleKey.approvals),
      HomeTileSpec(id: 'checklistApprovals', module: ModuleKey.approvals),
    ],
  ),
];

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({required this.route, super.key});

  /// [HomeRoute] carries no parameters of its own. Threaded through anyway,
  /// matching every other registered screen in this codebase.
  final HomeRoute route;

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  late final AppLifecycleListener _lifecycle;

  /// Whether Home was visible (its [TickerMode] on) at the last dependency
  /// change. A shell branch that is not selected, and a route covered by an
  /// opaque route above it, both run with tickers disabled; the flip back to
  /// enabled is the moment Home is on screen again.
  bool _wasVisible = true;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _refreshSources);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final bool visible = TickerMode.valuesOf(context).enabled;
    if (visible && !_wasVisible) {
      // Never invalidate providers in the middle of a build.
      WidgetsBinding.instance.addPostFrameCallback((_) => _refreshSources());
    }
    _wasVisible = visible;
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  /// Re-reads every Home source. Cheap for the ones a role cannot see: an
  /// invalidated provider nobody watches is not re-fetched.
  void _refreshSources() {
    if (!mounted) return;
    ref
      ..invalidate(homeLatestInspectionDraftProvider)
      ..invalidate(homePendingInspectionApprovalsProvider)
      ..invalidate(tyreAlertsProvider)
      ..invalidate(homePendingSyncCountProvider)
      ..invalidate(homeRecentAssetsProvider)
      ..invalidate(myWorkSnapshotProvider);
  }

  /// Pull-to-refresh: invalidate, then wait for the sources this role is
  /// actually watching so the indicator stays up until they answer. A
  /// failure is not rethrown - the section it belongs to renders it.
  Future<void> _pullToRefresh({
    required bool draft,
    required bool approvals,
    required bool alerts,
    required bool recent,
    required bool plan,
  }) async {
    _refreshSources();
    Future<void> settle(Future<Object?> future) =>
        future.then<void>((_) {}, onError: (Object _) {});
    await Future.wait(<Future<void>>[
      settle(ref.read(homePendingSyncCountProvider.future)),
      if (draft) settle(ref.read(homeLatestInspectionDraftProvider.future)),
      if (approvals)
        settle(ref.read(homePendingInspectionApprovalsProvider.future)),
      if (alerts) settle(ref.read(tyreAlertsProvider.future)),
      if (recent) settle(ref.read(homeRecentAssetsProvider.future)),
      if (plan) settle(ref.read(myWorkSnapshotProvider.future)),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool canInspect = ref.watch(
      canAccessModuleProvider(ModuleKey.inspect),
    );
    final bool canScan = ref.watch(
      canAccessModuleProvider(ModuleKey.scan),
    );
    final bool canWash = ref.watch(
      canAccessModuleProvider(ModuleKey.washing),
    );
    final bool canSeeVehicles = ref.watch(
      canAccessModuleProvider(ModuleKey.vehicles),
    );
    final bool canSeeApprovals = ref.watch(
      canAccessModuleProvider(ModuleKey.approvals),
    );
    // Reaching the approvals module is not enough to be asked to sign: the
    // server's own role gate is narrower (V606).
    final bool canSignApprovals =
        canSeeApprovals && ref.watch(homeCanSignInspectionApprovalsProvider);
    final bool canSeeHistory = ref.watch(
      canAccessModuleProvider(ModuleKey.history),
    );
    final bool canSeeAlerts = ref.watch(
      canAccessModuleProvider(ModuleKey.alerts),
    );
    final bool canSeeTasks = ref.watch(
      canAccessModuleProvider(ModuleKey.tasks),
    );
    final bool canSeeCalendar = ref.watch(
      canAccessModuleProvider(ModuleKey.calendar),
    );
    final bool canReportIssue = ref.watch(
      canAccessModuleProvider(ModuleKey.reportIssue),
    );
    final bool canReportAccident = ref.watch(
      canAccessModuleProvider(ModuleKey.reportAccident),
    );
    final bool canSeeAccidents = ref.watch(
      canAccessModuleProvider(ModuleKey.accidents),
    );
    final List<HomeSectionSpec> sections = visibleHomeSections(
      _kHomeSections,
      (ModuleKey module) => ref.watch(canAccessModuleProvider(module)),
    );
    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    final DateTime now = ref.watch(homeHeaderClockProvider)();
    final AsyncValue<InspectionDraftSummary?>? draft =
        canInspect ? ref.watch(homeLatestInspectionDraftProvider) : null;
    final AsyncValue<HomePendingApprovals>? approvals = canSignApprovals
        ? ref.watch(homePendingInspectionApprovalsProvider)
        : null;
    final AsyncValue<List<HomeRecentAsset>>? recent =
        canInspect ? ref.watch(homeRecentAssetsProvider) : null;
    final AsyncValue<List<TyreAlert>>? alerts =
        canSeeAlerts ? ref.watch(tyreAlertsProvider) : null;
    // Today's plan (mocks 08 and 09 "current assignment"): the same personal
    // snapshot "My tasks" and "Today's field plan" render, read only when the
    // person can open one of those screens to see the rest of it.
    final bool canSeePlan = canSeeCalendar || canSeeTasks;
    final AsyncValue<MyWorkSnapshot>? plan =
        canSeePlan ? ref.watch(myWorkSnapshotProvider) : null;
    final AsyncValue<int> pendingSync = ref.watch(homePendingSyncCountProvider);
    final AsyncValue<int> notificationCount =
        ref.watch(unreadNotificationsCountProvider);

    final bool accessFailed = ref.watch(accessLoadFailedProvider);
    final VoidCallback? retryAccess = ref.watch(retryAccessLoadProvider);
    final _TodaysWork work = _buildTodaysWork(
      l10n: l10n,
      palette: palette,
      now: now,
      draft: draft,
      alerts: alerts,
      approvals: approvals,
      plan: plan,
      onOpenPlan: canSeeCalendar
          ? () => context.push(const CalendarRoute().location)
          : canSeeTasks
              ? () => context.push(const TasksRoute().location)
              : null,
      accessFailed: accessFailed,
      onRetryAccess: retryAccess,
    );

    return TpScaffold(
      backgroundColor: palette.background,
      body: RefreshIndicator(
        key: HomeScreenKeys.refresh,
        color: palette.primary,
        onRefresh: () => _pullToRefresh(
          draft: draft != null,
          approvals: approvals != null,
          alerts: alerts != null,
          recent: recent != null,
          plan: plan != null,
        ),
        child: ListView(
          padding: EdgeInsets.zero,
          // Always scrollable, so a short Home can still be pulled.
          physics: const AlwaysScrollableScrollPhysics(),
          children: <Widget>[
            // Header and the primary calls to action share one softly tinted
            // band, so the top of Home reads as a single "start here" block
            // rather than three stacked strips.
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: AlignmentDirectional.topStart,
                  end: AlignmentDirectional.bottomEnd,
                  colors: <Color>[
                    palette.surface,
                    Color.lerp(palette.surface, palette.primarySoft, 0.75)!,
                  ],
                ),
                border: Border(bottom: BorderSide(color: palette.border)),
              ),
              child: _Band(
                color: Colors.transparent,
                padding: const EdgeInsetsDirectional.fromSTEB(16, 16, 12, 18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    _Entrance(
                      index: 0,
                      child: _HomeHeader(
                        l10n: l10n,
                        workspace: workspace,
                        now: now,
                        pendingSync: pendingSync,
                        notificationCount: _scalarCountText(notificationCount),
                        onSiteTap: () => _showSite(workspace, l10n),
                        onNotifications: () =>
                            context.push(const NotificationsRoute().location),
                      ),
                    ),
                    if (canInspect || canSeeAccidents) ...<Widget>[
                      const SizedBox(height: 18),
                      _Entrance(
                        index: 1,
                        child: Padding(
                          padding: const EdgeInsetsDirectional.only(end: 4),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: <Widget>[
                              if (canInspect)
                                _NewInspectionButton(
                                  label: l10n.inspectionNewInspection,
                                  onTap: () => context
                                      .go(const NewInspectionRoute().location),
                                ),
                              if (canInspect && canSeeAccidents)
                                const SizedBox(height: 12),
                              if (canSeeAccidents)
                                _AccidentCommandShortcut(
                                  l10n: l10n,
                                  onTap: () => context.go(
                                    const AccidentDashboardRoute().location,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            _Band(
              color: palette.background,
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _HomeSectionHeader(
                    title: l10n.homeTodaysWork,
                    action: l10n.homeViewAll,
                    onAction: _seeAllDestination(
                      canSeeAlerts: canSeeAlerts,
                      canSeeApprovals: canSeeApprovals,
                      canSeeTasks: canSeeTasks,
                    ),
                  ),
                  const SizedBox(height: 10),
                  _Entrance(index: 2, child: _TodaysWorkCard(work: work)),
                  if (_showRecent(recent)) ...<Widget>[
                    const SizedBox(height: 26),
                    _HomeSectionHeader(
                      title: l10n.homeRecentInspectionsTitle,
                      action: l10n.homeViewAll,
                      onAction: canSeeHistory
                          ? () =>
                              context.go(const ActivityHistoryRoute().location)
                          : null,
                    ),
                    const SizedBox(height: 12),
                    _RecentAssetsStrip(
                      recent: recent!,
                      onRetry: () => ref.invalidate(homeRecentAssetsProvider),
                      onOpen: canSeeVehicles
                          ? (String assetNo) => context.push(
                                VehiclesRoute(assetNo: AssetNo(assetNo))
                                    .location,
                              )
                          : null,
                    ),
                  ],
                  const SizedBox(height: 26),
                  _HomeSectionHeader(title: l10n.homeOperationalSummary),
                  const SizedBox(height: 12),
                  _OperationalSummary(
                    tiles: _summaryTiles(
                      l10n: l10n,
                      palette: palette,
                      plan: plan,
                      pendingSync: pendingSync,
                      alerts: alerts,
                      approvals: approvals,
                      onOpenPlan: canSeeCalendar
                          ? () => context.push(const CalendarRoute().location)
                          : canSeeTasks
                              ? () => context.push(const TasksRoute().location)
                              : null,
                    ),
                  ),
                  const SizedBox(height: 26),
                  _HomeSectionHeader(title: l10n.homeQuickActions),
                  const SizedBox(height: 12),
                  // Deliberately NOT animated: the grid sits below the fold on
                  // a phone, so a rise nobody sees would only move tap targets
                  // under a finger that arrives early.
                  _DashboardQuickActions(
                    l10n: l10n,
                    canScan: canScan,
                    canWash: canWash,
                    canSeeVehicles: canSeeVehicles,
                    canReportIssue: canReportIssue,
                    canReportAccident: canReportAccident,
                    onScanner: () =>
                        context.push(const ScannerRoute().location),
                    onWashing: () => context.go(const WashingRoute().location),
                    onAsset: () => context.push(const VehiclesRoute().location),
                    onReportIssue: () =>
                        context.push(const ReportIssueRoute().location),
                    onAccident: () =>
                        context.push(const AccidentReportRoute().location),
                    onMore: () => _showServices(sections, l10n),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The recent strip is shown while loading, on failure (so the failure is
  /// said), and when there is at least one asset. An empty history hides it:
  /// a person who has inspected nothing has no recent inspections to list.
  static bool _showRecent(AsyncValue<List<HomeRecentAsset>>? recent) =>
      switch (recent) {
        null => false,
        AsyncData<List<HomeRecentAsset>>(:final value) => value.isNotEmpty,
        _ => true,
      };

  /// Builds the timeline rows from the three real sources, in the mock's
  /// order: unfinished work first, then safety, then sign-off.
  _TodaysWork _buildTodaysWork({
    required AppLocalizations l10n,
    required TpPalette palette,
    required DateTime now,
    required AsyncValue<InspectionDraftSummary?>? draft,
    required AsyncValue<List<TyreAlert>>? alerts,
    required AsyncValue<HomePendingApprovals>? approvals,
    AsyncValue<MyWorkSnapshot>? plan,
    VoidCallback? onOpenPlan,
    bool accessFailed = false,
    VoidCallback? onRetryAccess,
  }) {
    final List<_WorkRowData> rows = <_WorkRowData>[];
    final List<String> failed = <String>[];
    bool loading = false;
    bool loadedAny = false;

    switch (draft) {
      case AsyncData<InspectionDraftSummary?>(:final value):
        loadedAny = true;
        if (value != null) rows.add(_draftRow(l10n, palette, now, value));
      case AsyncError<InspectionDraftSummary?>():
        failed.add(l10n.inspectionDraftLabel);
      case null:
        break;
      default:
        loading = true;
    }

    switch (alerts) {
      case AsyncData<List<TyreAlert>>(:final value):
        loadedAny = true;
        final TyreAlert? critical = value
            .cast<TyreAlert?>()
            .firstWhere((TyreAlert? a) => a!.isCritical, orElse: () => null);
        if (critical != null) {
          rows.add(_criticalRow(l10n, palette, critical));
        }
      case AsyncError<List<TyreAlert>>():
        failed.add(l10n.homeCriticalMetric);
      case null:
        break;
      default:
        loading = true;
    }

    switch (approvals) {
      case AsyncData<HomePendingApprovals>(:final value):
        loadedAny = true;
        if (value.count > 0) {
          rows.add(_approvalsRow(l10n, palette, now, value));
        }
      case AsyncError<HomePendingApprovals>():
        failed.add(l10n.homeApprovalsMetric);
      case null:
        break;
      default:
        loading = true;
    }

    // The mock's "Scheduled" row: the next open item on today's plan.
    switch (plan) {
      case AsyncData<MyWorkSnapshot>(:final value):
        loadedAny = true;
        final List<MyWorkItem> today = <MyWorkItem>[
          for (final MyWorkItem i
              in itemsForDay(value.items, day: now, now: now))
            if (i.isOpen) i,
        ];
        if (today.isNotEmpty) {
          rows.add(_planRow(l10n, palette, today, onOpenPlan));
        }
      case AsyncError<MyWorkSnapshot>():
        failed.add(l10n.myWorkFieldPlanTitle);
      case null:
        break;
      default:
        loading = true;
    }

    return _TodaysWork(
      rows: rows,
      failed: failed,
      loading: loading,
      loadedAny: loadedAny,
      applicable:
          draft != null || alerts != null || approvals != null || plan != null,
      accessFailed: accessFailed,
      onRetryAccess: onRetryAccess,
      onRetry: failed.isEmpty
          ? null
          : () => ref
            ..invalidate(homeLatestInspectionDraftProvider)
            ..invalidate(tyreAlertsProvider)
            ..invalidate(homePendingInspectionApprovalsProvider)
            ..invalidate(myWorkSnapshotProvider),
    );
  }

  /// The first open item on today's plan, in the plan's own order (timed
  /// items first, then worst state). A count of the rest is shown beside it
  /// so the row never reads as the whole day.
  _WorkRowData _planRow(
    AppLocalizations l10n,
    TpPalette palette,
    List<MyWorkItem> today,
    VoidCallback? onOpenPlan,
  ) {
    final MyWorkItem item = today.first;
    final int? answered = item.answered;
    final int? total = item.total;
    final DateTime? at = item.dueAt;
    return _WorkRowData(
      id: 'plan',
      tone: switch (item.state) {
        MyWorkState.overdue => palette.critical,
        MyWorkState.inProgress => palette.info,
        MyWorkState.dueToday => palette.ok,
        MyWorkState.upcoming || MyWorkState.completed => palette.neutral,
      },
      icon: myWorkIcon(item),
      tag: myWorkStateLabel(l10n, item.state),
      title: myWorkTitle(l10n, item),
      detail: _joinParts(<String?>[item.reference, item.assetNo, item.site]),
      secondary: _nonEmpty(
        _joinParts(<String?>[
          if (answered != null && total != null && total > 0)
            l10n.myWorkAnswered(answered, total),
          if (today.length > 1) l10n.homePlanMoreToday(today.length - 1),
        ]),
      ),
      time: at == null ? null : myWorkTime(context, at),
      timeIsAlert: item.state == MyWorkState.overdue,
      onTap: onOpenPlan,
    );
  }

  _WorkRowData _draftRow(
    AppLocalizations l10n,
    TpPalette palette,
    DateTime now,
    InspectionDraftSummary draft,
  ) {
    final String asset = draft.assetNo.trim();
    final String? site = draft.site?.trim();
    return _WorkRowData(
      id: 'draft',
      tone: palette.info,
      icon: Icons.edit_outlined,
      tag: l10n.inspectionDraftLabel,
      title: l10n.homeResumeInspection,
      detail: _joinParts(<String?>[asset, draft.vehicleType, site]),
      secondary: draft.total > 0
          ? l10n.inspectionResumeProgress(draft.filled, draft.total)
          : null,
      time: _relativeTime(l10n, context, draft.updatedAt, now),
      onTap: () => context.go(
        NewInspectionRoute(
          assetNo: AssetNo(asset),
          siteName: site == null || site.isEmpty ? null : SiteName(site),
        ).location,
      ),
    );
  }

  _WorkRowData _criticalRow(
    AppLocalizations l10n,
    TpPalette palette,
    TyreAlert alert,
  ) {
    final num? tread = alert.treadDepthMm;
    final DateTime? issued = DateTime.tryParse(alert.issueDate ?? '');
    return _WorkRowData(
      id: 'critical',
      tone: palette.critical,
      icon: Icons.warning_amber_rounded,
      tag: l10n.statusCritical,
      title: l10n.homeTyreIssueNeedsAttention,
      detail: _joinParts(<String?>[alert.position, alert.assetNo, alert.site]),
      secondary: tread == null
          ? null
          // The reading is isolated left-to-right so "4.8 mm" never renders as
          // "mm 4.8" inside an Arabic or Urdu sentence.
          : '${l10n.tyreDetailStatTread}: '
              '\u2066${tread % 1 == 0 ? tread.toInt() : tread.toStringAsFixed(1)} mm\u2069',
      // `issue_date` is the tyre record's own date, not when the alert was
      // raised, so it is shown as a date rather than as "N minutes ago".
      time: issued == null
          ? null
          : MaterialLocalizations.of(context).formatShortDate(issued.toLocal()),
      timeIsAlert: true,
      onTap: () => context.push(const AlertsRoute().location),
    );
  }

  _WorkRowData _approvalsRow(
    AppLocalizations l10n,
    TpPalette palette,
    DateTime now,
    HomePendingApprovals pending,
  ) {
    final DateTime? newest = pending.newestAt;
    return _WorkRowData(
      id: 'approvals',
      tone: palette.warning,
      icon: Icons.assignment_turned_in_outlined,
      tag: l10n.homeAwaitingSignatureTag,
      title: l10n.inspectionApprovalsTitle,
      detail: l10n.inspectionApprovalsAwaitingCount(pending.count),
      time: newest == null ? null : _relativeTime(l10n, context, newest, now),
      onTap: () => context.go(const InspectionApprovalsRoute().location),
    );
  }

  /// Mock 10's operational summary. A tile appears only for a source this
  /// person can read; a failed read says so and never renders as 0.
  List<_SummaryTileData> _summaryTiles({
    required AppLocalizations l10n,
    required TpPalette palette,
    required AsyncValue<MyWorkSnapshot>? plan,
    required AsyncValue<int> pendingSync,
    required AsyncValue<List<TyreAlert>>? alerts,
    required AsyncValue<HomePendingApprovals>? approvals,
    required VoidCallback? onOpenPlan,
  }) {
    _SummaryTileData tile<T>({
      required String id,
      required IconData icon,
      required TpStatusColors tone,
      required String label,
      required AsyncValue<T> state,
      required String Function(T value) value,
      VoidCallback? onTap,
    }) =>
        switch (state) {
          AsyncData<T>(value: final T v) => _SummaryTileData(
              id: id,
              icon: icon,
              tone: tone,
              label: label,
              value: value(v),
              onTap: onTap,
            ),
          AsyncError<T>() => _SummaryTileData(
              id: id,
              icon: icon,
              tone: palette.unknown,
              label: label,
              value: '-',
              note: l10n.homeStatUnavailableCaption,
              onTap: onTap,
            ),
          _ => _SummaryTileData(
              id: id,
              icon: icon,
              tone: palette.unknown,
              label: label,
              value: '-',
              note: l10n.homeStatLoadingCaption,
              onTap: onTap,
            ),
        };

    final MyWorkSnapshot? snapshot = plan?.asData?.value;
    final bool planHasInspections = plan != null &&
        (snapshot == null ||
            snapshot.attempted.contains(MyWorkSource.inspectionPlans));
    return <_SummaryTileData>[
      if (planHasInspections)
        tile<MyWorkSnapshot>(
          id: 'inspections',
          icon: Icons.assignment_outlined,
          tone: palette.info,
          label: l10n.homeInspectionsDue,
          state: snapshot != null &&
                  snapshot.failed.contains(MyWorkSource.inspectionPlans)
              ? AsyncError<MyWorkSnapshot>(
                  StateError('inspection plans unreadable'),
                  StackTrace.empty,
                )
              : plan,
          value: (MyWorkSnapshot v) {
            final int n = v.items
                .where(
                  (MyWorkItem i) =>
                      i.kind == MyWorkKind.inspectionPlan &&
                      (i.state == MyWorkState.overdue ||
                          i.state == MyWorkState.inProgress ||
                          i.state == MyWorkState.dueToday),
                )
                .length;
            return v.incomplete.contains(MyWorkSource.inspectionPlans)
                ? '$n+'
                : '$n';
          },
          onTap: onOpenPlan,
        ),
      tile<int>(
        id: 'sync',
        icon: Icons.sync_rounded,
        tone:
            (pendingSync.asData?.value ?? 0) > 0 ? palette.warning : palette.ok,
        label: l10n.homeSyncStatLabel,
        state: pendingSync,
        value: (int v) => '$v',
        onTap: () => context.go(const ProfileRoute().location),
      ),
      if (alerts != null)
        tile<List<TyreAlert>>(
          id: 'tyres',
          icon: Icons.tire_repair_outlined,
          tone: palette.critical,
          label: l10n.homeTyresNeedAttention,
          state: alerts,
          // The alerts read is a bounded page of 300 rows.
          value: (List<TyreAlert> v) =>
              v.length >= 300 ? '${v.length}+' : '${v.length}',
          onTap: () => context.push(const AlertsRoute().location),
        ),
      if (approvals != null)
        tile<HomePendingApprovals>(
          id: 'approvals',
          icon: Icons.how_to_reg_outlined,
          tone: palette.warning,
          label: l10n.homeApprovalsAwaitingYou,
          state: approvals,
          value: (HomePendingApprovals v) => '${v.count}',
          onTap: () => context.go(const InspectionApprovalsRoute().location),
        ),
    ];
  }

  VoidCallback? _seeAllDestination({
    required bool canSeeAlerts,
    required bool canSeeApprovals,
    required bool canSeeTasks,
  }) {
    if (canSeeAlerts) {
      return () => context.push(const AlertsRoute().location);
    }
    if (canSeeApprovals) {
      return () => context.go(const InspectionApprovalsRoute().location);
    }
    if (canSeeTasks) {
      return () => context.push(const TasksRoute().location);
    }
    return null;
  }

  Future<void> _showSite(
    WorkspaceContext? workspace,
    AppLocalizations l10n,
  ) {
    final String site = _workspaceSiteLabel(workspace, l10n);
    final String country = workspace?.activeCountry?.trim().isNotEmpty == true
        ? workspace!.activeCountry!.trim()
        : l10n.valueNotMeasured;
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(site, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text(country, style: Theme.of(context).textTheme.bodyMedium),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showServices(
    List<HomeSectionSpec> sections,
    AppLocalizations l10n,
  ) {
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.72,
          ),
          child: ListView(
            key: HomeScreenKeys.action('servicesSheet'),
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            children: <Widget>[
              Text(
                l10n.homeMenuTooltip,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              for (final HomeSectionSpec section in sections)
                for (final HomeTileSpec tile in section.tiles)
                  ListTile(
                    leading: Icon(_tileMeta(l10n, tile.id).icon),
                    title: Text(_tileMeta(l10n, tile.id).label),
                    trailing: const Icon(
                      // Mirrors itself under RTL (matchTextDirection).
                      Icons.chevron_right_rounded,
                    ),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      _openHomeTile(context, tile.id);
                    },
                  ),
            ],
          ),
        ),
      ),
    );
  }
}

String _scalarCountText(AsyncValue<int> state) => switch (state) {
      AsyncData<int>(:final value) => value > 99 ? '99+' : '$value',
      _ => '—',
    };

/// The site the header chip names.
///
/// A named site wins. With none, an organisation wide scope (`sites` holding
/// the `ALL` sentinel, which V309 backfilled onto every profile) reads as all
/// sites: that person has MORE site reach, not none, so "No site on file"
/// would be the wrong sentence. Only a genuinely empty scope says no site.
String _workspaceSiteLabel(WorkspaceContext? workspace, AppLocalizations l10n) {
  if (workspace == null) return l10n.homeSiteStatUnavailable;
  final String? legacy = workspace.legacySite?.trim();
  if (legacy?.isNotEmpty == true) return legacy!;
  for (final String site in <String>[
    ...workspace.activeSites,
    ...workspace.siteScope.namedSites,
  ]) {
    final String value = site.trim();
    if (value.isNotEmpty &&
        !SiteScope.allSentinels.contains(value.toUpperCase())) {
      return value;
    }
  }
  if (workspace.siteScope.isOrganisationWide) return l10n.homeSiteAllSites;
  return l10n.homeSiteStatUnavailable;
}

String? _nonEmpty(String value) => value.isEmpty ? null : value;

/// Joins the non-blank [parts] with the mock's bullet separator.
String _joinParts(List<String?> parts) => parts
    .whereType<String>()
    .map((String value) => value.trim())
    .where((String value) => value.isNotEmpty)
    .join(' • ');

/// "Just now", "10m ago", "3h ago", "2d ago", then a short date - the same
/// wording the notification inbox already ships in all three locales.
String _relativeTime(
  AppLocalizations l10n,
  BuildContext context,
  DateTime then,
  DateTime now,
) {
  final DateTime local = then.toLocal();
  final Duration diff = now.difference(local);
  final String catalog = l10n.notificationInboxCopyCatalog;
  String count(String key, int value) =>
      _catalogLabel(catalog, key).replaceAll('%count%', '$value');
  if (diff.isNegative || diff.inMinutes < 1) {
    return _catalogLabel(catalog, 'justNow');
  }
  if (diff.inHours < 1) return count('minutesAgo', diff.inMinutes);
  if (diff.inDays < 1) return count('hoursAgo', diff.inHours);
  if (diff.inDays < 7) return count('daysAgo', diff.inDays);
  return MaterialLocalizations.of(context).formatShortDate(local);
}

/// Up to two initials from [fullName]; null when there is no usable name.
String? _initials(String? fullName) {
  final List<String> words = (fullName ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((String word) => word.isNotEmpty)
      .toList(growable: false);
  if (words.isEmpty) return null;
  final String first = words.first.characters.first;
  final String last = words.length > 1 ? words.last.characters.first : '';
  return '$first$last'.toUpperCase();
}

String? _firstName(String? raw) {
  final String value = raw?.trim() ?? '';
  if (value.isEmpty) return null;
  final String first = value.split(RegExp(r'\s+')).first;
  if (first.isEmpty) return null;
  return '${first[0].toUpperCase()}${first.substring(1)}';
}

/// A full-width horizontal band with centred, width-capped content, so a
/// tablet does not stretch the mock's phone layout edge to edge.
class _Band extends StatelessWidget {
  const _Band({
    required this.color,
    required this.padding,
    required this.child,
  });

  final Color color;
  final EdgeInsetsGeometry padding;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: color,
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// The soft, two-layer card shadow Home uses for depth.
///
/// Light mode gets a faint ink-tinted lift; dark mode a deeper black one,
/// because an ink-tinted shadow disappears on a near-black background.
List<BoxShadow> _homeShadow(TpPalette palette, {double lift = 1}) {
  final bool dark = palette.brightness == Brightness.dark;
  final Color ink = dark ? Colors.black : palette.text;
  return <BoxShadow>[
    BoxShadow(
      color: ink.withValues(alpha: (dark ? 0.38 : 0.07) * lift),
      blurRadius: 18 * lift,
      offset: Offset(0, 6 * lift),
    ),
    BoxShadow(
      color: ink.withValues(alpha: dark ? 0.30 : 0.04),
      blurRadius: 2,
      offset: const Offset(0, 1),
    ),
  ];
}

/// A short, staggered fade-and-rise as Home first appears.
///
/// Skipped entirely when the platform asks for reduced motion, so the
/// content is simply there.
class _Entrance extends StatelessWidget {
  const _Entrance({required this.index, required this.child});

  /// Position in the stagger; each step starts a little later.
  final int index;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: 1),
      duration: Duration(milliseconds: 260 + index * 70),
      curve: Curves.easeOutCubic,
      builder: (BuildContext context, double t, Widget? child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, 14 * (1 - t)),
          child: child,
        ),
      ),
      child: child,
    );
  }
}

class _HomeHeader extends StatelessWidget {
  const _HomeHeader({
    required this.l10n,
    required this.workspace,
    required this.now,
    required this.pendingSync,
    required this.notificationCount,
    required this.onSiteTap,
    required this.onNotifications,
  });

  final AppLocalizations l10n;
  final WorkspaceContext? workspace;
  final DateTime now;
  final AsyncValue<int> pendingSync;
  final String notificationCount;
  final VoidCallback onSiteTap;
  final VoidCallback onNotifications;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final int hour = now.hour;
    final String greeting = hour < 12
        ? l10n.homeGoodMorning
        : hour < 17
            ? l10n.homeGoodAfternoon
            : l10n.homeGoodEvening;
    final String? fullName = workspace?.fullName;
    final String name = _firstName(fullName) ?? l10n.homeFallbackUser;
    final String? initials = _initials(fullName);
    final String site = _workspaceSiteLabel(workspace, l10n);
    final String? country = workspace?.activeCountry?.trim();
    final bool showBadge = notificationCount != '—' && notificationCount != '0';

    return Column(
      key: HomeScreenKeys.hero,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            // A gradient ring around the initials gives the avatar the
            // presence of the mock's profile photo without inventing one.
            Container(
              width: 56,
              height: 56,
              padding: const EdgeInsets.all(2.5),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  begin: AlignmentDirectional.topStart,
                  end: AlignmentDirectional.bottomEnd,
                  colors: <Color>[palette.primary, palette.info.base],
                ),
                boxShadow: _homeShadow(palette, lift: 0.6),
              ),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: palette.primarySoft,
                  shape: BoxShape.circle,
                  border: Border.all(color: palette.surface, width: 2),
                ),
                child: initials == null
                    ? Icon(Icons.person_outline_rounded, color: palette.primary)
                    : Text(
                        initials,
                        style: text.titleMedium?.copyWith(
                          color: palette.primary,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    greeting,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodyMedium?.copyWith(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.headlineSmall?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w900,
                      height: 1.15,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            _HeaderIconButton(
              tooltip: l10n.homeNotificationsTooltip,
              onPressed: onNotifications,
              icon: Icons.notifications_none_rounded,
              badge: showBadge ? notificationCount : null,
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: <Widget>[
            Flexible(
              child: _SiteChip(
                site: site,
                country: country,
                onTap: onSiteTap,
              ),
            ),
            const SizedBox(width: 8),
            _HomeSyncStatus(l10n: l10n, pending: pendingSync),
          ],
        ),
      ],
    );
  }
}

/// The notification bell in a rounded, lifted square, as in the mock.
class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.tooltip,
    required this.onPressed,
    required this.icon,
    this.badge,
  });

  final String tooltip;
  final VoidCallback onPressed;
  final IconData icon;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String? badge = this.badge;
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: tooltip,
        child: Material(
          color: palette.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(TpRadius.md),
            side: BorderSide(color: palette.border),
          ),
          child: InkWell(
            onTap: onPressed,
            customBorder: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: SizedBox(
              width: 48,
              height: 48,
              child: Stack(
                clipBehavior: Clip.none,
                alignment: Alignment.center,
                children: <Widget>[
                  Icon(icon, size: 24, color: palette.text),
                  if (badge != null)
                    PositionedDirectional(
                      top: 6,
                      end: 6,
                      child: Container(
                        constraints: const BoxConstraints(minWidth: 18),
                        height: 18,
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: palette.critical.base,
                          borderRadius: BorderRadius.circular(TpRadius.pill),
                          border: Border.all(
                            color: palette.surface,
                            width: 1.5,
                          ),
                        ),
                        child: Text(
                          badge,
                          style: TextStyle(
                            color: palette.critical.onBase,
                            fontSize: 9,
                            height: 1,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
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

/// The active site and country as a tappable pill.
class _SiteChip extends StatelessWidget {
  const _SiteChip({
    required this.site,
    required this.country,
    required this.onTap,
  });

  final String site;
  final String? country;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? style = Theme.of(context).textTheme.labelMedium?.copyWith(
          color: palette.textSecondary,
          fontWeight: FontWeight.w700,
        );
    final String? country = this.country;
    return Material(
      color: palette.surface.withValues(alpha: 0.85),
      shape: StadiumBorder(side: BorderSide(color: palette.border)),
      child: InkWell(
        onTap: onTap,
        customBorder: const StadiumBorder(),
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(8, 6, 12, 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.location_on_rounded,
                size: 16,
                color: palette.primary,
              ),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  site,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: style,
                ),
              ),
              if (country != null && country.isNotEmpty) ...<Widget>[
                Text(
                  '  •  ',
                  style: style?.copyWith(color: palette.textMuted),
                ),
                Flexible(
                  child: Text(
                    country,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: style,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// What the local offline queue knows, and nothing more.
///
/// There is no connectivity provider in this app, so this never says
/// "Online": it says all changes are synced, how many are waiting, or that
/// the queue could not be read.
class _HomeSyncStatus extends StatelessWidget {
  const _HomeSyncStatus({required this.l10n, required this.pending});

  final AppLocalizations l10n;
  final AsyncValue<int> pending;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final (IconData icon, TpStatusColors tone, String label) =
        switch (pending) {
      AsyncData<int>(:final value) when value > 0 => (
          Icons.cloud_upload_outlined,
          palette.info,
          l10n.syncPendingChanges(value),
        ),
      AsyncData<int>() => (
          Icons.cloud_done_rounded,
          palette.ok,
          l10n.syncAllSynced,
        ),
      AsyncError<int>() => (
          Icons.sync_problem_rounded,
          palette.unknown,
          l10n.homeStatUnavailableCaption,
        ),
      _ => (Icons.sync, palette.unknown, l10n.homeStatLoadingCaption),
    };
    return ConstrainedBox(
      key: HomeScreenKeys.syncStatus,
      constraints: const BoxConstraints(maxWidth: 240),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: tone.soft,
          borderRadius: BorderRadius.circular(TpRadius.pill),
        ),
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(8, 6, 10, 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(icon, size: 16, color: tone.base),
              const SizedBox(width: 5),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: tone.onSoft,
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

class _NewInspectionButton extends StatefulWidget {
  const _NewInspectionButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  State<_NewInspectionButton> createState() => _NewInspectionButtonState();
}

class _NewInspectionButtonState extends State<_NewInspectionButton> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed != value) setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool reduceMotion =
        MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final Color deep = Color.lerp(palette.primary, Colors.black, 0.22)!;
    return Semantics(
      button: true,
      label: widget.label,
      excludeSemantics: true,
      child: AnimatedScale(
        scale: _pressed ? 0.98 : 1,
        duration:
            reduceMotion ? Duration.zero : const Duration(milliseconds: 120),
        curve: Curves.easeOut,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(TpRadius.md),
            boxShadow: <BoxShadow>[
              BoxShadow(
                color:
                    palette.primary.withValues(alpha: _pressed ? 0.22 : 0.34),
                blurRadius: _pressed ? 8 : 18,
                offset: Offset(0, _pressed ? 3 : 8),
              ),
            ],
          ),
          child: Material(
            key: HomeScreenKeys.newInspection,
            borderRadius: BorderRadius.circular(TpRadius.md),
            clipBehavior: Clip.antiAlias,
            color: palette.primary,
            child: Ink(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: AlignmentDirectional.topStart,
                  end: AlignmentDirectional.bottomEnd,
                  colors: <Color>[palette.primary, deep],
                ),
              ),
              child: InkWell(
                onTap: widget.onTap,
                onHighlightChanged: _setPressed,
                splashColor: palette.onPrimary.withValues(alpha: 0.12),
                highlightColor: palette.onPrimary.withValues(alpha: 0.06),
                child: SizedBox(
                  height: 68,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            color: palette.onPrimary,
                            shape: BoxShape.circle,
                            boxShadow: <BoxShadow>[
                              BoxShadow(
                                color: deep.withValues(alpha: 0.45),
                                blurRadius: 6,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: Icon(
                            Icons.add_rounded,
                            color: palette.primary,
                            size: 26,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Flexible(
                          child: Text(
                            widget.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .titleLarge
                                ?.copyWith(
                                  color: palette.onPrimary,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 0.2,
                                ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HomeSectionHeader extends StatelessWidget {
  const _HomeSectionHeader({
    required this.title,
    this.action,
    this.onAction,
  });

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    // The action is capped at half the row so a large text scale ellipsises
    // "View all" instead of pushing the button past the screen edge.
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) => Row(
        children: <Widget>[
          Expanded(
            child: Semantics(
              header: true,
              child: Text(
                title,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w800,
                      fontSize: 19,
                    ),
              ),
            ),
          ),
          if (action != null && onAction != null)
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: constraints.maxWidth / 2),
              child: TextButton(
                onPressed: onAction,
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  foregroundColor: palette.primary,
                  padding: const EdgeInsetsDirectional.fromSTEB(10, 4, 4, 4),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Flexible(
                      child: Text(
                        action!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                    ),
                    const Icon(
                      // Mirrors itself under RTL (matchTextDirection).
                      Icons.chevron_right_rounded,
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One timeline row, already resolved from a real source.
class _WorkRowData {
  const _WorkRowData({
    required this.id,
    required this.tone,
    required this.icon,
    required this.tag,
    required this.title,
    required this.detail,
    this.secondary,
    this.time,
    this.timeIsAlert = false,
    this.onTap,
  });

  final String id;
  final TpStatusColors tone;
  final IconData icon;
  final String tag;
  final String title;
  final String detail;
  final String? secondary;
  final String? time;
  final bool timeIsAlert;
  final VoidCallback? onTap;
}

/// The timeline's rows plus what could not be read.
class _TodaysWork {
  const _TodaysWork({
    required this.rows,
    required this.failed,
    required this.loading,
    required this.loadedAny,
    required this.applicable,
    this.accessFailed = false,
    this.onRetryAccess,
    this.onRetry,
  });

  /// True when at least one source answered. "Nothing needs you right now"
  /// is a claim only a source that actually answered can support.
  final bool loadedAny;

  /// False when no work source applies to this role at all.
  final bool applicable;

  /// True when the person's access could not be read. The role-based lists
  /// below are then incomplete, so "nothing for your role" would be untrue.
  final bool accessFailed;

  /// Re-reads the access; null when nothing can retry.
  final VoidCallback? onRetryAccess;

  /// Re-reads the failed sources; null when nothing failed.
  final VoidCallback? onRetry;

  final List<_WorkRowData> rows;

  /// Localised names of the sources whose read failed.
  final List<String> failed;

  /// True while any source is still loading.
  final bool loading;
}

class _TodaysWorkCard extends StatelessWidget {
  const _TodaysWorkCard({required this.work});

  final _TodaysWork work;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final List<_WorkRowData> rows = <_WorkRowData>[
      if (work.accessFailed)
        _WorkRowData(
          id: 'access',
          tone: palette.warning,
          icon: Icons.lock_reset_rounded,
          tag: '',
          title: l10n.homeAccessLoadFailedTitle,
          detail: l10n.homeAccessLoadFailedBody,
          secondary: work.onRetryAccess == null ? null : l10n.actionRetry,
          onTap: work.onRetryAccess,
        ),
      ...work.rows,
      if (work.failed.isNotEmpty)
        _WorkRowData(
          id: 'unavailable',
          tone: palette.unknown,
          icon: Icons.sync_problem_rounded,
          tag: l10n.homeStatUnavailableCaption,
          title: l10n.homeStatUnavailableCaption,
          detail: work.failed.join(' • '),
          secondary: work.onRetry == null ? null : l10n.actionRetry,
          onTap: work.onRetry,
        ),
      if (!work.applicable && !work.accessFailed)
        _WorkRowData(
          id: 'none',
          tone: palette.unknown,
          icon: Icons.info_outline_rounded,
          tag: '',
          title: l10n.homeNothingForRoleTitle,
          detail: '',
        ),
      if (work.rows.isEmpty && work.failed.isEmpty && work.loading)
        _WorkRowData(
          id: 'loading',
          tone: palette.unknown,
          icon: Icons.hourglass_empty_rounded,
          tag: l10n.homeStatLoadingCaption,
          title: l10n.homeStatLoadingCaption,
          detail: '',
        ),
      if (work.rows.isEmpty &&
          work.failed.isEmpty &&
          !work.loading &&
          work.loadedAny)
        _WorkRowData(
          id: 'empty',
          tone: palette.ok,
          icon: Icons.task_alt_rounded,
          tag: '',
          title: l10n.checklistApprovalsEmptyMineTitle,
          detail: '',
        ),
    ];

    return DecoratedBox(
      key: HomeScreenKeys.todaysWork,
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.lg),
        border: Border.all(color: palette.border.withValues(alpha: 0.7)),
        boxShadow: _homeShadow(palette),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(TpRadius.lg),
        child: Column(
          children: <Widget>[
            for (int i = 0; i < rows.length; i++)
              _WorkTimelineRow(
                key: HomeScreenKeys.workRow(rows[i].id),
                data: rows[i],
                isFirst: i == 0,
                isLast: i == rows.length - 1,
                // Status rows (loading, empty, unavailable) carry no tag:
                // the title already says it, and a tag repeating the title
                // is noise.
                showTag: work.rows.contains(rows[i]),
              ),
          ],
        ),
      ),
    );
  }
}

class _WorkTimelineRow extends StatelessWidget {
  const _WorkTimelineRow({
    required this.data,
    required this.isFirst,
    required this.isLast,
    required this.showTag,
    super.key,
  });

  final _WorkRowData data;
  final bool isFirst;
  final bool isLast;
  final bool showTag;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? time = data.time;

    Widget connector(bool visible) => Expanded(
          child: Center(
            child: SizedBox(
              width: 2,
              height: double.infinity,
              child: ColoredBox(
                color: visible ? palette.borderStrong : Colors.transparent,
              ),
            ),
          ),
        );

    return Semantics(
      button: data.onTap != null,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: data.onTap,
          splashColor: data.tone.soft,
          highlightColor: data.tone.soft.withValues(alpha: 0.5),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                SizedBox(
                  width: 72,
                  child: Stack(
                    fit: StackFit.expand,
                    children: <Widget>[
                      Column(
                        children: <Widget>[
                          connector(!isFirst),
                          connector(!isLast),
                        ],
                      ),
                      Center(
                        child: Container(
                          width: 50,
                          height: 50,
                          decoration: BoxDecoration(
                            color: palette.surface,
                            shape: BoxShape.circle,
                          ),
                          padding: const EdgeInsets.all(3),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: data.tone.soft,
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: data.tone.base.withValues(alpha: 0.28),
                                width: 1.5,
                              ),
                            ),
                            child: Icon(
                              data.icon,
                              color: data.tone.base,
                              size: 23,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: isLast
                          ? null
                          : Border(
                              bottom: BorderSide(
                                color: palette.border.withValues(alpha: 0.8),
                              ),
                            ),
                    ),
                    child: Padding(
                      padding: const EdgeInsetsDirectional.fromSTEB(
                        0,
                        14,
                        10,
                        14,
                      ),
                      child: Row(
                        children: <Widget>[
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: <Widget>[
                                if (showTag || time != null) ...<Widget>[
                                  Row(
                                    children: <Widget>[
                                      Expanded(
                                        child: showTag
                                            ? Align(
                                                alignment: AlignmentDirectional
                                                    .centerStart,
                                                child: _StatusTag(
                                                  label: data.tag,
                                                  tone: data.tone,
                                                ),
                                              )
                                            : const SizedBox.shrink(),
                                      ),
                                      if (time != null) ...<Widget>[
                                        const SizedBox(width: 8),
                                        Text(
                                          time,
                                          maxLines: 1,
                                          style: text.labelSmall?.copyWith(
                                            color: data.timeIsAlert
                                                ? data.tone.base
                                                : palette.textMuted,
                                            fontWeight: data.timeIsAlert
                                                ? FontWeight.w800
                                                : FontWeight.w600,
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  const SizedBox(height: 7),
                                ],
                                Text(
                                  data.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: text.titleSmall?.copyWith(
                                    color: palette.text,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15,
                                  ),
                                ),
                                if (data.detail.isNotEmpty) ...<Widget>[
                                  const SizedBox(height: 4),
                                  Text(
                                    data.detail,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.bodySmall?.copyWith(
                                      color: palette.textSecondary,
                                    ),
                                  ),
                                ],
                                if (data.secondary != null) ...<Widget>[
                                  const SizedBox(height: 3),
                                  Text(
                                    data.secondary!,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.bodySmall?.copyWith(
                                      color: palette.textMuted,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          if (data.onTap != null) ...<Widget>[
                            const SizedBox(width: 6),
                            Icon(
                              // Mirrors itself under RTL (matchTextDirection).
                              Icons.chevron_right_rounded,
                              color: palette.textMuted,
                            ),
                          ],
                        ],
                      ),
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

class _StatusTag extends StatelessWidget {
  const _StatusTag({required this.label, required this.tone});

  final String label;
  final TpStatusColors tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tone.soft,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        border: Border.all(color: tone.base.withValues(alpha: 0.18)),
      ),
      child: Text(
        label.toUpperCase(),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: tone.onSoft,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.6,
            ),
      ),
    );
  }
}

class _AccidentCommandShortcut extends StatelessWidget {
  const _AccidentCommandShortcut({required this.l10n, required this.onTap});

  final AppLocalizations l10n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors tone = palette.critical;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TpRadius.md),
        boxShadow: _homeShadow(palette, lift: 0.7),
      ),
      child: Material(
        key: HomeScreenKeys.action('accidents'),
        color: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(color: tone.base.withValues(alpha: 0.22)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          splashColor: tone.soft,
          highlightColor: tone.soft.withValues(alpha: 0.5),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                // The red leading rail marks this as the urgent lane without
                // flooding the whole card in red.
                ColoredBox(color: tone.base, child: const SizedBox(width: 5)),
                Expanded(
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 66),
                    padding:
                        const EdgeInsetsDirectional.fromSTEB(12, 10, 10, 10),
                    child: Row(
                      children: <Widget>[
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: tone.soft,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: tone.base.withValues(alpha: 0.28),
                              width: 1.5,
                            ),
                          ),
                          child: Icon(
                            Icons.car_crash_outlined,
                            color: tone.base,
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              Text(
                                _catalogLabel(
                                  l10n.accidentCopyCatalog,
                                  'dashboardTitle',
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context)
                                    .textTheme
                                    .titleSmall
                                    ?.copyWith(
                                      color: palette.text,
                                      fontWeight: FontWeight.w800,
                                    ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                l10n.homeReportAccidentAction,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context)
                                    .textTheme
                                    .labelMedium
                                    ?.copyWith(
                                      color: tone.base,
                                      fontWeight: FontWeight.w700,
                                    ),
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          // Mirrors itself under RTL (matchTextDirection).
                          Icons.chevron_right_rounded,
                          color: palette.textMuted,
                        ),
                      ],
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

/// Secondary field actions under the timeline. "More" is always present: it
/// is the only Home entry into the full permission-gated module catalogue
/// now that Home no longer draws its own bottom bar.
class _DashboardQuickActions extends StatelessWidget {
  const _DashboardQuickActions({
    required this.l10n,
    required this.canScan,
    required this.canWash,
    required this.canSeeVehicles,
    required this.canReportIssue,
    required this.canReportAccident,
    required this.onScanner,
    required this.onWashing,
    required this.onAsset,
    required this.onReportIssue,
    required this.onAccident,
    required this.onMore,
  });

  final AppLocalizations l10n;
  final bool canScan;
  final bool canWash;
  final bool canSeeVehicles;
  final bool canReportIssue;
  final bool canReportAccident;
  final VoidCallback onScanner;
  final VoidCallback onWashing;
  final VoidCallback onAsset;
  final VoidCallback onReportIssue;
  final VoidCallback onAccident;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    // Each action carries the tone of what it leads to: capture work is
    // blue, fleet records green, a reported fault amber, an accident red,
    // and the catalogue neutral - so the grid scans by colour, not only by
    // reading every label.
    final actions = <({
      String id,
      String label,
      IconData icon,
      TpStatusColors tone,
      VoidCallback onTap,
    })>[
      if (canScan)
        (
          id: 'scanner',
          label: l10n.scannerTitle,
          icon: Icons.qr_code_scanner_rounded,
          tone: palette.info,
          onTap: onScanner,
        ),
      if (canWash)
        (
          id: 'washing',
          label: l10n.tabWashing,
          icon: Icons.local_car_wash_rounded,
          tone: palette.info,
          onTap: onWashing,
        ),
      if (canSeeVehicles)
        (
          id: 'asset',
          label: l10n.homeAssetAction,
          icon: Icons.local_shipping_outlined,
          tone: palette.ok,
          onTap: onAsset,
        ),
      if (canReportIssue)
        (
          id: 'reportIssue',
          label: l10n.homeReportIssueAction,
          icon: Icons.report_gmailerrorred_rounded,
          tone: palette.warning,
          onTap: onReportIssue,
        ),
      if (canReportAccident)
        (
          id: 'accident',
          label: l10n.homeReportAccidentAction,
          icon: Icons.car_crash_outlined,
          tone: palette.critical,
          onTap: onAccident,
        ),
      (
        id: 'more',
        label: l10n.homeMoreAction,
        icon: Icons.apps_rounded,
        tone: palette.neutral,
        onTap: onMore,
      ),
    ];

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int perRow = constraints.maxWidth >= 280 ? 3 : 2;
        final int columns = actions.length < perRow ? actions.length : perRow;
        final double width =
            (constraints.maxWidth - (columns - 1) * 10) / columns;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: <Widget>[
            for (final action in actions)
              SizedBox(
                width: width,
                child: _DashboardActionCard(
                  key: HomeScreenKeys.action(action.id),
                  label: action.label,
                  icon: action.icon,
                  tone: action.tone,
                  onTap: action.onTap,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _DashboardActionCard extends StatelessWidget {
  const _DashboardActionCard({
    required this.label,
    required this.icon,
    required this.tone,
    required this.onTap,
    super.key,
  });

  final String label;
  final IconData icon;
  final TpStatusColors tone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TpRadius.md),
        boxShadow: _homeShadow(palette, lift: 0.6),
      ),
      child: Material(
        color: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(color: palette.border.withValues(alpha: 0.7)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          splashColor: tone.soft,
          highlightColor: tone.soft.withValues(alpha: 0.5),
          child: Container(
            constraints: const BoxConstraints(minHeight: 112),
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: tone.soft,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: tone.base.withValues(alpha: 0.22),
                      width: 1.5,
                    ),
                  ),
                  child: Icon(icon, color: tone.base, size: 21),
                ),
                const SizedBox(height: 12),
                Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: palette.text,
                        height: 1.15,
                        fontWeight: FontWeight.w800,
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

/// The label, icon and colour tone for one tile [id].
///
/// A tile whose [id] is not in the switch below falls back to its raw [id]
/// as the label rather than throwing - this catalogue is `const` and closed
/// (see [_kHomeSections]), so the fallback branch should never be reached in
/// practice, but a silent crash on a typo'd id is worse than a visibly wrong
/// label during development.
({String label, IconData icon, bool approve}) _tileMeta(
  AppLocalizations l10n,
  String id,
) {
  switch (id) {
    case 'inspection':
      return (
        label: l10n.inspectionNewInspection,
        icon: Icons.add_task_rounded,
        approve: false,
      );
    case 'scanner':
      return (
        label: l10n.scannerTitle,
        icon: Icons.qr_code_scanner_rounded,
        approve: false,
      );
    case 'serial':
      return (
        label: l10n.serialSearchTitle,
        icon: Icons.confirmation_number_outlined,
        approve: false,
      );
    case 'meter':
      return (label: l10n.meterLogNavTitle, icon: Icons.speed, approve: false);
    case 'washing':
      return (
        label: l10n.washNavTitle,
        icon: Icons.local_car_wash,
        approve: false,
      );
    case 'tyreChange':
      return (
        label: l10n.tyreReplaceNavTitle,
        icon: Icons.tire_repair_outlined,
        approve: false,
      );
    case 'checklists':
      return (
        label: l10n.checklistsHomeTitle,
        icon: Icons.checklist,
        approve: false,
      );
    case 'checklistHistory':
      return (
        label: l10n.checklistHistoryTitle,
        icon: Icons.history,
        approve: false,
      );
    case 'myPlans':
      return (
        label: l10n.myPlansNavTitle,
        icon: Icons.event_available_outlined,
        // Not an approval queue: this is the crew's OWN work to do, so it must
        // not borrow the approve styling that marks somebody else's work
        // awaiting a signature.
        approve: false,
      );
    case 'reportIssue':
      return (
        label: l10n.homeReportIssueAction,
        icon: Icons.report_problem_outlined,
        approve: false,
      );
    case 'records':
      return (
        label: l10n.recordsTitle,
        icon: Icons.inventory_2_outlined,
        approve: false,
      );
    case 'vehicles':
      return (
        label: l10n.vehiclesTitle,
        icon: Icons.directions_car_outlined,
        approve: false,
      );
    case 'history':
      return (
        label: l10n.inspectionHistoryTitle,
        icon: Icons.manage_search_rounded,
        approve: false,
      );
    case 'alerts':
      return (
        label: _catalogLabel(l10n.alertsCopyCatalog, 'title'),
        icon: Icons.notifications_active_outlined,
        approve: false,
      );
    case 'calendar':
      return (
        label: _catalogLabel(l10n.calendarCopyCatalog, 'title'),
        icon: Icons.calendar_today_outlined,
        approve: false,
      );
    case 'accidents':
      return (
        label: _catalogLabel(l10n.accidentCopyCatalog, 'dashboardTitle'),
        icon: Icons.car_crash_outlined,
        approve: false,
      );
    case 'reportAccident':
      return (
        label: l10n.homeReportAccidentAction,
        icon: Icons.add_a_photo_outlined,
        approve: false,
      );
    case 'workorders':
      return (
        label: l10n.workOrdersNavTitle,
        icon: Icons.build_circle_outlined,
        approve: false,
      );
    case 'rca':
      return (
        label: _catalogLabel(l10n.rcaCopyCatalog, 'title'),
        icon: Icons.account_tree_outlined,
        approve: false,
      );
    case 'tasks':
      return (
        label: _catalogLabel(l10n.tasksCopyCatalog, 'title'),
        icon: Icons.assignment_outlined,
        approve: false,
      );
    case 'stock':
      return (
        label: _catalogLabel(l10n.stockCountCopyCatalog, 'title'),
        icon: Icons.inventory_outlined,
        approve: false,
      );
    case 'pm':
      return (
        label: _catalogLabel(l10n.pmCopyCatalog, 'title'),
        icon: Icons.build_circle_outlined,
        approve: false,
      );
    case 'workshop':
      return (
        label: l10n.loginScopeMaintenanceWorkshop,
        icon: Icons.home_repair_service_outlined,
        approve: false,
      );
    case 'workshopStatus':
      return (
        label: _catalogLabel(l10n.workshopStatusCopyCatalog, 'title'),
        icon: Icons.car_repair_outlined,
        approve: false,
      );
    case 'overview':
      return (
        label: _catalogLabel(l10n.managementCopyCatalog, 'overviewTitle'),
        icon: Icons.dashboard_outlined,
        approve: false,
      );
    case 'reports':
      return (
        label: _catalogLabel(l10n.managementCopyCatalog, 'reportsTitle'),
        icon: Icons.summarize_outlined,
        approve: false,
      );
    case 'analytics':
      return (
        label: _catalogLabel(l10n.managementCopyCatalog, 'analyticsTitle'),
        icon: Icons.analytics_outlined,
        approve: false,
      );
    case 'team':
      return (
        label: _catalogLabel(l10n.managementCopyCatalog, 'teamTitle'),
        icon: Icons.groups_outlined,
        approve: false,
      );
    case 'inspectionApprovals':
      return (
        label: l10n.inspectionApprovalsTitle,
        icon: Icons.done_all,
        approve: true,
      );
    case 'checklistApprovals':
      return (
        label: l10n.checklistApprovalsTitle,
        icon: Icons.fact_check_outlined,
        approve: true,
      );
    default:
      return (label: id, icon: Icons.circle_outlined, approve: false);
  }
}

/// "Your recent inspections": the mock's "Recent assets" strip, from the
/// signed-in user's own latest inspections.
class _RecentAssetsStrip extends StatelessWidget {
  const _RecentAssetsStrip({
    required this.recent,
    required this.onRetry,
    required this.onOpen,
  });

  final AsyncValue<List<HomeRecentAsset>> recent;
  final VoidCallback onRetry;

  /// Opens the asset; null when this role cannot reach asset details, in
  /// which case the cards are not tappable rather than leading to a refusal.
  final void Function(String assetNo)? onOpen;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    Widget statusLine(IconData icon, String label, {VoidCallback? onTap}) {
      return Material(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.lg),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.lg),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: <Widget>[
                Icon(icon, color: palette.textMuted, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    label,
                    style: text.bodyMedium?.copyWith(
                      color: palette.textSecondary,
                    ),
                  ),
                ),
                if (onTap != null)
                  Text(
                    l10n.actionRetry,
                    style: text.labelLarge?.copyWith(
                      color: palette.primary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
              ],
            ),
          ),
        ),
      );
    }

    return KeyedSubtree(
      key: HomeScreenKeys.recentAssets,
      child: switch (recent) {
        AsyncData<List<HomeRecentAsset>>(:final value) => SizedBox(
            height: 150,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              clipBehavior: Clip.none,
              itemCount: value.length,
              separatorBuilder: (BuildContext _, int __) =>
                  const SizedBox(width: 10),
              itemBuilder: (BuildContext context, int index) =>
                  _RecentAssetCard(asset: value[index], onOpen: onOpen),
            ),
          ),
        AsyncError<List<HomeRecentAsset>>() => statusLine(
            Icons.sync_problem_rounded,
            l10n.homeStatUnavailableCaption,
            onTap: onRetry,
          ),
        _ => statusLine(
            Icons.hourglass_empty_rounded,
            l10n.homeStatLoadingCaption,
          ),
      },
    );
  }
}

class _RecentAssetCard extends StatelessWidget {
  const _RecentAssetCard({required this.asset, required this.onOpen});

  final HomeRecentAsset asset;
  final void Function(String assetNo)? onOpen;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? photo = vehiclePhotoAssetFor(
      assetNo: asset.assetNo,
      vehicleType: asset.vehicleType,
    );
    final (TpStatusColors tone, String label) = switch (asset.health) {
      HomeAssetHealth.good => (palette.ok, l10n.tyreConditionGood),
      HomeAssetHealth.attention => (palette.warning, l10n.statusWarning),
      HomeAssetHealth.critical => (palette.critical, l10n.statusCritical),
      HomeAssetHealth.notChecked => (
          palette.unknown,
          l10n.homeAssetNotChecked,
        ),
    };
    final VoidCallback? tap =
        onOpen == null ? null : () => onOpen!(asset.assetNo);

    return SizedBox(
      key: HomeScreenKeys.recentAsset(asset.assetNo),
      width: 118,
      child: Semantics(
        button: tap != null,
        label: '${asset.assetNo}, $label',
        excludeSemantics: true,
        child: Material(
          color: palette.surface,
          borderRadius: BorderRadius.circular(TpRadius.md),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: tap,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(TpRadius.md),
                border: Border.all(color: palette.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Expanded(
                    child: ColoredBox(
                      color: palette.surfaceAlt,
                      child: photo == null
                          ? Icon(
                              Icons.local_shipping_outlined,
                              size: 40,
                              color: palette.primary,
                            )
                          : Padding(
                              padding: const EdgeInsets.all(6),
                              child: Image.asset(
                                photo,
                                fit: BoxFit.contain,
                                filterQuality: FilterQuality.medium,
                                errorBuilder: (
                                  BuildContext _,
                                  Object __,
                                  StackTrace? ___,
                                ) =>
                                    Icon(
                                  Icons.local_shipping_outlined,
                                  size: 40,
                                  color: palette.primary,
                                ),
                              ),
                            ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          asset.assetNo,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: text.titleSmall?.copyWith(
                            color: palette.text,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: <Widget>[
                            DecoratedBox(
                              decoration: BoxDecoration(
                                color: tone.base,
                                shape: BoxShape.circle,
                              ),
                              child: const SizedBox(width: 8, height: 8),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: text.labelMedium?.copyWith(
                                  color: tone.onSoft,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
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

String _catalogLabel(String catalog, String key) {
  for (final String entry in catalog.split('~')) {
    final int separator = entry.indexOf('=');
    if (separator <= 0 || entry.substring(0, separator) != key) continue;
    return entry.substring(separator + 1);
  }
  return key;
}

/// Routes a tap on tile [id] to its destination.
///
/// See this file's own library comment, "Navigation: push within Home's own
/// branch, `go` across a branch", for why each [id] takes the navigation
/// method it does.
void _openHomeTile(BuildContext context, String id) {
  switch (id) {
    case 'inspection':
      context.go(const NewInspectionRoute().location);
      return;
    case 'scanner':
      context.push(const ScannerRoute().location);
      return;
    case 'serial':
      context.push(const SerialSearchRoute().location);
      return;
    case 'records':
      context.push(const TyreRecordsRoute().location);
      return;
    case 'vehicles':
      context.push(const VehiclesRoute().location);
      return;
    case 'history':
      context.go(const ActivityHistoryRoute().location);
      return;
    case 'alerts':
      context.push(const AlertsRoute().location);
      return;
    case 'calendar':
      context.push(const CalendarRoute().location);
      return;
    case 'reportIssue':
      context.push(const ReportIssueRoute().location);
      return;
    case 'accidents':
      context.go(const AccidentDashboardRoute().location);
      return;
    case 'reportAccident':
      context.push(const AccidentReportRoute().location);
      return;
    case 'workorders':
      context.push(const WorkOrdersRoute().location);
      return;
    case 'rca':
      context.push(const RcaRoute().location);
      return;
    case 'tasks':
      context.push(const TasksRoute().location);
      return;
    case 'stock':
      context.push(const StockCountRoute().location);
      return;
    case 'pm':
      context.push(const PreventiveMaintenanceRoute().location);
      return;
    case 'workshop':
      context.push(const WorkshopRoute().location);
      return;
    case 'workshopStatus':
      context.push(const WorkshopStatusRoute().location);
      return;
    case 'overview':
      context.push(const OverviewRoute().location);
      return;
    case 'reports':
      context.push(const ReportsRoute().location);
      return;
    case 'analytics':
      context.push(const AnalyticsRoute().location);
      return;
    case 'team':
      context.push(const TeamRoute().location);
      return;
    case 'checklistApprovals':
      context.push(const ChecklistApprovalsRoute().location);
      return;
    case 'tyreChange':
      context.push(const TyreChangeRoute().location);
      return;
    case 'meter':
      context.go(const MeterLogRoute().location);
      return;
    case 'washing':
      context.go(const WashingRoute().location);
      return;
    case 'checklists':
      context.go(const ChecklistsRoute().location);
      return;
    case 'checklistHistory':
      context.go(const ChecklistHistoryRoute().location);
      return;
    case 'myPlans':
      context.go(const MyPlansRoute().location);
      return;
    case 'inspectionApprovals':
      context.go(const InspectionApprovalsRoute().location);
      return;
  }
}

class _SummaryTileData {
  const _SummaryTileData({
    required this.id,
    required this.icon,
    required this.tone,
    required this.label,
    required this.value,
    this.note,
    this.onTap,
  });

  final String id;
  final IconData icon;
  final TpStatusColors tone;
  final String label;
  final String value;

  /// "Checking" or "Could not check" when the value is not a measurement.
  final String? note;
  final VoidCallback? onTap;
}

/// Mock 10's "Operational summary": two tiles a row on a phone, four on a
/// tablet. Each tile is one real count and opens where that count lives.
class _OperationalSummary extends StatelessWidget {
  const _OperationalSummary({required this.tiles});

  final List<_SummaryTileData> tiles;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      key: HomeScreenKeys.summary,
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth >= 560 ? 4 : 2;
        const double gap = 10;
        final double width =
            (constraints.maxWidth - gap * (columns - 1)) / columns;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: <Widget>[
            for (final _SummaryTileData tile in tiles)
              SizedBox(width: width, child: _SummaryTile(tile: tile)),
          ],
        );
      },
    );
  }
}

class _SummaryTile extends StatelessWidget {
  const _SummaryTile({required this.tile});

  final _SummaryTileData tile;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? note = tile.note;
    return Semantics(
      button: tile.onTap != null,
      label:
          <String>[tile.label, tile.value, if (note != null) note].join(', '),
      excludeSemantics: true,
      child: Material(
        key: HomeScreenKeys.summaryTile(tile.id),
        color: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.lg),
          side: BorderSide(color: palette.border),
        ),
        child: InkWell(
          onTap: tile.onTap,
          customBorder: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(TpRadius.lg),
          ),
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(minHeight: TpSizing.minTouchTarget),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Container(
                        width: 36,
                        height: 36,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: tile.tone.soft,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(tile.icon, size: 20, color: tile.tone.base),
                      ),
                      const Spacer(),
                      if (tile.onTap != null)
                        Icon(
                          // Mirrors itself under RTL (matchTextDirection).
                          Icons.chevron_right_rounded,
                          size: 20,
                          color: palette.textMuted,
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    tile.value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.headlineSmall?.copyWith(
                      color: tile.tone.base,
                      fontWeight: FontWeight.w900,
                      height: 1.1,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    tile.label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: text.labelMedium?.copyWith(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (note != null)
                    Text(
                      note,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          text.labelSmall?.copyWith(color: palette.textMuted),
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
