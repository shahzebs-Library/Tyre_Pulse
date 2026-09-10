/// The Home branch root - the real Home hub.
///
/// # Replaces the earlier stopgap, deliberately, not by extension
///
/// The screen this file used to hold was a single Work-Orders tile plus a
/// dashed "nothing available" fallback, and its own library comment already
/// said what it was: "a deliberately minimal, single-tile placeholder ...
/// not the eventual Home hub design", closing with "A LATER Home phase
/// should REPLACE this screen builder entirely - not extend it - once a
/// real design exists." This is that replacement.
///
/// # What was verified before this was written
///
/// The production React Native app's own Home screen,
/// `mobile/app/(app)/index.tsx`, was read in full and is the behavioural
/// spec this mirrors: a greeting header, a primary "Start Inspection" call
/// to action, a Scan shortcut, a small stats row, and access-gated quick
/// actions grouped into labelled operational sections. The presentation is
/// responsive rather than a fixed square grid: action names wrap in full and
/// the sections become one, two or three columns only when their available
/// width can carry them without clipping.
///
/// The catalogue below contains every permission-gated module that currently
/// has a concrete Flutter destination. It intentionally exposes the complete
/// PMV surface through More, including accident reporting and case control.
/// Registry-only modules with no implemented screen remain excluded so a Home
/// control can never lead to a placeholder.
///
/// `InspectionHistoryScreen` ("My Inspections") is a further, sharper case:
/// `features/inspections/inspections_screen_registrations.dart`'s own
/// library comment states it "deliberately has NO entry here: it is
/// reached from inside `NewInspectionScreen` by an ordinary `Navigator`
/// push", i.e. it is reachable only as a step inside the New Inspection
/// flow, never as an independent destination - so it is not a Home tile
/// either, by the same rule as `tyreChange` above.
///
/// # Navigation: push within Home's own branch, `go` across a branch
///
/// `TpShell.destinations` (`app/router/shell_tabs.dart`) declares NINE
/// branches: `home`, `newInspection`, `inspectionApprovals`,
/// `accidentDashboard`, `meterLog`, `washing`, `activityHistory`,
/// `checklists`, `profile`. A routeId that owns one of those branches is
/// reached with `context.go(...)` - the same choice
/// `vehicle_detail_screen.dart`'s own `_startInspection` makes for exactly
/// this reason, quoted by the earlier stopgap screen's own comment: it
/// "genuinely crosses from branch 0 into branch 1". A routeId with NO
/// branch of its own - `serialSearch`, `tyreRecords`, `vehicles`,
/// `workOrders`, `checklistApprovals`, `scanner`, `tyreChange` - is nested
/// inside Home's OWN branch (0), the same shape `WorkOrdersRoute` had in the
/// stopgap this file replaces, and is reached with `context.push(...)` so
/// Home stays on the stack underneath it with real history.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_copy.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/home/home_layout.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_deps.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_navigation.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/domain/task_board.dart';
import 'package:tyre_pulse/features/tasks/presentation/tasks_copy.dart';

/// Real local time in production; overridden for deterministic header goldens.
final homeHeaderClockProvider = Provider<DateTime Function()>(
  (Ref ref) => DateTime.now,
);

/// Stable finders for Home's responsive visual regions.
@visibleForTesting
abstract final class HomeScreenKeys {
  static const Key hero = Key('home.hero');
  static const Key pmvHero = Key('home.pmv.hero');
  static const Key pmvHeroImage = Key('home.pmv.hero.image');
  static const Key stats = Key('home.stats');
  static const Key darkDashboard = Key('home.dark.dashboard');
  static const Key darkJobs = Key('home.dark.jobs');

  static Key section(String id) => Key('home.section.$id');

  static Key action(String id) => Key('home.action.$id');
}

/// The tile catalogue this screen renders, filtered by [visibleHomeSections].
///
/// `const`, and deliberately declared ONCE at file scope rather than rebuilt
/// per frame - it carries no `BuildContext` and nothing here changes at
/// runtime; only which of its entries survive the access filter does.
const List<HomeSectionSpec> _kHomeSections = <HomeSectionSpec>[
  HomeSectionSpec(
    id: 'field',
    tiles: <HomeTileSpec>[
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
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool canInspect = ref.watch(
      canAccessModuleProvider(ModuleKey.inspect),
    );
    final bool canScan = ref.watch(
      canAccessModuleProvider(ModuleKey.scan),
    );
    final bool canSeeVehicles = ref.watch(
      canAccessModuleProvider(ModuleKey.vehicles),
    );
    final bool canSeeApprovals = ref.watch(
      canAccessModuleProvider(ModuleKey.approvals),
    );
    final bool canSeeAlerts = ref.watch(
      canAccessModuleProvider(ModuleKey.alerts),
    );
    final bool canSeeTasks = ref.watch(
      canAccessModuleProvider(ModuleKey.tasks),
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
    final String? fullName = workspace?.fullName;
    final AsyncValue<List<InspectionApprovalItem>>? approvals = canSeeApprovals
        ? ref.watch(homePendingInspectionApprovalsProvider)
        : null;
    final AsyncValue<List<TyreAlert>>? alerts =
        canSeeAlerts ? ref.watch(tyreAlertsProvider) : null;
    final AsyncValue<List<TaskItem>>? tasks =
        canSeeTasks ? ref.watch(homeTaskPreviewProvider) : null;
    final AsyncValue<int> notificationCount =
        ref.watch(unreadNotificationsCountProvider);

    if (Theme.of(context).brightness == Brightness.dark) {
      return _DarkHomeDashboard(
        l10n: l10n,
        scrollController: _scrollController,
        fullName: fullName,
        approvals: approvals,
        alerts: alerts,
        tasks: tasks,
        notificationCount: _scalarCountText(notificationCount),
        canInspect: canInspect,
        canSeeVehicles: canSeeVehicles,
        canSeeAlerts: canSeeAlerts,
        onNotifications: () =>
            context.push(const NotificationsRoute().location),
        onApprovals: canSeeApprovals
            ? () => context.go(const InspectionApprovalsRoute().location)
            : null,
        onAlerts: canSeeAlerts
            ? () => context.push(const AlertsRoute().location)
            : null,
        onTasks: canSeeTasks
            ? () => context.push(const TasksRoute().location)
            : null,
        onAssets: canSeeVehicles
            ? () => context.push(const VehiclesRoute().location)
            : null,
        onInspect: canInspect
            ? () => context.go(const NewInspectionRoute().location)
            : null,
        onScanner:
            canScan ? () => context.push(const ScannerRoute().location) : null,
        onHome: _scrollToTop,
        onMore: () => _showServices(sections, l10n),
      );
    }

    return TpScaffold(
      backgroundColor: TpPalette.of(context).surface,
      appBar: _HomeDashboardAppBar(
        l10n: l10n,
        alertCount: _scalarCountText(notificationCount),
        onMenu: () => _showServices(sections, l10n),
        onAlerts: () => context.push(const NotificationsRoute().location),
      ),
      bottomNavigationBar: _HomeDashboardNavigation(
        l10n: l10n,
        canInspect: canInspect,
        canSeeTasks: canSeeTasks,
        canSeeAlerts: canSeeAlerts,
        onHome: _scrollToTop,
        onMyWork: () => context.push(const TasksRoute().location),
        onInspect: () => context.go(const NewInspectionRoute().location),
        onAlerts: () => context.push(const AlertsRoute().location),
        onMore: () => _showServices(sections, l10n),
      ),
      body: ListView(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        children: <Widget>[
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _DashboardGreeting(
                    l10n: l10n,
                    fullName: fullName,
                    workspace: workspace,
                    onSiteTap: () => _showSite(workspace, l10n),
                  ),
                  const SizedBox(height: 14),
                  _PmvOperationsHero(
                    l10n: l10n,
                    onTap: canScan
                        ? () => context.push(const ScannerRoute().location)
                        : null,
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    height: 42,
                    child: _DashboardSearchField(
                      hint: l10n.homeSearchAssetsHint,
                      onSubmitted: _openAssetSearch,
                    ),
                  ),
                  if (canSeeAccidents) ...<Widget>[
                    const SizedBox(height: 12),
                    _AccidentCommandShortcut(
                      l10n: l10n,
                      onTap: () => context.go(
                        const AccidentDashboardRoute().location,
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  _AttentionRow(
                    l10n: l10n,
                    approvals: approvals,
                    tasks: tasks,
                    alerts: alerts,
                    onViewAll: _attentionDestination(
                      canSeeAlerts: canSeeAlerts,
                      canSeeApprovals: canSeeApprovals,
                      canSeeTasks: canSeeTasks,
                    ),
                    onApprovals: canSeeApprovals
                        ? () => context.go(
                              const InspectionApprovalsRoute().location,
                            )
                        : null,
                    onTasks: canSeeTasks
                        ? () => context.push(const TasksRoute().location)
                        : null,
                    onAlerts: canSeeAlerts
                        ? () => context.push(const AlertsRoute().location)
                        : null,
                  ),
                  const SizedBox(height: 14),
                  _TyreIssuePreview(
                    l10n: l10n,
                    alerts: alerts,
                    onOpen: canSeeAlerts
                        ? () => context.push(const AlertsRoute().location)
                        : null,
                  ),
                  const SizedBox(height: 20),
                  _HomeSectionHeader(title: l10n.homeMyWork),
                  const SizedBox(height: 10),
                  _MyWorkPreview(
                    l10n: l10n,
                    tasks: tasks,
                    assigneeId: workspace?.userId,
                    assigneeName: fullName,
                    onOpen: canSeeTasks
                        ? () => context.push(const TasksRoute().location)
                        : null,
                  ),
                  const SizedBox(height: 14),
                  _HomeSectionHeader(title: l10n.homeQuickActions),
                  const SizedBox(height: 10),
                  _DashboardQuickActions(
                    l10n: l10n,
                    canSeeVehicles: canSeeVehicles,
                    canReportIssue: canReportIssue,
                    canReportAccident: canReportAccident,
                    onAsset: () => context.push(const VehiclesRoute().location),
                    onReportIssue: () =>
                        context.push(const ReportIssueRoute().location),
                    onAccident: () =>
                        context.push(const AccidentReportRoute().location),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  VoidCallback? _attentionDestination({
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

  void _scrollToTop() {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      0,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  void _openAssetSearch(String raw) {
    final String query = raw.trim();
    context.push(
      VehiclesRoute(assetNo: query.isEmpty ? null : AssetNo(query)).location,
    );
  }

  Future<void> _openGlobalSearch() {
    final workspace = ref.read(workspaceContextProvider);
    return openGlobalSearch(
      context,
      canRestore: () =>
          mounted &&
          workspace != null &&
          ref.read(workspaceContextProvider) == workspace &&
          ref.read(globalSearchModulesProvider).isNotEmpty,
    );
  }

  Future<void> _showSite(
    WorkspaceContext? workspace,
    AppLocalizations l10n,
  ) {
    final String site =
        _workspaceSiteLabel(workspace) ?? l10n.homeSiteStatUnavailable;
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
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            children: <Widget>[
              Text(
                l10n.homeMenuTooltip,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Consumer(
                builder: (context, ref, child) {
                  if (!ref.watch(canAccessModuleProvider(ModuleKey.admin))) {
                    return const SizedBox.shrink();
                  }
                  return ListTile(
                    leading: const Icon(Icons.admin_panel_settings_outlined),
                    title: Text(AdminCopy(context).title),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      this.context.push(const AdminConsoleRoute().location);
                    },
                  );
                },
              ),
              Consumer(
                builder: (context, ref, child) {
                  if (ref.watch(globalSearchModulesProvider).isEmpty) {
                    return const SizedBox.shrink();
                  }
                  return ListTile(
                    key: const Key('home.globalSearch'),
                    leading: const Icon(Icons.search_rounded),
                    title: Text(l10n.globalSearchTitle),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      _openGlobalSearch();
                    },
                  );
                },
              ),
              for (final HomeSectionSpec section in sections)
                for (final HomeTileSpec tile in section.tiles)
                  ListTile(
                    leading: Icon(_tileMeta(l10n, tile.id).icon),
                    title: Text(_tileMeta(l10n, tile.id).label),
                    trailing: const Icon(Icons.chevron_right_rounded),
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

String _countText<T>(
  AsyncValue<List<T>>? state, {
  required int cap,
  required bool Function(T item) where,
}) {
  if (state == null) return '—';
  return switch (state) {
    AsyncData<List<T>>(:final value) => () {
        final int count = value.where(where).length;
        return value.length >= cap ? '$count+' : '$count';
      }(),
    _ => '—',
  };
}

String _scalarCountText(AsyncValue<int> state) => switch (state) {
      AsyncData<int>(:final value) => value > 99 ? '99+' : '$value',
      _ => '—',
    };

List<T>? _asyncItems<T>(AsyncValue<List<T>>? state) => switch (state) {
      AsyncData<List<T>>(:final value) => value,
      _ => null,
    };

bool _isOverdueTask(TaskItem task) {
  final DateTime? due = task.dueDate;
  return !isTaskCompleted(task) && due != null && due.isBefore(DateTime.now());
}

String? _workspaceSiteLabel(WorkspaceContext? workspace) {
  if (workspace == null) return null;
  final String? legacy = workspace.legacySite?.trim();
  if (legacy?.isNotEmpty == true) return legacy;
  for (final String site in <String>[
    ...workspace.activeSites,
    ...workspace.siteScope.namedSites,
  ]) {
    final String value = site.trim();
    if (value.isNotEmpty) return value;
  }
  return null;
}

/// Night-shift rendering of the approved dark Dashboard mock. It deliberately
/// consumes the same verified providers as the light Home dashboard; only the
/// information hierarchy changes with the theme.
class _DarkHomeDashboard extends StatelessWidget {
  const _DarkHomeDashboard({
    required this.l10n,
    required this.scrollController,
    required this.fullName,
    required this.approvals,
    required this.alerts,
    required this.tasks,
    required this.notificationCount,
    required this.canInspect,
    required this.canSeeVehicles,
    required this.canSeeAlerts,
    required this.onNotifications,
    required this.onApprovals,
    required this.onAlerts,
    required this.onTasks,
    required this.onAssets,
    required this.onInspect,
    required this.onScanner,
    required this.onHome,
    required this.onMore,
  });

  final AppLocalizations l10n;
  final ScrollController scrollController;
  final String? fullName;
  final AsyncValue<List<InspectionApprovalItem>>? approvals;
  final AsyncValue<List<TyreAlert>>? alerts;
  final AsyncValue<List<TaskItem>>? tasks;
  final String notificationCount;
  final bool canInspect;
  final bool canSeeVehicles;
  final bool canSeeAlerts;
  final VoidCallback onNotifications;
  final VoidCallback? onApprovals;
  final VoidCallback? onAlerts;
  final VoidCallback? onTasks;
  final VoidCallback? onAssets;
  final VoidCallback? onInspect;
  final VoidCallback? onScanner;
  final VoidCallback onHome;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpScaffold(
      key: HomeScreenKeys.darkDashboard,
      backgroundColor: palette.background,
      bottomNavigationBar: _DarkHomeNavigation(
        l10n: l10n,
        canInspect: canInspect,
        canSeeVehicles: canSeeVehicles,
        canSeeAlerts: canSeeAlerts,
        onAssets: onAssets,
        onInspect: onInspect,
        onAlerts: onAlerts,
        onHome: onHome,
        onMore: onMore,
      ),
      body: SafeArea(
        bottom: false,
        child: ListView(
          controller: scrollController,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 18),
          children: <Widget>[
            _DarkDashboardHeader(
              l10n: l10n,
              fullName: fullName,
              notificationCount: notificationCount,
              onNotifications: onNotifications,
            ),
            const SizedBox(height: 14),
            _PmvOperationsHero(
              l10n: l10n,
              onTap: onScanner,
            ),
            const SizedBox(height: 16),
            _DarkMetricsGrid(
              l10n: l10n,
              approvals: approvals,
              alerts: alerts,
              tasks: tasks,
              onApprovals: onApprovals,
              onAlerts: onAlerts,
              onTasks: onTasks,
            ),
            const SizedBox(height: 16),
            _HomeSectionHeader(
              title: l10n.homeMyWork,
              action: l10n.homeViewAll,
              onAction: onTasks,
            ),
            const SizedBox(height: 6),
            _DarkJobsList(
              l10n: l10n,
              tasks: tasks,
              onOpen: onTasks,
            ),
          ],
        ),
      ),
    );
  }
}

class _DarkDashboardHeader extends ConsumerWidget {
  const _DarkDashboardHeader({
    required this.l10n,
    required this.fullName,
    required this.notificationCount,
    required this.onNotifications,
  });

  final AppLocalizations l10n;
  final String? fullName;
  final String notificationCount;
  final VoidCallback onNotifications;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DateTime now = ref.watch(homeHeaderClockProvider)();
    final TpPalette palette = TpPalette.of(context);
    final List<String> brandWords = l10n.appTitle.trim().split(
          RegExp(r'\s+'),
        );
    final String brandAccent = brandWords.isEmpty ? '' : brandWords.last;
    final String brandLead = brandWords.length < 2
        ? ''
        : brandWords.take(brandWords.length - 1).join(' ');
    final String name = fullName?.trim().isNotEmpty == true
        ? fullName!.trim()
        : l10n.homeFallbackUser;
    final String greeting = now.hour < 12
        ? l10n.homeGoodMorning
        : now.hour < 17
            ? l10n.homeGoodAfternoon
            : l10n.homeGoodEvening;
    final int? numericCount = int.tryParse(
      notificationCount.replaceAll('+', ''),
    );
    final bool showBadge = numericCount != null && numericCount > 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text.rich(
                TextSpan(
                  children: <InlineSpan>[
                    if (brandLead.isNotEmpty)
                      TextSpan(
                        text: '${brandLead.toUpperCase()} ',
                        style: TextStyle(color: palette.text),
                      ),
                    TextSpan(
                      text: brandAccent.toUpperCase(),
                      style: TextStyle(color: palette.primary),
                    ),
                  ],
                ),
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontStyle: FontStyle.italic,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.5,
                    ),
              ),
            ),
            IconButton(
              tooltip: l10n.homeNotificationsTooltip,
              onPressed: onNotifications,
              icon: Badge(
                isLabelVisible: showBadge,
                label: Text(notificationCount),
                child: const Icon(Icons.notifications_none_rounded),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: <Widget>[
            CircleAvatar(
              radius: 22,
              backgroundColor: palette.primarySoft,
              foregroundColor: palette.primary,
              child: const Icon(Icons.person_outline_rounded),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    greeting,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: palette.textSecondary,
                        ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          MaterialLocalizations.of(context).formatFullDate(now),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.textSecondary,
              ),
        ),
      ],
    );
  }
}

class _DarkMetricsGrid extends StatelessWidget {
  const _DarkMetricsGrid({
    required this.l10n,
    required this.approvals,
    required this.alerts,
    required this.tasks,
    required this.onApprovals,
    required this.onAlerts,
    required this.onTasks,
  });

  final AppLocalizations l10n;
  final AsyncValue<List<InspectionApprovalItem>>? approvals;
  final AsyncValue<List<TyreAlert>>? alerts;
  final AsyncValue<List<TaskItem>>? tasks;
  final VoidCallback? onApprovals;
  final VoidCallback? onAlerts;
  final VoidCallback? onTasks;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      key: HomeScreenKeys.stats,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      mainAxisSpacing: 6,
      crossAxisSpacing: 6,
      childAspectRatio: 2.25,
      children: <Widget>[
        _DarkMetricCard(
          value: _countText<InspectionApprovalItem>(
            approvals,
            cap: 100,
            where: (_) => true,
          ),
          label: l10n.homeApprovalsMetric,
          colors: const <Color>[Color(0xFFB91C1C), Color(0xFF7F1D1D)],
          onTap: onApprovals,
        ),
        _DarkMetricCard(
          value: _countText<TyreAlert>(
            alerts,
            cap: 300,
            where: (TyreAlert alert) => alert.isCritical,
          ),
          label: l10n.homeCriticalMetric,
          colors: const <Color>[Color(0xFFB56B00), Color(0xFF7C4300)],
          onTap: onAlerts,
        ),
        _DarkMetricCard(
          value: _countText<TaskItem>(
            tasks,
            cap: 100,
            where: _isOverdueTask,
          ),
          label: l10n.homeOverdueMetric,
          colors: const <Color>[Color(0xFF17457B), Color(0xFF102F57)],
          onTap: onTasks,
        ),
        _DarkMetricCard(
          value: _countText<TaskItem>(
            tasks,
            cap: 100,
            where: (TaskItem task) => !isTaskCompleted(task),
          ),
          label: l10n.workOrdersNavTitle,
          colors: const <Color>[Color(0xFF176B34), Color(0xFF104923)],
          onTap: onTasks,
        ),
      ],
    );
  }
}

class _DarkMetricCard extends StatelessWidget {
  const _DarkMetricCard({
    required this.value,
    required this.label,
    required this.colors,
    required this.onTap,
  });

  final String value;
  final String label;
  final List<Color> colors;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(TpRadius.sm),
      clipBehavior: Clip.antiAlias,
      child: Ink(
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: colors),
          borderRadius: BorderRadius.circular(TpRadius.sm),
        ),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(13, 8, 10, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Text(
                  value,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        color: Colors.white,
                        height: 1,
                        fontWeight: FontWeight.w900,
                      ),
                ),
                const SizedBox(height: 5),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
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

class _DarkJobsList extends StatelessWidget {
  const _DarkJobsList({
    required this.l10n,
    required this.tasks,
    required this.onOpen,
  });

  final AppLocalizations l10n;
  final AsyncValue<List<TaskItem>>? tasks;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final List<TaskItem>? loaded = _asyncItems(tasks);
    final List<TaskItem> items = loaded
            ?.where((TaskItem item) => !isTaskCompleted(item))
            .take(3)
            .toList(growable: false) ??
        const <TaskItem>[];
    final TpPalette palette = TpPalette.of(context);

    if (loaded == null || items.isEmpty) {
      return Container(
        key: HomeScreenKeys.darkJobs,
        constraints: const BoxConstraints(minHeight: 74),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: palette.surfaceAlt,
          borderRadius: BorderRadius.circular(TpRadius.sm),
          border: Border.all(color: palette.border),
        ),
        alignment: AlignmentDirectional.centerStart,
        child: Text(
          loaded == null
              ? l10n.homeStatUnavailableCaption
              : l10n.homeNoUrgentWorkTitle,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: palette.textSecondary,
              ),
        ),
      );
    }

    return Container(
      key: HomeScreenKeys.darkJobs,
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        border: Border.all(color: palette.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: <Widget>[
          for (int index = 0; index < items.length; index++) ...<Widget>[
            _DarkJobRow(task: items[index], onTap: onOpen),
            if (index != items.length - 1)
              Divider(height: 1, color: palette.border),
          ],
        ],
      ),
    );
  }
}

class _DarkJobRow extends StatelessWidget {
  const _DarkJobRow({required this.task, required this.onTap});

  final TaskItem task;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final DateTime? due = task.dueDate;
    final String supporting = <String?>[task.assetNo, task.description]
        .whereType<String>()
        .where((String value) => value.trim().isNotEmpty)
        .join(' • ');
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 62),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          child: Row(
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: palette.surfaceSunken,
                  borderRadius: BorderRadius.circular(7),
                ),
                alignment: Alignment.center,
                child: Icon(
                  Icons.local_shipping_outlined,
                  color: palette.primary,
                  size: 23,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      task.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: palette.text,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    if (supporting.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 2),
                      Text(
                        supporting,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: palette.textSecondary,
                            ),
                      ),
                    ],
                  ],
                ),
              ),
              if (due != null) ...<Widget>[
                const SizedBox(width: 8),
                Text(
                  MaterialLocalizations.of(context).formatTimeOfDay(
                    TimeOfDay.fromDateTime(due.toLocal()),
                  ),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.textSecondary,
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

class _DarkHomeNavigation extends StatelessWidget {
  const _DarkHomeNavigation({
    required this.l10n,
    required this.canInspect,
    required this.canSeeVehicles,
    required this.canSeeAlerts,
    required this.onAssets,
    required this.onInspect,
    required this.onAlerts,
    required this.onHome,
    required this.onMore,
  });

  final AppLocalizations l10n;
  final bool canInspect;
  final bool canSeeVehicles;
  final bool canSeeAlerts;
  final VoidCallback? onAssets;
  final VoidCallback? onInspect;
  final VoidCallback? onAlerts;
  final VoidCallback onHome;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.background,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 66,
          child: Row(
            children: <Widget>[
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.home_rounded,
                  label: l10n.homeNavTitle,
                  selected: true,
                  onTap: onHome,
                ),
              ),
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.directions_car_outlined,
                  label: l10n.homeAssetAction,
                  onTap: canSeeVehicles ? onAssets : null,
                ),
              ),
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.add_rounded,
                  label: l10n.homeInspectAction,
                  raised: true,
                  onTap: canInspect ? onInspect : null,
                ),
              ),
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.notifications_none_rounded,
                  label: l10n.homeAlertsAction,
                  onTap: canSeeAlerts ? onAlerts : null,
                ),
              ),
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.menu_rounded,
                  label: l10n.homeMoreAction,
                  onTap: onMore,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeDashboardAppBar extends StatelessWidget
    implements PreferredSizeWidget {
  const _HomeDashboardAppBar({
    required this.l10n,
    required this.alertCount,
    required this.onMenu,
    required this.onAlerts,
  });

  final AppLocalizations l10n;
  final String alertCount;
  final VoidCallback onMenu;
  final VoidCallback? onAlerts;

  @override
  Size get preferredSize => const Size.fromHeight(54);

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool showBadge = alertCount != '—' && alertCount != '0';
    return AppBar(
      toolbarHeight: 54,
      automaticallyImplyLeading: false,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      backgroundColor: palette.surface,
      foregroundColor: palette.text,
      leadingWidth: 52,
      leading: IconButton(
        tooltip: l10n.homeMenuTooltip,
        onPressed: onMenu,
        icon: const Icon(Icons.menu_rounded, size: 22),
      ),
      titleSpacing: 0,
      title: Text(
        l10n.appTitle,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w800,
            ),
      ),
      actions: <Widget>[
        IconButton(
          tooltip: l10n.homeNotificationsTooltip,
          onPressed: onAlerts,
          icon: Stack(
            clipBehavior: Clip.none,
            children: <Widget>[
              const Icon(Icons.notifications_none_rounded, size: 23),
              if (showBadge)
                PositionedDirectional(
                  top: -5,
                  end: -7,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 16),
                    height: 16,
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    decoration: BoxDecoration(
                      color: palette.critical.base,
                      borderRadius: BorderRadius.circular(TpRadius.pill),
                      border: Border.all(color: palette.surface, width: 1.5),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      alertCount,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 8,
                        height: 1,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(width: 4),
      ],
    );
  }
}

class _DashboardSearchField extends StatelessWidget {
  const _DashboardSearchField({
    required this.hint,
    required this.onSubmitted,
  });

  final String hint;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TextField(
      textInputAction: TextInputAction.search,
      onSubmitted: onSubmitted,
      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: palette.text,
            fontWeight: FontWeight.w600,
          ),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: palette.textMuted,
              fontWeight: FontWeight.w500,
            ),
        prefixIcon: Icon(Icons.search_rounded, color: palette.textSecondary),
        filled: true,
        fillColor: palette.surfaceAlt,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TpRadius.sm),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TpRadius.sm),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(TpRadius.sm),
          borderSide: BorderSide(
            color: palette.primary,
            width: TpBorderWidth.strong,
          ),
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
    return Material(
      key: HomeScreenKeys.action('accidents'),
      color: palette.critical.soft,
      borderRadius: BorderRadius.circular(TpRadius.sm),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 62),
          padding: const EdgeInsetsDirectional.fromSTEB(12, 9, 10, 9),
          decoration: BoxDecoration(
            border: Border.all(
              color: palette.critical.base.withValues(alpha: 0.25),
            ),
            borderRadius: BorderRadius.circular(TpRadius.sm),
          ),
          child: Row(
            children: <Widget>[
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: palette.critical.base,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.car_crash_outlined,
                  color: palette.critical.onBase,
                  size: 21,
                ),
              ),
              const SizedBox(width: 11),
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
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color: palette.critical.onSoft,
                            fontWeight: FontWeight.w900,
                          ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      l10n.homeReportAccidentAction,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.critical.onSoft,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ],
                ),
              ),
              Icon(
                Directionality.of(context) == TextDirection.rtl
                    ? Icons.chevron_left_rounded
                    : Icons.chevron_right_rounded,
                color: palette.critical.onSoft,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PmvOperationsHero extends StatelessWidget {
  const _PmvOperationsHero({required this.l10n, required this.onTap});

  final AppLocalizations l10n;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final BorderRadius radius = BorderRadius.circular(TpRadius.lg);
    return Semantics(
      button: onTap != null,
      label: '${l10n.scannerTitle}: ${l10n.homeAssetAction}',
      child: Material(
        key: HomeScreenKeys.pmvHero,
        color: const Color(0xFFF4F8F6),
        borderRadius: radius,
        clipBehavior: Clip.antiAlias,
        child: SizedBox(
          height: 154,
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final double cardWidth = constraints.maxWidth * 0.59;
              final BorderRadius tapRadius =
                  Directionality.of(context) == TextDirection.rtl
                      ? const BorderRadius.only(
                          topLeft: Radius.circular(TpRadius.xl),
                          bottomLeft: Radius.circular(TpRadius.xl),
                        )
                      : const BorderRadius.only(
                          topRight: Radius.circular(TpRadius.xl),
                          bottomRight: Radius.circular(TpRadius.xl),
                        );
              return Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  PositionedDirectional(
                    top: 0,
                    bottom: 0,
                    start: 0,
                    width: cardWidth,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: const BorderRadiusDirectional.only(
                          topEnd: Radius.circular(TpRadius.xl),
                          bottomEnd: Radius.circular(TpRadius.xl),
                        ),
                        gradient: LinearGradient(
                          begin: AlignmentDirectional.topStart,
                          end: AlignmentDirectional.bottomEnd,
                          colors: <Color>[
                            Color.lerp(
                              palette.primary,
                              const Color(0xFF006B36),
                              0.25,
                            )!,
                            Color.lerp(
                              palette.primary,
                              palette.ok.base,
                              0.34,
                            )!,
                          ],
                        ),
                      ),
                    ),
                  ),
                  PositionedDirectional(
                    top: 20,
                    bottom: 20,
                    end: 20,
                    width: constraints.maxWidth * 0.34,
                    child: IgnorePointer(
                      child: DecoratedBox(
                        key: HomeScreenKeys.pmvHeroImage,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.94),
                          borderRadius: BorderRadius.circular(TpRadius.lg),
                          boxShadow: <BoxShadow>[
                            BoxShadow(
                              color:
                                  palette.primaryDark.withValues(alpha: 0.12),
                              blurRadius: 16,
                              offset: const Offset(0, 6),
                            ),
                          ],
                        ),
                        child: Icon(
                          Icons.qr_code_scanner_rounded,
                          color: palette.primary,
                          size: 62,
                        ),
                      ),
                    ),
                  ),
                  PositionedDirectional(
                    top: 0,
                    bottom: 0,
                    start: 0,
                    width: cardWidth,
                    child: InkWell(
                      onTap: onTap,
                      borderRadius: tapRadius,
                      child: Padding(
                        padding: const EdgeInsetsDirectional.fromSTEB(
                          18,
                          18,
                          28,
                          16,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Container(
                              width: 38,
                              height: 38,
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(
                                  TpRadius.sm,
                                ),
                              ),
                              child: Stack(
                                clipBehavior: Clip.none,
                                children: <Widget>[
                                  Center(
                                    child: Icon(
                                      Icons.document_scanner_outlined,
                                      color: palette.primary,
                                      size: 23,
                                    ),
                                  ),
                                  PositionedDirectional(
                                    end: -4,
                                    bottom: -4,
                                    child: Container(
                                      width: 17,
                                      height: 17,
                                      decoration: BoxDecoration(
                                        color: Colors.white,
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: palette.primary,
                                          width: 1.5,
                                        ),
                                      ),
                                      child: Icon(
                                        Icons.center_focus_strong_rounded,
                                        color: palette.primary,
                                        size: 13,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const Spacer(),
                            Text(
                              l10n.scannerTitle,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w900,
                                  ),
                            ),
                            const SizedBox(height: 2),
                            Row(
                              children: <Widget>[
                                Expanded(
                                  child: Text(
                                    l10n.homeSearchAssetsHint,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: Theme.of(context)
                                        .textTheme
                                        .labelSmall
                                        ?.copyWith(
                                          color: Colors.white.withValues(
                                            alpha: 0.86,
                                          ),
                                          fontWeight: FontWeight.w600,
                                        ),
                                  ),
                                ),
                                const SizedBox(width: 5),
                                Icon(
                                  Directionality.of(context) ==
                                          TextDirection.rtl
                                      ? Icons.arrow_back_rounded
                                      : Icons.arrow_forward_rounded,
                                  color: Colors.white,
                                  size: 18,
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _DashboardGreeting extends ConsumerWidget {
  const _DashboardGreeting({
    required this.l10n,
    required this.fullName,
    required this.workspace,
    required this.onSiteTap,
  });

  final AppLocalizations l10n;
  final String? fullName;
  final WorkspaceContext? workspace;
  final VoidCallback onSiteTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DateTime now = ref.watch(homeHeaderClockProvider)();
    final TpPalette palette = TpPalette.of(context);
    final int hour = now.hour;
    final String greeting = hour < 12
        ? l10n.homeGoodMorning
        : hour < 17
            ? l10n.homeGoodAfternoon
            : l10n.homeGoodEvening;
    final String name = _firstName(fullName) ?? l10n.homeFallbackUser;
    final String site =
        _workspaceSiteLabel(workspace) ?? l10n.homeSiteStatUnavailable;

    return Row(
      key: HomeScreenKeys.hero,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                greeting,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w500,
                    ),
              ),
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        Material(
          color: palette.surfaceAlt,
          borderRadius: BorderRadius.circular(TpRadius.sm),
          child: InkWell(
            onTap: onSiteTap,
            borderRadius: BorderRadius.circular(TpRadius.sm),
            child: Container(
              constraints: const BoxConstraints(minHeight: 40, maxWidth: 138),
              padding: const EdgeInsetsDirectional.fromSTEB(10, 6, 7, 6),
              decoration: BoxDecoration(
                border: Border.all(color: palette.border),
                borderRadius: BorderRadius.circular(TpRadius.sm),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Flexible(
                    child: Text(
                      site,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.text,
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: 16,
                    color: palette.textSecondary,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  String? _firstName(String? raw) {
    final String value = raw?.trim() ?? '';
    if (value.isEmpty) return null;
    final String first = value.split(RegExp(r'\s+')).first;
    if (first.isEmpty) return null;
    return '${first[0].toUpperCase()}${first.substring(1)}';
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
    return SizedBox(
      height: 20,
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              title.toUpperCase(),
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: palette.text,
                    fontSize: 10,
                    letterSpacing: 0.15,
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
          if (action != null && onAction != null)
            InkWell(
              onTap: onAction,
              borderRadius: BorderRadius.circular(TpRadius.sm),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
                child: Text(
                  action!,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.primary,
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({
    required this.l10n,
    required this.approvals,
    required this.tasks,
    required this.alerts,
    required this.onViewAll,
    required this.onApprovals,
    required this.onTasks,
    required this.onAlerts,
  });

  final AppLocalizations l10n;
  final AsyncValue<List<InspectionApprovalItem>>? approvals;
  final AsyncValue<List<TaskItem>>? tasks;
  final AsyncValue<List<TyreAlert>>? alerts;
  final VoidCallback? onViewAll;
  final VoidCallback? onApprovals;
  final VoidCallback? onTasks;
  final VoidCallback? onAlerts;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      key: HomeScreenKeys.stats,
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: palette.text.withValues(alpha: 0.045),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(13, 10, 8, 9),
            child: Row(
              children: <Widget>[
                Icon(Icons.monitor_heart_outlined, color: palette.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.homeAttentionRequired.toUpperCase(),
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.15,
                        ),
                  ),
                ),
                if (onViewAll != null)
                  TextButton.icon(
                    onPressed: onViewAll,
                    iconAlignment: IconAlignment.end,
                    icon: Icon(
                      Directionality.of(context) == TextDirection.rtl
                          ? Icons.chevron_left_rounded
                          : Icons.chevron_right_rounded,
                      size: 17,
                    ),
                    label: Text(l10n.homeViewAll),
                  ),
              ],
            ),
          ),
          Divider(height: 1, color: palette.border),
          IntrinsicHeight(
            child: Row(
              children: <Widget>[
                Expanded(
                  child: _AttentionMetric(
                    value: _countText<InspectionApprovalItem>(
                      approvals,
                      cap: 100,
                      where: (_) => true,
                    ),
                    label: l10n.homeApprovalsMetric,
                    icon: Icons.assignment_turned_in_outlined,
                    background: const Color(0xFFFFF0DC),
                    foreground: const Color(0xFFEA580C),
                    onTap: onApprovals,
                  ),
                ),
                VerticalDivider(width: 1, color: palette.border),
                Expanded(
                  child: _AttentionMetric(
                    value: _countText<TaskItem>(
                      tasks,
                      cap: 100,
                      where: _isOverdueTask,
                    ),
                    label: l10n.homeOverdueMetric,
                    icon: Icons.timer_outlined,
                    background: const Color(0xFFFFF7D6),
                    foreground: const Color(0xFFD97706),
                    onTap: onTasks,
                  ),
                ),
                VerticalDivider(width: 1, color: palette.border),
                Expanded(
                  child: _AttentionMetric(
                    value: _countText<TyreAlert>(
                      alerts,
                      cap: 300,
                      where: (TyreAlert alert) => alert.isCritical,
                    ),
                    label: l10n.homeCriticalMetric,
                    icon: Icons.warning_rounded,
                    background: const Color(0xFFFDE6E8),
                    foreground: const Color(0xFFDC2626),
                    onTap: onAlerts,
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

class _AttentionMetric extends StatelessWidget {
  const _AttentionMetric({
    required this.value,
    required this.label,
    required this.icon,
    required this.background,
    required this.foreground,
    required this.onTap,
  });

  final String value;
  final String label;
  final IconData icon;
  final Color background;
  final Color foreground;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 110,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 9),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Container(
                  width: 29,
                  height: 29,
                  decoration: BoxDecoration(
                    color: background,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, color: foreground, size: 18),
                ),
                const SizedBox(height: 5),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: <Widget>[
                    Flexible(
                      child: Text(
                        value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              color: foreground,
                              fontSize: 22,
                              height: 1,
                              fontWeight: FontWeight.w900,
                            ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: const Color(0xFF111827),
                        fontSize: 9.5,
                        height: 1.05,
                        fontWeight: FontWeight.w700,
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

class _TyreIssuePreview extends StatelessWidget {
  const _TyreIssuePreview({
    required this.l10n,
    required this.alerts,
    required this.onOpen,
  });

  final AppLocalizations l10n;
  final AsyncValue<List<TyreAlert>>? alerts;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final List<TyreAlert>? items = _asyncItems(alerts);
    final TyreAlert? alert = items == null || items.isEmpty
        ? null
        : items.cast<TyreAlert?>().firstWhere(
              (TyreAlert? item) => item?.isCritical == true,
              orElse: () => items.first,
            );
    final bool loadingOrFailed = alerts != null && items == null;
    final String title = loadingOrFailed
        ? l10n.homeStatUnavailableCaption
        : alert == null
            ? l10n.homeNoCriticalIssueTitle
            : l10n.homeTyreIssueDetected;
    final String asset = alert?.assetNo?.trim().isNotEmpty == true
        ? alert!.assetNo!.trim()
        : l10n.valueNotMeasured;
    final String details = alert == null
        ? l10n.homeNoCriticalIssueMessage
        : <String?>[
            alert.position,
            alert.site,
          ]
            .whereType<String>()
            .where((String value) => value.isNotEmpty)
            .join(' • ');
    final TpStatusColors tone = loadingOrFailed
        ? palette.unknown
        : alert == null
            ? palette.ok
            : alert.isCritical
                ? palette.critical
                : palette.warning;
    final IconData icon = loadingOrFailed
        ? Icons.sync_problem_rounded
        : alert == null
            ? Icons.verified_rounded
            : alert.isCritical
                ? Icons.warning_amber_rounded
                : Icons.error_outline_rounded;
    final DateTime? issueDate = DateTime.tryParse(alert?.issueDate ?? '');
    final String? when = issueDate == null
        ? null
        : MaterialLocalizations.of(context)
            .formatShortDate(issueDate.toLocal());

    return Material(
      color: palette.surface,
      borderRadius: BorderRadius.circular(TpRadius.sm),
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        child: Container(
          constraints: const BoxConstraints(minHeight: 112),
          padding: const EdgeInsets.all(11),
          decoration: BoxDecoration(
            border: Border.all(color: palette.border),
            borderRadius: BorderRadius.circular(TpRadius.sm),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Align(
                alignment: Alignment.center,
                child: Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: tone.soft,
                    borderRadius: BorderRadius.circular(TpRadius.sm),
                  ),
                  child: Icon(
                    icon,
                    color: tone.base,
                    size: 19,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context)
                                  .textTheme
                                  .labelMedium
                                  ?.copyWith(
                                    color: palette.text,
                                    fontWeight: FontWeight.w800,
                                  ),
                            ),
                          ),
                          if (when != null) ...<Widget>[
                            const SizedBox(width: 6),
                            Text(
                              when,
                              style: Theme.of(context)
                                  .textTheme
                                  .labelSmall
                                  ?.copyWith(fontSize: 9),
                            ),
                          ],
                        ],
                      ),
                      if (alert != null) ...<Widget>[
                        const SizedBox(height: 2),
                        Text(
                          asset,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style:
                              Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: palette.text,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w800,
                                  ),
                        ),
                      ],
                      const SizedBox(height: 2),
                      Text(
                        details.isEmpty ? l10n.valueNotMeasured : details,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: palette.textSecondary,
                              fontSize: 10,
                              height: 1.2,
                            ),
                      ),
                    ],
                  ),
                ),
              ),
              if (onOpen != null)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const SizedBox(width: 8),
                    Text(
                      l10n.homeReviewAction,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.primary,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    Icon(
                      Icons.chevron_right_rounded,
                      color: palette.primary,
                      size: 17,
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MyWorkPreview extends StatelessWidget {
  const _MyWorkPreview({
    required this.l10n,
    required this.tasks,
    required this.assigneeId,
    required this.assigneeName,
    required this.onOpen,
  });

  final AppLocalizations l10n;
  final AsyncValue<List<TaskItem>>? tasks;
  final String? assigneeId;
  final String? assigneeName;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final List<TaskItem>? items = _asyncItems(tasks);
    final TasksCopy taskCopy = TasksCopy.of(context);
    final Set<String> assignees = <String>{
      if (assigneeId?.trim().isNotEmpty == true)
        assigneeId!.trim().toLowerCase(),
      if (assigneeName?.trim().isNotEmpty == true)
        assigneeName!.trim().toLowerCase(),
    };
    final List<TaskItem> mine = items
            ?.where(
              (TaskItem item) => assignees.contains(
                item.assignedTo?.trim().toLowerCase(),
              ),
            )
            .toList(growable: false) ??
        const <TaskItem>[];
    final TaskItem? task = mine.cast<TaskItem?>().firstWhere(
          (TaskItem? item) =>
              item != null && isTaskUrgent(item, DateTime.now()),
          orElse: () => mine.cast<TaskItem?>().firstWhere(
                (TaskItem? item) => item != null && !isTaskCompleted(item),
                orElse: () => null,
              ),
        );
    final bool loadingOrFailed = tasks != null && items == null;
    final String title = loadingOrFailed
        ? l10n.homeStatUnavailableCaption
        : task?.title ?? l10n.homeNoUrgentWorkTitle;
    final String detail = task == null
        ? l10n.homeNoUrgentWorkMessage
        : <String?>[task.assetNo, task.description]
            .whereType<String>()
            .where((String value) => value.isNotEmpty)
            .join(' • ');
    final TpPalette palette = TpPalette.of(context);
    final bool urgent = task != null && isTaskUrgent(task, DateTime.now());
    final TpStatusColors tone = urgent ? palette.critical : palette.ok;
    final String? due = task?.dueDate == null
        ? null
        : MaterialLocalizations.of(context)
            .formatMediumDate(task!.dueDate!.toLocal());
    final String meta = <String?>[due, task?.site]
        .whereType<String>()
        .where((String value) => value.trim().isNotEmpty)
        .join(' • ');

    return Material(
      color: palette.surface,
      borderRadius: BorderRadius.circular(TpRadius.sm),
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        child: Container(
          constraints: const BoxConstraints(minHeight: 96),
          padding: const EdgeInsets.all(11),
          decoration: BoxDecoration(
            border: Border.all(color: palette.border),
            borderRadius: BorderRadius.circular(TpRadius.sm),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Align(
                alignment: Alignment.center,
                child: Icon(
                  urgent ? Icons.bolt_rounded : Icons.work_outline_rounded,
                  color: tone.base,
                  size: 18,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context)
                                  .textTheme
                                  .labelMedium
                                  ?.copyWith(
                                    color: palette.text,
                                    fontWeight: FontWeight.w800,
                                  ),
                            ),
                          ),
                          if (urgent)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: tone.base,
                                borderRadius:
                                    BorderRadius.circular(TpRadius.pill),
                              ),
                              child: Text(
                                (task.priority ?? taskCopy('urgent'))
                                    .toUpperCase(),
                                style: Theme.of(context)
                                    .textTheme
                                    .labelSmall
                                    ?.copyWith(
                                      color: tone.onBase,
                                      fontSize: 8,
                                      height: 1,
                                      fontWeight: FontWeight.w800,
                                    ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        detail,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: palette.textSecondary,
                              fontSize: 10,
                              height: 1.2,
                            ),
                      ),
                      if (meta.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 2),
                        Text(
                          meta,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style:
                              Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: palette.textSecondary,
                                    fontSize: 9,
                                    height: 1.2,
                                  ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              if (onOpen != null) ...<Widget>[
                const SizedBox(width: 8),
                Text(
                  l10n.homeOpenAction,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.primary,
                        fontWeight: FontWeight.w800,
                      ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: palette.primary,
                  size: 17,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _DashboardQuickActions extends StatelessWidget {
  const _DashboardQuickActions({
    required this.l10n,
    required this.canSeeVehicles,
    required this.canReportIssue,
    required this.canReportAccident,
    required this.onAsset,
    required this.onReportIssue,
    required this.onAccident,
  });

  final AppLocalizations l10n;
  final bool canSeeVehicles;
  final bool canReportIssue;
  final bool canReportAccident;
  final VoidCallback onAsset;
  final VoidCallback onReportIssue;
  final VoidCallback onAccident;

  @override
  Widget build(BuildContext context) {
    final actions =
        <({String id, String label, IconData icon, VoidCallback onTap})>[
      if (canSeeVehicles)
        (
          id: 'asset',
          label: l10n.homeAssetAction,
          icon: Icons.directions_car_outlined,
          onTap: onAsset,
        ),
      if (canReportIssue)
        (
          id: 'reportIssue',
          label: l10n.homeReportIssueAction,
          icon: Icons.report_gmailerrorred_rounded,
          onTap: onReportIssue,
        ),
      if (canReportAccident)
        (
          id: 'accident',
          label: l10n.homeReportAccidentAction,
          icon: Icons.car_crash_outlined,
          onTap: onAccident,
        ),
    ];

    if (actions.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = actions.length == 1
            ? 1
            : constraints.maxWidth >= 280
                ? actions.length
                : 2;
        final double width =
            (constraints.maxWidth - (columns - 1) * 8) / columns;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            for (final action in actions)
              SizedBox(
                width: width,
                child: _DashboardActionCard(
                  key: HomeScreenKeys.action(action.id),
                  label: action.label,
                  icon: action.icon,
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
    required this.onTap,
    super.key,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Material(
      color: palette.surface,
      borderRadius: BorderRadius.circular(TpRadius.sm),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        child: Container(
          height: 104,
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 9),
          decoration: BoxDecoration(
            border: Border.all(color: palette.border),
            borderRadius: BorderRadius.circular(TpRadius.sm),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 31,
                height: 31,
                decoration: BoxDecoration(
                  color: palette.primarySoft,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: palette.primary, size: 18),
              ),
              const Spacer(),
              Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: palette.text,
                      fontSize: 9.5,
                      height: 1.05,
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 3),
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: Icon(
                  Directionality.of(context) == TextDirection.rtl
                      ? Icons.chevron_left_rounded
                      : Icons.chevron_right_rounded,
                  color: palette.primary,
                  size: 16,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeDashboardNavigation extends StatelessWidget {
  const _HomeDashboardNavigation({
    required this.l10n,
    required this.canInspect,
    required this.canSeeTasks,
    required this.canSeeAlerts,
    required this.onHome,
    required this.onMyWork,
    required this.onInspect,
    required this.onAlerts,
    required this.onMore,
  });

  final AppLocalizations l10n;
  final bool canInspect;
  final bool canSeeTasks;
  final bool canSeeAlerts;
  final VoidCallback onHome;
  final VoidCallback onMyWork;
  final VoidCallback onInspect;
  final VoidCallback onAlerts;
  final VoidCallback onMore;

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
        child: SizedBox(
          height: 66,
          child: Row(
            children: <Widget>[
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.home_rounded,
                  label: l10n.homeNavTitle,
                  selected: true,
                  onTap: onHome,
                ),
              ),
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.assignment_outlined,
                  label: l10n.homeMyWork,
                  onTap: canSeeTasks ? onMyWork : null,
                ),
              ),
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.add_rounded,
                  label: l10n.homeInspectAction,
                  raised: true,
                  onTap: canInspect ? onInspect : null,
                ),
              ),
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.notifications_none_rounded,
                  label: l10n.homeAlertsAction,
                  onTap: canSeeAlerts ? onAlerts : null,
                ),
              ),
              Expanded(
                child: _HomeNavItem(
                  icon: Icons.menu_rounded,
                  label: l10n.homeMoreAction,
                  onTap: onMore,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HomeNavItem extends StatelessWidget {
  const _HomeNavItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.selected = false,
    this.raised = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool selected;
  final bool raised;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color ink = selected ? palette.primary : palette.textSecondary;
    return InkResponse(
      onTap: onTap,
      radius: 30,
      child: Opacity(
        opacity: onTap == null ? 0.45 : 1,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Container(
              width: raised ? 39 : 28,
              height: raised ? 39 : 28,
              decoration: raised
                  ? BoxDecoration(
                      color: palette.primary,
                      shape: BoxShape.circle,
                    )
                  : null,
              alignment: Alignment.center,
              child: Icon(
                icon,
                size: raised ? 23 : 20,
                color: raised ? palette.onPrimary : ink,
              ),
            ),
            SizedBox(height: raised ? 1 : 2),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: selected ? palette.primary : palette.textSecondary,
                    fontSize: 9,
                    fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The page's visual anchor: product scope first, then only the two genuinely
/// reachable high-frequency field actions admitted by the access resolver.
// Kept temporarily as a compatibility reference for older Home goldens while
// the approved dashboard replaces it.
// ignore: unused_element
class _HomeHero extends StatelessWidget {
  const _HomeHero({
    required this.l10n,
    required this.workspace,
    required this.canInspect,
    required this.canScan,
    required this.canSeeVehicles,
  });

  final AppLocalizations l10n;
  final WorkspaceContext? workspace;
  final bool canInspect;
  final bool canScan;
  final bool canSeeVehicles;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    final String? site = workspace?.legacySite?.trim();

    return Column(
      key: HomeScreenKeys.hero,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    l10n.homeGreeting,
                    style: text.bodyMedium?.copyWith(
                      color: palette.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    l10n.loginOperationsTitle,
                    style: text.headlineSmall?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Container(
              constraints: const BoxConstraints(maxWidth: 136),
              padding: const EdgeInsets.symmetric(
                horizontal: TpSpace.md,
                vertical: TpSpace.sm,
              ),
              decoration: BoxDecoration(
                color: palette.surfaceAlt,
                border: Border.all(color: palette.border),
                borderRadius: BorderRadius.circular(TpRadius.md),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(
                    Icons.location_on_outlined,
                    size: TpSizing.iconSm,
                    color: palette.primary,
                  ),
                  const SizedBox(width: TpSpace.xs),
                  Flexible(
                    child: Text(
                      site?.isNotEmpty == true ? site! : l10n.valueNotMeasured,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.labelMedium?.copyWith(color: palette.text),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (canInspect || canScan || canSeeVehicles) ...<Widget>[
          const SizedBox(height: TpSpace.xl),
          _PrimaryActionGrid(
            l10n: l10n,
            canInspect: canInspect,
            canScan: canScan,
            canSeeVehicles: canSeeVehicles,
          ),
        ],
      ],
    );
  }
}

class _PrimaryActionGrid extends StatelessWidget {
  const _PrimaryActionGrid({
    required this.l10n,
    required this.canInspect,
    required this.canScan,
    required this.canSeeVehicles,
  });

  final AppLocalizations l10n;
  final bool canInspect;
  final bool canScan;
  final bool canSeeVehicles;

  @override
  Widget build(BuildContext context) {
    final List<({String label, IconData icon, VoidCallback onTap})> actions =
        <({String label, IconData icon, VoidCallback onTap})>[
      if (canInspect)
        (
          label: l10n.inspectionNavTitle,
          icon: Icons.search_rounded,
          onTap: () => context.go(const NewInspectionRoute().location),
        ),
      if (canScan)
        (
          label: l10n.scannerTitle,
          icon: Icons.qr_code_scanner_rounded,
          onTap: () => context.push(const ScannerRoute().location),
        ),
      if (canSeeVehicles)
        (
          label: l10n.vehiclesTitle,
          icon: Icons.local_shipping_outlined,
          onTap: () => context.push(const VehiclesRoute().location),
        ),
    ];

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth >= 340 ? 3 : 2;
        final double width =
            (constraints.maxWidth - TpSpace.sm * (columns - 1)) / columns;
        return Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final action in actions)
              SizedBox(
                width: width,
                child: _PrimaryActionCard(
                  label: action.label,
                  icon: action.icon,
                  onTap: action.onTap,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _PrimaryActionCard extends StatelessWidget {
  const _PrimaryActionCard({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.md,
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 72),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(icon, color: palette.primary, size: TpSizing.iconLg),
            const SizedBox(height: TpSpace.sm),
            Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Real operational context cards with adaptive widths. Unlike the former
/// stretched Row, this remains finite inside a vertical scroll view and lets
/// each card grow naturally when Arabic, Urdu or a long site name needs it.
// ignore: unused_element
class _ResponsiveStats extends StatelessWidget {
  const _ResponsiveStats({required this.cards});

  final List<Widget> cards;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      key: HomeScreenKeys.stats,
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth >= 720
            ? cards.length
            : constraints.maxWidth >= 360
                ? (cards.length < 2 ? cards.length : 2)
                : 1;
        final int safeColumns = columns < 1 ? 1 : columns;
        final double width =
            (constraints.maxWidth - TpSpace.md * (safeColumns - 1)) /
                safeColumns;

        return Wrap(
          spacing: TpSpace.md,
          runSpacing: TpSpace.md,
          children: <Widget>[
            for (final Widget card in cards)
              SizedBox(width: width, child: card),
          ],
        );
      },
    );
  }
}

// ignore: unused_element
class _ServiceSection extends StatelessWidget {
  const _ServiceSection({required this.section, required this.l10n});

  final HomeSectionSpec section;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final ({IconData icon, TpStatusColors tone}) meta = _sectionMeta(
      palette,
      section.id,
    );

    return Column(
      key: HomeScreenKeys.section(section.id),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: meta.tone.soft,
                borderRadius: BorderRadius.circular(TpRadius.sm),
              ),
              child: Icon(
                meta.icon,
                size: TpSizing.iconSm,
                color: meta.tone.onSoft,
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                _sectionHeading(l10n, section.id),
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final int columns = constraints.maxWidth >= 700
                ? 3
                : constraints.maxWidth >= 380
                    ? 2
                    : 1;
            final double tileWidth =
                (constraints.maxWidth - TpSpace.sm * (columns - 1)) / columns;

            return Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final HomeTileSpec tile in section.tiles)
                  SizedBox(
                    width: tileWidth,
                    child: _QuickActionTile(id: tile.id, l10n: l10n),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

/// One reachable action. Its width is chosen by [_ServiceSection], while its
/// height is content-driven so translated labels are never clipped or replaced
/// with an ellipsis.
class _QuickActionTile extends StatelessWidget {
  const _QuickActionTile({required this.id, required this.l10n});

  final String id;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ({String label, IconData icon, bool approve}) meta = _tileMeta(
      l10n,
      id,
    );
    final TpPalette palette = TpPalette.of(context);
    // Type inferred deliberately - the tone object's own class name was not
    // independently confirmed while writing this, and `palette.ok`/
    // `palette.info` are both proven shapes already (see this file's own
    // `.soft`/`.onSoft` usage below, mirroring the pattern the file this
    // screen replaces used for its one tile).
    final tone = meta.approve ? palette.ok : palette.info;

    return Semantics(
      button: true,
      label: meta.label,
      child: TpCard(
        key: HomeScreenKeys.action(id),
        onTap: () => _openHomeTile(context, id),
        background: palette.surface,
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.md,
          vertical: TpSpace.sm,
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: TpSizing.minTouchTarget,
          ),
          child: Row(
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: tone.soft,
                  shape: BoxShape.circle,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.sm),
                  child: Icon(
                    meta.icon,
                    size: TpSizing.iconMd,
                    color: tone.onSoft,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Text(
                  meta.label,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
              const SizedBox(width: TpSpace.xs),
              Icon(
                Directionality.of(context) == TextDirection.rtl
                    ? Icons.chevron_left
                    : Icons.chevron_right,
                size: TpSizing.iconMd,
                color: palette.textMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

({IconData icon, TpStatusColors tone}) _sectionMeta(
  TpPalette palette,
  String id,
) {
  switch (id) {
    case 'field':
      return (icon: Icons.engineering_outlined, tone: palette.ok);
    case 'fleet':
      return (icon: Icons.local_shipping_outlined, tone: palette.info);
    case 'maintenance':
      return (icon: Icons.handyman_outlined, tone: palette.warning);
    case 'management':
      return (icon: Icons.insights_outlined, tone: palette.info);
    case 'approvals':
      return (icon: Icons.verified_outlined, tone: palette.ok);
    default:
      return (icon: Icons.apps_outlined, tone: palette.neutral);
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
    case 'inspectionApprovals':
      context.go(const InspectionApprovalsRoute().location);
      return;
  }
}

/// The localised heading for one section [id] in [_kHomeSections].
String _sectionHeading(AppLocalizations l10n, String id) {
  switch (id) {
    case 'field':
      return l10n.homeFieldSectionHeading;
    case 'fleet':
      return l10n.homeFleetSectionHeading;
    case 'maintenance':
      return l10n.homeMaintenanceSectionHeading;
    case 'management':
      return _catalogLabel(l10n.managementCopyCatalog, 'overviewTitle');
    case 'approvals':
      return l10n.tabApprovals;
    default:
      return id;
  }
}

/// The "Site" stat card - a real, stored value
/// ([WorkspaceContext.legacySite]), never a fabricated one. Honestly
/// [TpStatCard.unavailable] when the profile carries no site at all, which
/// `workspace_context.dart` itself documents as a real, common state (its
/// own comment: "carried for form pre-fill only").
// ignore: unused_element
Widget _siteStatCard(AppLocalizations l10n, WorkspaceContext? workspace) {
  final String? site = workspace?.legacySite;
  if (site == null || site.trim().isEmpty) {
    return TpStatCard.unavailable(
      label: l10n.homeSiteStatLabel,
      caption: l10n.homeSiteStatUnavailable,
      icon: Icons.location_on_outlined,
    );
  }
  return TpStatCard.text(
    label: l10n.homeSiteStatLabel,
    value: site,
    icon: Icons.location_on_outlined,
  );
}

/// The "Pending sync" stat card, sourced from
/// [homePendingSyncCountProvider] - the same "not synced, failed included"
/// count [QueueDao.pendingCount] itself documents.
// ignore: unused_element
Widget _pendingSyncStatCard(AppLocalizations l10n, AsyncValue<int> pending) {
  return pending.when(
    data: (int count) => TpStatCard.count(
      label: l10n.homeSyncStatLabel,
      count: count,
      icon: Icons.sync,
    ),
    loading: () => TpStatCard.unavailable(
      label: l10n.homeSyncStatLabel,
      caption: l10n.homeStatLoadingCaption,
      icon: Icons.sync,
    ),
    error: (Object _, StackTrace __) => TpStatCard.unavailable(
      label: l10n.homeSyncStatLabel,
      caption: l10n.homeStatUnavailableCaption,
      icon: Icons.sync,
    ),
  );
}

/// The "Fleet size" stat card - only ever built when the caller has already
/// confirmed [ModuleKey.vehicles] access, so an unreadable fleet-list load
/// renders [TpStatCard.unavailable] rather than a fabricated 0, matching
/// `VehicleFleetRepository`'s own three-outcome contract: a live count
/// ([VehicleFleetListLoaded]), a cached count ([VehicleFleetListFromCache] -
/// still a real, previously-measured number, so it is shown the same way),
/// or [VehicleFleetListFailed], which is honestly "not measured".
// ignore: unused_element
Widget _fleetSizeStatCard(
  AppLocalizations l10n,
  AsyncValue<VehicleFleetListOutcome> fleet,
) {
  return fleet.when(
    data: (VehicleFleetListOutcome outcome) {
      int? count;
      if (outcome is VehicleFleetListLoaded) {
        count = outcome.assets.length;
      } else if (outcome is VehicleFleetListFromCache) {
        count = outcome.assets.length;
      }
      if (count == null) {
        return TpStatCard.unavailable(
          label: l10n.homeFleetSizeStatLabel,
          caption: l10n.homeStatUnavailableCaption,
          icon: Icons.local_shipping_outlined,
        );
      }
      return TpStatCard.count(
        label: l10n.homeFleetSizeStatLabel,
        count: count,
        icon: Icons.local_shipping_outlined,
      );
    },
    loading: () => TpStatCard.unavailable(
      label: l10n.homeFleetSizeStatLabel,
      caption: l10n.homeStatLoadingCaption,
      icon: Icons.local_shipping_outlined,
    ),
    error: (Object _, StackTrace __) => TpStatCard.unavailable(
      label: l10n.homeFleetSizeStatLabel,
      caption: l10n.homeStatUnavailableCaption,
      icon: Icons.local_shipping_outlined,
    ),
  );
}
