/// Fills one checklist: header (site/printed name/reading language), every
/// visible field in template order, and the submit gate.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart'
    show ChecklistDraftPhoto;
import 'package:tyre_pulse/features/checklists/data/checklist_photo_capture.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_auto_fill.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_submit_gate.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';
import 'package:tyre_pulse/features/checklists/presentation/controllers/checklist_fill_controller.dart';
import 'package:tyre_pulse/features/checklists/presentation/state/checklist_fill_state.dart';
import 'package:tyre_pulse/features/checklists/presentation/widgets/checklist_field_answer_tile.dart';
import 'package:tyre_pulse/features/checklists/presentation/widgets/checklist_signature_pad.dart';

class ChecklistFillScreen extends ConsumerStatefulWidget {
  const ChecklistFillScreen({required this.route, super.key});

  final ChecklistFillRoute route;

  @override
  ConsumerState<ChecklistFillScreen> createState() =>
      _ChecklistFillScreenState();
}

class _ChecklistFillScreenState extends ConsumerState<ChecklistFillScreen> {
  @override
  void initState() {
    super.initState();
    // Runs once, matching `NewInspectionScreen`'s own established pattern
    // for this exact situation - see `ChecklistFillController`'s own
    // library comment.
    unawaited(
      ref
          .read(checklistFillControllerProvider.notifier)
          .initialiseFromRoute(widget.route),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ChecklistFillState state = ref.watch(checklistFillControllerProvider);
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (state.phase == ChecklistFillPhase.loading) {
      return TpScaffold(
        backFallback: TpRoutePaths.checklists,
        appBar: TpAppBar(
          title: l10n.checklistFillLoadingTitle,
          backFallback: TpRoutePaths.checklists,
        ),
        body: const TpLoadingState(),
      );
    }

    if (state.phase == ChecklistFillPhase.error) {
      return TpScaffold(
        backFallback: TpRoutePaths.checklists,
        appBar: TpAppBar(
          title: l10n.checklistFillLoadingTitle,
          backFallback: TpRoutePaths.checklists,
        ),
        body: TpErrorState(
          error: AppError(
            kind: AppErrorKind.unknown,
            message: state.errorMessage ?? l10n.stateErrorTitle,
            isRetryable: true,
          ),
          onRetry: () => ref
              .read(checklistFillControllerProvider.notifier)
              .initialiseFromRoute(widget.route),
        ),
      );
    }

    if (state.phase == ChecklistFillPhase.submitted) {
      return _SubmittedView(
        onDone: () => GoRouter.of(context).go(TpRoutePaths.checklists),
      );
    }

    return _FillFormView(state: state);
  }
}

class _SubmittedView extends StatelessWidget {
  const _SubmittedView({required this.onDone});

  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpScaffold(
      body: TpStateView(
        icon: Icons.check_circle_outline,
        tone: TpStatus.ok,
        title: l10n.checklistSubmittedTitle,
        message: l10n.checklistSubmittedMessage,
        primaryActionLabel: l10n.actionClose,
        onPrimaryAction: onDone,
      ),
    );
  }
}

class _FillFormView extends ConsumerWidget {
  const _FillFormView({required this.state});

  final ChecklistFillState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ChecklistTemplate template = state.templateRecord!.template;
    final List<ChecklistField> fields = visibleChecklistFields(
      template.fields,
      state.answers,
    );
    final ChecklistFillController controller = ref.read(
      checklistFillControllerProvider.notifier,
    );
    final ChecklistSubmitGate? gate = state.submitGate;

    return TpScaffold(
      backFallback: TpRoutePaths.checklists,
      appBar: TpAppBar(
        title: template.name ?? l10n.checklistFillLoadingTitle,
        subtitle: state.assetNo,
        backFallback: TpRoutePaths.checklists,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl * 2,
        ),
        children: <Widget>[
          if (state.errorMessage != null)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.lg),
              child: _Banner(
                tone: TpStatus.critical,
                message: state.errorMessage!,
              ),
            ),
          if (state.lastSubmissionWarning?.found ?? false)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.lg),
              child: _Banner(
                tone: TpStatus.info,
                message: state.lastSubmissionWarning!.daysAgo == null
                    ? l10n.checklistLastSubmissionKnown
                    : l10n.checklistLastSubmissionDaysAgo(
                        state.lastSubmissionWarning!.daysAgo!,
                      ),
              ),
            ),
          _HeaderCard(state: state, controller: controller),
          const SizedBox(height: TpSpace.lg),
          for (final ChecklistField field in fields)
            _buildField(context, controller, field),
          if (state.templateRecord!.requireSignature) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            Text(
              l10n.checklistPrimarySignatureLabel,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: TpSpace.sm),
            ChecklistSignaturePad(
              value: state.primarySignature,
              onChanged: (capture) =>
                  controller.savePrimarySignature(capture?.dataUrl),
            ),
          ],
          const SizedBox(height: TpSpace.xl),
          if (gate != null && !gate.canSubmit)
            _GateSummary(gate: gate, l10n: l10n),
          const SizedBox(height: TpSpace.md),
          TpButton.primary(
            label: l10n.checklistSubmitAction,
            isFullWidth: true,
            isBusy: state.phase == ChecklistFillPhase.submitting,
            onPressed: state.canSubmit ? controller.submit : null,
          ),
        ],
      ),
    );
  }

  Widget _buildField(
    BuildContext context,
    ChecklistFillController controller,
    ChecklistField field,
  ) {
    final ChecklistTemplate template = state.templateRecord!.template;
    final String label = fieldLabel(field, state.readLang);
    final Object? value = state.answers[field.id];
    final bool locked = field.locked;
    final bool readOnly = isFieldLocked(field, value);
    final ChecklistSubmitGate? gate = state.submitGate;
    final String? errorText =
        gate?.fieldErrors[field.id] ?? gate?.signatureFieldErrors[field.id];
    final bool noteRequired =
        gate?.missingNotes.any((f) => f.id == field.id) ?? false;

    List<ChecklistFieldOption> options = const <ChecklistFieldOption>[];
    if (field.type == 'select' || field.type == 'multiselect') {
      options = fieldOptions(field, template, state.readLang);
    } else if (field.type == 'site') {
      options = <ChecklistFieldOption>[
        for (final String s in state.siteOptions)
          ChecklistFieldOption(value: s, label: s),
      ];
    }

    return ChecklistFieldAnswerTile(
      key: ValueKey<String>(field.id),
      field: field,
      label: label,
      value: value,
      options: options,
      onChanged: (Object? v) => controller.updateAnswer(field.id, v),
      readOnly: readOnly,
      locked: locked,
      errorText: errorText,
      note: state.notes[field.id]?.toString(),
      onNoteChanged: field.allowNote == false
          ? null
          : (String v) => controller.updateNote(field.id, v),
      noteRequired: noteRequired,
      showNoteField: field.allowNote != false,
      photos: (state.photosByField[field.id] ?? const <ChecklistDraftPhoto>[])
          .map((ChecklistDraftPhoto p) => p.localPath)
          .toList(growable: false),
      onCapturePhoto: field.type == 'photo'
          ? (ChecklistPhotoPickSource source) => controller.capturePhoto(
                fieldId: field.id,
                capture: () async {
                  final String? draftKey = state.draftKey;
                  if (draftKey == null) return null;
                  final CapturedChecklistPhoto? captured =
                      await ChecklistPhotoCapture().captureAndStore(
                    draftKey: draftKey,
                    fieldKey: field.id,
                    source: source == ChecklistPhotoPickSource.camera
                        ? ChecklistPhotoSource.camera
                        : ChecklistPhotoSource.gallery,
                  );
                  if (captured == null) return null;
                  return ChecklistDraftPhotoCaptureResult(
                    localPath: captured.localPath,
                    capturedAt: captured.capturedAt,
                    sizeBytes: captured.sizeBytes,
                  );
                },
              )
          : null,
      signatureBuilder: field.type == 'signature'
          ? (BuildContext context) => ChecklistSignaturePad(
                value: state.signaturesByField[field.id],
                onChanged: (capture) =>
                    controller.saveSignature(field.id, capture?.dataUrl),
              )
          : null,
    );
  }
}

class _HeaderCard extends StatefulWidget {
  const _HeaderCard({required this.state, required this.controller});

  final ChecklistFillState state;
  final ChecklistFillController controller;

  @override
  State<_HeaderCard> createState() => _HeaderCardState();
}

class _HeaderCardState extends State<_HeaderCard> {
  late final TextEditingController _printedNameController;

  @override
  void initState() {
    super.initState();
    _printedNameController = TextEditingController(
      text: widget.state.printedName,
    );
  }

  @override
  void didUpdateWidget(covariant _HeaderCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state.printedName != widget.state.printedName &&
        _printedNameController.text != widget.state.printedName) {
      _printedNameController.text = widget.state.printedName;
    }
  }

  @override
  void dispose() {
    _printedNameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ChecklistFillState state = widget.state;
    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (state.siteOptions.isNotEmpty)
            TpDropdown<String>(
              label: l10n.checklistSiteLabel,
              value: state.siteOptions.contains(state.site) ? state.site : null,
              items: <TpDropdownItem<String>>[
                for (final String s in state.siteOptions)
                  TpDropdownItem<String>(value: s, label: s),
              ],
              onChanged: widget.controller.setSite,
            )
          else
            TpInput(
              label: l10n.checklistSiteLabel,
              hint: state.site,
              enabled: false,
            ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: l10n.checklistPrintedNameLabel,
            controller: _printedNameController,
            hint: l10n.checklistPrintedNamePlaceholder,
            onChanged: widget.controller.setPrintedName,
          ),
        ],
      ),
    );
  }
}

class _GateSummary extends StatelessWidget {
  const _GateSummary({required this.gate, required this.l10n});

  final ChecklistSubmitGate gate;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final List<String> lines = <String>[
      if (gate.fieldErrors.isNotEmpty)
        l10n.checklistGateFieldErrors(gate.fieldErrors.length),
      if (gate.signatureFieldErrors.isNotEmpty)
        l10n.checklistGateSignatureErrors(gate.signatureFieldErrors.length),
      if (gate.missingNotes.isNotEmpty)
        l10n.checklistGateMissingNotes(gate.missingNotes.length),
      if (gate.unsatisfiedGroups.isNotEmpty)
        l10n.checklistGateUnsatisfiedGroups(gate.unsatisfiedGroups.length),
      if (!gate.primarySignatureOk) l10n.checklistGatePrimarySignature,
    ];
    if (lines.isEmpty) return const SizedBox.shrink();
    return _Banner(tone: TpStatus.warning, message: lines.join('\n'));
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.tone, required this.message});

  final TpStatus tone;
  final String message;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Text(
        message,
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: colors.onSoft),
      ),
    );
  }
}
