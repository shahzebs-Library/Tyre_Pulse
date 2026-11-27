/// The server reads behind each role's Home tiles and rows.
///
/// Every read is PostgREST on a table the app already reads elsewhere, under
/// the caller's own RLS. Counts are exact head counts (`count=exact`) unless
/// the doc says the read is a bounded page, in which case the result carries
/// `capped` so Home shows `N+` instead of a false total. A failed read throws
/// so Home says "Could not check" rather than 0.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/workspace/company_scope.dart';
import 'package:tyre_pulse/features/home/data/home_repository.dart'
    show homeCountryFilter;
import 'package:tyre_pulse/features/preventive_maintenance/domain/maintenance_work_order.dart'
    show kTerminalWorkOrderStatuses;
import 'package:tyre_pulse/features/workshop/domain/workshop_live.dart';

/// A count that may come from a bounded page.
final class HomeCount {
  const HomeCount(this.value, {this.capped = false});

  final int value;

  /// True when [value] is the page size, so the real number may be higher.
  final bool capped;

  String get text => capped ? '$value+' : '$value';
}

/// The signed-in driver's own meter reading today.
final class HomeMeterToday {
  const HomeMeterToday({required this.assetNo, this.km, this.at});

  final String assetNo;
  final num? km;
  final DateTime? at;
}

/// The vehicle this driver last logged a meter reading for, and its last wash.
///
/// Vehicle assignments are empty in production, so the last asset the
/// person logged in `odometer_logs` is the honest "my vehicle".
final class HomeMyVehicle {
  const HomeMyVehicle({required this.assetNo, this.site, this.lastWash});

  final String assetNo;
  final String? site;
  final DateTime? lastWash;
}

/// Who in the workshop is doing what right now, from today's
/// `tech_activity_events`.
///
/// `workshop_attendance` holds no rows, so "free" means checked in by an
/// event and not working; somebody who never checked in today is not
/// counted at all. Absent cannot be computed and is never shown.
final class HomeTeamNow {
  const HomeTeamNow({
    required this.working,
    required this.waiting,
    required this.free,
    required this.waitingParts,
    required this.blockedOver30,
    this.capped = false,
  });

  final int working;
  final int waiting;
  final int free;
  final int waitingParts;

  /// Waiting (parts, tools, approval, vehicle) for more than 30 minutes.
  final int blockedOver30;
  final bool capped;
}

/// The statuses that count as "waiting".
const Set<WorkshopStatus> _waitingStatuses = <WorkshopStatus>{
  WorkshopStatus.waitingParts,
  WorkshopStatus.waitingApproval,
  WorkshopStatus.waitingTools,
  WorkshopStatus.waitingVehicle,
};

/// Pure: [rows] are `tech_activity_events` rows (`user_id`, `event_type`,
/// `reason_code`, `at`) for today. One status per person, measured at [now].
HomeTeamNow teamNowFromEvents(
  List<Map<String, dynamic>> rows, {
  required DateTime now,
  bool capped = false,
}) {
  final Map<String, List<WorkshopEventLike>> byUser =
      <String, List<WorkshopEventLike>>{};
  for (final Map<String, dynamic> row in rows) {
    final String user = (row['user_id'] ?? '').toString().trim();
    final String type = (row['event_type'] ?? '').toString().trim();
    if (user.isEmpty || type.isEmpty) continue;
    final DateTime? at = DateTime.tryParse((row['at'] ?? '').toString());
    byUser.putIfAbsent(user, () => <WorkshopEventLike>[]).add(
          WorkshopEventLike(
            eventType: type,
            reasonCode: row['reason_code']?.toString(),
            at: at?.toLocal(),
          ),
        );
  }
  int working = 0, waiting = 0, free = 0, parts = 0, blocked = 0;
  for (final List<WorkshopEventLike> events in byUser.values) {
    final bool present = workshopIsCheckedIn(events);
    final WorkshopStatus status =
        workshopStatusFromEvents(events, present: present);
    if (status == WorkshopStatus.working) {
      working++;
    } else if (_waitingStatuses.contains(status)) {
      waiting++;
      if (status == WorkshopStatus.waitingParts) parts++;
      DateTime? since;
      for (final WorkshopEventLike e in events) {
        final DateTime? at = e.at;
        if (at != null && (since == null || at.isAfter(since))) since = at;
      }
      if (since != null && now.difference(since).inMinutes > 30) blocked++;
    } else if (present && status == WorkshopStatus.available) {
      free++;
    }
  }
  return HomeTeamNow(
    working: working,
    waiting: waiting,
    free: free,
    waitingParts: parts,
    blockedOver30: blocked,
    capped: capped,
  );
}

/// Local midnight of [now], as a UTC ISO string for a `gte` filter.
String homeStartOfDayIso(DateTime now) =>
    DateTime(now.year, now.month, now.day).toUtc().toIso8601String();

/// Local `YYYY-MM-DD` of [now].
String homeIsoDay(DateTime now) => '${now.year.toString().padLeft(4, '0')}-'
    '${now.month.toString().padLeft(2, '0')}-'
    '${now.day.toString().padLeft(2, '0')}';

/// The closed tokens `accidentRecordIsClosed` recognises (it trims and
/// lowercases before comparing).
const List<String> homeAccidentClosedTokens = <String>[
  'closed',
  'legacy_closed',
  'fully_closed',
];

/// The `.or(...)` filters, one per lifecycle column `accidentRecordIsClosed`
/// reads, that together mean "open": no column holds a closed token. A NULL
/// column is not closed (`not.in` alone would drop it), hence `is.null`.
///
/// Case agreement with the register's trim + lowercase, checked against the
/// live schema (2026-11-28): `status`, `case_status` and `closure_level` are
/// CHECK-constrained to lowercase tokens (`chk_status`,
/// `chk_accident_case_status`, `chk_accident_closure_level`), so an exact
/// `not.in` is equivalent. `closure_status` is unconstrained free text
/// (live value today: only `open`), so it is compared with `not.ilike` per
/// token - case-insensitive equality, no wildcards. Leading/trailing
/// whitespace on that one column is the only variant the server cannot
/// match; none exists today.
List<String> homeOpenAccidentFilters() {
  final String inList = homeAccidentClosedTokens.join(',');
  String strict(String column) => '$column.is.null,$column.not.in.($inList)';
  final String loose = <String>[
    for (final String t in homeAccidentClosedTokens)
      'closure_status.not.ilike.$t',
  ].join(',');
  return <String>[
    strict('status'),
    strict('case_status'),
    'closure_status.is.null,and($loose)',
    strict('closure_level'),
  ];
}

abstract interface class HomeRoleRepository {
  Future<HomeMeterToday?> myMeterToday({
    required String userId,
    required DateTime now,
  });

  Future<HomeMyVehicle?> myVehicle({required String userId});

  /// Fleet rows with `ops_status = 'breakdown'` (off road).
  Future<int> countOffRoad({String? country});

  /// Accidents none of whose lifecycle columns is a closed token.
  Future<int> countOpenAccidents({String? country});

  /// Active maintenance plans whose `next_due` is before today.
  Future<int> countMaintenanceOverdue({
    required DateTime now,
    String? country,
  });

  /// Checklist sheets in [statuses] not submitted by [excludeUserId].
  Future<int> countChecklistsToSign({
    required List<String> statuses,
    String? excludeUserId,
    String? country,
  });

  /// Open job cards with no `assigned_owner_id` and no active
  /// `wo_assignments` row. A bounded page of 1000 open unowned cards.
  Future<HomeCount> countUnassignedJobs({String? country});

  Future<HomeTeamNow> teamNow({required DateTime now});

  /// Template ids [userId] submitted today.
  Future<Set<String>> mySubmittedTemplateIdsToday({
    required String userId,
    required DateTime now,
  });
}

final class SupabaseHomeRoleRepository
    with SupabaseGateway
    implements HomeRoleRepository {
  SupabaseHomeRoleRepository(this._client, {String? companyId})
      : _companyId = companyId;

  final SupabaseClient _client;

  /// The caller's active company; every count is pinned to it so a super
  /// admin's Home matches the lists the tiles open (company_scope).
  final String? _companyId;

  static final String _terminalWo = '(${kTerminalWorkOrderStatuses.join(',')})';

  @override
  Future<HomeMeterToday?> myMeterToday({
    required String userId,
    required DateTime now,
  }) async {
    if (userId.trim().isEmpty) return null;
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.odometerLogs)
          .select('asset_no,odometer_km,created_at')
          .eq('created_by', userId)
          .eq('reading_date', homeIsoDay(now))
          .order('created_at', ascending: false)
          .limit(1),
    );
    if (rows.isEmpty) return null;
    final Map<String, dynamic> row = rows.first;
    final Object? km = row['odometer_km'];
    return HomeMeterToday(
      assetNo: (row['asset_no'] ?? '').toString(),
      km: km is num ? km : num.tryParse('${km ?? ''}'),
      at: DateTime.tryParse((row['created_at'] ?? '').toString())?.toLocal(),
    );
  }

  @override
  Future<HomeMyVehicle?> myVehicle({required String userId}) async {
    if (userId.trim().isEmpty) return null;
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.odometerLogs)
          .select('asset_no,site')
          .eq('created_by', userId)
          .order('created_at', ascending: false)
          .limit(1),
    );
    if (rows.isEmpty) return null;
    final String asset = (rows.first['asset_no'] ?? '').toString().trim();
    if (asset.isEmpty) return null;
    final List<Map<String, dynamic>> washes =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.washRecords)
          .select('wash_date')
          .eq('asset_no', asset)
          .order('wash_date', ascending: false, nullsFirst: false)
          .limit(1),
    );
    final String? site = rows.first['site']?.toString().trim();
    return HomeMyVehicle(
      assetNo: asset,
      site: site == null || site.isEmpty ? null : site,
      lastWash: washes.isEmpty
          ? null
          : DateTime.tryParse((washes.first['wash_date'] ?? '').toString()),
    );
  }

  Future<int> _count(
    String table,
    PostgrestFilterBuilder<int> Function(PostgrestFilterBuilder<int> q) build, {
    String? country,
  }) =>
      guard<int>(() async {
        PostgrestFilterBuilder<int> query = pinCompany(
          build(_client.from(table).count(CountOption.exact)),
          _companyId,
        );
        final String? filter = homeCountryFilter(country);
        if (filter != null) query = query.or(filter);
        return await query;
      });

  @override
  Future<int> countOffRoad({String? country}) => _count(
        SupabaseTables.vehicleFleet,
        (q) => q.eq('ops_status', 'breakdown'),
        country: country,
      );

  @override
  Future<int> countOpenAccidents({String? country}) => _count(
        SupabaseTables.accidents,
        (q) {
          // The SAME rule the accident register's Open filter applies
          // (`accidentRecordIsClosed`): a case is closed when ANY of its four
          // lifecycle columns carries a closed token, so it is open only when
          // none does. A NULL column is not closed (`not.in` alone would drop
          // it), hence the `is.null` arm on each.
          PostgrestFilterBuilder<int> out = q;
          for (final String filter in homeOpenAccidentFilters()) {
            out = out.or(filter);
          }
          return out;
        },
        country: country,
      );

  @override
  Future<int> countMaintenanceOverdue({
    required DateTime now,
    String? country,
  }) =>
      _count(
        SupabaseTables.pmPrograms,
        (q) => q.eq('status', 'active').lt('next_due', homeIsoDay(now)),
        country: country,
      );

  @override
  Future<int> countChecklistsToSign({
    required List<String> statuses,
    String? excludeUserId,
    String? country,
  }) =>
      _count(
        SupabaseTables.checklistSubmissions,
        (q) {
          PostgrestFilterBuilder<int> out =
              q.inFilter('approval_status', statuses);
          final String me = excludeUserId?.trim() ?? '';
          if (me.isNotEmpty) out = out.neq('submitted_by', me);
          return out;
        },
        country: country,
      );

  @override
  Future<HomeCount> countUnassignedJobs({String? country}) async {
    const int page = 1000;
    final List<Map<String, dynamic>> open =
        await guard<List<Map<String, dynamic>>>(() async {
      var query = pinCompany(
        _client
            .from(SupabaseTables.workOrders)
            .select('id')
            .isFilter('assigned_owner_id', null)
            .not('status', 'in', _terminalWo),
        _companyId,
      );
      final String? filter = homeCountryFilter(country);
      if (filter != null) query = query.or(filter);
      return await query.order('id').limit(page);
    });
    final List<String> ids = <String>[
      for (final Map<String, dynamic> r in open)
        if ((r['id'] ?? '').toString().isNotEmpty) r['id'].toString(),
    ];
    final Set<String> assigned = <String>{};
    for (int start = 0; start < ids.length; start += 200) {
      final int end = start + 200 > ids.length ? ids.length : start + 200;
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(
        () => _client
            .from(SupabaseTables.woAssignments)
            .select('job_id')
            .eq('active', true)
            .inFilter('job_id', ids.sublist(start, end)),
      );
      for (final Map<String, dynamic> r in rows) {
        assigned.add((r['job_id'] ?? '').toString());
      }
    }
    return HomeCount(
      ids.where((String id) => !assigned.contains(id)).length,
      capped: open.length >= page,
    );
  }

  @override
  Future<HomeTeamNow> teamNow({required DateTime now}) async {
    const int page = 3000;
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.techActivityEvents)
          .select('user_id,event_type,reason_code,at')
          .gte('at', homeStartOfDayIso(now))
          .order('at', ascending: false)
          .limit(page),
    );
    return teamNowFromEvents(rows, now: now, capped: rows.length >= page);
  }

  @override
  Future<Set<String>> mySubmittedTemplateIdsToday({
    required String userId,
    required DateTime now,
  }) async {
    if (userId.trim().isEmpty) return const <String>{};
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.checklistSubmissions)
          .select('template_id')
          .eq('submitted_by', userId)
          .gte('submitted_at', homeStartOfDayIso(now))
          .limit(500),
    );
    return <String>{
      for (final Map<String, dynamic> r in rows)
        if ((r['template_id'] ?? '').toString().isNotEmpty)
          r['template_id'].toString(),
    };
  }
}
