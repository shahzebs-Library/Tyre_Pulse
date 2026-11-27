/// The Fleet Supervisor's team: their drivers, the vehicle each one drives,
/// and the charges and fines they issue.
///
/// Server contract (migration `20261127140000_fleet_supervisor_driver_management`):
///   * `fleet_supervisor_drivers(p_view 'mine'|'available', p_search, p_offset)`
///   * `fleet_supervisor_assignment_history(p_driver_id)`
///   * `fleet_supervisor_command(p_action, p_payload, p_request_id)` with
///     `take_driver`, `assign_vehicle`, `unassign_vehicle`, `release_driver`.
/// Charges and fines go through the existing `driver_workspace_command`
/// (`charge_issue`, `create_fine`). The server enforces every rule again; the
/// checks here only stop an obviously incomplete form being sent.
///
/// Everything in this file is pure.
library;

/// Which list the supervisor is looking at.
enum FleetTeamView {
  /// Drivers whose open assignment names this supervisor.
  mine('mine'),

  /// Active drivers in scope with no supervisor yet.
  available('available');

  const FleetTeamView(this.wire);
  final String wire;
}

/// The four team actions the server accepts.
abstract final class FleetTeamAction {
  static const String take = 'take_driver';
  static const String assignVehicle = 'assign_vehicle';
  static const String unassignVehicle = 'unassign_vehicle';
  static const String release = 'release_driver';

  static const Set<String> all = <String>{
    take,
    assignVehicle,
    unassignVehicle,
    release,
  };
}

String? _s(Object? v) {
  if (v == null) return null;
  final String t = '$v'.trim();
  return t.isEmpty ? null : t;
}

int _i(Object? v) => v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0;

double? _d(Object? v) => v is num ? v.toDouble() : double.tryParse('$v');

DateTime? _t(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

/// One row of `fleet_supervisor_drivers`.
final class FleetTeamDriver {
  const FleetTeamDriver({
    required this.id,
    required this.employeeId,
    required this.name,
    this.phone,
    this.site,
    this.country,
    this.status,
    this.loginLinked = false,
    this.assignedSince,
    this.vehicleId,
    this.assetNo,
    this.registrationNo,
    this.vehicleType,
    this.openCharges = 0,
    this.openFines = 0,
    this.lastKm,
    this.lastKmDate,
  });

  factory FleetTeamDriver.fromRow(Map<String, Object?> row) => FleetTeamDriver(
        id: _s(row['id']) ?? '',
        employeeId: _s(row['driver_id']) ?? '',
        name: _s(row['driver_name']) ?? '',
        phone: _s(row['phone']),
        site: _s(row['site']),
        country: _s(row['country']),
        status: _s(row['status']),
        loginLinked: row['login_linked'] == true,
        assignedSince: _t(row['assigned_since']),
        vehicleId: _s(row['vehicle_id']),
        assetNo: _s(row['asset_no']),
        registrationNo: _s(row['registration_no']),
        vehicleType: _s(row['vehicle_type']),
        openCharges: _i(row['open_charges']),
        openFines: _i(row['open_fines']),
        lastKm: _d(row['last_km']),
        lastKmDate: _t(row['last_km_date']),
      );

  final String id;
  final String employeeId;
  final String name;
  final String? phone;
  final String? site;
  final String? country;
  final String? status;
  final bool loginLinked;
  final DateTime? assignedSince;
  final String? vehicleId;
  final String? assetNo;
  final String? registrationNo;
  final String? vehicleType;
  final int openCharges;
  final int openFines;
  final double? lastKm;
  final DateTime? lastKmDate;

  bool get hasVehicle => vehicleId != null;

  FleetTeamDriver withVehicle(FleetVehicleOption? v) => FleetTeamDriver(
        id: id,
        employeeId: employeeId,
        name: name,
        phone: phone,
        site: site ?? v?.site,
        country: country,
        status: status,
        loginLinked: loginLinked,
        assignedSince: assignedSince,
        vehicleId: v?.id,
        assetNo: v?.assetNo,
        registrationNo: v?.registrationNo,
        vehicleType: v?.vehicleType,
        openCharges: openCharges,
        openFines: openFines,
      );
}

/// One page of the team list. The server returns up to 101 rows; 101 means
/// there is another page.
final class FleetTeamPage {
  factory FleetTeamPage.fromResult(Object? result) {
    if (result is! Map || result['rows'] is! List) {
      throw const FormatException('Team list is unavailable.');
    }
    final List<FleetTeamDriver> all = <FleetTeamDriver>[
      for (final Object? r in result['rows'] as List<Object?>)
        if (r is Map) FleetTeamDriver.fromRow(Map<String, Object?>.from(r)),
    ];
    return FleetTeamPage(
      rows: all.take(pageSize).toList(),
      hasMore: all.length > pageSize,
    );
  }
  const FleetTeamPage({required this.rows, required this.hasMore});

  static const int pageSize = 100;

  final List<FleetTeamDriver> rows;
  final bool hasMore;
}

/// One assignment row, newest first. A row with an end date is history.
final class FleetAssignment {
  const FleetAssignment({
    required this.id,
    required this.startsAt,
    this.endsAt,
    this.reason,
    this.assetNo,
    this.registrationNo,
    this.supervisorName,
    this.managerName,
    this.assignedByName,
  });

  factory FleetAssignment.fromRow(Map<String, Object?> row) => FleetAssignment(
        id: _s(row['id']) ?? '',
        startsAt: _t(row['starts_at']),
        endsAt: _t(row['ends_at']),
        reason: _s(row['reason']),
        assetNo: _s(row['asset_no']),
        registrationNo: _s(row['registration_no']),
        supervisorName: _s(row['supervisor_name']),
        managerName: _s(row['manager_name']),
        assignedByName: _s(row['assigned_by_name']),
      );

  final String id;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final String? reason;
  final String? assetNo;
  final String? registrationNo;
  final String? supervisorName;
  final String? managerName;
  final String? assignedByName;

  bool get isCurrent => endsAt == null;
}

List<FleetAssignment> fleetAssignmentsFrom(Object? result) {
  if (result is! Map || result['rows'] is! List) {
    throw const FormatException('Assignment history is unavailable.');
  }
  return <FleetAssignment>[
    for (final Object? r in result['rows'] as List<Object?>)
      if (r is Map) FleetAssignment.fromRow(Map<String, Object?>.from(r)),
  ];
}

/// A vehicle the supervisor may give a driver.
final class FleetVehicleOption {
  const FleetVehicleOption({
    required this.id,
    required this.assetNo,
    this.registrationNo,
    this.site,
    this.vehicleType,
    this.country,
  });

  factory FleetVehicleOption.fromRow(Map<String, Object?> row) =>
      FleetVehicleOption(
        id: _s(row['id']) ?? '',
        assetNo: _s(row['asset_no']) ?? '',
        registrationNo: _s(row['registration_no']),
        site: _s(row['site']),
        vehicleType: _s(row['vehicle_type']),
        country: _s(row['country']),
      );

  final String id;
  final String assetNo;
  final String? registrationNo;
  final String? site;
  final String? vehicleType;
  final String? country;
}

/// The answer to a team command.
sealed class FleetCommandOutcome {
  const FleetCommandOutcome();

  static FleetCommandOutcome fromResult(Object? result) {
    if (result is! Map) {
      throw const FormatException('The server did not confirm the change.');
    }
    final Object? conflict = result['conflict'];
    if (result['ok'] == false && conflict is Map) {
      return FleetVehicleConflict(
        driverId: _s(conflict['driver_id']) ?? '',
        driverName: _s(conflict['driver_name']) ?? '',
        assetNo: _s(conflict['asset_no']),
      );
    }
    if (result['ok'] == true) return const FleetCommandDone();
    throw const FormatException('The server did not confirm the change.');
  }
}

final class FleetCommandDone extends FleetCommandOutcome {
  const FleetCommandDone();
}

/// The vehicle is already with another driver. Nothing was written; the user
/// must confirm the move, then the call is sent again with `move_from_driver`.
final class FleetVehicleConflict extends FleetCommandOutcome {
  const FleetVehicleConflict({
    required this.driverId,
    required this.driverName,
    this.assetNo,
  });

  final String driverId;
  final String driverName;
  final String? assetNo;
}

/// A reason is kept on every assignment row (server CHECK 3..2000).
bool fleetReasonValid(String reason) {
  final int n = reason.trim().length;
  return n >= 3 && n <= 2000;
}

/// The charge categories a supervisor issues from the phone. `traffic_fine`
/// is left out on purpose: a traffic fine charge must link an approved
/// traffic fine record, which is the web review step. The supervisor issues
/// the traffic fine itself with [FleetFineDraft].
const List<String> fleetChargeCategories = <String>[
  'accident_damage',
  'tyre_damage',
  'handover_damage',
  'missing_item',
  'other',
];

/// Damage categories need a photo and a fault finding (Saudi Labour Law
/// Art 91). Mirror of `private.driver_charge_needs_photo` and
/// `driverChargeBucket`.
bool fleetChargeNeedsPhoto(String category) => const <String>{
      'accident_damage',
      'tyre_damage',
      'handover_damage',
    }.contains(category);

bool fleetChargeIsDamage(String category) =>
    fleetChargeNeedsPhoto(category) || category == 'missing_item';

const List<String> fleetFaultFindings = <String>[
  'driver_fault',
  'instruction_violation',
  'third_party',
  'force_majeure',
];

/// Currency by driver country. Display and prefill only: the server refuses
/// any other currency (`private.driver_charge_country_currency`).
String? fleetCurrencyFor(String? country) {
  final String k =
      (country ?? '').toUpperCase().replaceAll(RegExp('[^A-Z]'), '');
  if (const <String>{'KSA', 'SA', 'SAU', 'SAUDIARABIA'}.contains(k)) {
    return 'SAR';
  }
  if (const <String>{'UAE', 'AE', 'ARE', 'UNITEDARABEMIRATES'}.contains(k)) {
    return 'AED';
  }
  if (const <String>{'EGYPT', 'EG', 'EGY'}.contains(k)) return 'EGP';
  return null;
}

/// Why a form cannot be sent yet.
enum FleetFormIssue {
  amount,
  currency,
  basis,
  photo,
  faultFinding,
  incidentInFuture,
  authority,
  reference,
  vehicle,
}

double? _amount(String raw) {
  final double? v = double.tryParse(raw.trim().replaceAll(',', ''));
  if (v == null || !v.isFinite || v <= 0 || v > 1000000) return null;
  return v;
}

/// A charge being written on the phone.
final class FleetChargeDraft {
  const FleetChargeDraft({
    required this.driverId,
    required this.category,
    required this.amount,
    required this.currency,
    required this.basis,
    required this.incidentAt,
    this.vehicleId,
    this.faultFinding,
    this.photoRefs = const <String>[],
    this.documentRef = '',
  });

  final String driverId;
  final String category;
  final String amount;
  final String currency;
  final String basis;
  final DateTime incidentAt;
  final String? vehicleId;
  final String? faultFinding;

  /// `tp-storage://tyre-photos/modules/driver-charge/...` references.
  final List<String> photoRefs;

  /// A paper reference (job card, notice, statement number).
  final String documentRef;

  List<FleetFormIssue> issues({DateTime? now}) => <FleetFormIssue>{
        if (_amount(amount) == null) FleetFormIssue.amount,
        if (!RegExp(r'^[A-Z]{3}$').hasMatch(currency.trim().toUpperCase()))
          FleetFormIssue.currency,
        if (basis.trim().length < 10 || basis.trim().length > 4000)
          FleetFormIssue.basis,
        if (fleetChargeNeedsPhoto(category) && photoRefs.isEmpty)
          FleetFormIssue.photo,
        if (photoRefs.isEmpty && documentRef.trim().isEmpty)
          FleetFormIssue.photo,
        if (fleetChargeIsDamage(category) && faultFinding == null)
          FleetFormIssue.faultFinding,
        if (incidentAt
            .isAfter((now ?? DateTime.now()).add(const Duration(minutes: 1))))
          FleetFormIssue.incidentInFuture,
      }.toList();

  Map<String, Object?> toPayload() => <String, Object?>{
        'driver_id': driverId,
        'category': category,
        'source_type': 'none',
        'amount': _amount(amount),
        'currency': currency.trim().toUpperCase(),
        'basis': basis.trim(),
        'incident_at': incidentAt.toUtc().toIso8601String(),
        if (vehicleId != null) 'vehicle_id': vehicleId,
        if (fleetChargeIsDamage(category) && faultFinding != null)
          'fault_finding': faultFinding,
        'evidence': <Map<String, String>>[
          for (int i = 0; i < photoRefs.length; i++)
            <String, String>{
              'kind': 'photo',
              'ref': photoRefs[i],
              'label': 'Photo ${i + 1}',
            },
          if (documentRef.trim().isNotEmpty)
            <String, String>{
              'kind': 'document',
              'ref': documentRef.trim(),
              'label': 'Reference',
            },
        ],
      };
}

/// A traffic fine notice being recorded on the phone (`create_fine`).
final class FleetFineDraft {
  const FleetFineDraft({
    required this.driverId,
    required this.vehicleId,
    required this.authority,
    required this.noticeReference,
    required this.incidentAt,
    required this.amount,
    required this.currency,
    required this.description,
    required this.assignmentReason,
    this.dueDate,
  });

  final String driverId;
  final String? vehicleId;
  final String authority;
  final String noticeReference;
  final DateTime incidentAt;
  final DateTime? dueDate;
  final String amount;
  final String currency;
  final String description;
  final String assignmentReason;

  List<FleetFormIssue> issues({DateTime? now}) => <FleetFormIssue>[
        if (vehicleId == null) FleetFormIssue.vehicle,
        if (authority.trim().length < 2) FleetFormIssue.authority,
        if (noticeReference.trim().length < 2) FleetFormIssue.reference,
        if (_amount(amount) == null) FleetFormIssue.amount,
        if (!RegExp(r'^[A-Z]{3}$').hasMatch(currency.trim().toUpperCase()))
          FleetFormIssue.currency,
        if (assignmentReason.trim().length < 3) FleetFormIssue.basis,
        if (incidentAt
            .isAfter((now ?? DateTime.now()).add(const Duration(minutes: 1))))
          FleetFormIssue.incidentInFuture,
      ];

  Map<String, Object?> toPayload() => <String, Object?>{
        'driver_id': driverId,
        'vehicle_id': vehicleId,
        'authority': authority.trim(),
        'notice_reference': noticeReference.trim(),
        'incident_at': incidentAt.toUtc().toIso8601String(),
        if (dueDate != null)
          'due_date': '${dueDate!.year.toString().padLeft(4, '0')}-'
              '${dueDate!.month.toString().padLeft(2, '0')}-'
              '${dueDate!.day.toString().padLeft(2, '0')}',
        'amount': _amount(amount),
        'currency': currency.trim().toUpperCase(),
        'description': description.trim(),
        'assignment_reason': assignmentReason.trim(),
      };
}
