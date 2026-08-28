library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

abstract final class AccidentCaseScreenKeys {
  static const Key tabs = Key('accident.case.tabs');
  static const Key overview = Key('accident.case.overview');
  static const Key evidence = Key('accident.case.evidence');
  static const Key insurance = Key('accident.case.insurance');
  static const Key repair = Key('accident.case.repair');
  static const Key more = Key('accident.case.more');
  static const Key readOnlyAction = Key('accident.case.readOnlyAction');
}

/// The approved Case Details mock, backed by the real accident and case
/// workstream reads. Mutations are intentionally absent until their RPC and
/// permission contracts are verified.
class AccidentCaseScreen extends ConsumerStatefulWidget {
  const AccidentCaseScreen({required this.route, super.key});
  final AccidentCaseRoute route;

  @override
  ConsumerState<AccidentCaseScreen> createState() => _AccidentCaseScreenState();
}

class _AccidentCaseScreenState extends ConsumerState<AccidentCaseScreen> {
  AccidentCaseSnapshot? _snapshot;
  AppError? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final AccidentCaseSnapshot? snapshot =
          await ref.read(accidentRepositoryProvider).caseById(
                widget.route.accidentId.value,
                country: ref.read(activeCountryProvider),
              );
      if (!mounted) return;
      setState(() {
        _snapshot = snapshot;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = accidentAppError(error, AccidentCopy.of(context));
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final AccidentCopy copy = AccidentCopy.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool hasRecord = _snapshot != null;
    return DefaultTabController(
      length: 5,
      child: TpScaffold(
        backFallback: fallback,
        backgroundColor: TpPalette.of(context).surface,
        appBar: TpAppBar(
          title: copy('caseTitle'),
          backFallback: fallback,
          actions: hasRecord
              ? <Widget>[
                  IconButton(
                    tooltip: copy('boundary'),
                    onPressed: () => _showReadOnlyBoundary(copy),
                    icon: const Icon(Icons.more_vert_rounded),
                  ),
                ]
              : null,
          bottom: hasRecord
              ? PreferredSize(
                  preferredSize: const Size.fromHeight(44),
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TabBar(
                      key: AccidentCaseScreenKeys.tabs,
                      isScrollable: true,
                      dividerColor: TpPalette.of(context).border,
                      indicatorColor: TpPalette.of(context).primary,
                      labelColor: TpPalette.of(context).primary,
                      unselectedLabelColor: TpPalette.of(context).textSecondary,
                      labelStyle: Theme.of(context)
                          .textTheme
                          .labelSmall
                          ?.copyWith(fontWeight: FontWeight.w800),
                      tabs: <Widget>[
                        Tab(text: l10n.tyreDetailSectionOverview),
                        Tab(text: _compactCopy(copy('evidence'))),
                        Tab(text: _shortCopy(copy('insurance'))),
                        Tab(text: l10n.workOrderWorkTypeRepair),
                        Tab(text: _shortCopy(copy('closure'))),
                      ],
                    ),
                  ),
                )
              : null,
        ),
        body: _body(copy),
        bottomNavigationBar: hasRecord
            ? _ReadOnlyFooter(
                key: AccidentCaseScreenKeys.readOnlyAction,
                label: copy('boundary'),
                onPressed: () => _showReadOnlyBoundary(copy),
              )
            : null,
      ),
    );
  }

  Widget _body(AccidentCopy copy) {
    if (_loading) {
      return TpLoadingState(message: copy('loadingWorkstreams'));
    }
    if (_error != null) return TpErrorState(error: _error!, onRetry: _load);
    final AccidentCaseSnapshot? snapshot = _snapshot;
    if (snapshot == null) {
      return TpEmptyState(
        icon: Icons.search_off_outlined,
        title: copy('caseNotFound'),
        message: copy('caseNotFoundMessage'),
      );
    }
    return TabBarView(
      children: <Widget>[
        _OverviewTab(snapshot: snapshot, copy: copy, onRefresh: _load),
        _EvidenceTab(snapshot: snapshot, copy: copy, onRefresh: _load),
        _InsuranceTab(snapshot: snapshot, copy: copy, onRefresh: _load),
        _RepairTab(snapshot: snapshot, copy: copy, onRefresh: _load),
        _MoreTab(snapshot: snapshot, copy: copy, onRefresh: _load),
      ],
    );
  }

  Future<void> _showReadOnlyBoundary(AccidentCopy copy) =>
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (BuildContext context) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              TpSpace.xl,
              0,
              TpSpace.xl,
              TpSpace.xxl,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  copy('boundary'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: TpSpace.sm),
                Text(copy('boundaryMessage')),
              ],
            ),
          ),
        ),
      );
}

class _OverviewTab extends StatelessWidget {
  const _OverviewTab({
    required this.snapshot,
    required this.copy,
    required this.onRefresh,
  });

  final AccidentCaseSnapshot snapshot;
  final AccidentCopy copy;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final AccidentRecord record = snapshot.accident;
    return _CaseScrollView(
      key: AccidentCaseScreenKeys.overview,
      onRefresh: onRefresh,
      children: <Widget>[
        _CaseSection(
          title: copy('incidentFacts'),
          child: Column(
            children: <Widget>[
              AccidentInfoRow(copy('caseTitle'), record.reference),
              AccidentInfoRow(copy('assetNo'), record.assetNo),
              AccidentInfoRow(
                copy('exactLocation'),
                record.location ?? record.site,
              ),
              AccidentInfoRow(copy('incidentFactsHint'), record.incidentDate),
              AccidentInfoRow(copy('reporter'), record.reporterName),
            ],
          ),
        ),
        _CaseSection(
          title: copy('description'),
          child: Text(
            _shown(record.description, copy),
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
        _CaseSection(
          title: '${_compactCopy(copy('evidence'))} (${record.photos.length})',
          child: AccidentEvidenceStrip(
            photos: record.photos,
            emptyLabel: copy('notRecorded'),
            evidenceLabel: copy('evidencePhoto'),
          ),
        ),
      ],
    );
  }
}

class _EvidenceTab extends StatelessWidget {
  const _EvidenceTab({
    required this.snapshot,
    required this.copy,
    required this.onRefresh,
  });

  final AccidentCaseSnapshot snapshot;
  final AccidentCopy copy;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final AccidentRecord record = snapshot.accident;
    return _CaseScrollView(
      key: AccidentCaseScreenKeys.evidence,
      onRefresh: onRefresh,
      children: <Widget>[
        _CaseSection(
          title: '${_compactCopy(copy('evidence'))} (${record.photos.length})',
          child: AccidentEvidenceStrip(
            photos: record.photos,
            emptyLabel: copy('notRecorded'),
            evidenceLabel: copy('evidencePhoto'),
          ),
        ),
        _CaseSection(
          title: copy('description'),
          child: Text(_shown(record.description, copy)),
        ),
        _CaseSection(
          title: copy('damage'),
          child: Text(_shown(record.damageDescription, copy)),
        ),
        _WorkstreamSummary(
          workstreams: _matching(snapshot.workstreams, const <String>{
            'incident_evidence',
            'fleet_validation',
          }),
          copy: copy,
          provisioned: snapshot.provisioned,
        ),
      ],
    );
  }
}

class _InsuranceTab extends StatelessWidget {
  const _InsuranceTab({
    required this.snapshot,
    required this.copy,
    required this.onRefresh,
  });

  final AccidentCaseSnapshot snapshot;
  final AccidentCopy copy;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final AccidentRecord record = snapshot.accident;
    return _CaseScrollView(
      key: AccidentCaseScreenKeys.insurance,
      onRefresh: onRefresh,
      children: <Widget>[
        _CaseSection(
          title: copy('insurance'),
          child: Column(
            children: <Widget>[
              AccidentInfoRow(copy('insurer'), record.insurer),
              AccidentInfoRow(copy('policy'), record.policyNo),
              AccidentInfoRow(copy('claimNo'), record.insuranceClaimNo),
              AccidentInfoRow(copy('claimStatus'), record.claimStatus),
              AccidentInfoRow(copy('claimed'), record.claimAmount),
              AccidentInfoRow(copy('approved'), record.claimApprovedAmount),
              AccidentInfoRow(copy('recoveryStatus'), record.recoveryStatus),
              AccidentInfoRow(copy('recovered'), record.recoveredAmount),
            ],
          ),
        ),
        _WorkstreamSummary(
          workstreams: _matching(
            snapshot.workstreams,
            const <String>{'insurance', 'finance'},
          ),
          copy: copy,
          provisioned: snapshot.provisioned,
        ),
      ],
    );
  }
}

class _RepairTab extends StatelessWidget {
  const _RepairTab({
    required this.snapshot,
    required this.copy,
    required this.onRefresh,
  });

  final AccidentCaseSnapshot snapshot;
  final AccidentCopy copy;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final AccidentRecord record = snapshot.accident;
    return _CaseScrollView(
      key: AccidentCaseScreenKeys.repair,
      onRefresh: onRefresh,
      children: <Widget>[
        _CaseSection(
          title: copy('workshopRelease'),
          child: Column(
            children: <Widget>[
              AccidentInfoRow(copy('repairType'), record.repairType),
              AccidentInfoRow(copy('workshop'), record.workshopName),
              AccidentInfoRow(copy('repairCost'), record.repairCost),
              AccidentInfoRow(
                copy('expectedRelease'),
                record.expectedReleaseDate,
              ),
              AccidentInfoRow(copy('actualRelease'), record.releaseDate),
              AccidentInfoRow(copy('nextAction'), record.nextStep),
            ],
          ),
        ),
        _WorkstreamSummary(
          workstreams: _matching(snapshot.workstreams, const <String>{
            'assessment',
            'repair',
            'workshop_qc',
            'handover',
          }),
          copy: copy,
          provisioned: snapshot.provisioned,
        ),
      ],
    );
  }
}

class _MoreTab extends StatelessWidget {
  const _MoreTab({
    required this.snapshot,
    required this.copy,
    required this.onRefresh,
  });

  final AccidentCaseSnapshot snapshot;
  final AccidentCopy copy;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final AccidentRecord record = snapshot.accident;
    return _CaseScrollView(
      key: AccidentCaseScreenKeys.more,
      onRefresh: onRefresh,
      children: <Widget>[
        _CaseSection(
          title: copy('liability'),
          child: Column(
            children: <Widget>[
              AccidentInfoRow(copy('fault'), record.faultStatus),
              AccidentInfoRow(copy('responsible'), record.responsibleParty),
              AccidentInfoRow(copy('liable'), record.liableParty),
              AccidentInfoRow(copy('payer'), record.payer),
            ],
          ),
        ),
        _CaseSection(
          title: copy('closure'),
          child: Column(
            children: <Widget>[
              AccidentInfoRow(
                copy('workflowStage'),
                humaniseAccidentToken(record.workflowStage),
              ),
              AccidentInfoRow(
                copy('caseStatus'),
                humaniseAccidentToken(record.caseStatus),
              ),
              AccidentInfoRow(
                copy('closureRequest'),
                humaniseAccidentToken(record.closureStatus),
              ),
              AccidentInfoRow(
                copy('closureLevel'),
                humaniseAccidentToken(record.closureLevel),
              ),
            ],
          ),
        ),
        _WorkstreamSummary(
          workstreams: snapshot.workstreams,
          copy: copy,
          provisioned: snapshot.provisioned,
        ),
        _CaseSection(
          title: copy('boundary'),
          child: Text(copy('boundaryMessage')),
        ),
      ],
    );
  }
}

class _CaseScrollView extends StatelessWidget {
  const _CaseScrollView({
    required this.children,
    required this.onRefresh,
    super.key,
  });

  final List<Widget> children;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
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
                  children: children,
                ),
              ),
            ),
          ],
        ),
      );
}

class _CaseSection extends StatelessWidget {
  const _CaseSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: TpPalette.of(context).border),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                title.toUpperCase(),
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: TpPalette.of(context).textSecondary,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.5,
                    ),
              ),
              const SizedBox(height: TpSpace.sm),
              child,
            ],
          ),
        ),
      );
}

class _WorkstreamSummary extends StatelessWidget {
  const _WorkstreamSummary({
    required this.workstreams,
    required this.copy,
    required this.provisioned,
  });

  final List<AccidentWorkstream> workstreams;
  final AccidentCopy copy;
  final bool provisioned;

  @override
  Widget build(BuildContext context) {
    if (!provisioned) {
      return Padding(
        padding: const EdgeInsets.only(top: TpSpace.md),
        child: TpNotConfiguredState(
          title: copy('notActivated'),
          detail: copy('notActivatedMessage'),
        ),
      );
    }
    if (workstreams.isEmpty) return const SizedBox.shrink();
    return _CaseSection(
      title: copy('timeline'),
      child: Column(
        children: <Widget>[
          for (final AccidentWorkstream workstream in workstreams)
            _WorkstreamRow(workstream: workstream, copy: copy),
        ],
      ),
    );
  }
}

class _WorkstreamRow extends StatelessWidget {
  const _WorkstreamRow({required this.workstream, required this.copy});

  final AccidentWorkstream workstream;
  final AccidentCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpStatus tone = switch (workstream.chip) {
      AccidentWorkstreamChip.done => TpStatus.ok,
      AccidentWorkstreamChip.inProgress => TpStatus.warning,
      AccidentWorkstreamChip.pending => TpStatus.unknown,
      AccidentWorkstreamChip.notRequired => TpStatus.neutral,
    };
    final String status = switch (workstream.chip) {
      AccidentWorkstreamChip.done => copy('done'),
      AccidentWorkstreamChip.inProgress => copy('inProgress'),
      AccidentWorkstreamChip.pending => copy('pending'),
      AccidentWorkstreamChip.notRequired => copy('notRequired'),
    };
    final String owner = <String?>[workstream.team, workstream.ownerRole]
        .whereType<String>()
        .where((String value) => value.trim().isNotEmpty)
        .join(' / ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            workstream.chip == AccidentWorkstreamChip.done
                ? Icons.check_circle_rounded
                : Icons.radio_button_checked_rounded,
            color: TpPalette.of(context).forStatus(tone).base,
            size: 20,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  workstreamLabel(copy, workstream.key),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                if (owner.isNotEmpty)
                  Text(owner, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          TpStatusChip(status: tone, label: status, isCompact: true),
        ],
      ),
    );
  }
}

class _ReadOnlyFooter extends StatelessWidget {
  const _ReadOnlyFooter({
    required this.label,
    required this.onPressed,
    super.key,
  });

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          color: TpPalette.of(context).surface,
          border: Border(
            top: BorderSide(color: TpPalette.of(context).border),
          ),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              TpSpace.lg,
              TpSpace.sm,
              TpSpace.lg,
              TpSpace.sm,
            ),
            child: TpButton.primary(
              label: label,
              icon: Icons.lock_outline_rounded,
              onPressed: onPressed,
              isFullWidth: true,
            ),
          ),
        ),
      );
}

List<AccidentWorkstream> _matching(
  List<AccidentWorkstream> workstreams,
  Set<String> keys,
) =>
    workstreams
        .where((AccidentWorkstream workstream) => keys.contains(workstream.key))
        .toList(growable: false);

String _shown(String? value, AccidentCopy copy) {
  final String text = value?.trim() ?? '';
  return text.isEmpty ? copy('notRecorded') : text;
}

String _compactCopy(String value) =>
    value.replaceFirst(RegExp(r'^\s*\d+[.)]\s*'), '').trim();

String _shortCopy(String value) => value.split('&').first.trim();
