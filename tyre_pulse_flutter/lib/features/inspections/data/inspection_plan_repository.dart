/// Reads the inspections this user has been PLANNED to do.
///
/// # Why this goes through an RPC and not a table read
///
/// A plan row on its own cannot answer the only question that matters - has
/// this been done? An inspection carries no link back to the plan that asked
/// for it, so "done" means "that vehicle has an inspection dated inside the
/// plan's grace window", which is a JOIN. `get_schedule_adherence` does that
/// join server-side and is the single definition of the resulting state; see
/// `domain/inspection_plan.dart` for why the phone must not reproduce it.
///
/// # The row cap is real and is reported, not hidden
///
/// The RPC is set-returning, so it is capped at 1000 rows like any read
/// (`SupabaseRpcs.setReturning`). It returns every plan in the window for the
/// caller's whole country scope, not just this user's, so the cap is shared
/// with colleagues' plans. The window is kept short for that reason, and
/// [InspectionPlanPage.truncated] says so when a result touches the ceiling -
/// a crew member must never be shown a short list that looks complete.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';

/// The server's per-response row ceiling. Not a limit this client chooses.
const int kPlanRowCap = 1000;

/// How far back and forward the phone asks for.
///
/// Back far enough that work missed last month is still visible - a missed
/// plan does not stop mattering when its day passes - and forward far enough
/// to pack for the week ahead without pulling a whole quarter onto the device.
const int kPlanDaysBack = 45;
const int kPlanDaysAhead = 21;

/// One read's worth of plans, plus whether the read was complete.
final class InspectionPlanPage {
  const InspectionPlanPage({
    required this.plans,
    required this.truncated,
  });

  const InspectionPlanPage.empty()
      : plans = const <InspectionPlan>[],
        truncated = false;

  final List<InspectionPlan> plans;

  /// True when the RPC returned a full page, so plans may exist that this
  /// result does not contain. Surfaced to the user, never swallowed.
  final bool truncated;

  InspectionPlanSummary get summary => InspectionPlanSummary.of(plans);
}

abstract interface class InspectionPlanRepository {
  /// This user's own plans, worst-state first.
  ///
  /// [assignedTo] is the profile id. Filtering happens on the CLIENT because
  /// the RPC has no assignee argument - adding one would be the better fix and
  /// is recorded as such, but inventing a parameter the live function does not
  /// take produces a 42883 that reads to a user as "function does not exist".
  Future<InspectionPlanPage> myPlans({
    required String assignedTo,
    String? country,
    int daysBack,
    int daysAhead,
    DateTime? now,
  });
}

final class SupabaseInspectionPlanRepository
    with SupabaseGateway
    implements InspectionPlanRepository {
  SupabaseInspectionPlanRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<InspectionPlanPage> myPlans({
    required String assignedTo,
    String? country,
    int daysBack = kPlanDaysBack,
    int daysAhead = kPlanDaysAhead,
    DateTime? now,
  }) async {
    final String owner = assignedTo.trim();
    // Without an owner every colleague's plans would pass the filter below and
    // the crew member would be shown the whole country's work as their own.
    if (owner.isEmpty) return const InspectionPlanPage.empty();

    final DateTime today = (now ?? DateTime.now()).toUtc();
    final DateTime from = today.subtract(Duration(days: daysBack));
    final DateTime to = today.add(Duration(days: daysAhead));

    final Object? result = await guard<Object?>(
      () => _client.rpc(
        SupabaseRpcs.getScheduleAdherence,
        params: <String, Object?>{
          // 'All' is the app's own all-countries sentinel and is NOT a country
          // anybody is scoped to, so it is sent as null - the RPC then applies
          // no country predicate and RLS alone bounds the read.
          'p_country': _scopeCountry(country),
          'p_from': _day(from),
          'p_to': _day(to),
        },
      ),
    );

    if (result is! List) return const InspectionPlanPage.empty();

    final List<InspectionPlan> mine = <InspectionPlan>[];
    for (final Object? row in result) {
      if (row is! Map) continue;
      final Map<String, dynamic> typed = Map<String, dynamic>.from(row);
      final InspectionPlan plan = InspectionPlan.fromRow(typed);
      if (plan.id.isEmpty) continue;
      if (plan.assignedTo != owner) continue;
      mine.add(plan);
    }
    mine.sort(comparePlansForCrew);

    return InspectionPlanPage(
      plans: mine,
      truncated: result.length >= kPlanRowCap,
    );
  }

  static String? _scopeCountry(String? country) {
    final String trimmed = country?.trim() ?? '';
    if (trimmed.isEmpty || trimmed.toLowerCase() == 'all') return null;
    return trimmed;
  }

  /// `date` columns want a bare day, and a full ISO timestamp is not one.
  static String _day(DateTime value) {
    final String month = value.month.toString().padLeft(2, '0');
    final String day = value.day.toString().padLeft(2, '0');
    return '${value.year}-$month-$day';
  }
}
