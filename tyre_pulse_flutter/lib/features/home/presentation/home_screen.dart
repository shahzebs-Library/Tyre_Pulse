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
/// - AWAITING SIGNATURE - pending inspection approvals
///   ([homePendingInspectionApprovalsProvider]).
///
/// The mock's "Scheduled daily checklist" row, its "Fleet pulse"
/// Good/Attention/Critical/Not-checked counts and its "Recent assets" photo
/// strip have NO data source this app can read, so they are not rendered.
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
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/home/home_layout.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
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

  /// One timeline row: `draft`, `critical`, `approvals`, `unavailable`,
  /// `loading` or `empty`.
  static Key workRow(String id) => Key('home.work.$id');

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
    final DateTime now = ref.watch(homeHeaderClockProvider)();
    final AsyncValue<InspectionDraftSummary?>? draft =
        canInspect ? ref.watch(homeLatestInspectionDraftProvider) : null;
    final AsyncValue<List<InspectionApprovalItem>>? approvals = canSeeApprovals
        ? ref.watch(homePendingInspectionApprovalsProvider)
        : null;
    final AsyncValue<List<TyreAlert>>? alerts =
        canSeeAlerts ? ref.watch(tyreAlertsProvider) : null;
    final AsyncValue<int> pendingSync = ref.watch(homePendingSyncCountProvider);
    final AsyncValue<int> notificationCount =
        ref.watch(unreadNotificationsCountProvider);

    final _TodaysWork work = _buildTodaysWork(
      l10n: l10n,
      palette: palette,
      now: now,
      draft: draft,
      alerts: alerts,
      approvals: approvals,
    );

    return TpScaffold(
      backgroundColor: palette.background,
      body: ListView(
        padding: EdgeInsets.zero,
        children: <Widget>[
          _Band(
            color: palette.surface,
            padding: const EdgeInsetsDirectional.fromSTEB(16, 14, 8, 14),
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
          Divider(height: 1, thickness: 1, color: palette.border),
          if (canInspect || canSeeAccidents) ...<Widget>[
            _Band(
              color: palette.surface,
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  if (canInspect)
                    _NewInspectionButton(
                      label: l10n.inspectionNewInspection,
                      onTap: () =>
                          context.go(const NewInspectionRoute().location),
                    ),
                  if (canInspect && canSeeAccidents) const SizedBox(height: 12),
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
            Divider(height: 1, thickness: 1, color: palette.border),
          ],
          _Band(
            color: palette.background,
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
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
                _TodaysWorkCard(work: work),
                const SizedBox(height: 22),
                _HomeSectionHeader(title: l10n.homeQuickActions),
                const SizedBox(height: 10),
                _DashboardQuickActions(
                  l10n: l10n,
                  canScan: canScan,
                  canWash: canWash,
                  canSeeVehicles: canSeeVehicles,
                  canReportIssue: canReportIssue,
                  canReportAccident: canReportAccident,
                  onScanner: () => context.push(const ScannerRoute().location),
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
    );
  }

  /// Builds the timeline rows from the three real sources, in the mock's
  /// order: unfinished work first, then safety, then sign-off.
  _TodaysWork _buildTodaysWork({
    required AppLocalizations l10n,
    required TpPalette palette,
    required DateTime now,
    required AsyncValue<InspectionDraftSummary?>? draft,
    required AsyncValue<List<TyreAlert>>? alerts,
    required AsyncValue<List<InspectionApprovalItem>>? approvals,
  }) {
    final List<_WorkRowData> rows = <_WorkRowData>[];
    final List<String> failed = <String>[];
    bool loading = false;

    switch (draft) {
      case AsyncData<InspectionDraftSummary?>(:final value):
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
      case AsyncData<List<InspectionApprovalItem>>(:final value):
        if (value.isNotEmpty) {
          rows.add(_approvalsRow(l10n, palette, now, value));
        }
      case AsyncError<List<InspectionApprovalItem>>():
        failed.add(l10n.homeApprovalsMetric);
      case null:
        break;
      default:
        loading = true;
    }

    return _TodaysWork(rows: rows, failed: failed, loading: loading);
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
          : '${l10n.tyreDetailStatTread}: '
              '${tread % 1 == 0 ? tread.toInt() : tread.toStringAsFixed(1)} mm',
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
    List<InspectionApprovalItem> items,
  ) {
    DateTime? newest;
    for (final InspectionApprovalItem item in items) {
      final DateTime? created = DateTime.tryParse(item.createdAt ?? '');
      if (created != null && (newest == null || created.isAfter(newest))) {
        newest = created;
      }
    }
    return _WorkRowData(
      id: 'approvals',
      tone: palette.warning,
      icon: Icons.assignment_turned_in_outlined,
      tag: l10n.homeAwaitingSignatureTag,
      title: l10n.inspectionApprovalsTitle,
      detail: l10n.inspectionApprovalsAwaitingCount(items.length),
      time: newest == null ? null : _relativeTime(l10n, context, newest, now),
      onTap: () => context.go(const InspectionApprovalsRoute().location),
    );
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
                    trailing: Icon(
                      Directionality.of(context) == TextDirection.rtl
                          ? Icons.chevron_left_rounded
                          : Icons.chevron_right_rounded,
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
    final String site =
        _workspaceSiteLabel(workspace) ?? l10n.homeSiteStatUnavailable;
    final String? country = workspace?.activeCountry?.trim();
    final bool showBadge = notificationCount != '—' && notificationCount != '0';

    return Row(
      key: HomeScreenKeys.hero,
      children: <Widget>[
        Container(
          width: 52,
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: palette.primarySoft,
            shape: BoxShape.circle,
            border: Border.all(color: palette.border),
          ),
          child: initials == null
              ? Icon(Icons.person_outline_rounded, color: palette.primary)
              : Text(
                  initials,
                  style: text.titleMedium?.copyWith(
                    color: palette.primary,
                    fontWeight: FontWeight.w800,
                  ),
                ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Flexible(
                    child: Text(
                      greeting,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.titleMedium?.copyWith(
                        color: palette.text,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.titleMedium?.copyWith(
                        color: palette.text,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              InkWell(
                onTap: onSiteTap,
                borderRadius: BorderRadius.circular(TpRadius.sm),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: <Widget>[
                      Icon(
                        Icons.location_on_outlined,
                        size: 16,
                        color: palette.textSecondary,
                      ),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          site,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                        ),
                      ),
                      if (country != null && country.isNotEmpty) ...<Widget>[
                        Text(
                          '  •  ',
                          style: text.bodySmall?.copyWith(
                            color: palette.textMuted,
                          ),
                        ),
                        Flexible(
                          child: Text(
                            country,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodySmall?.copyWith(
                              color: palette.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            IconButton(
              tooltip: l10n.homeNotificationsTooltip,
              visualDensity: VisualDensity.compact,
              onPressed: onNotifications,
              icon: Stack(
                clipBehavior: Clip.none,
                children: <Widget>[
                  Icon(
                    Icons.notifications_none_rounded,
                    size: 22,
                    color: palette.text,
                  ),
                  if (showBadge)
                    PositionedDirectional(
                      top: -5,
                      end: -7,
                      child: Container(
                        constraints: const BoxConstraints(minWidth: 16),
                        height: 16,
                        padding: const EdgeInsets.symmetric(horizontal: 3),
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
                          notificationCount,
                          style: TextStyle(
                            color: palette.critical.onBase,
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
            _HomeSyncStatus(l10n: l10n, pending: pendingSync),
          ],
        ),
      ],
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
          Icons.cloud_done_outlined,
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
      constraints: const BoxConstraints(maxWidth: 116),
      child: Padding(
        padding: const EdgeInsetsDirectional.only(end: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 15, color: tone.base),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NewInspectionButton extends StatelessWidget {
  const _NewInspectionButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        key: HomeScreenKeys.newInspection,
        color: palette.primary,
        borderRadius: BorderRadius.circular(TpRadius.md),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: 64,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      color: palette.onPrimary,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.add_rounded,
                      color: palette.primary,
                      size: 22,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            color: palette.onPrimary,
                            fontWeight: FontWeight.w800,
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
    return Row(
      children: <Widget>[
        Expanded(
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: palette.text,
                  fontWeight: FontWeight.w800,
                ),
          ),
        ),
        if (action != null && onAction != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              visualDensity: VisualDensity.compact,
              foregroundColor: palette.primary,
            ),
            child: Text(
              action!,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
      ],
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
  });

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
      ...work.rows,
      if (work.failed.isNotEmpty)
        _WorkRowData(
          id: 'unavailable',
          tone: palette.unknown,
          icon: Icons.sync_problem_rounded,
          tag: l10n.homeStatUnavailableCaption,
          title: l10n.homeStatUnavailableCaption,
          detail: work.failed.join(' • '),
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
      if (work.rows.isEmpty && work.failed.isEmpty && !work.loading)
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
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(TpRadius.md),
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
    final bool rtl = Directionality.of(context) == TextDirection.rtl;
    final String? time = data.time;

    Widget connector(bool visible) => Expanded(
          child: Center(
            child: SizedBox(
              width: 2,
              height: double.infinity,
              child: ColoredBox(
                color: visible ? palette.border : Colors.transparent,
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
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                SizedBox(
                  width: 68,
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
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: data.tone.soft,
                            shape: BoxShape.circle,
                            border:
                                Border.all(color: palette.surface, width: 3),
                          ),
                          child: Icon(
                            data.icon,
                            color: data.tone.base,
                            size: 22,
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
                              bottom: BorderSide(color: palette.border),
                            ),
                    ),
                    child: Padding(
                      padding: const EdgeInsetsDirectional.fromSTEB(
                        0,
                        12,
                        8,
                        12,
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
                                                : palette.textSecondary,
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                ],
                                Text(
                                  data.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: text.titleSmall?.copyWith(
                                    color: palette.text,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                if (data.detail.isNotEmpty) ...<Widget>[
                                  const SizedBox(height: 3),
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
                                      color: palette.textSecondary,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          if (data.onTap != null) ...<Widget>[
                            const SizedBox(width: 6),
                            Icon(
                              rtl
                                  ? Icons.chevron_left_rounded
                                  : Icons.chevron_right_rounded,
                              color: palette.text,
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
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: tone.soft,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label.toUpperCase(),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: tone.onSoft,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.3,
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
    final actions =
        <({String id, String label, IconData icon, VoidCallback onTap})>[
      if (canScan)
        (
          id: 'scanner',
          label: l10n.scannerTitle,
          icon: Icons.qr_code_scanner_rounded,
          onTap: onScanner,
        ),
      if (canWash)
        (
          id: 'washing',
          label: l10n.tabWashing,
          icon: Icons.local_car_wash_rounded,
          onTap: onWashing,
        ),
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
      (
        id: 'more',
        label: l10n.homeMoreAction,
        icon: Icons.apps_rounded,
        onTap: onMore,
      ),
    ];

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int perRow = constraints.maxWidth >= 280 ? 3 : 2;
        final int columns = actions.length < perRow ? actions.length : perRow;
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
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.md),
        child: Container(
          constraints: const BoxConstraints(minHeight: 92),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          decoration: BoxDecoration(
            border: Border.all(color: palette.border),
            borderRadius: BorderRadius.circular(TpRadius.md),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: palette.primarySoft,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: palette.primary, size: 19),
              ),
              const SizedBox(height: 10),
              Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: palette.text,
                      height: 1.15,
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ],
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
    case 'myPlans':
      context.go(const MyPlansRoute().location);
      return;
    case 'inspectionApprovals':
      context.go(const InspectionApprovalsRoute().location);
      return;
  }
}
