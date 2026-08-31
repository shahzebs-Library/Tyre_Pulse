library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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

abstract final class AccidentDetailScreenKeys {
  static const Key content = Key('accident.detail.content');
  static const Key boundaryAction = Key('accident.detail.boundaryAction');
  static const Key caseDetailsAction = Key('accident.detail.caseDetailsAction');
  static const Key progress = Key('accident.detail.progress');
  static const Key nextAction = Key('accident.detail.nextAction');
  static const Key responsible = Key('accident.detail.responsible');
  static const Key dueDate = Key('accident.detail.dueDate');
}

/// The compact Accident Case Overview selected in the approved mobile mock.
///
/// The screen remains a live Supabase read. The progress ladder is built only
/// from the accident row and verified workstream rows; a missing workstream is
/// explicitly unknown rather than visually presented as completed.
class AccidentDetailScreen extends ConsumerStatefulWidget {
  const AccidentDetailScreen({required this.route, super.key});
  final AccidentDetailRoute route;

  @override
  ConsumerState<AccidentDetailScreen> createState() =>
      _AccidentDetailScreenState();
}

class _AccidentDetailScreenState extends ConsumerState<AccidentDetailScreen> {
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
    final AccidentRecord? record = _snapshot?.accident;
    return TpScaffold(
      backFallback: fallback,
      backgroundColor: TpPalette.of(context).surface,
      appBar: TpAppBar(
        title: l10n.accidentOverviewAppBarTitle,
        backFallback: fallback,
        actions: record == null
            ? null
            : <Widget>[
                IconButton(
                  key: AccidentDetailScreenKeys.boundaryAction,
                  tooltip: copy('boundary'),
                  onPressed: () => _showReadOnlyBoundary(copy),
                  icon: const Icon(Icons.more_vert_rounded),
                ),
              ],
      ),
      body: _body(copy),
      bottomNavigationBar: record == null
          ? null
          : _BottomAction(
              key: AccidentDetailScreenKeys.caseDetailsAction,
              label: l10n.accidentViewCaseDetailsAction,
              onPressed: () => context.push(
                AccidentCaseRoute(
                  accidentId: AccidentId(record.id),
                ).location,
              ),
            ),
    );
  }

  Widget _body(AccidentCopy copy) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (_loading) return TpLoadingState(message: copy('loadingFacts'));
    if (_error != null) return TpErrorState(error: _error!, onRetry: _load);
    final AccidentCaseSnapshot? snapshot = _snapshot;
    if (snapshot == null) {
      return TpEmptyState(
        icon: Icons.search_off_outlined,
        title: copy('notFound'),
        message: copy('notFoundMessage'),
      );
    }

    final AccidentRecord record = snapshot.accident;
    final AccidentWorkstream? active = _activeWorkstream(snapshot.workstreams);
    final String responsible = <String?>[active?.team, active?.ownerRole]
        .whereType<String>()
        .where((String value) => value.trim().isNotEmpty)
        .join(' / ');
    final String statusToken = record.displayStatus.trim().isNotEmpty
        ? record.displayStatus
        : record.workflowStage ?? '';
    final String statusLabel = humaniseAccidentToken(statusToken);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: AccidentDetailScreenKeys.content,
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
                  Text(
                    record.reference,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.4,
                        ),
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TpStatusChip(
                      status: accidentTone(statusToken),
                      label: statusLabel.isEmpty
                          ? copy('notRecorded')
                          : statusLabel,
                      isCompact: true,
                    ),
                  ),
                  const SizedBox(height: TpSpace.md),
                  Text(
                    record.assetNo.isEmpty
                        ? copy('unrecordedAsset')
                        : record.assetNo,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    record.site.isEmpty ? copy('notRecorded') : record.site,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    record.incidentDate.isEmpty
                        ? copy('notRecorded')
                        : '${l10n.accidentReportedOnLabel} '
                            '${formatAccidentIncidentDate(context, record.incidentDate)}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: TpPalette.of(context).textSecondary,
                        ),
                  ),
                  const SizedBox(height: TpSpace.xxl),
                  _SectionLabel(l10n.accidentProgressSection),
                  const SizedBox(height: TpSpace.md),
                  AccidentProgressLadder(
                    key: AccidentDetailScreenKeys.progress,
                    steps: _progressSteps(snapshot, copy),
                  ),
                  const SizedBox(height: TpSpace.xxl),
                  _OverviewFact(
                    key: AccidentDetailScreenKeys.nextAction,
                    label: copy('nextAction'),
                    value: record.nextStep,
                    missing: copy('notRecorded'),
                  ),
                  _OverviewFact(
                    key: AccidentDetailScreenKeys.responsible,
                    label: copy('responsible'),
                    value: responsible,
                    missing: copy('notRecorded'),
                  ),
                  _OverviewFact(
                    key: AccidentDetailScreenKeys.dueDate,
                    label: l10n.accidentDueDateLabel,
                    value: record.expectedReleaseDate,
                    missing: copy('notRecorded'),
                  ),
                  if (!snapshot.provisioned) ...<Widget>[
                    const SizedBox(height: TpSpace.md),
                    TpNotConfiguredState(
                      title: copy('notActivated'),
                      detail: copy('notActivatedMessage'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
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

List<AccidentProgressStep> _progressSteps(
  AccidentCaseSnapshot snapshot,
  AccidentCopy copy,
) {
  final bool closed = <String?>[
    snapshot.accident.caseStatus,
    snapshot.accident.closureStatus,
    snapshot.accident.status,
  ].whereType<String>().any((String token) {
    final String normal = token.trim().toLowerCase();
    return normal == 'closed' || normal == 'completed';
  });
  return <AccidentProgressStep>[
    AccidentProgressStep(
      label: copy('reportShort'),
      state: AccidentProgressState.done,
    ),
    AccidentProgressStep(
      label: _compactCopy(copy('evidence')),
      state: _workstreamProgress(snapshot, 'incident_evidence'),
    ),
    AccidentProgressStep(
      label: _shortCopy(copy('insurance')),
      state: _workstreamProgress(snapshot, 'insurance'),
    ),
    AccidentProgressStep(
      label: _stepWord(copy('wsRepair')),
      state: _workstreamProgress(snapshot, 'repair'),
    ),
    AccidentProgressStep(
      label: copy('closed'),
      state:
          closed ? AccidentProgressState.done : AccidentProgressState.pending,
    ),
  ];
}

AccidentProgressState _workstreamProgress(
  AccidentCaseSnapshot snapshot,
  String key,
) {
  if (!snapshot.provisioned) return AccidentProgressState.unknown;
  final AccidentWorkstream? workstream = _workstream(snapshot.workstreams, key);
  if (workstream == null) return AccidentProgressState.unknown;
  return switch (workstream.chip) {
    AccidentWorkstreamChip.done => AccidentProgressState.done,
    AccidentWorkstreamChip.inProgress => AccidentProgressState.current,
    AccidentWorkstreamChip.pending => AccidentProgressState.pending,
    AccidentWorkstreamChip.notRequired => AccidentProgressState.unknown,
  };
}

AccidentWorkstream? _workstream(
  List<AccidentWorkstream> workstreams,
  String key,
) {
  for (final AccidentWorkstream workstream in workstreams) {
    if (workstream.key == key) return workstream;
  }
  return null;
}

AccidentWorkstream? _activeWorkstream(List<AccidentWorkstream> workstreams) {
  for (final AccidentWorkstream workstream in workstreams) {
    if (workstream.chip == AccidentWorkstreamChip.inProgress) return workstream;
  }
  for (final AccidentWorkstream workstream in workstreams) {
    if (workstream.required != false &&
        workstream.chip == AccidentWorkstreamChip.pending) {
      return workstream;
    }
  }
  return null;
}

String _compactCopy(String value) =>
    value.replaceFirst(RegExp(r'^\s*\d+[.)]\s*'), '').trim();

String _shortCopy(String value) => value.split('&').first.trim();

/// The first word of [value], for the five-column progress ladder - see the
/// identical helper and its doc comment in `accident_case_screen.dart`.
String _stepWord(String value) {
  final String trimmed = _shortCopy(value).trim();
  final int space = trimmed.indexOf(' ');
  return space < 0 ? trimmed : trimmed.substring(0, space);
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Text(
        label.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: TpPalette.of(context).textSecondary,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.5,
            ),
      );
}

class _OverviewFact extends StatelessWidget {
  const _OverviewFact({
    required this.label,
    required this.value,
    required this.missing,
    super.key,
  });

  final String label;
  final String? value;
  final String missing;

  @override
  Widget build(BuildContext context) {
    final String shown = value?.trim() ?? '';
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: TpPalette.of(context).border),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _SectionLabel(label),
            const SizedBox(height: TpSpace.xs),
            Text(
              shown.isEmpty ? missing : shown,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BottomAction extends StatelessWidget {
  const _BottomAction({
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
              onPressed: onPressed,
              isFullWidth: true,
            ),
          ),
        ),
      );
}
