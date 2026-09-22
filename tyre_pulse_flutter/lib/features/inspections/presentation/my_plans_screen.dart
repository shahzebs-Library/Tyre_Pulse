/// "My plans" - the inspections this person has been asked to do.
///
/// # Why this screen exists
///
/// Until it did, planning was one-directional. A supervisor could build a
/// schedule on the web, assign it to a named inspector, and that inspector had
/// no way to see it: neither mobile app read `inspection_schedules` at all. The
/// plan existed, the work did not reach the person, and the adherence board
/// then reported the result as missed. This is the other half of that loop.
///
/// # What it deliberately does not do
///
/// It does not let the crew edit or complete a plan. A plan is closed by DOING
/// the inspection - the server matches the inspection to the plan by vehicle
/// and date window - so a "mark done" button here would let somebody close work
/// they had not carried out, and the adherence figures would stop meaning
/// anything. The only action offered is to start the inspection the plan asks
/// for, which is the honest way to close it.
///
/// # Localisation
///
/// Every string here comes from the ARB catalogues, like every other screen in
/// this app. That is not house style for its own sake: this screen is FOR the
/// field crew, and the crew reads Arabic and Urdu. Dates are formatted through
/// [MaterialLocalizations] rather than a month table of our own, because a
/// hand-written English month list is exactly the kind of thing that looks
/// correct in review and then renders "12 Mar 2026" to an Arabic reader.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_plan_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';

class MyPlansScreen extends ConsumerWidget {
  const MyPlansScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<InspectionPlanPage> plans =
        ref.watch(myInspectionPlansProvider);

    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.myPlansNavTitle,
        subtitle: l10n.myPlansSubtitle,
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myInspectionPlansProvider),
        child: plans.when(
          loading: () => TpLoadingState(message: l10n.myPlansLoadingMessage),
          error: (Object error, StackTrace _) => ListView(
            children: <Widget>[
              const SizedBox(height: TpSpace.xl),
              TpErrorState(
                error: _asAppError(error),
                onRetry: () => ref.invalidate(myInspectionPlansProvider),
              ),
            ],
          ),
          data: (InspectionPlanPage page) => _PlanList(
            page: page,
            myName: ref.watch(workspaceContextProvider)?.fullName,
          ),
        ),
      ),
    );
  }
}

class _PlanList extends StatelessWidget {
  const _PlanList({required this.page, this.myName});

  final InspectionPlanPage page;
  final String? myName;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (page.plans.isEmpty) {
      // An empty list here means "nobody has planned work for you", which is a
      // real and common answer - not a failure, and not something to dress up.
      return ListView(
        children: <Widget>[
          const SizedBox(height: TpSpace.xl),
          TpEmptyState(
            icon: Icons.event_available_outlined,
            title: l10n.myPlansEmptyTitle,
            message: l10n.myPlansEmptyMessage,
          ),
        ],
      );
    }

    final Map<DateTime, List<InspectionPlan>> byDay = groupPlansByDay(
      page.plans,
    );

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        _SummaryRow(summary: page.summary),
        if (page.truncated) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          const _TruncationNotice(),
        ],
        const SizedBox(height: TpSpace.lg),
        for (final MapEntry<DateTime, List<InspectionPlan>> day
            in byDay.entries) ...<Widget>[
          _DayHeading(day: day.key),
          const SizedBox(height: TpSpace.sm),
          for (final InspectionPlan plan in day.value) ...<Widget>[
            _PlanCard(plan: plan, myName: myName),
            const SizedBox(height: TpSpace.sm),
          ],
          const SizedBox(height: TpSpace.md),
        ],
      ],
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.summary});

  final InspectionPlanSummary summary;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    // The tallies deliberately REUSE the plan-state labels rather than
    // carrying a second vocabulary of their own. A row reading "Missed" and a
    // chip reading something else for the same state is how two views of one
    // fact drift apart.
    return Row(
      children: <Widget>[
        Expanded(
          child: _Tally(
            label: l10n.myPlansStateMissed,
            value: summary.missed,
            status: TpStatus.critical,
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: _Tally(
            label: l10n.myPlansStateDue,
            value: summary.due,
            status: TpStatus.warning,
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: _Tally(
            label: l10n.myPlansStateUpcoming,
            value: summary.upcoming,
            status: TpStatus.info,
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: _Tally(
            label: l10n.myPlansStateDone,
            value: summary.done,
            status: TpStatus.ok,
          ),
        ),
      ],
    );
  }
}

class _Tally extends StatelessWidget {
  const _Tally({
    required this.label,
    required this.value,
    required this.status,
  });

  final String label;
  final int value;
  final TpStatus status;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return TpCard(
      padding: const EdgeInsets.symmetric(
        vertical: TpSpace.md,
        horizontal: TpSpace.sm,
      ),
      child: Column(
        children: <Widget>[
          Text(
            '$value',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
              color: value == 0 ? theme.disabledColor : null,
            ),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            label,
            textAlign: TextAlign.center,
            style: theme.textTheme.labelSmall,
          ),
        ],
      ),
    );
  }
}

class _TruncationNotice extends StatelessWidget {
  const _TruncationNotice();

  @override
  Widget build(BuildContext context) {
    return TpCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Icon(Icons.info_outline, size: 18),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              AppLocalizations.of(context).myPlansTruncatedNotice,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

class _DayHeading extends StatelessWidget {
  const _DayHeading({required this.day});

  final DateTime day;

  @override
  Widget build(BuildContext context) {
    return Text(
      _friendlyDay(context, day),
      style: Theme.of(context)
          .textTheme
          .titleSmall
          ?.copyWith(fontWeight: FontWeight.w700),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.plan, this.myName});

  final InspectionPlan plan;
  final String? myName;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool actionable = plan.isOutstanding;
    final String? footnote = _footnoteFor(context, plan, myName);

    return TpCard(
      // Only outstanding work is tappable. Offering "start inspection" on a
      // plan that is already done would invite a duplicate inspection, and the
      // duplicate would then look like somebody working twice.
      onTap: actionable
          ? () => context.go(const NewInspectionRoute().location)
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  plan.assetNo,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              TpStatusChip(
                status: _statusFor(plan.state),
                label: _labelFor(l10n, plan.state),
                isCompact: true,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Text(_subtitleFor(l10n, plan), style: theme.textTheme.bodySmall),
          if (plan.notes != null) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(plan.notes!, style: theme.textTheme.bodySmall),
          ],
          if (footnote != null) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              footnote,
              style: theme.textTheme.labelSmall?.copyWith(
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The one place a plan state becomes a colour.
TpStatus _statusFor(InspectionPlanState state) => switch (state) {
      InspectionPlanState.missed => TpStatus.critical,
      InspectionPlanState.due => TpStatus.warning,
      InspectionPlanState.started => TpStatus.info,
      InspectionPlanState.done => TpStatus.ok,
      // Upcoming, cancelled and unknown all carry no judgement. `unknown` in
      // particular must never borrow a colour that asserts a meaning this
      // build does not actually know.
      InspectionPlanState.upcoming ||
      InspectionPlanState.cancelled ||
      InspectionPlanState.unknown =>
        TpStatus.neutral,
    };

String _labelFor(AppLocalizations l10n, InspectionPlanState state) =>
    switch (state) {
      InspectionPlanState.missed => l10n.myPlansStateMissed,
      InspectionPlanState.due => l10n.myPlansStateDue,
      InspectionPlanState.started => l10n.myPlansStateStarted,
      InspectionPlanState.upcoming => l10n.myPlansStateUpcoming,
      InspectionPlanState.done => l10n.myPlansStateDone,
      InspectionPlanState.cancelled => l10n.myPlansStateCancelled,
      // Honest rather than invented - the row is shown, the state is not
      // claimed.
      InspectionPlanState.unknown => l10n.myPlansStateUnknown,
    };

String _subtitleFor(AppLocalizations l10n, InspectionPlan plan) {
  final List<String> parts = <String>[
    if (plan.site != null) plan.site!,
    if (plan.vehicleType != null) plan.vehicleType!,
    if (plan.inspectionTime != null) plan.inspectionTime!,
    if (plan.team != null) plan.team!,
  ];
  return parts.isEmpty ? l10n.myPlansNoLocation : parts.join('  |  ');
}

/// The extra line under a plan, when there is something true worth adding.
///
/// Returns null rather than an empty string so the caller can omit the widget
/// entirely - a blank line reads as a rendering fault.
String? _footnoteFor(
  BuildContext context,
  InspectionPlan plan,
  String? myName,
) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  if (plan.state == InspectionPlanState.done) {
    if (plan.coveredBySomeoneElse(myName) && plan.matchedInspector != null) {
      return l10n.myPlansCoveredBy(plan.matchedInspector!);
    }
    return plan.matchedDate == null
        ? l10n.myPlansCompleted
        : l10n.myPlansCompletedOn(_friendlyDay(context, plan.matchedDate!));
  }
  if (plan.state == InspectionPlanState.missed && plan.daysLate > 0) {
    return l10n.myPlansOverdue(plan.daysLate);
  }
  return null;
}

/// Today / Tomorrow / Yesterday by name, anything else through the platform's
/// own locale-aware date format.
String _friendlyDay(BuildContext context, DateTime day) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final DateTime now = DateTime.now().toUtc();
  final DateTime today = DateTime.utc(now.year, now.month, now.day);
  final int delta = day.difference(today).inDays;
  if (delta == 0) return l10n.dateGroupToday;
  if (delta == 1) return l10n.dateGroupTomorrow;
  if (delta == -1) return l10n.dateGroupYesterday;
  return MaterialLocalizations.of(context).formatMediumDate(day);
}

/// Unwraps the error the repository threw into something [TpErrorState] can
/// render. Mirrors the alerts screen's own mapping.
AppError _asAppError(Object error) => switch (error) {
      final SupabaseFailure failure => failure.error,
      final AppError appError => appError,
      _ => const AppError.network(),
    };
