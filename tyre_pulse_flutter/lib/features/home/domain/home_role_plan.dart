/// Which work each role's Home leads with.
///
/// # The owner's rule (2026-11-27)
///
/// At most TWO big tiles per role, and only for the action that role does
/// most often. Everything else is a compact row (72-88dp, one 48dp tap
/// target) or a chip. Every count row opens the records it counts and says
/// "-" / "Could not check" when its read fails, never 0.
///
/// This file is the ONE place that decides what each role sees. It is pure
/// data: no `BuildContext`, no provider, no I/O. `presentation/home_screen.dart`
/// turns a [HomeRolePlan] into widgets and data reads, and gates every
/// entry on the module it opens (a tile for a module the person cannot open
/// is dropped there, so a plan can never put a refusal on Home).
///
/// A role with no plan (null from [homePersonaFor]) keeps the original Home
/// (header, timeline, summary, quick actions). Store Keeper keeps its store
/// Home the same way.
library;

import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_targeting.dart';

/// A group of people whose Home leads with the same work.
enum HomePersona {
  driver,
  manager,
  fleetSupervisor,
  admin,
  reporter,
  inspector,
  workshopSupervisor,

  /// A trade on [kPlantTradeRoles] (ice plants, chillers, batching plants).
  plantTrade,

  /// Any other workshop trade ([kVehicleTradeRoles], plus the built-in
  /// Mechanic and Electrician roles).
  vehicleTrade,
  tyreMan,
  tyreDataCollector,
  dataMonitor,
  tyrePlanner,
}

/// The big tiles. A plan lists at most two.
enum HomeBigTile {
  /// Driver: "Log today's meter" with today's state from their own
  /// `odometer_logs` rows.
  meterToday,

  /// Driver: "Report a problem or breakdown".
  reportProblem,

  /// Manager: one card with the four exception counts.
  exceptions,

  /// Fleet Supervisor: handovers awaiting their sign-off.
  handoverSignoff,

  /// Fleet Supervisor: report an accident, with the open count under it.
  reportAccident,

  /// Admin: inspections + checklists awaiting a decision.
  approvalsWaiting,

  /// Reporter: report an issue.
  reportIssue,

  /// Inspector / Tyre Man: start a new inspection.
  newInspection,

  /// Inspector: resume the newest unfinished draft. Shown only when a draft
  /// exists.
  resumeDraft,

  /// Workshop Supervisor: who is working, waiting and free right now.
  teamNow,

  /// Workshop Supervisor: open job cards nobody is assigned to.
  assignJobs,

  /// Trades: their open assigned jobs. For plant trades shown only when
  /// they have one.
  myJobs,

  /// Plant trades: today's plant check sheets not yet submitted.
  plantChecks,

  /// Vehicle trades: the Workshop Daily sheet, shown only when it is due.
  workshopDaily,

  /// Tyre Data Collector: serial search (scan from there).
  serialSearch,

  /// Tyre Data Collector: inspection sign-offs waiting, with the count.
  approvalsToSign,

  /// Tire Planning Engineer: tyres due for replacement.
  tyresDue,
}

/// The compact rows.
enum HomeRow {
  myVehicle,
  wash,

  /// Red-toned. Driver only, and only when the module allows it.
  reportAccident,

  /// A published checklist targeted at the role (driver, Tyre Man).
  dailyChecklist,
  myCharges,

  /// Driver: raise or follow a concern (grievance). Opens Driver Concerns.
  myConcerns,
  dailySummary,
  alerts,
  offRoad,
  openAccidents,
  maintenanceDue,
  tyresAttention,

  /// Admin: the four exception counts as rows.
  exceptions,
  workshopStatus,
  todaysPlan,
  sync,
  repairRequest,
  meter,
  dueToday,

  /// Workshop Supervisor: checklist sheets awaiting a sign-off (their own
  /// submissions excluded).
  checklistsToSign,

  /// Workshop Supervisor: technicians waiting for parts now.
  waitingParts,

  /// Workshop Supervisor: technicians blocked for more than 30 minutes.
  blocked,
  requestParts,
  reportProblem,
  recentInspections,
  stockReorder,
}

/// One role's Home, top to bottom.
final class HomeRolePlan {
  const HomeRolePlan({
    required this.persona,
    this.big = const <HomeBigTile>[],
    this.rows = const <HomeRow>[],
    this.chips = const <String>[],
    this.showMore = true,
  });

  final HomePersona persona;

  /// At most two (the owner's rule; pinned by home_role_plan_test.dart).
  final List<HomeBigTile> big;
  final List<HomeRow> rows;

  /// Home tile ids (the same ids the "More" sheet uses), shown as chips.
  final List<String> chips;

  /// Whether the "More" chip (the full module catalogue) is offered.
  final bool showMore;
}

/// Who [role] is for Home purposes, or null to keep the original Home.
///
/// A super admin whose own role has no plan keeps the original Home: they
/// reach everything and the full layout is the honest overview.
HomePersona? homePersonaFor(UserRole role) {
  switch (role.id) {
    case RoleId.driver:
      return HomePersona.driver;
    case RoleId.manager:
      return HomePersona.manager;
    case RoleId.fleetSupervisor:
      return HomePersona.fleetSupervisor;
    case RoleId.admin:
      return HomePersona.admin;
    case RoleId.reporter:
      return HomePersona.reporter;
    case RoleId.inspector:
      return HomePersona.inspector;
    case RoleId.workshopSupervisor:
      return HomePersona.workshopSupervisor;
    case RoleId.mechanic:
    case RoleId.electrician:
      return isPlantTradeRole(role.rawValue)
          ? HomePersona.plantTrade
          : HomePersona.vehicleTrade;
    case RoleId.tyreMan:
      return HomePersona.tyreMan;
    case RoleId.tyreDataCollector:
      return HomePersona.tyreDataCollector;
    case null:
      break;
    default:
      return null;
  }
  // Roles the phone has no token for, held by real people with role-matrix
  // rows (`profiles.role` titles).
  final String raw = role.rawValue;
  if (isPlantTradeRole(raw)) return HomePersona.plantTrade;
  if (isVehicleTradeRole(raw)) return HomePersona.vehicleTrade;
  final String key = normaliseRoleKey(raw);
  if (key == 'data_monitor_officer') return HomePersona.dataMonitor;
  if (key == 'tire_planning_engineer' || key == 'tyre_planning_engineer') {
    return HomePersona.tyrePlanner;
  }
  return null;
}

/// The plan for [persona].
HomeRolePlan homeRolePlanFor(HomePersona persona) => switch (persona) {
      HomePersona.driver => const HomeRolePlan(
          persona: HomePersona.driver,
          big: <HomeBigTile>[HomeBigTile.meterToday, HomeBigTile.reportProblem],
          rows: <HomeRow>[
            HomeRow.myVehicle,
            HomeRow.wash,
            HomeRow.reportAccident,
            HomeRow.dailyChecklist,
            HomeRow.myCharges,
            HomeRow.myConcerns,
          ],
          // The owner removed Alerts, Serial, fleet Vehicles and More from
          // the driver's Home.
          showMore: false,
        ),
      HomePersona.manager => const HomeRolePlan(
          persona: HomePersona.manager,
          big: <HomeBigTile>[HomeBigTile.exceptions],
          rows: <HomeRow>[HomeRow.dailySummary, HomeRow.alerts],
          chips: <String>[
            'vehicles',
            'scanner',
            'serial',
            'stock',
            'workshopStatus',
          ],
        ),
      HomePersona.fleetSupervisor => const HomeRolePlan(
          persona: HomePersona.fleetSupervisor,
          big: <HomeBigTile>[
            HomeBigTile.handoverSignoff,
            HomeBigTile.reportAccident,
          ],
          rows: <HomeRow>[
            HomeRow.openAccidents,
            HomeRow.offRoad,
            HomeRow.workshopStatus,
            HomeRow.todaysPlan,
          ],
        ),
      HomePersona.admin => const HomeRolePlan(
          persona: HomePersona.admin,
          big: <HomeBigTile>[HomeBigTile.approvalsWaiting],
          rows: <HomeRow>[HomeRow.exceptions, HomeRow.sync],
        ),
      HomePersona.reporter => const HomeRolePlan(
          persona: HomePersona.reporter,
          big: <HomeBigTile>[HomeBigTile.reportIssue],
          rows: <HomeRow>[
            HomeRow.repairRequest,
            HomeRow.meter,
            HomeRow.todaysPlan,
          ],
        ),
      HomePersona.inspector => const HomeRolePlan(
          persona: HomePersona.inspector,
          big: <HomeBigTile>[
            HomeBigTile.newInspection,
            HomeBigTile.resumeDraft,
          ],
          rows: <HomeRow>[
            HomeRow.dueToday,
            HomeRow.tyresAttention,
            HomeRow.sync,
          ],
        ),
      HomePersona.workshopSupervisor => const HomeRolePlan(
          persona: HomePersona.workshopSupervisor,
          big: <HomeBigTile>[HomeBigTile.teamNow, HomeBigTile.assignJobs],
          rows: <HomeRow>[
            HomeRow.checklistsToSign,
            HomeRow.waitingParts,
            HomeRow.blocked,
          ],
        ),
      HomePersona.plantTrade => const HomeRolePlan(
          persona: HomePersona.plantTrade,
          big: <HomeBigTile>[HomeBigTile.plantChecks, HomeBigTile.myJobs],
          rows: <HomeRow>[HomeRow.requestParts, HomeRow.reportProblem],
          chips: <String>['scanner', 'meter', 'vehicles', 'serial'],
        ),
      HomePersona.vehicleTrade => const HomeRolePlan(
          persona: HomePersona.vehicleTrade,
          big: <HomeBigTile>[HomeBigTile.myJobs, HomeBigTile.workshopDaily],
          rows: <HomeRow>[HomeRow.requestParts, HomeRow.reportProblem],
          chips: <String>['scanner', 'meter', 'vehicles', 'serial'],
        ),
      HomePersona.tyreMan => const HomeRolePlan(
          persona: HomePersona.tyreMan,
          // The tyre change tile stays hidden until tyre change can save.
          big: <HomeBigTile>[HomeBigTile.newInspection],
          rows: <HomeRow>[
            HomeRow.todaysPlan,
            HomeRow.dailyChecklist,
            HomeRow.recentInspections,
          ],
          chips: <String>['scanner', 'serial'],
        ),
      HomePersona.tyreDataCollector => const HomeRolePlan(
          persona: HomePersona.tyreDataCollector,
          big: <HomeBigTile>[
            HomeBigTile.serialSearch,
            HomeBigTile.approvalsToSign,
          ],
          rows: <HomeRow>[HomeRow.todaysPlan],
          chips: <String>['records', 'tyreChange', 'stock'],
        ),
      HomePersona.dataMonitor => const HomeRolePlan(
          persona: HomePersona.dataMonitor,
          rows: <HomeRow>[
            HomeRow.tyresAttention,
            HomeRow.openAccidents,
            HomeRow.maintenanceDue,
          ],
        ),
      HomePersona.tyrePlanner => const HomeRolePlan(
          persona: HomePersona.tyrePlanner,
          big: <HomeBigTile>[HomeBigTile.tyresDue],
          rows: <HomeRow>[HomeRow.maintenanceDue, HomeRow.stockReorder],
        ),
    };

/// The plan for [role], or null to keep the original Home.
HomeRolePlan? homeRolePlanForRole(UserRole role) {
  final HomePersona? persona = homePersonaFor(role);
  return persona == null ? null : homeRolePlanFor(persona);
}
