/// Every navigable destination, defined once, with typed parameters.
///
/// Spec section 41 is the reason this file exists. The Kotlin rebuild routed on
/// `jobId` while the ViewModel read `workOrderId`, and it crashed. A route
/// parameter that is a bare `String` in a `Map` is a name nobody can rename
/// safely and the compiler cannot check.
///
/// ---------------------------------------------------------------------------
/// CANONICAL PARAMETER NAMES
/// ---------------------------------------------------------------------------
///
/// The production Expo app calls the same domain value by different names on
/// different screens. Artifact 03 section 7.5 lists seven such inconsistencies.
/// One name is chosen for each concept here and used everywhere, so the rename
/// is deliberate and traceable rather than discovered during a crash.
///
/// | Canonical  | Type            | Replaces (Expo)                              |
/// |------------|-----------------|----------------------------------------------|
/// | accidentId | [AccidentId]    | path `id` on accident/[id]; query `id` on     |
/// |            |                 | accident/case                                 |
/// | inspectionId | [InspectionId]| `id` on inspection/[id] AND on                |
/// |            |                 | inspection/approvals/[id] - two routes, same  |
/// |            |                 | name, different meanings in the same app      |
/// | submissionId | [SubmissionId]| `submissionId` - already correct              |
/// | templateId | [TemplateId]    | `templateId` - already correct                |
/// | assignmentId | [AssignmentId]| `assignment`                                  |
/// | assetNo    | [AssetNo]       | `asset` (inspection, meter, rca, tyre-change, |
/// |            |                 | report-issue, repair-request) AND `asset_no`  |
/// |            |                 | (checklist fill) AND `q` (vehicles)           |
/// | siteName   | [SiteName]      | `site` - already consistent                   |
/// | tyreSerial | [TyreSerial]    | `tyreSerial` (inspection), `serial` (rca,     |
/// |            |                 | report-issue), `q` (serial-search)            |
/// | tyrePosition | [TyrePosition]| `tyrePosition` (inspection) AND `position`    |
/// |            |                 | (tyre-change)                                 |
/// | draftKey   | [DraftKey]      | `resume` - which named the gesture, not the   |
/// |            |                 | value. It is a device-local draft key, never  |
/// |            |                 | a server id                                   |
/// | workOrderId | [WorkOrderId]  | no route exists today. New surface, named     |
/// |            |                 | correctly on the first commit                 |
///
/// The pattern in the Expo app is that the newer surfaces (checklists) name
/// their parameters after their domain and the older ones (inspection,
/// accident) call everything `id`. The checklist pattern is the one copied.
///
/// ---------------------------------------------------------------------------
/// WHAT THIS FILE DOES NOT DO
/// ---------------------------------------------------------------------------
///
/// It does not import `go_router`. Route construction and parsing are pure, so
/// the round-trip is unit-testable without a widget tree, and so the location
/// strings cannot drift from the parsing that reads them back.
library;

import 'package:flutter/foundation.dart';

// ---------------------------------------------------------------------------
// Canonical domain identifiers
// ---------------------------------------------------------------------------

/// A domain identifier carried by a route.
///
/// Two identifiers of different types are never equal even when they wrap the
/// same characters, which is what stops an inspection id being handed to a
/// screen that wanted an accident id.
@immutable
abstract class TpIdentifier {
  const TpIdentifier(this.value);

  final String value;

  bool get isEmpty => value.trim().isEmpty;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TpIdentifier &&
          other.runtimeType == runtimeType &&
          other.value == value);

  @override
  int get hashCode => Object.hash(runtimeType, value);

  @override
  String toString() => value;
}

/// `accidents.id`.
final class AccidentId extends TpIdentifier {
  const AccidentId(super.value);
}

/// `inspections.id`.
final class InspectionId extends TpIdentifier {
  const InspectionId(super.value);
}

/// `checklist_submissions.id`.
final class SubmissionId extends TpIdentifier {
  const SubmissionId(super.value);
}

/// `checklist_templates.id`.
final class TemplateId extends TpIdentifier {
  const TemplateId(super.value);
}

/// `checklist_assignments.id`.
final class AssignmentId extends TpIdentifier {
  const AssignmentId(super.value);
}

/// `work_orders.id`.
final class WorkOrderId extends TpIdentifier {
  const WorkOrderId(super.value);
}

/// `vehicle_fleet.asset_no`.
///
/// NOT a uuid. It is a business code such as `TM514` or `MP093`, and it is
/// unique per `(organisation_id, country, asset_no)` rather than globally - the
/// same code in two countries is a different machine, which is why the web
/// application had to make `vehicle_fleet` unique per country.
///
/// The country is deliberately NOT carried on the route. The active country
/// comes from workspace scope, not from a link, so a deep link cannot silently
/// resolve to a machine in another country. Whoever turns an [AssetNo] into a
/// record must resolve it against the active workspace, never globally.
final class AssetNo extends TpIdentifier {
  const AssetNo(super.value);
}

/// `sites.name`, or the `site` column on a business table.
final class SiteName extends TpIdentifier {
  const SiteName(super.value);
}

/// `tyre_records.serial_no`.
final class TyreSerial extends TpIdentifier {
  const TyreSerial(super.value);
}

/// `tyre_records.tyre_position`, for example `LHF1` or `RHCO`.
///
/// Repository rule 10: never change a tyre position id. It is also a technical
/// identifier for display purposes - see `TpDirection` - so it must never be
/// reordered under a right-to-left locale.
final class TyrePosition extends TpIdentifier {
  const TyrePosition(super.value);
}

/// A device-local checklist draft key.
///
/// Built from `(userId, templateId, assetNo)`. It never leaves the device and
/// it is not a server id, which is why it has its own type: handing one to a
/// repository as though it were a submission id would look plausible and find
/// nothing.
final class DraftKey extends TpIdentifier {
  const DraftKey(super.value);
}

// ---------------------------------------------------------------------------
// Route identity
// ---------------------------------------------------------------------------

/// Stable route names. Used as the GoRoute `name`, as the key into the screen
/// registry, and as the key into the guard table, so those three can never
/// disagree about which route is which.
abstract final class TpRouteId {
  static const String boot = 'boot';
  static const String login = 'login';
  static const String register = 'register';

  static const String home = 'home';
  static const String notifications = 'notifications';
  static const String scanner = 'scanner';
  static const String serialSearch = 'serialSearch';
  static const String tyreRecords = 'tyreRecords';
  static const String vehicles = 'vehicles';
  static const String alerts = 'alerts';
  static const String calendar = 'calendar';
  static const String overview = 'overview';
  static const String reports = 'reports';
  static const String analytics = 'analytics';
  static const String fleetAi = 'fleetAi';
  static const String team = 'team';
  static const String tyreChange = 'tyreChange';
  static const String reportIssue = 'reportIssue';
  static const String repairRequest = 'repairRequest';
  static const String rca = 'rca';
  static const String stockCount = 'stockCount';
  static const String tasks = 'tasks';
  static const String preventiveMaintenance = 'preventiveMaintenance';
  static const String workOrders = 'workOrders';
  static const String workOrderDetail = 'workOrderDetail';
  static const String workshop = 'workshop';
  static const String adminConsole = 'adminConsole';
  static const String adminUsers = 'adminUsers';
  static const String adminAccess = 'adminAccess';
  static const String adminApprovals = 'adminApprovals';
  static const String adminSites = 'adminSites';
  static const String adminAiChat = 'adminAiChat';

  static const String newInspection = 'newInspection';

  static const String accidentDashboard = 'accidentDashboard';
  static const String accidentReport = 'accidentReport';
  static const String accidentDetail = 'accidentDetail';
  static const String accidentCase = 'accidentCase';

  static const String meterLog = 'meterLog';
  static const String washing = 'washing';
  static const String profile = 'profile';

  static const String activityHistory = 'activityHistory';
  static const String inspectionDetail = 'inspectionDetail';

  static const String checklists = 'checklists';
  static const String checklistHistory = 'checklistHistory';
  static const String checklistFill = 'checklistFill';

  static const String inspectionApprovals = 'inspectionApprovals';
  static const String inspectionApprovalReview = 'inspectionApprovalReview';
  static const String checklistApprovals = 'checklistApprovals';
  static const String checklistApprovalReview = 'checklistApprovalReview';
}

/// The literal location templates, in one place.
///
/// A path is written here once and referenced everywhere else, so the router,
/// the guard table and the fallback table cannot drift apart. Artifact 03
/// section 2.2: a second place that can name a destination will eventually name
/// one that does not exist.
abstract final class TpRoutePaths {
  static const String boot = '/';
  static const String login = '/login';
  static const String register = '/register';

  static const String home = '/home';
  static const String notifications = '/notifications';
  static const String scanner = '/scan';
  static const String serialSearch = '/serial-search';
  static const String tyreRecords = '/records';
  static const String vehicles = '/vehicles';
  static const String alerts = '/alerts';
  static const String calendar = '/calendar';
  static const String overview = '/overview';
  static const String reports = '/reports';
  static const String analytics = '/analytics';
  static const String fleetAi = '/ai';
  static const String team = '/team';
  static const String tyreChange = '/tyre-change';
  static const String reportIssue = '/report-issue';
  static const String repairRequest = '/repair-request';
  static const String rca = '/rca';
  static const String stockCount = '/stock';
  static const String tasks = '/tasks';
  static const String preventiveMaintenance = '/maintenance';
  static const String workOrders = '/work-orders';
  static const String workshop = '/workshop';
  static const String adminConsole = '/admin';
  static const String adminUsers = '/admin/users';
  static const String adminAccess = '/admin/access';
  static const String adminApprovals = '/admin/approvals';
  static const String adminSites = '/admin/sites';
  static const String adminAiChat = '/admin/ai-chat';

  static const String newInspection = '/inspect/new';

  static const String accidentDashboard = '/accidents';
  static const String accidentReport = '/accidents/report';

  static const String meterLog = '/meter';
  static const String washing = '/washing';
  static const String profile = '/profile';

  static const String activityHistory = '/history';

  static const String checklists = '/checklists';
  static const String checklistHistory = '/checklists/history';

  static const String inspectionApprovals = '/approvals/inspections';
  static const String checklistApprovals = '/approvals/checklists';

  /// The path parameter names. Referenced by both the GoRoute templates and
  /// the parsing below.
  static const String pAccidentId = 'accidentId';
  static const String pInspectionId = 'inspectionId';
  static const String pSubmissionId = 'submissionId';
  static const String pTemplateId = 'templateId';
  static const String pWorkOrderId = 'workOrderId';

  /// The query parameter names.
  static const String qAssetNo = 'assetNo';
  static const String qSiteName = 'siteName';
  static const String qTyreSerial = 'tyreSerial';
  static const String qTyrePosition = 'tyrePosition';
  static const String qAssignmentId = 'assignmentId';
  static const String qDraftKey = 'draftKey';
  static const String qBrand = 'brand';

  /// Carries the location a user was trying to reach when the shell had to
  /// send them somewhere else first. See `redirect` in `app_router.dart`.
  static const String qFrom = 'from';
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/// The raw parameters of a matched location.
///
/// A deliberately plain pair of maps so `parse` stays pure. `app_router.dart`
/// adapts `GoRouterState` into this; nothing else needs to know go_router
/// exists.
@immutable
class TpRouteParameters {
  const TpRouteParameters({
    this.path = const <String, String>{},
    this.query = const <String, String>{},
  });

  final Map<String, String> path;
  final Map<String, String> query;

  /// A path parameter that the route template guarantees.
  ///
  /// Throws when it is absent, and that is correct: a matched route cannot be
  /// missing a segment of its own template, so an absence here means the
  /// template and the parse have drifted - exactly the spec section 41 defect,
  /// caught at the earliest possible moment instead of as a null later on.
  String requirePath(String key) {
    final String? value = path[key];
    if (value == null || value.isEmpty) {
      throw StateError(
        'Route parameter "$key" is missing. The route template and the route '
        'class disagree about its name.',
      );
    }
    return value;
  }

  /// An optional query parameter. Blank is treated as absent: a link carrying
  /// `?assetNo=` is not a link to an asset.
  String? optionalQuery(String key) {
    final String? value = query[key];
    if (value == null || value.trim().isEmpty) return null;
    return value;
  }
}

/// Builds a location from a path and optional query values.
///
/// Null and blank values are dropped, so a route with no parameters set
/// produces the bare path and two identical routes produce identical strings.
String _location(String path, [Map<String, String?>? query]) {
  if (query == null || query.isEmpty) return path;
  final List<String> parts = <String>[];
  for (final MapEntry<String, String?> entry in query.entries) {
    final String? value = entry.value;
    if (value == null || value.trim().isEmpty) continue;
    parts.add(
      '${Uri.encodeQueryComponent(entry.key)}='
      '${Uri.encodeQueryComponent(value)}',
    );
  }
  if (parts.isEmpty) return path;
  return '$path?${parts.join('&')}';
}

String _segment(String value) => Uri.encodeComponent(value);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/// A destination in the application.
@immutable
sealed class TpRoute {
  const TpRoute();

  /// The stable route name. Matches a constant on [TpRouteId].
  String get routeId;

  /// The fully resolved location, ready to hand to the router.
  String get location;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TpRoute &&
          other.runtimeType == runtimeType &&
          other.location == location);

  @override
  int get hashCode => Object.hash(runtimeType, location);

  @override
  String toString() => '$runtimeType($location)';
}

// --- Root and authentication ------------------------------------------------

/// The boot decider.
///
/// Artifact 03 section 1.1: this is not a screen in the product sense, it is a
/// three-state decider, and the third state matters. Reading the stored session
/// out of the Android keystore stalls on low-end hardware, and the screen used
/// to spin forever. `resolving`, `timed out` and `signed out` are three
/// different renderings.
final class BootRoute extends TpRoute {
  const BootRoute({this.from});

  static BootRoute parse(TpRouteParameters p) =>
      BootRoute(from: p.optionalQuery(TpRoutePaths.qFrom));

  /// Where the user was trying to go before the session had resolved.
  final String? from;

  @override
  String get routeId => TpRouteId.boot;

  @override
  String get location =>
      _location(TpRoutePaths.boot, <String, String?>{TpRoutePaths.qFrom: from});
}

final class LoginRoute extends TpRoute {
  const LoginRoute({this.from});

  static LoginRoute parse(TpRouteParameters p) =>
      LoginRoute(from: p.optionalQuery(TpRoutePaths.qFrom));

  /// Where the user was trying to go before they were asked to sign in.
  final String? from;

  @override
  String get routeId => TpRouteId.login;

  @override
  String get location => _location(
        TpRoutePaths.login,
        <String, String?>{TpRoutePaths.qFrom: from},
      );
}

final class RegisterRoute extends TpRoute {
  const RegisterRoute();

  @override
  String get routeId => TpRouteId.register;

  @override
  String get location => TpRoutePaths.register;
}

// --- Home branch ------------------------------------------------------------

final class HomeRoute extends TpRoute {
  const HomeRoute();

  @override
  String get routeId => TpRouteId.home;

  @override
  String get location => TpRoutePaths.home;
}

final class NotificationsRoute extends TpRoute {
  const NotificationsRoute();

  @override
  String get routeId => TpRouteId.notifications;

  @override
  String get location => TpRoutePaths.notifications;
}

final class ScannerRoute extends TpRoute {
  const ScannerRoute();

  @override
  String get routeId => TpRouteId.scanner;

  @override
  String get location => TpRoutePaths.scanner;
}

/// Search for a tyre by serial.
///
/// The Expo screen reads `q`. Renamed to `tyreSerial` per the canonical table:
/// `q` says nothing about what is being searched for, and the same screen's
/// value is a serial.
final class SerialSearchRoute extends TpRoute {
  const SerialSearchRoute({this.tyreSerial});

  static SerialSearchRoute parse(TpRouteParameters p) {
    final String? raw = p.optionalQuery(TpRoutePaths.qTyreSerial);
    return SerialSearchRoute(
      tyreSerial: raw == null ? null : TyreSerial(raw),
    );
  }

  final TyreSerial? tyreSerial;

  @override
  String get routeId => TpRouteId.serialSearch;

  @override
  String get location => _location(
        TpRoutePaths.serialSearch,
        <String, String?>{TpRoutePaths.qTyreSerial: tyreSerial?.value},
      );
}

final class TyreRecordsRoute extends TpRoute {
  const TyreRecordsRoute();

  @override
  String get routeId => TpRouteId.tyreRecords;

  @override
  String get location => TpRoutePaths.tyreRecords;
}

/// The fleet list.
///
/// Artifact 03 section 7.4: the production scanner passes `q` here and the
/// screen never reads it, so scanning an asset and choosing "View asset" opens
/// the unfiltered fleet list. A typed optional [assetNo] makes that
/// impossible to reintroduce - the parameter either exists on the route class
/// or the call does not compile.
final class VehiclesRoute extends TpRoute {
  const VehiclesRoute({this.assetNo});

  static VehiclesRoute parse(TpRouteParameters p) {
    final String? raw = p.optionalQuery(TpRoutePaths.qAssetNo);
    return VehiclesRoute(assetNo: raw == null ? null : AssetNo(raw));
  }

  final AssetNo? assetNo;

  @override
  String get routeId => TpRouteId.vehicles;

  @override
  String get location => _location(
        TpRoutePaths.vehicles,
        <String, String?>{TpRoutePaths.qAssetNo: assetNo?.value},
      );
}

final class AlertsRoute extends TpRoute {
  const AlertsRoute();

  @override
  String get routeId => TpRouteId.alerts;

  @override
  String get location => TpRoutePaths.alerts;
}

final class CalendarRoute extends TpRoute {
  const CalendarRoute();

  @override
  String get routeId => TpRouteId.calendar;

  @override
  String get location => TpRoutePaths.calendar;
}

final class OverviewRoute extends TpRoute {
  const OverviewRoute();

  @override
  String get routeId => TpRouteId.overview;

  @override
  String get location => TpRoutePaths.overview;
}

final class ReportsRoute extends TpRoute {
  const ReportsRoute();

  @override
  String get routeId => TpRouteId.reports;

  @override
  String get location => TpRoutePaths.reports;
}

final class AnalyticsRoute extends TpRoute {
  const AnalyticsRoute();

  @override
  String get routeId => TpRouteId.analytics;

  @override
  String get location => TpRoutePaths.analytics;
}

final class FleetAiRoute extends TpRoute {
  const FleetAiRoute();

  @override
  String get routeId => TpRouteId.fleetAi;

  @override
  String get location => TpRoutePaths.fleetAi;
}

final class TeamRoute extends TpRoute {
  const TeamRoute();

  @override
  String get routeId => TpRouteId.team;

  @override
  String get location => TpRoutePaths.team;
}

/// Replace a tyre. The Expo screen reads `position`; renamed to `tyrePosition`
/// so it matches the inspection form, which reads `tyrePosition` for the same
/// value.
final class TyreChangeRoute extends TpRoute {
  const TyreChangeRoute({this.assetNo, this.siteName, this.tyrePosition});

  static TyreChangeRoute parse(TpRouteParameters p) {
    final String? asset = p.optionalQuery(TpRoutePaths.qAssetNo);
    final String? site = p.optionalQuery(TpRoutePaths.qSiteName);
    final String? position = p.optionalQuery(TpRoutePaths.qTyrePosition);
    return TyreChangeRoute(
      assetNo: asset == null ? null : AssetNo(asset),
      siteName: site == null ? null : SiteName(site),
      tyrePosition: position == null ? null : TyrePosition(position),
    );
  }

  final AssetNo? assetNo;
  final SiteName? siteName;
  final TyrePosition? tyrePosition;

  @override
  String get routeId => TpRouteId.tyreChange;

  @override
  String get location => _location(TpRoutePaths.tyreChange, <String, String?>{
        TpRoutePaths.qAssetNo: assetNo?.value,
        TpRoutePaths.qSiteName: siteName?.value,
        TpRoutePaths.qTyrePosition: tyrePosition?.value,
      });
}

/// Report a problem. The Expo screen reads `serial`; renamed to `tyreSerial`.
final class ReportIssueRoute extends TpRoute {
  const ReportIssueRoute({this.assetNo, this.siteName, this.tyreSerial});

  static ReportIssueRoute parse(TpRouteParameters p) {
    final String? asset = p.optionalQuery(TpRoutePaths.qAssetNo);
    final String? site = p.optionalQuery(TpRoutePaths.qSiteName);
    final String? serial = p.optionalQuery(TpRoutePaths.qTyreSerial);
    return ReportIssueRoute(
      assetNo: asset == null ? null : AssetNo(asset),
      siteName: site == null ? null : SiteName(site),
      tyreSerial: serial == null ? null : TyreSerial(serial),
    );
  }

  final AssetNo? assetNo;
  final SiteName? siteName;
  final TyreSerial? tyreSerial;

  @override
  String get routeId => TpRouteId.reportIssue;

  @override
  String get location => _location(TpRoutePaths.reportIssue, <String, String?>{
        TpRoutePaths.qAssetNo: assetNo?.value,
        TpRoutePaths.qSiteName: siteName?.value,
        TpRoutePaths.qTyreSerial: tyreSerial?.value,
      });
}

final class RepairRequestRoute extends TpRoute {
  const RepairRequestRoute({this.assetNo, this.siteName});

  static RepairRequestRoute parse(TpRouteParameters p) {
    final String? asset = p.optionalQuery(TpRoutePaths.qAssetNo);
    final String? site = p.optionalQuery(TpRoutePaths.qSiteName);
    return RepairRequestRoute(
      assetNo: asset == null ? null : AssetNo(asset),
      siteName: site == null ? null : SiteName(site),
    );
  }

  final AssetNo? assetNo;
  final SiteName? siteName;

  @override
  String get routeId => TpRouteId.repairRequest;

  @override
  String get location =>
      _location(TpRoutePaths.repairRequest, <String, String?>{
        TpRoutePaths.qAssetNo: assetNo?.value,
        TpRoutePaths.qSiteName: siteName?.value,
      });
}

/// Root cause analysis. The Expo screen reads `serial`; renamed to
/// `tyreSerial`. `brand` stays a plain string: it is a manufacturer name, not
/// an identifier of a row.
final class RcaRoute extends TpRoute {
  const RcaRoute({this.assetNo, this.siteName, this.tyreSerial, this.brand});

  static RcaRoute parse(TpRouteParameters p) {
    final String? asset = p.optionalQuery(TpRoutePaths.qAssetNo);
    final String? site = p.optionalQuery(TpRoutePaths.qSiteName);
    final String? serial = p.optionalQuery(TpRoutePaths.qTyreSerial);
    return RcaRoute(
      assetNo: asset == null ? null : AssetNo(asset),
      siteName: site == null ? null : SiteName(site),
      tyreSerial: serial == null ? null : TyreSerial(serial),
      brand: p.optionalQuery(TpRoutePaths.qBrand),
    );
  }

  final AssetNo? assetNo;
  final SiteName? siteName;
  final TyreSerial? tyreSerial;
  final String? brand;

  @override
  String get routeId => TpRouteId.rca;

  @override
  String get location => _location(TpRoutePaths.rca, <String, String?>{
        TpRoutePaths.qAssetNo: assetNo?.value,
        TpRoutePaths.qSiteName: siteName?.value,
        TpRoutePaths.qTyreSerial: tyreSerial?.value,
        TpRoutePaths.qBrand: brand,
      });
}

final class StockCountRoute extends TpRoute {
  const StockCountRoute();

  @override
  String get routeId => TpRouteId.stockCount;

  @override
  String get location => TpRoutePaths.stockCount;
}

final class TasksRoute extends TpRoute {
  const TasksRoute();

  @override
  String get routeId => TpRouteId.tasks;

  @override
  String get location => TpRoutePaths.tasks;
}

final class PreventiveMaintenanceRoute extends TpRoute {
  const PreventiveMaintenanceRoute();

  @override
  String get routeId => TpRouteId.preventiveMaintenance;

  @override
  String get location => TpRoutePaths.preventiveMaintenance;
}

/// The work order list.
///
/// Artifact 03 section 7.1: production carries TWO work order screens,
/// `work-orders.tsx` and `workorders/index.tsx`, both live and both guarded on
/// the same module. Exactly one path is ported. `/work-orders` is the spelling
/// kept, because it is the one the notification journey in spec section 5 is
/// drawn against.
final class WorkOrdersRoute extends TpRoute {
  const WorkOrdersRoute();

  @override
  String get routeId => TpRouteId.workOrders;

  @override
  String get location => TpRoutePaths.workOrders;
}

/// A single work order.
///
/// NEW SURFACE. There is no work order detail route in the production app -
/// both list screens open a record in an in-page modal. Spec section 41 names
/// `WorkOrderRoute(workOrderId)` explicitly, and artifact 03 section 3.5 says
/// the notification must push this so Back gives Work Order, Workshop, Home.
/// This is the one route where the naming had no legacy to inherit, so it is
/// simply correct: `workOrderId`, never `jobId`.
final class WorkOrderDetailRoute extends TpRoute {
  const WorkOrderDetailRoute({required this.workOrderId});

  static WorkOrderDetailRoute parse(TpRouteParameters p) =>
      WorkOrderDetailRoute(
        workOrderId: WorkOrderId(p.requirePath(TpRoutePaths.pWorkOrderId)),
      );

  final WorkOrderId workOrderId;

  @override
  String get routeId => TpRouteId.workOrderDetail;

  @override
  String get location =>
      '${TpRoutePaths.workOrders}/${_segment(workOrderId.value)}';
}

final class WorkshopRoute extends TpRoute {
  const WorkshopRoute();

  @override
  String get routeId => TpRouteId.workshop;

  @override
  String get location => TpRoutePaths.workshop;
}

final class AdminConsoleRoute extends TpRoute {
  const AdminConsoleRoute();

  @override
  String get routeId => TpRouteId.adminConsole;

  @override
  String get location => TpRoutePaths.adminConsole;
}

final class AdminUsersRoute extends TpRoute {
  const AdminUsersRoute();

  @override
  String get routeId => TpRouteId.adminUsers;

  @override
  String get location => TpRoutePaths.adminUsers;
}

final class AdminAccessRoute extends TpRoute {
  const AdminAccessRoute();

  @override
  String get routeId => TpRouteId.adminAccess;

  @override
  String get location => TpRoutePaths.adminAccess;
}

final class AdminApprovalsRoute extends TpRoute {
  const AdminApprovalsRoute();

  @override
  String get routeId => TpRouteId.adminApprovals;

  @override
  String get location => TpRoutePaths.adminApprovals;
}

final class AdminSitesRoute extends TpRoute {
  const AdminSitesRoute();

  @override
  String get routeId => TpRouteId.adminSites;

  @override
  String get location => TpRoutePaths.adminSites;
}

final class AdminAiChatRoute extends TpRoute {
  const AdminAiChatRoute();

  @override
  String get routeId => TpRouteId.adminAiChat;

  @override
  String get location => TpRoutePaths.adminAiChat;
}

// --- Inspect branch ---------------------------------------------------------

/// The inspection capture form.
///
/// The Expo screen reads `asset`; renamed to `assetNo`, which is also what the
/// checklist fill screen calls the same value (as `asset_no`).
final class NewInspectionRoute extends TpRoute {
  const NewInspectionRoute({
    this.siteName,
    this.assetNo,
    this.tyreSerial,
    this.tyrePosition,
  });

  static NewInspectionRoute parse(TpRouteParameters p) {
    final String? site = p.optionalQuery(TpRoutePaths.qSiteName);
    final String? asset = p.optionalQuery(TpRoutePaths.qAssetNo);
    final String? serial = p.optionalQuery(TpRoutePaths.qTyreSerial);
    final String? position = p.optionalQuery(TpRoutePaths.qTyrePosition);
    return NewInspectionRoute(
      siteName: site == null ? null : SiteName(site),
      assetNo: asset == null ? null : AssetNo(asset),
      tyreSerial: serial == null ? null : TyreSerial(serial),
      tyrePosition: position == null ? null : TyrePosition(position),
    );
  }

  final SiteName? siteName;
  final AssetNo? assetNo;
  final TyreSerial? tyreSerial;
  final TyrePosition? tyrePosition;

  @override
  String get routeId => TpRouteId.newInspection;

  @override
  String get location => _location(TpRoutePaths.newInspection, <String, String?>{
        TpRoutePaths.qSiteName: siteName?.value,
        TpRoutePaths.qAssetNo: assetNo?.value,
        TpRoutePaths.qTyreSerial: tyreSerial?.value,
        TpRoutePaths.qTyrePosition: tyrePosition?.value,
      });
}

// --- Accidents branch -------------------------------------------------------

final class AccidentDashboardRoute extends TpRoute {
  const AccidentDashboardRoute();

  @override
  String get routeId => TpRouteId.accidentDashboard;

  @override
  String get location => TpRoutePaths.accidentDashboard;
}

final class AccidentReportRoute extends TpRoute {
  const AccidentReportRoute();

  @override
  String get routeId => TpRouteId.accidentReport;

  @override
  String get location => TpRoutePaths.accidentReport;
}

/// One accident.
///
/// In production this id is a PATH segment here and a QUERY parameter on the
/// case screen, and both are called `id`. Artifact 03 calls that the clearest
/// spec section 41 defect in the app. Here both are a path segment named
/// `accidentId`, and the case screen is a child of this route so Back returns
/// to the accident rather than to the register.
final class AccidentDetailRoute extends TpRoute {
  const AccidentDetailRoute({required this.accidentId});

  static AccidentDetailRoute parse(TpRouteParameters p) => AccidentDetailRoute(
        accidentId: AccidentId(p.requirePath(TpRoutePaths.pAccidentId)),
      );

  final AccidentId accidentId;

  @override
  String get routeId => TpRouteId.accidentDetail;

  @override
  String get location =>
      '${TpRoutePaths.accidentDashboard}/${_segment(accidentId.value)}';
}

final class AccidentCaseRoute extends TpRoute {
  const AccidentCaseRoute({required this.accidentId});

  static AccidentCaseRoute parse(TpRouteParameters p) => AccidentCaseRoute(
        accidentId: AccidentId(p.requirePath(TpRoutePaths.pAccidentId)),
      );

  final AccidentId accidentId;

  @override
  String get routeId => TpRouteId.accidentCase;

  @override
  String get location =>
      '${AccidentDetailRoute(accidentId: accidentId).location}/case';
}

// --- Meter, washing, profile ------------------------------------------------

final class MeterLogRoute extends TpRoute {
  const MeterLogRoute({this.assetNo, this.siteName});

  static MeterLogRoute parse(TpRouteParameters p) {
    final String? asset = p.optionalQuery(TpRoutePaths.qAssetNo);
    final String? site = p.optionalQuery(TpRoutePaths.qSiteName);
    return MeterLogRoute(
      assetNo: asset == null ? null : AssetNo(asset),
      siteName: site == null ? null : SiteName(site),
    );
  }

  final AssetNo? assetNo;
  final SiteName? siteName;

  @override
  String get routeId => TpRouteId.meterLog;

  @override
  String get location => _location(TpRoutePaths.meterLog, <String, String?>{
        TpRoutePaths.qAssetNo: assetNo?.value,
        TpRoutePaths.qSiteName: siteName?.value,
      });
}

final class WashingRoute extends TpRoute {
  const WashingRoute();

  @override
  String get routeId => TpRouteId.washing;

  @override
  String get location => TpRoutePaths.washing;
}

final class ProfileRoute extends TpRoute {
  const ProfileRoute();

  @override
  String get routeId => TpRouteId.profile;

  @override
  String get location => TpRoutePaths.profile;
}

// --- History branch ---------------------------------------------------------

final class ActivityHistoryRoute extends TpRoute {
  const ActivityHistoryRoute();

  @override
  String get routeId => TpRouteId.activityHistory;

  @override
  String get location => TpRoutePaths.activityHistory;
}

/// One inspection, opened from History.
///
/// Nested under `/history` deliberately. Artifact 03 section 3.4 records that
/// the production fallback for this screen is History rather than an inspection
/// list, because History is the only screen that opens an inspection detail.
/// Nesting encodes that in the route tree instead of in a fallback string.
final class InspectionDetailRoute extends TpRoute {
  const InspectionDetailRoute({required this.inspectionId});

  static InspectionDetailRoute parse(TpRouteParameters p) =>
      InspectionDetailRoute(
        inspectionId: InspectionId(p.requirePath(TpRoutePaths.pInspectionId)),
      );

  final InspectionId inspectionId;

  @override
  String get routeId => TpRouteId.inspectionDetail;

  @override
  String get location => '${TpRoutePaths.activityHistory}/inspection/'
      '${_segment(inspectionId.value)}';
}

// --- Checklists branch ------------------------------------------------------

final class ChecklistsRoute extends TpRoute {
  const ChecklistsRoute();

  @override
  String get routeId => TpRouteId.checklists;

  @override
  String get location => TpRoutePaths.checklists;
}

final class ChecklistHistoryRoute extends TpRoute {
  const ChecklistHistoryRoute();

  @override
  String get routeId => TpRouteId.checklistHistory;

  @override
  String get location => TpRoutePaths.checklistHistory;
}

/// Fill a checklist.
///
/// `assignment` becomes `assignmentId`, `asset_no` becomes `assetNo`, and
/// `resume` becomes `draftKey`. The last rename is the one worth reading twice:
/// `resume` described the gesture that produced the value, not the value
/// itself, which is a device-local draft key and never a server id.
final class ChecklistFillRoute extends TpRoute {
  const ChecklistFillRoute({
    required this.templateId,
    this.assignmentId,
    this.siteName,
    this.assetNo,
    this.draftKey,
  });

  static ChecklistFillRoute parse(TpRouteParameters p) {
    final String? assignment = p.optionalQuery(TpRoutePaths.qAssignmentId);
    final String? site = p.optionalQuery(TpRoutePaths.qSiteName);
    final String? asset = p.optionalQuery(TpRoutePaths.qAssetNo);
    final String? draft = p.optionalQuery(TpRoutePaths.qDraftKey);
    return ChecklistFillRoute(
      templateId: TemplateId(p.requirePath(TpRoutePaths.pTemplateId)),
      assignmentId: assignment == null ? null : AssignmentId(assignment),
      siteName: site == null ? null : SiteName(site),
      assetNo: asset == null ? null : AssetNo(asset),
      draftKey: draft == null ? null : DraftKey(draft),
    );
  }

  final TemplateId templateId;
  final AssignmentId? assignmentId;
  final SiteName? siteName;
  final AssetNo? assetNo;
  final DraftKey? draftKey;

  @override
  String get routeId => TpRouteId.checklistFill;

  @override
  String get location => _location(
        '${TpRoutePaths.checklists}/${_segment(templateId.value)}',
        <String, String?>{
          TpRoutePaths.qAssignmentId: assignmentId?.value,
          TpRoutePaths.qSiteName: siteName?.value,
          TpRoutePaths.qAssetNo: assetNo?.value,
          TpRoutePaths.qDraftKey: draftKey?.value,
        },
      );
}

// --- Approvals branch -------------------------------------------------------

final class InspectionApprovalsRoute extends TpRoute {
  const InspectionApprovalsRoute();

  @override
  String get routeId => TpRouteId.inspectionApprovals;

  @override
  String get location => TpRoutePaths.inspectionApprovals;
}

/// Review one inspection for sign off.
///
/// The id is an INSPECTION id, exactly as on [InspectionDetailRoute]. In the
/// Expo app both routes call it `id`, on two screens that do different things
/// with it.
final class InspectionApprovalReviewRoute extends TpRoute {
  const InspectionApprovalReviewRoute({required this.inspectionId});

  static InspectionApprovalReviewRoute parse(TpRouteParameters p) =>
      InspectionApprovalReviewRoute(
        inspectionId: InspectionId(p.requirePath(TpRoutePaths.pInspectionId)),
      );

  final InspectionId inspectionId;

  @override
  String get routeId => TpRouteId.inspectionApprovalReview;

  @override
  String get location => '${TpRoutePaths.inspectionApprovals}/'
      '${_segment(inspectionId.value)}';
}

final class ChecklistApprovalsRoute extends TpRoute {
  const ChecklistApprovalsRoute();

  @override
  String get routeId => TpRouteId.checklistApprovals;

  @override
  String get location => TpRoutePaths.checklistApprovals;
}

final class ChecklistApprovalReviewRoute extends TpRoute {
  const ChecklistApprovalReviewRoute({required this.submissionId});

  static ChecklistApprovalReviewRoute parse(TpRouteParameters p) =>
      ChecklistApprovalReviewRoute(
        submissionId: SubmissionId(p.requirePath(TpRoutePaths.pSubmissionId)),
      );

  final SubmissionId submissionId;

  @override
  String get routeId => TpRouteId.checklistApprovalReview;

  @override
  String get location => '${TpRoutePaths.checklistApprovals}/'
      '${_segment(submissionId.value)}';
}
