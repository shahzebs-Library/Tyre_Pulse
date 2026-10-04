/// "Report a problem" - one sentence, a type, an optional severity.
///
/// Reached from Profile (Help section) and from the "Report a problem" action
/// the shared error states offer when [TpReportProblemScope] is installed. It
/// is pushed with `Navigator` rather than given a go_router route, so no
/// router wiring file changes (AGENTS.md: those seven files are human-only).
///
/// Online only (see `problem_report_repository.dart`): with no signal the
/// screen says so plainly and keeps what was typed, so the person can press
/// Send again once they have signal. Nothing is queued.
///
/// No database text reaches the screen: every failure is one of
/// [ProblemSubmitFailure]'s seven cases, each with its own localised sentence.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/problem_report/data/device_context_reader.dart';
import 'package:tyre_pulse/features/problem_report/domain/problem_report.dart';
import 'package:tyre_pulse/features/problem_report/problem_report_providers.dart';

/// Keys for widget tests.
abstract final class ReportProblemScreenKeys {
  static const Key description = Key('reportProblem.description');
  static const Key category = Key('reportProblem.category');
  static const Key severity = Key('reportProblem.severity');
  static const Key send = Key('reportProblem.send');
  static const Key failure = Key('reportProblem.failure');
  static const Key success = Key('reportProblem.success');
  static const Key attached = Key('reportProblem.attached');
}

/// The route location currently on screen, or null when there is no
/// go_router above [context] (a widget test, a pushed dialog). Never throws.
String? currentRouteLocation(BuildContext context) {
  try {
    final GoRouter? router = GoRouter.maybeOf(context);
    if (router == null) return null;
    final String path = router.routerDelegate.currentConfiguration.uri.path;
    return path.trim().isEmpty ? null : path;
  } on Object {
    return null;
  }
}

/// Opens the report screen from anywhere below the app's Navigator.
///
/// [sourceScreen] is the route the person was on; when omitted it is read
/// from go_router at the moment of opening.
Future<void> openReportProblem(
  BuildContext context, {
  String? sourceScreen,
  String? referenceId,
}) {
  final String? screen = sourceScreen ?? currentRouteLocation(context);
  return Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (BuildContext _) =>
          ReportProblemScreen(sourceScreen: screen, referenceId: referenceId),
    ),
  );
}

/// The version string to attach: null for the unconfigured build placeholder
/// (`999.0.0`, see `main.dart`) rather than a version that never existed.
String? reportableAppVersion(String? configured) {
  final String value = (configured ?? '').trim();
  if (value.isEmpty || value == '999.0.0') return null;
  return value;
}

class ReportProblemScreen extends ConsumerStatefulWidget {
  const ReportProblemScreen({this.sourceScreen, this.referenceId, super.key});

  final String? sourceScreen;
  final String? referenceId;

  @override
  ConsumerState<ReportProblemScreen> createState() =>
      _ReportProblemScreenState();
}

class _ReportProblemScreenState extends ConsumerState<ReportProblemScreen> {
  final TextEditingController _description = TextEditingController();
  ProblemCategory? _category;
  ProblemSeverity? _severity;
  bool _attempted = false;
  bool _sending = false;
  ProblemSubmitFailure? _failure;
  ProblemSubmitted? _sent;

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  String? _appVersion() {
    try {
      return reportableAppVersion(ref.read(currentAppVersionProvider));
    } on Object {
      return null;
    }
  }

  Future<void> _send() async {
    if (_sending) return;
    setState(() => _attempted = true);
    if (validateProblemDescription(_description.text) != null ||
        _category == null) {
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _sending = true;
      _failure = null;
    });
    DeviceDescription device = (device: null, os: null);
    try {
      device = await ref.read(deviceDescriptionProvider.future);
    } on Object {
      // A device that cannot be described does not stop the report.
    }
    final ProblemSubmitOutcome outcome =
        await ref.read(problemReportRepositoryProvider).submit(
              ProblemReportDraft(
                description: _description.text,
                category: _category!,
                severity: _severity,
                referenceId: widget.referenceId,
                context: ProblemReportContext(
                  appVersion: _appVersion(),
                  device: device.device,
                  os: device.os,
                  screen: widget.sourceScreen,
                ),
              ),
            );
    if (!mounted) return;
    setState(() {
      _sending = false;
      switch (outcome) {
        case ProblemSubmitted():
          _sent = outcome;
        case ProblemNotSubmitted(:final ProblemSubmitFailure reason):
          _failure = reason;
      }
    });
  }

  String _failureText(AppLocalizations l10n, ProblemSubmitFailure failure) {
    return switch (failure) {
      ProblemSubmitFailure.needsSignal => l10n.problemReportNeedsSignal,
      ProblemSubmitFailure.signedOut => l10n.problemReportSignedOut,
      ProblemSubmitFailure.notAllowed => l10n.problemReportNotAllowed,
      ProblemSubmitFailure.tooMany => l10n.problemReportTooMany,
      ProblemSubmitFailure.invalid => l10n.problemReportInvalid,
      ProblemSubmitFailure.unavailable => l10n.problemReportUnavailable,
      ProblemSubmitFailure.failed => l10n.problemReportFailed,
    };
  }

  String? _descriptionError(AppLocalizations l10n) {
    if (!_attempted) return null;
    return switch (validateProblemDescription(_description.text)) {
      ProblemDescriptionIssue.tooShort => l10n.problemReportDescriptionTooShort,
      ProblemDescriptionIssue.tooLong => l10n.problemReportDescriptionTooLong,
      null => null,
    };
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.problemReportAction,
        onBack: () => unawaited(Navigator.of(context).maybePop()),
      ),
      body:
          _sent != null ? _buildSent(context, l10n) : _buildForm(context, l10n),
    );
  }

  Widget _buildSent(BuildContext context, AppLocalizations l10n) {
    return TpStateView(
      key: ReportProblemScreenKeys.success,
      icon: Icons.check_circle_outline_rounded,
      tone: TpStatus.ok,
      title: l10n.problemReportSentTitle,
      message: l10n.problemReportSentMessage,
      primaryActionLabel: l10n.actionClose,
      onPrimaryAction: () => unawaited(Navigator.of(context).maybePop()),
    );
  }

  Widget _buildForm(BuildContext context, AppLocalizations l10n) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final AsyncValue<DeviceDescription> device = ref.watch(
      deviceDescriptionProvider,
    );
    final String? version = _appVersion();
    final DeviceDescription? described = device.asData?.value;
    final String deviceText = <String?>[
      described?.device,
      described?.os,
    ].whereType<String>().where((String s) => s.trim().isNotEmpty).join(' · ');
    final ProblemSubmitFailure? failure = _failure;

    return SafeArea(
      top: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(l10n.problemReportIntro, style: text.bodyMedium),
                  const SizedBox(height: TpSpace.lg),
                  TpInput(
                    key: ReportProblemScreenKeys.description,
                    label: l10n.problemReportDescriptionLabel,
                    hint: l10n.problemReportDescriptionHint,
                    controller: _description,
                    isRequired: true,
                    enabled: !_sending,
                    maxLines: 5,
                    maxLength: problemDescriptionMax,
                    keyboardType: TextInputType.multiline,
                    textInputAction: TextInputAction.newline,
                    textCapitalization: TextCapitalization.sentences,
                    inputFormatters: <TextInputFormatter>[
                      LengthLimitingTextInputFormatter(problemDescriptionMax),
                    ],
                    errorText: _descriptionError(l10n),
                    onChanged: (_) {
                      if (_attempted) setState(() {});
                    },
                  ),
                  const SizedBox(height: TpSpace.md),
                  TpDropdown<ProblemCategory>(
                    key: ReportProblemScreenKeys.category,
                    label: l10n.problemReportTypeLabel,
                    value: _category,
                    isRequired: true,
                    enabled: !_sending,
                    errorText: _attempted && _category == null
                        ? l10n.problemReportTypeRequired
                        : null,
                    items: <TpDropdownItem<ProblemCategory>>[
                      for (final ProblemCategory c in ProblemCategory.values)
                        TpDropdownItem<ProblemCategory>(
                          value: c,
                          label: _categoryLabel(l10n, c),
                        ),
                    ],
                    onChanged: (ProblemCategory? value) =>
                        setState(() => _category = value),
                  ),
                  const SizedBox(height: TpSpace.md),
                  TpDropdown<ProblemSeverity>(
                    key: ReportProblemScreenKeys.severity,
                    label: l10n.problemReportSeverityLabel,
                    value: _severity,
                    enabled: !_sending,
                    items: <TpDropdownItem<ProblemSeverity>>[
                      for (final ProblemSeverity s in ProblemSeverity.values)
                        TpDropdownItem<ProblemSeverity>(
                          value: s,
                          label: _severityLabel(l10n, s),
                        ),
                    ],
                    onChanged: (ProblemSeverity? value) =>
                        setState(() => _severity = value),
                  ),
                  const SizedBox(height: TpSpace.lg),
                  TpCard(
                    key: ReportProblemScreenKeys.attached,
                    background: palette.surfaceAlt,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Text(
                          l10n.problemReportAttachedTitle,
                          style: text.titleSmall,
                        ),
                        const SizedBox(height: TpSpace.sm),
                        _AttachedLine(
                          label: l10n.problemReportAttachedVersion,
                          value: version ?? l10n.valueUnavailable,
                        ),
                        _AttachedLine(
                          label: l10n.problemReportAttachedDevice,
                          value: device.isLoading
                              ? l10n.stateLoading
                              : deviceText.isEmpty
                                  ? l10n.valueUnavailable
                                  : deviceText,
                        ),
                        _AttachedLine(
                          label: l10n.problemReportAttachedScreen,
                          value: widget.sourceScreen ?? l10n.valueUnavailable,
                        ),
                      ],
                    ),
                  ),
                  if (failure != null) ...<Widget>[
                    const SizedBox(height: TpSpace.lg),
                    _FailureBanner(
                      key: ReportProblemScreenKeys.failure,
                      icon: failure == ProblemSubmitFailure.needsSignal
                          ? Icons.signal_cellular_off_rounded
                          : Icons.error_outline_rounded,
                      message: _failureText(l10n, failure),
                    ),
                  ],
                  const SizedBox(height: TpSpace.xl),
                  TpButton.primary(
                    key: ReportProblemScreenKeys.send,
                    label: l10n.problemReportSend,
                    icon: Icons.send_rounded,
                    isBusy: _sending,
                    isFullWidth: true,
                    onPressed: _sending ? null : () => unawaited(_send()),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _categoryLabel(AppLocalizations l10n, ProblemCategory c) => switch (c) {
      ProblemCategory.bug => l10n.problemReportTypeBug,
      ProblemCategory.dataWrong => l10n.problemReportTypeData,
      ProblemCategory.access => l10n.problemReportTypeAccess,
      ProblemCategory.slow => l10n.problemReportTypeSlow,
      ProblemCategory.other => l10n.problemReportTypeOther,
    };

String _severityLabel(AppLocalizations l10n, ProblemSeverity s) => switch (s) {
      ProblemSeverity.low => l10n.problemReportSeverityLow,
      ProblemSeverity.medium => l10n.problemReportSeverityMedium,
      ProblemSeverity.high => l10n.problemReportSeverityHigh,
      ProblemSeverity.critical => l10n.problemReportSeverityCritical,
    };

class _AttachedLine extends StatelessWidget {
  const _AttachedLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            flex: 2,
            child: Text(
              label,
              style: text.labelMedium?.copyWith(color: palette.textSecondary),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            flex: 3,
            // Route paths and device names are Latin script; an isolate keeps
            // them in order inside an Arabic or Urdu row.
            child: Text('\u2068$value\u2069', style: text.bodySmall),
          ),
        ],
      ),
    );
  }
}

class _FailureBanner extends StatelessWidget {
  const _FailureBanner({required this.icon, required this.message, super.key});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(TpSpace.md),
        decoration: BoxDecoration(
          color: palette.critical.soft,
          borderRadius: BorderRadius.circular(TpRadius.md),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, color: palette.critical.onSoft),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                message,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: palette.critical.onSoft),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
