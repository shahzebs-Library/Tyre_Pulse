library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';
import 'package:tyre_pulse/features/preventive_maintenance/pm_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/presentation/pm_copy.dart';

class PreventiveMaintenanceScreen extends ConsumerStatefulWidget {
  const PreventiveMaintenanceScreen({required this.route, super.key});
  final PreventiveMaintenanceRoute route;

  @override
  ConsumerState<PreventiveMaintenanceScreen> createState() =>
      _PreventiveMaintenanceScreenState();
}

class _PreventiveMaintenanceScreenState
    extends ConsumerState<PreventiveMaintenanceScreen> {
  bool dueOnly = true;

  @override
  Widget build(BuildContext context) {
    final PmCopy copy = PmCopy.of(context);
    final AsyncValue<List<PmPlan>> state = ref.watch(activePmPlansProvider);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('title'),
        backFallback: fallback,
      ),
      body: state.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace stackTrace) => TpErrorState(
          error: switch (error) {
            final SupabaseFailure failure => failure.error,
            final AppError appError => appError,
            _ => AppError(
                kind: AppErrorKind.unknown,
                message: copy('loadFailed'),
                cause: error,
                isRetryable: true,
              ),
          },
          onRetry: () => ref.invalidate(activePmPlansProvider),
        ),
        data: (List<PmPlan> plans) => _content(copy, plans),
      ),
    );
  }

  Widget _content(PmCopy copy, List<PmPlan> plans) {
    final DateTime now = DateTime.now();
    final int overdue = plans
        .where((PmPlan plan) => plan.dueBand(now) == PmDueBand.overdue)
        .length;
    final int soon = plans
        .where((PmPlan plan) => plan.dueBand(now) == PmDueBand.dueSoon)
        .length;
    final List<PmPlan> visible = dueOnly
        ? plans
            .where(
              (PmPlan plan) => <PmDueBand>{
                PmDueBand.overdue,
                PmDueBand.dueSoon,
              }.contains(plan.dueBand(now)),
            )
            .toList(growable: false)
        : plans;
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(activePmPlansProvider);
        await ref.read(activePmPlansProvider.future);
      },
      child: ListView(
        key: const Key('pm.list'),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: _PmMetric(value: overdue, label: copy('overdue')),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(child: _PmMetric(value: soon, label: copy('dueSoon'))),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: _PmMetric(value: plans.length, label: copy('active')),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          SegmentedButton<bool>(
            segments: <ButtonSegment<bool>>[
              ButtonSegment<bool>(value: true, label: Text(copy('due'))),
              ButtonSegment<bool>(value: false, label: Text(copy('all'))),
            ],
            selected: <bool>{dueOnly},
            onSelectionChanged: (Set<bool> value) =>
                setState(() => dueOnly = value.single),
          ),
          const SizedBox(height: TpSpace.md),
          if (visible.isEmpty)
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.45,
              child: TpEmptyState(
                icon: Icons.build_circle_outlined,
                title: copy('empty'),
                message: dueOnly ? copy('emptyDue') : copy('emptyAll'),
              ),
            )
          else
            for (final PmPlan plan in visible) ...<Widget>[
              _PmPlanCard(
                plan: plan,
                now: now,
                copy: copy,
                onRecord: () => unawaited(_record(plan, copy)),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
        ],
      ),
    );
  }

  Future<void> _record(PmPlan plan, PmCopy copy) async {
    final bool? saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext context) => _RecordServiceSheet(
        plan: plan,
        copy: copy,
      ),
    );
    if (saved == true) ref.invalidate(activePmPlansProvider);
  }
}

class _PmMetric extends StatelessWidget {
  const _PmMetric({required this.value, required this.label});
  final int value;
  final String label;

  @override
  Widget build(BuildContext context) => TpCard(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          children: <Widget>[
            Text('$value', style: Theme.of(context).textTheme.headlineSmall),
            Text(label, textAlign: TextAlign.center),
          ],
        ),
      );
}

class _PmPlanCard extends StatelessWidget {
  const _PmPlanCard({
    required this.plan,
    required this.now,
    required this.copy,
    required this.onRecord,
  });
  final PmPlan plan;
  final DateTime now;
  final PmCopy copy;
  final VoidCallback onRecord;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final PmDueBand band = plan.dueBand(now);
    final int? days = plan.daysToDue(now);
    final TpStatus status = switch (band) {
      PmDueBand.overdue => TpStatus.critical,
      PmDueBand.dueSoon => TpStatus.warning,
      PmDueBand.ok => TpStatus.ok,
      PmDueBand.none => TpStatus.neutral,
    };
    final List<String> meta = <String>[
      if (plan.assetNo != null) plan.assetNo!,
      if (plan.site != null) plan.site!,
      if (plan.assetCategory != null) plan.assetCategory!,
    ];
    return TpCard(
      key: Key('pm.plan.${plan.id}'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  plan.name ?? plan.assetNo ?? copy('plan'),
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              TpStatusChip(
                status: status,
                label: switch (band) {
                  PmDueBand.overdue => '${days!.abs()} ${copy('daysOverdue')}',
                  PmDueBand.dueSoon => '$days ${copy('daysLeft')}',
                  PmDueBand.ok => '$days ${copy('daysLeft')}',
                  PmDueBand.none => copy('noDate'),
                },
              ),
            ],
          ),
          if (meta.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              meta.join(' / '),
              style: TextStyle(color: palette.textSecondary),
            ),
          ],
          if (plan.nextDueMeter != null &&
              plan.meterUnit.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text('${plan.nextDueMeter} ${plan.meterUnit}'),
          ],
          const SizedBox(height: TpSpace.sm),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: FilledButton.icon(
              onPressed: onRecord,
              icon: const Icon(Icons.check_circle_outline_rounded),
              label: Text(copy('record')),
            ),
          ),
        ],
      ),
    );
  }
}

class _RecordServiceSheet extends ConsumerStatefulWidget {
  const _RecordServiceSheet({required this.plan, required this.copy});
  final PmPlan plan;
  final PmCopy copy;

  @override
  ConsumerState<_RecordServiceSheet> createState() =>
      _RecordServiceSheetState();
}

class _RecordServiceSheetState extends ConsumerState<_RecordServiceSheet> {
  final TextEditingController meter = TextEditingController();
  final TextEditingController performedBy = TextEditingController();
  final TextEditingController workshop = TextEditingController();
  final TextEditingController partsCost = TextEditingController();
  final TextEditingController labourCost = TextEditingController();
  final TextEditingController findings = TextEditingController();
  PmServiceOutcome outcome = PmServiceOutcome.completed;
  bool saving = false;

  @override
  void initState() {
    super.initState();
    performedBy.text =
        ref.read(workspaceContextProvider)?.fullName?.trim() ?? '';
  }

  @override
  void dispose() {
    for (final TextEditingController controller in <TextEditingController>[
      meter,
      performedBy,
      workshop,
      partsCost,
      labourCost,
      findings,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final PmCopy copy = widget.copy;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        MediaQuery.viewInsetsOf(context).bottom + TpSpace.lg,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(copy('record'), style: Theme.of(context).textTheme.titleLarge),
            Text(widget.plan.name ?? widget.plan.assetNo ?? copy('plan')),
            if (widget.plan.meterUnit.isNotEmpty)
              _PmInput(
                controller: meter,
                label: '${copy('meter')} (${widget.plan.meterUnit})',
                keyName: 'meter',
                numeric: true,
              ),
            _PmInput(
              controller: performedBy,
              label: copy('performedBy'),
              keyName: 'performedBy',
            ),
            _PmInput(
              controller: workshop,
              label: copy('workshop'),
              keyName: 'workshop',
            ),
            _PmInput(
              controller: partsCost,
              label: copy('partsCost'),
              keyName: 'partsCost',
              numeric: true,
            ),
            _PmInput(
              controller: labourCost,
              label: copy('labourCost'),
              keyName: 'labourCost',
              numeric: true,
            ),
            _PmInput(
              controller: findings,
              label: copy('findings'),
              keyName: 'findings',
              lines: 3,
            ),
            const SizedBox(height: TpSpace.md),
            Wrap(
              spacing: TpSpace.xs,
              children: <Widget>[
                for (final PmServiceOutcome value in PmServiceOutcome.values)
                  ChoiceChip(
                    label: Text(copy(value.name)),
                    selected: outcome == value,
                    onSelected: (_) => setState(() => outcome = value),
                  ),
              ],
            ),
            const SizedBox(height: TpSpace.xl),
            FilledButton(
              key: const Key('pm.save'),
              onPressed: saving ? null : () => unawaited(_save(copy)),
              child: Text(copy('save')),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save(PmCopy copy) async {
    final num? meterValue = _number(meter.text);
    final num? parts = _number(partsCost.text);
    final num? labour = _number(labourCost.text);
    if ((meter.text.trim().isNotEmpty && meterValue == null) ||
        (partsCost.text.trim().isNotEmpty && parts == null) ||
        (labourCost.text.trim().isNotEmpty && labour == null)) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(copy('invalidNumber'))));
      return;
    }
    setState(() => saving = true);
    try {
      await ref.read(pmRepositoryProvider).recordService(
            RecordPmServiceInput(
              programId: widget.plan.id,
              serviceDate: DateTime.now(),
              outcome: outcome,
              meterReading: meterValue,
              performedBy: performedBy.text,
              workshop: workshop.text,
              site: widget.plan.site,
              partsCost: parts,
              labourCost: labour,
              findings: findings.text,
            ),
          );
      if (mounted) Navigator.pop(context, true);
    } on Object {
      if (mounted) {
        setState(() => saving = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(copy('saveFailed'))));
      }
    }
  }
}

class _PmInput extends StatelessWidget {
  const _PmInput({
    required this.controller,
    required this.label,
    required this.keyName,
    this.numeric = false,
    this.lines = 1,
  });
  final TextEditingController controller;
  final String label;
  final String keyName;
  final bool numeric;
  final int lines;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: TpSpace.md),
        child: TextField(
          key: Key('pm.$keyName'),
          controller: controller,
          keyboardType: numeric
              ? const TextInputType.numberWithOptions(decimal: true)
              : null,
          minLines: lines,
          maxLines: lines == 1 ? 1 : 5,
          decoration: InputDecoration(labelText: label),
        ),
      );
}

num? _number(String raw) {
  final String value = raw.trim().replaceAll(',', '');
  return value.isEmpty ? null : num.tryParse(value);
}
