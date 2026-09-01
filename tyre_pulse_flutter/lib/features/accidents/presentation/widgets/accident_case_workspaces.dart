/// Seven read-only accident case workspaces backed only by the verified
/// accident row, workstream ledger and authenticated notification inbox.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_workflow.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_workflow_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';

enum AccidentCaseWorkspace {
  incident,
  fleet,
  responsibility,
  insurance,
  assessment,
  externalWorkshop,
  timeline,
}

extension AccidentCaseWorkspaceDefinition on AccidentCaseWorkspace {
  int get step => index + 1;

  String get labelKey => switch (this) {
        AccidentCaseWorkspace.incident => 'workspaceIncident',
        AccidentCaseWorkspace.fleet => 'workspaceFleet',
        AccidentCaseWorkspace.responsibility => 'workspaceResponsibility',
        AccidentCaseWorkspace.insurance => 'workspaceInsurance',
        AccidentCaseWorkspace.assessment => 'workspaceAssessment',
        AccidentCaseWorkspace.externalWorkshop => 'workspaceExternal',
        AccidentCaseWorkspace.timeline => 'workspaceTimeline',
      };

  IconData get icon => switch (this) {
        AccidentCaseWorkspace.incident => Icons.car_crash_outlined,
        AccidentCaseWorkspace.fleet => Icons.fact_check_outlined,
        AccidentCaseWorkspace.responsibility => Icons.balance_outlined,
        AccidentCaseWorkspace.insurance => Icons.verified_user_outlined,
        AccidentCaseWorkspace.assessment => Icons.handyman_outlined,
        AccidentCaseWorkspace.externalWorkshop => Icons.local_shipping_outlined,
        AccidentCaseWorkspace.timeline => Icons.timeline_outlined,
      };

  List<String> get workstreamKeys => switch (this) {
        AccidentCaseWorkspace.incident => const <String>['incident_evidence'],
        AccidentCaseWorkspace.fleet => const <String>['fleet_validation'],
        AccidentCaseWorkspace.responsibility => const <String>['liability'],
        AccidentCaseWorkspace.insurance => const <String>[
            'insurance',
            'finance',
          ],
        AccidentCaseWorkspace.assessment => const <String>['assessment'],
        AccidentCaseWorkspace.externalWorkshop => const <String>[
            'repair',
            'workshop_qc',
            'handover',
          ],
        AccidentCaseWorkspace.timeline => accidentWorkstreamOrder,
      };
}

class AccidentCaseWorkspaceView extends ConsumerWidget {
  const AccidentCaseWorkspaceView({
    required this.workspace,
    required this.snapshot,
    required this.onRefresh,
    required this.controller,
    required this.bodyKey,
    super.key,
  });

  final AccidentCaseWorkspace workspace;
  final AccidentCaseSnapshot snapshot;
  final Future<void> Function() onRefresh;
  final ScrollController controller;
  final Key bodyKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentCaseWorkflowCopy workflowCopy =
        AccidentCaseWorkflowCopy.of(context);
    final AccidentCaseWorkflowProjection projection =
        AccidentCaseWorkflowProjection(snapshot);
    final AccidentWorkstream? current = _firstMatching(
      snapshot.workstreams,
      workspace.workstreamKeys,
    );
    final AccidentWorkstream? next = _nextHandoff(
      snapshot.workstreams,
      workspace.workstreamKeys,
    );

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        key: bodyKey,
        controller: controller,
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  _WorkspaceHeader(
                    workspace: workspace,
                    snapshot: snapshot,
                    current: current,
                    next: next,
                    copy: copy,
                    workflowCopy: workflowCopy,
                  ),
                  const SizedBox(height: TpSpace.md),
                  ..._workspaceBody(
                    context,
                    ref,
                    projection,
                    copy,
                    workflowCopy,
                  ),
                  const SizedBox(height: TpSpace.md),
                  _ReadOnlyTruthCard(copy: copy),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _workspaceBody(
    BuildContext context,
    WidgetRef ref,
    AccidentCaseWorkflowProjection projection,
    AccidentCopy copy,
    AccidentCaseWorkflowCopy workflowCopy,
  ) {
    final AccidentRecord record = snapshot.accident;
    return switch (workspace) {
      AccidentCaseWorkspace.incident => <Widget>[
          _WorkspaceCard(
            title: copy('incidentFacts'),
            icon: Icons.assignment_outlined,
            child: _FactGrid(
              facts: <_Fact>[
                _Fact(copy('caseId'), record.reference),
                _Fact(copy('type'), humaniseAccidentToken(record.accidentType)),
                _Fact(copy('severity'), humaniseAccidentToken(record.severity)),
                _Fact(
                  copy('incidentDateLabel'),
                  formatAccidentIncidentDate(
                    context,
                    record.incidentDate,
                    includeTime: true,
                  ),
                ),
                _Fact(copy('reporter'), record.reporterName),
                _Fact(
                  AppLocalizations.of(context).accidentCaseLocationLabel,
                  _firstText(<String?>[record.location, record.site]),
                ),
              ],
              missing: copy('notRecorded'),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          _WorkspaceCard(
            title: workflowCopy('damageEvidence'),
            icon: Icons.photo_camera_back_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                _LabeledText(
                  label: copy('description'),
                  value: _shown(record.description, copy),
                ),
                const SizedBox(height: TpSpace.md),
                _LabeledText(
                  label: copy('damage'),
                  value: _shown(record.damageDescription, copy),
                ),
                const SizedBox(height: TpSpace.md),
                Text(
                  '${copy('evidenceFiles')} (${record.photos.length})',
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
                const SizedBox(height: TpSpace.sm),
                AccidentEvidenceStrip(
                  photos: record.photos,
                  emptyLabel: copy('notRecorded'),
                  evidenceLabel: copy('evidencePhoto'),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          _WorkstreamLedger(
            projection: projection,
            keys: workspace.workstreamKeys,
            copy: copy,
            workflowCopy: workflowCopy,
          ),
        ],
      AccidentCaseWorkspace.fleet => <Widget>[
          _WorkspaceCard(
            title: workflowCopy('validationFacts'),
            icon: Icons.directions_car_filled_outlined,
            child: _FactGrid(
              facts: <_Fact>[
                _Fact(
                  AppLocalizations.of(context).accidentCaseAssetLabel,
                  record.assetNo,
                ),
                _Fact(copy('vehicleType'), record.vehicleType),
                _Fact(copy('plate'), record.plateNumber),
                _Fact(copy('reporter'), record.reporterName),
                _Fact(
                  AppLocalizations.of(context).accidentCaseLocationLabel,
                  record.location,
                ),
                _Fact(copy('site'), record.site),
                _Fact(
                  copy('workflowStage'),
                  humaniseAccidentToken(record.workflowStage),
                ),
                _Fact(
                  copy('caseStatus'),
                  humaniseAccidentToken(record.caseStatus),
                ),
              ],
              missing: copy('notRecorded'),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          _WorkstreamLedger(
            projection: projection,
            keys: workspace.workstreamKeys,
            copy: copy,
            workflowCopy: workflowCopy,
          ),
        ],
      AccidentCaseWorkspace.responsibility => <Widget>[
          _WorkspaceCard(
            title: workflowCopy('responsibilityTitle'),
            icon: Icons.account_balance_outlined,
            child: _FactGrid(
              facts: <_Fact>[
                _Fact(copy('fault'), humaniseAccidentToken(record.faultStatus)),
                _Fact(
                  copy('responsible'),
                  humaniseAccidentToken(record.responsibleParty),
                ),
                _Fact(
                  copy('liable'),
                  humaniseAccidentToken(record.liableParty),
                ),
                _Fact(copy('payer'), humaniseAccidentToken(record.payer)),
              ],
              missing: copy('notRecorded'),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          _WorkstreamLedger(
            projection: projection,
            keys: workspace.workstreamKeys,
            copy: copy,
            workflowCopy: workflowCopy,
          ),
        ],
      AccidentCaseWorkspace.insurance => <Widget>[
          _WorkspaceCard(
            title: workflowCopy('claimPackageTitle'),
            icon: Icons.policy_outlined,
            child: _FactGrid(
              facts: <_Fact>[
                _Fact(copy('insurer'), record.insurer),
                _Fact(copy('policy'), record.policyNo),
                _Fact(copy('claimNo'), record.insuranceClaimNo),
                _Fact(
                  copy('claimStatus'),
                  humaniseAccidentToken(record.claimStatus),
                ),
                _Fact(copy('claimed'), _number(record.claimAmount)),
                _Fact(copy('approved'), _number(record.claimApprovedAmount)),
                _Fact(
                  copy('recoveryStatus'),
                  humaniseAccidentToken(record.recoveryStatus),
                ),
                _Fact(copy('recovered'), _number(record.recoveredAmount)),
              ],
              missing: copy('notRecorded'),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          _WorkstreamLedger(
            projection: projection,
            keys: workspace.workstreamKeys,
            copy: copy,
            workflowCopy: workflowCopy,
          ),
        ],
      AccidentCaseWorkspace.assessment => <Widget>[
          _WorkspaceCard(
            title: copy('wsAssessment'),
            icon: Icons.build_circle_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                _LabeledText(
                  label: copy('damage'),
                  value: _shown(record.damageDescription, copy),
                ),
                const SizedBox(height: TpSpace.md),
                _FactGrid(
                  facts: <_Fact>[
                    _Fact(
                      copy('repairType'),
                      humaniseAccidentToken(record.repairType),
                    ),
                    _Fact(copy('workshop'), record.workshopName),
                    _Fact(copy('repairCost'), _number(record.repairCost)),
                    _Fact(copy('expectedRelease'), record.expectedReleaseDate),
                  ],
                  missing: copy('notRecorded'),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          _WorkstreamLedger(
            projection: projection,
            keys: workspace.workstreamKeys,
            copy: copy,
            workflowCopy: workflowCopy,
          ),
        ],
      AccidentCaseWorkspace.externalWorkshop => <Widget>[
          _WorkspaceCard(
            title: workflowCopy('dispatchReceiptTitle'),
            icon: Icons.local_shipping_outlined,
            child: _FactGrid(
              facts: <_Fact>[
                _Fact(
                  copy('repairType'),
                  humaniseAccidentToken(record.repairType),
                ),
                _Fact(copy('workshop'), record.workshopName),
                _Fact(copy('nextAction'), record.nextStep),
                _Fact(copy('expectedRelease'), record.expectedReleaseDate),
                _Fact(copy('actualRelease'), record.releaseDate),
                _Fact(copy('repairCost'), _number(record.repairCost)),
              ],
              missing: copy('notRecorded'),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          _WorkstreamLedger(
            projection: projection,
            keys: workspace.workstreamKeys,
            copy: copy,
            workflowCopy: workflowCopy,
          ),
        ],
      AccidentCaseWorkspace.timeline => <Widget>[
          _TimelineCard(
            projection: projection,
            copy: copy,
            workflowCopy: workflowCopy,
          ),
          const SizedBox(height: TpSpace.md),
          _CaseNotifications(
            accidentId: record.id,
            ref: ref,
            copy: copy,
            workflowCopy: workflowCopy,
          ),
        ],
    };
  }
}

class _WorkspaceHeader extends StatelessWidget {
  const _WorkspaceHeader({
    required this.workspace,
    required this.snapshot,
    required this.current,
    required this.next,
    required this.copy,
    required this.workflowCopy,
  });

  final AccidentCaseWorkspace workspace;
  final AccidentCaseSnapshot snapshot;
  final AccidentWorkstream? current;
  final AccidentWorkstream? next;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final AccidentRecord record = snapshot.accident;
    final TpPalette palette = TpPalette.of(context);
    final bool rtl = TpDirection.isRtl(context);
    final String title = <String>[
      rtl ? TpDirection.isolateLtr(record.reference) : record.reference,
      if (record.assetNo.trim().isNotEmpty)
        rtl ? TpDirection.isolateLtr(record.assetNo) : record.assetNo,
    ].join(' • ');
    final String statusToken = _firstText(<String?>[
      current?.status,
      record.caseStatus,
      record.status,
    ]);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          title,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
                letterSpacing: -0.3,
              ),
        ),
        const SizedBox(height: TpSpace.sm),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.xs,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            _StepChip(
              label: workflowCopy('stepOf')
                  .replaceAll('%step%', '${workspace.step}')
                  .replaceAll(
                    '%total%',
                    '${AccidentCaseWorkspace.values.length}',
                  ),
            ),
            Text(
              workflowCopy(workspace.labelKey),
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: palette.primary,
                    fontWeight: FontWeight.w800,
                  ),
            ),
            TpStatusChip(
              status: accidentTone(statusToken),
              label: statusToken.isEmpty
                  ? copy('notRecorded')
                  : humaniseAccidentToken(statusToken),
              isCompact: true,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        _OwnershipStrip(
          current: current,
          next: next,
          copy: copy,
          workflowCopy: workflowCopy,
        ),
      ],
    );
  }
}

class _StepChip extends StatelessWidget {
  const _StepChip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          color: TpPalette.of(context).primarySoft,
          borderRadius: BorderRadius.circular(TpRadius.pill),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.sm,
            vertical: TpSpace.xs,
          ),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: TpPalette.of(context).primary,
                  fontWeight: FontWeight.w800,
                ),
          ),
        ),
      );
}

class _OwnershipStrip extends StatelessWidget {
  const _OwnershipStrip({
    required this.current,
    required this.next,
    required this.copy,
    required this.workflowCopy,
  });

  final AccidentWorkstream? current;
  final AccidentWorkstream? next;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final List<Widget> items = <Widget>[
            _OwnershipItem(
              icon: Icons.person_outline_rounded,
              label: workflowCopy('workspaceOwner'),
              value: _owner(current, copy),
            ),
            _OwnershipItem(
              icon: Icons.arrow_forward_rounded,
              label: workflowCopy('nextHandoff'),
              value: next == null
                  ? workflowCopy('noNextHandoff')
                  : '${workstreamLabel(copy, next!.key)} • ${_owner(next, copy)}',
            ),
          ];
          if (constraints.maxWidth < 460) {
            return TpCard(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Column(
                children: <Widget>[
                  items.first,
                  const SizedBox(height: TpSpace.sm),
                  Divider(height: 1, color: TpPalette.of(context).border),
                  const SizedBox(height: TpSpace.sm),
                  items.last,
                ],
              ),
            );
          }
          return TpCard(
            padding: const EdgeInsets.all(TpSpace.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(child: items.first),
                const SizedBox(width: TpSpace.md),
                SizedBox(
                  height: 44,
                  child: VerticalDivider(color: TpPalette.of(context).border),
                ),
                const SizedBox(width: TpSpace.md),
                Expanded(child: items.last),
              ],
            ),
          );
        },
      );
}

class _OwnershipItem extends StatelessWidget {
  const _OwnershipItem({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            icon,
            size: TpSizing.iconMd,
            color: TpPalette.of(context).primary,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  label,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: TpPalette.of(context).textSecondary,
                        fontWeight: FontWeight.w700,
                      ),
                ),
                Text(
                  value,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ],
            ),
          ),
        ],
      );
}

class _WorkspaceCard extends StatelessWidget {
  const _WorkspaceCard({
    required this.title,
    required this.icon,
    required this.child,
  });
  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) => TpCard(
        padding: EdgeInsets.zero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Row(
                children: <Widget>[
                  Icon(
                    icon,
                    size: TpSizing.iconMd,
                    color: TpPalette.of(context).primary,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: TpPalette.of(context).border),
            Padding(padding: const EdgeInsets.all(TpSpace.md), child: child),
          ],
        ),
      );
}

class _Fact {
  const _Fact(this.label, this.value);
  final String label;
  final String? value;
}

class _FactGrid extends StatelessWidget {
  const _FactGrid({required this.facts, required this.missing});
  final List<_Fact> facts;
  final String missing;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final double width = constraints.maxWidth < 460
              ? constraints.maxWidth
              : (constraints.maxWidth - TpSpace.md) / 2;
          return Wrap(
            spacing: TpSpace.md,
            runSpacing: TpSpace.md,
            children: <Widget>[
              for (final _Fact fact in facts)
                SizedBox(
                  width: width,
                  child: _LabeledText(
                    label: fact.label,
                    value: _textOrMissing(fact.value, missing),
                  ),
                ),
            ],
          );
        },
      );
}

class _LabeledText extends StatelessWidget {
  const _LabeledText({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: TpPalette.of(context).textSecondary,
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(value, style: Theme.of(context).textTheme.bodyMedium),
        ],
      );
}

class _WorkstreamLedger extends StatelessWidget {
  const _WorkstreamLedger({
    required this.projection,
    required this.keys,
    required this.copy,
    required this.workflowCopy,
  });
  final AccidentCaseWorkflowProjection projection;
  final List<String> keys;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    if (!projection.provisioned) {
      return TpNotConfiguredState(
        title: copy('notActivated'),
        detail: copy('notActivatedMessage'),
      );
    }
    final List<AccidentWorkstream> workstreams = projection.matching(keys);
    return _WorkspaceCard(
      title: workflowCopy('workstreamLedger'),
      icon: Icons.route_outlined,
      child: workstreams.isEmpty
          ? Text(workflowCopy('noWorkstreamRecord'))
          : Column(
              children: <Widget>[
                for (int index = 0;
                    index < workstreams.length;
                    index++) ...<Widget>[
                  if (index > 0)
                    Divider(
                      height: TpSpace.lg,
                      color: TpPalette.of(context).border,
                    ),
                  _WorkstreamFactRow(
                    workstream: workstreams[index],
                    copy: copy,
                    workflowCopy: workflowCopy,
                  ),
                ],
              ],
            ),
    );
  }
}

class _WorkstreamFactRow extends StatelessWidget {
  const _WorkstreamFactRow({
    required this.workstream,
    required this.copy,
    required this.workflowCopy,
  });
  final AccidentWorkstream workstream;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final TpStatus status = _workstreamTone(workstream.chip);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(
          _workstreamIcon(workstream.chip),
          color: TpPalette.of(context).forStatus(status).base,
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                workstreamLabel(copy, workstream.key),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: TpSpace.xs),
              Text(
                '${workflowCopy('workspaceOwner')}: ${_owner(workstream, copy)}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (workstream.notes?.trim().isNotEmpty ?? false) ...<Widget>[
                const SizedBox(height: TpSpace.xs),
                Text(
                  workstream.notes!.trim(),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              if (workstream.updatedAt != null) ...<Widget>[
                const SizedBox(height: TpSpace.xs),
                Text(
                  '${workflowCopy('updated')}: ${_formatDateTime(context, workstream.updatedAt!)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: TpPalette.of(context).textSecondary,
                      ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        TpStatusChip(
          status: status,
          label: _workstreamStatus(copy, workstream.chip),
          isCompact: true,
        ),
      ],
    );
  }
}

class _TimelineCard extends StatelessWidget {
  const _TimelineCard({
    required this.projection,
    required this.copy,
    required this.workflowCopy,
  });
  final AccidentCaseWorkflowProjection projection;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final List<AccidentWorkstream> updates = projection.datedUpdates;
    return _WorkspaceCard(
      title: workflowCopy('timelineTitle'),
      icon: Icons.timeline_outlined,
      child: updates.isEmpty
          ? Text(workflowCopy('timelineEmpty'))
          : Column(
              children: <Widget>[
                for (int index = 0;
                    index < updates.length;
                    index++) ...<Widget>[
                  if (index > 0)
                    Divider(
                      height: TpSpace.lg,
                      color: TpPalette.of(context).border,
                    ),
                  _WorkstreamFactRow(
                    workstream: updates[index],
                    copy: copy,
                    workflowCopy: workflowCopy,
                  ),
                ],
              ],
            ),
    );
  }
}

class _CaseNotifications extends StatelessWidget {
  const _CaseNotifications({
    required this.accidentId,
    required this.ref,
    required this.copy,
    required this.workflowCopy,
  });
  final String accidentId;
  final WidgetRef ref;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) {
    final String userId =
        ref.watch(workspaceContextProvider)?.userId.trim() ?? '';
    final AsyncValue<List<AppNotification>>? inbox =
        userId.isEmpty ? null : ref.watch(notificationsInboxProvider);
    return _WorkspaceCard(
      title: workflowCopy('notificationsTitle'),
      icon: Icons.notifications_active_outlined,
      child: inbox == null
          ? Text(workflowCopy('notificationsNoWorkspace'))
          : inbox.when(
              data: (List<AppNotification> rows) {
                final List<AppNotification> related = rows
                    .where(
                      (AppNotification item) =>
                          _belongsToCase(item, accidentId),
                    )
                    .toList(growable: false);
                if (related.isEmpty) {
                  return Text(workflowCopy('notificationsEmpty'));
                }
                return Column(
                  children: <Widget>[
                    for (int index = 0;
                        index < related.length;
                        index++) ...<Widget>[
                      if (index > 0)
                        Divider(
                          height: TpSpace.lg,
                          color: TpPalette.of(context).border,
                        ),
                      _NotificationFactRow(
                        notification: related[index],
                        copy: copy,
                        workflowCopy: workflowCopy,
                      ),
                    ],
                  ],
                );
              },
              loading: () => Row(
                children: <Widget>[
                  const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(child: Text(workflowCopy('notificationsLoading'))),
                ],
              ),
              error: (Object error, StackTrace stackTrace) => Text(
                workflowCopy('notificationsFailed'),
                style: TextStyle(
                  color:
                      TpPalette.of(context).forStatus(TpStatus.critical).base,
                ),
              ),
            ),
    );
  }
}

class _NotificationFactRow extends StatelessWidget {
  const _NotificationFactRow({
    required this.notification,
    required this.copy,
    required this.workflowCopy,
  });
  final AppNotification notification;
  final AccidentCopy copy;
  final AccidentCaseWorkflowCopy workflowCopy;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(notification.icon, color: TpPalette.of(context).primary),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  _textOrMissing(notification.title, copy('notRecorded')),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
                if (notification.body?.trim().isNotEmpty ?? false)
                  Text(
                    notification.body!.trim(),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  _formatDateTime(context, notification.createdAt),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: TpPalette.of(context).textSecondary,
                      ),
                ),
              ],
            ),
          ),
          TpStatusChip(
            status: notification.isRead ? TpStatus.neutral : TpStatus.info,
            label: workflowCopy(notification.isRead ? 'read' : 'unread'),
            isCompact: true,
          ),
        ],
      );
}

class _ReadOnlyTruthCard extends StatelessWidget {
  const _ReadOnlyTruthCard({required this.copy});
  final AccidentCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors =
        TpPalette.of(context).forStatus(TpStatus.neutral);
    return DecoratedBox(
      key: const Key('accident.case.readOnlyStatus'),
      decoration: BoxDecoration(
        color: colors.soft,
        border: Border.all(color: colors.base),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.lock_outline_rounded, color: colors.onSoft),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                copy('boundaryMessage'),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.onSoft,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

AccidentWorkstream? _firstMatching(
  List<AccidentWorkstream> workstreams,
  List<String> keys,
) {
  for (final AccidentWorkstream item in workstreams) {
    if (keys.contains(item.key) &&
        item.chip == AccidentWorkstreamChip.inProgress) {
      return item;
    }
  }
  for (final AccidentWorkstream item in workstreams) {
    if (keys.contains(item.key) &&
        item.chip == AccidentWorkstreamChip.pending) {
      return item;
    }
  }
  for (final String key in keys) {
    for (final AccidentWorkstream item in workstreams) {
      if (item.key == key) return item;
    }
  }
  return null;
}

AccidentWorkstream? _nextHandoff(
  List<AccidentWorkstream> workstreams,
  List<String> keys,
) {
  int furthest = -1;
  for (final String key in keys) {
    final int index = accidentWorkstreamOrder.indexOf(key);
    if (index > furthest) furthest = index;
  }
  for (int index = furthest + 1;
      index < accidentWorkstreamOrder.length;
      index++) {
    for (final AccidentWorkstream item in workstreams) {
      if (item.key == accidentWorkstreamOrder[index]) return item;
    }
  }
  return null;
}

bool _belongsToCase(AppNotification notification, String accidentId) {
  if (notification.entityId?.trim() != accidentId.trim()) return false;
  final String type =
      (notification.entityType ?? notification.type ?? '').toLowerCase();
  return type.isEmpty ||
      type.contains('accident') ||
      type.contains('incident') ||
      type.contains('claim');
}

String _owner(AccidentWorkstream? workstream, AccidentCopy copy) {
  final String owner = <String?>[workstream?.team, workstream?.ownerRole]
      .whereType<String>()
      .map((String value) => value.trim())
      .where((String value) => value.isNotEmpty)
      .join(' / ');
  return owner.isEmpty ? copy('notRecorded') : owner;
}

String _shown(String? value, AccidentCopy copy) =>
    _textOrMissing(value, copy('notRecorded'));

String _textOrMissing(String? value, String missing) {
  final String text = value?.trim() ?? '';
  return text.isEmpty ? missing : text;
}

String _firstText(List<String?> values) {
  for (final String? value in values) {
    if (value?.trim().isNotEmpty ?? false) return value!.trim();
  }
  return '';
}

String? _number(num? value) => value?.toString();

String _formatDateTime(BuildContext context, DateTime value) {
  final MaterialLocalizations localizations = MaterialLocalizations.of(context);
  return '${localizations.formatShortDate(value.toLocal())} • '
      '${localizations.formatTimeOfDay(TimeOfDay.fromDateTime(value.toLocal()))}';
}

TpStatus _workstreamTone(AccidentWorkstreamChip chip) => switch (chip) {
      AccidentWorkstreamChip.done => TpStatus.ok,
      AccidentWorkstreamChip.inProgress => TpStatus.warning,
      AccidentWorkstreamChip.pending => TpStatus.unknown,
      AccidentWorkstreamChip.notRequired => TpStatus.neutral,
    };

IconData _workstreamIcon(AccidentWorkstreamChip chip) => switch (chip) {
      AccidentWorkstreamChip.done => Icons.check_circle_rounded,
      AccidentWorkstreamChip.inProgress => Icons.timelapse_rounded,
      AccidentWorkstreamChip.pending => Icons.schedule_rounded,
      AccidentWorkstreamChip.notRequired => Icons.remove_circle_outline_rounded,
    };

String _workstreamStatus(AccidentCopy copy, AccidentWorkstreamChip chip) =>
    switch (chip) {
      AccidentWorkstreamChip.done => copy('done'),
      AccidentWorkstreamChip.inProgress => copy('inProgress'),
      AccidentWorkstreamChip.pending => copy('pending'),
      AccidentWorkstreamChip.notRequired => copy('notRequired'),
    };
