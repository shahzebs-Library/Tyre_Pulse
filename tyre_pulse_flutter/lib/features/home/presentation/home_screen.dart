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
/// to action, a Scan shortcut, a small stats row, and an access-gated grid
/// of quick-action tiles grouped into labelled sections (Field / Fleet /
/// Maintenance / Management / Admin), where a section renders only when at
/// least one of its tiles is reachable, and every tile is a SINGLE label
/// line - no sublabel, calm neutral icon chip by default, colour reserved
/// for exactly the "approve" tone on the two Approvals tiles.
///
/// Not every module the RN app links from Home has a Flutter destination
/// yet. AGENTS.md rule 7 - "never implement a control that does nothing" -
/// so every tile below was checked against three independent sources before
/// being included: the route class constructors in `app/router/routes.dart`,
/// the `.withAll(...)` chain `main.dart` actually wires into the screen
/// registry, and a direct grep of `TpRouteId.<x>:` across every
/// `*_screen_registrations.dart` file under `lib/features/`. Only the
/// routeIds that came back from ALL THREE are tiles here:
/// `newInspection`, `scanner`, `serialSearch`, `tyreRecords`, `vehicles`,
/// `checklists`, `checklistHistory`, `meterLog`, `washing`, `workOrders`,
/// `inspectionApprovals`, `checklistApprovals`.
///
/// # Deliberately OMITTED, and why - the RN catalogue this does not carry
///
/// - `accidents` (every variant) - already reachable from its own primary
///   tab (`AccidentDashboardRoute`, `TpShell.destinations` branch 3), and
///   AGENTS's own dead-code rule cuts against a second entry point to the
///   same destination on the one screen that has room for genuinely new
///   controls.
/// - `tyreChange` - `TyreChangeRoute` is declared in `routes.dart` and
///   `route_access.dart`, but a grep of every `*_screen_registrations.dart`
///   file under `lib/features/` at the time this was written returns no
///   match for `TpRouteId.tyreChange` - no feature registers a screen for
///   it. A background agent in a sibling worktree may be building the tyre
///   replacement screen concurrently; if it lands after this file is
///   written, adding its tile is a follow-up, not a reason to guess here.
/// - `reportIssue`, `repairRequest`, `rca`, `tasks`, `stock`,
///   `preventiveMaintenance`, `workshop`, `overview`, `reports`,
///   `analytics`, `ai`, `team`, `admin`, `alerts`, `calendar`,
///   `activityHistory` - `TpShell.destinations` declares an
///   `activityHistory` branch and every one of these has a real `ModuleKey`
///   in `core/permissions/module_registry.dart`, but NONE of them has a
///   corresponding entry in the screen registry: no
///   `*_screen_registrations.dart` file registers a builder for any of
///   their routeIds. Gating a tile on a module that resolves to
///   `TpScreenNotAvailable` on tap is exactly the "control that does
///   nothing" AGENTS.md forbids, so none of these are tiles - not until a
///   feature actually registers a screen for them.
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
/// `workOrders`, `checklistApprovals`, `scanner` - is nested inside Home's
/// OWN branch (0), the same shape `WorkOrdersRoute` had in the stopgap this
/// file replaces, and is reached with `context.push(...)` so Home stays on
/// the stack underneath it with real history.
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
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/presentation/'
    'vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/home/home_layout.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';

/// The tile catalogue this screen renders, filtered by [visibleHomeSections].
///
/// `const`, and deliberately declared ONCE at file scope rather than rebuilt
/// per frame - it carries no `BuildContext` and nothing here changes at
/// runtime; only which of its entries survive the access filter does.
const List<HomeSectionSpec> _kHomeSections = <HomeSectionSpec>[
  HomeSectionSpec(
    id: 'field',
    tiles: <HomeTileSpec>[
      HomeTileSpec(id: 'serial', module: ModuleKey.serial),
      HomeTileSpec(id: 'meter', module: ModuleKey.meter),
      HomeTileSpec(id: 'washing', module: ModuleKey.washing),
      HomeTileSpec(id: 'checklists', module: ModuleKey.checklists),
      HomeTileSpec(id: 'checklistHistory', module: ModuleKey.checklists),
    ],
  ),
  HomeSectionSpec(
    id: 'fleet',
    tiles: <HomeTileSpec>[
      HomeTileSpec(id: 'records', module: ModuleKey.records),
      HomeTileSpec(id: 'vehicles', module: ModuleKey.vehicles),
    ],
  ),
  HomeSectionSpec(
    id: 'maintenance',
    tiles: <HomeTileSpec>[
      HomeTileSpec(id: 'workorders', module: ModuleKey.workorders),
      HomeTileSpec(id: 'inspectionApprovals', module: ModuleKey.approvals),
      HomeTileSpec(id: 'checklistApprovals', module: ModuleKey.approvals),
    ],
  ),
];

class HomeScreen extends ConsumerWidget {
  const HomeScreen({required this.route, super.key});

  /// [HomeRoute] carries no parameters of its own. Threaded through anyway,
  /// matching every other registered screen in this codebase.
  final HomeRoute route;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    final bool canInspect = ref.watch(
      canAccessModuleProvider(ModuleKey.inspect),
    );
    final bool canScan = ref.watch(canAccessModuleProvider(ModuleKey.scan));
    final bool canSeeVehicles = ref.watch(
      canAccessModuleProvider(ModuleKey.vehicles),
    );

    final List<HomeSectionSpec> sections = visibleHomeSections(
      _kHomeSections,
      (ModuleKey module) => ref.watch(canAccessModuleProvider(module)),
    );

    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    final AsyncValue<int> pendingSync = ref.watch(homePendingSyncCountProvider);
    final AsyncValue<VehicleFleetListOutcome>? fleet = canSeeVehicles
        ? ref.watch(vehicleFleetListProvider)
        : null;

    final List<Widget> statCards = <Widget>[
      _siteStatCard(l10n, workspace),
      _pendingSyncStatCard(l10n, pendingSync),
      if (fleet != null) _fleetSizeStatCard(l10n, fleet),
    ];

    return TpScaffold(
      // No back fallback: Home is the root of its own branch, and of the
      // whole signed-in app - see `tp_scaffold.dart`'s own library comment.
      appBar: TpAppBar(title: l10n.homeNavTitle, showBack: false),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Text(
            l10n.homeGreeting,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: TpSpace.xxl),
          if (canInspect)
            TpButton.primary(
              label: l10n.inspectionNavTitle,
              icon: Icons.assignment,
              isFullWidth: true,
              onPressed: () => context.go(const NewInspectionRoute().location),
            ),
          if (canInspect && canScan) const SizedBox(height: TpSpace.md),
          if (canScan)
            TpButton.secondary(
              label: l10n.scannerTitle,
              icon: Icons.qr_code_scanner,
              isFullWidth: true,
              onPressed: () => context.push(const ScannerRoute().location),
            ),
          if (canInspect || canScan) const SizedBox(height: TpSpace.xxl),
          Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              for (int i = 0; i < statCards.length; i++) ...<Widget>[
                if (i > 0) const SizedBox(width: TpSpace.md),
                Expanded(child: statCards[i]),
              ],
            ],
          ),
          const SizedBox(height: TpSpace.xxl),
          if (sections.isEmpty)
            TpCard(
              isDashed: true,
              child: Text(
                l10n.homeNoQuickActionsMessage,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            )
          else
            for (final HomeSectionSpec section in sections) ...<Widget>[
              Text(
                _sectionHeading(l10n, section.id),
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: TpSpace.md),
              GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 3,
                crossAxisSpacing: TpSpace.md,
                mainAxisSpacing: TpSpace.md,
                childAspectRatio: 1.05,
                children: <Widget>[
                  for (final HomeTileSpec tile in section.tiles)
                    _QuickActionTile(id: tile.id, l10n: l10n),
                ],
              ),
              const SizedBox(height: TpSpace.xxl),
            ],
        ],
      ),
    );
  }
}

/// One tile in the quick-action grid: a calm neutral (or "approve" toned)
/// icon chip over a single label line, no sublabel - the RN Home screen's
/// own tile-styling rule, read from `mobile/app/(app)/index.tsx` before this
/// was written.
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

    return TpCard(
      onTap: () => _openHomeTile(context, id),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(color: tone.soft, shape: BoxShape.circle),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.sm),
              child: Icon(meta.icon, size: TpSizing.iconMd, color: tone.onSoft),
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            meta.label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleSmall,
          ),
        ],
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
    case 'workorders':
      return (
        label: l10n.workOrdersNavTitle,
        icon: Icons.build_circle_outlined,
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

/// Routes a tap on tile [id] to its destination.
///
/// See this file's own library comment, "Navigation: push within Home's own
/// branch, `go` across a branch", for why each [id] takes the navigation
/// method it does.
void _openHomeTile(BuildContext context, String id) {
  if (id == 'serial') {
    context.push(const SerialSearchRoute().location);
  } else if (id == 'records') {
    context.push(const TyreRecordsRoute().location);
  } else if (id == 'vehicles') {
    context.push(const VehiclesRoute().location);
  } else if (id == 'workorders') {
    context.push(const WorkOrdersRoute().location);
  } else if (id == 'checklistApprovals') {
    context.push(const ChecklistApprovalsRoute().location);
  } else if (id == 'meter') {
    context.go(const MeterLogRoute().location);
  } else if (id == 'washing') {
    context.go(const WashingRoute().location);
  } else if (id == 'checklists') {
    context.go(const ChecklistsRoute().location);
  } else if (id == 'checklistHistory') {
    context.go(const ChecklistHistoryRoute().location);
  } else if (id == 'inspectionApprovals') {
    context.go(const InspectionApprovalsRoute().location);
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
    default:
      return id;
  }
}

/// The "Site" stat card - a real, stored value
/// ([WorkspaceContext.legacySite]), never a fabricated one. Honestly
/// [TpStatCard.unavailable] when the profile carries no site at all, which
/// `workspace_context.dart` itself documents as a real, common state (its
/// own comment: "carried for form pre-fill only").
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
