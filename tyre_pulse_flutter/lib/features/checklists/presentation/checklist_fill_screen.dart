/// Fills one checklist: header (site/printed name/reading language), every
/// visible field in template order, and the submit gate.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
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
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';

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
      Future<void>.microtask(
        () => ref
            .read(checklistFillControllerProvider.notifier)
            .initialiseFromRoute(widget.route),
      ),
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
            message: _failureMessage(l10n, state.failure),
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
    ).where((ChecklistField field) => !_isHeaderContextField(field)).toList();
    final ChecklistFillController controller = ref.read(
      checklistFillControllerProvider.notifier,
    );
    final List<VehicleAsset> fleetAssets = _fleetAssets(
      ref.watch(vehicleFleetListProvider).value,
    );
    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    final ChecklistSubmitGate? gate = state.submitGate;
    final _ChecklistProgress progress = _ChecklistProgress.fromState(
      state: state,
      fields: fields,
    );
    final List<_ChecklistSection> sections = _ChecklistSection.fromFields(
      fields,
      state,
    );

    return TpScaffold(
      backFallback: TpRoutePaths.checklists,
      appBar: TpAppBar(
        title: template.name ?? l10n.checklistFillLoadingTitle,
        subtitle: state.assetNo,
        backFallback: TpRoutePaths.checklists,
      ),
      bottomNavigationBar: _SubmitDock(
        state: state,
        progress: progress,
        onSubmit: controller.submit,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          _ProgressOverview(
            state: state,
            progress: progress,
          ),
          const SizedBox(height: TpSpace.lg),
          if (state.failure != null)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.lg),
              child: _Banner(
                tone: TpStatus.critical,
                message: _failureMessage(l10n, state.failure),
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
          _HeaderCard(
            state: state,
            controller: controller,
            languages: _availableLanguages(template),
            fleetAssets: fleetAssets,
            employeeId: workspace?.employeeId,
          ),
          const SizedBox(height: TpSpace.lg),
          if (sections.length > 1) ...<Widget>[
            _SectionProgressRail(sections: sections, state: state),
            const SizedBox(height: TpSpace.lg),
          ],
          for (int sectionIndex = 0;
              sectionIndex < sections.length;
              sectionIndex++) ...<Widget>[
            _SectionHeading(
              index: sectionIndex,
              section: sections[sectionIndex],
              state: state,
              showTitle: sections.length > 1 ||
                  sections[sectionIndex].title.trim().isNotEmpty,
            ),
            for (int fieldIndex = 0;
                fieldIndex < sections[sectionIndex].fields.length;
                fieldIndex++)
              _QuestionCard(
                number: sections.take(sectionIndex).fold<int>(
                          0,
                          (int total, _ChecklistSection item) =>
                              total + item.fields.length,
                        ) +
                    fieldIndex +
                    1,
                field: sections[sectionIndex].fields[fieldIndex],
                state: state,
                child: _buildField(
                  context,
                  controller,
                  sections[sectionIndex].fields[fieldIndex],
                ),
              ),
            const SizedBox(height: TpSpace.sm),
          ],
          if (state.templateRecord!.requireSignature) ...<Widget>[
            _SignOffCard(
              title: l10n.checklistPrimarySignatureLabel,
              isComplete: (state.primarySignature ?? '').trim().isNotEmpty,
              signerName: state.printedName,
              employeeId: workspace?.employeeId,
              child: ChecklistSignaturePad(
                value: state.primarySignature,
                onChanged: (capture) =>
                    controller.savePrimarySignature(capture?.dataUrl),
              ),
            ),
          ],
          const SizedBox(height: TpSpace.xl),
          if (gate != null && !gate.canSubmit)
            _GateSummary(gate: gate, l10n: l10n),
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

    return Directionality(
      textDirection:
          isRtlLang(state.readLang) ? TextDirection.rtl : TextDirection.ltr,
      child: ChecklistFieldAnswerTile(
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
        // Keep the sheet compact. A note box appears only when the template
        // explicitly allows it, a chosen mark makes it mandatory, or the
        // operator already entered a note. Nullable `allow_note` still keeps
        // its validation semantics; it no longer creates a blank remarks box
        // under every question.
        showNoteField: field.allowNote == true ||
            noteRequired ||
            (state.notes[field.id]?.toString().trim().isNotEmpty ?? false),
        photos: (state.photosByField[field.id] ?? const <ChecklistDraftPhoto>[])
            .map((ChecklistDraftPhoto p) => p.localPath)
            .toList(growable: false),
        onCapturePhoto: field.type == 'photo' || field.allowPhoto
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
      ),
    );
  }
}

String _failureMessage(
  AppLocalizations l10n,
  ChecklistFillFailure? failure,
) =>
    switch (failure) {
      ChecklistFillFailure.workspaceLoading =>
        l10n.checklistWorkspaceLoadingMessage,
      ChecklistFillFailure.notFound => l10n.checklistFillNotFoundMessage,
      ChecklistFillFailure.saveFailed => l10n.checklistFillSaveFailedMessage,
      null => l10n.stateErrorMessage,
    };

List<ChecklistLang> _availableLanguages(ChecklistTemplate template) {
  return <ChecklistLang>[
    for (final ChecklistLang language in kChecklistLangs)
      if (language.code == kChecklistDefaultLang ||
          template.fields.any(
            (ChecklistField field) =>
                (field.labels[language.code] ?? '').trim().isNotEmpty ||
                (field.optionsI18n[language.code]?.isNotEmpty ?? false),
          ) ||
          template.optionSets.values.any(
            (set) => set.i18n[language.code]?.isNotEmpty ?? false,
          ))
        language,
  ];
}

bool _isHeaderContextField(ChecklistField field) {
  if (field.type == 'asset' || field.type == 'site') return true;
  if (field.type == 'date' && (field.locked || field.autoValue == 'today')) {
    return true;
  }
  return field.type == 'user' && field.autoValue == 'current_user';
}

List<VehicleAsset> _fleetAssets(VehicleFleetListOutcome? outcome) {
  return switch (outcome) {
    VehicleFleetListLoaded(assets: final List<VehicleAsset> assets) => assets,
    VehicleFleetListFromCache(assets: final List<VehicleAsset> assets) =>
      assets,
    VehicleFleetListFailed() || null => const <VehicleAsset>[],
  };
}

bool _hasAnswer(Object? value) {
  if (value == null) return false;
  if (value is String) return value.trim().isNotEmpty;
  if (value is Iterable) return value.isNotEmpty;
  if (value is Map) return value.isNotEmpty;
  return true;
}

bool _isFieldComplete(ChecklistField field, ChecklistFillState state) {
  return switch (field.type) {
    'photo' => (state.photosByField[field.id] ?? const <ChecklistDraftPhoto>[])
        .isNotEmpty,
    'signature' => (state.signaturesByField[field.id] ?? '').trim().isNotEmpty,
    _ => _hasAnswer(state.answers[field.id]),
  };
}

bool _fieldNeedsAttention(ChecklistField field, ChecklistFillState state) {
  final ChecklistSubmitGate? gate = state.submitGate;
  if (gate == null) return false;
  return gate.fieldErrors.containsKey(field.id) ||
      gate.signatureFieldErrors.containsKey(field.id) ||
      gate.missingNotes.any((item) => item.id == field.id);
}

final class _ChecklistProgress {
  const _ChecklistProgress({
    required this.completed,
    required this.total,
    required this.photoCount,
  });

  factory _ChecklistProgress.fromState({
    required ChecklistFillState state,
    required List<ChecklistField> fields,
  }) {
    final List<ChecklistField> answerable = <ChecklistField>[
      for (final ChecklistField field in fields)
        if (field.type != 'section') field,
    ];
    return _ChecklistProgress(
      completed: answerable
          .where((ChecklistField field) => _isFieldComplete(field, state))
          .length,
      total: answerable.length,
      photoCount: state.photosByField.values.fold<int>(
        0,
        (int count, List<ChecklistDraftPhoto> photos) => count + photos.length,
      ),
    );
  }

  final int completed;
  final int total;
  final int photoCount;

  double get fraction => total == 0 ? 0 : completed / total;
  int get percent => (fraction * 100).round();
}

final class _ChecklistSection {
  const _ChecklistSection({required this.title, required this.fields});

  static List<_ChecklistSection> fromFields(
    List<ChecklistField> fields,
    ChecklistFillState state,
  ) {
    final List<_ChecklistSection> sections = <_ChecklistSection>[];
    String title = '';
    List<ChecklistField> current = <ChecklistField>[];

    void finishCurrent() {
      if (title.trim().isEmpty && current.isEmpty) return;
      sections.add(
        _ChecklistSection(
          title: title,
          fields: List<ChecklistField>.unmodifiable(current),
        ),
      );
    }

    for (final ChecklistField field in fields) {
      if (field.type == 'section') {
        finishCurrent();
        title = fieldLabel(field, state.readLang);
        current = <ChecklistField>[];
      } else {
        current.add(field);
      }
    }
    finishCurrent();

    if (sections.isEmpty) {
      sections
          .add(const _ChecklistSection(title: '', fields: <ChecklistField>[]));
    }
    return sections;
  }

  final String title;
  final List<ChecklistField> fields;

  int completed(ChecklistFillState state) => fields
      .where((ChecklistField field) => _isFieldComplete(field, state))
      .length;

  bool isComplete(ChecklistFillState state) =>
      fields.isNotEmpty && completed(state) == fields.length;
}

class _ProgressOverview extends StatelessWidget {
  const _ProgressOverview({
    required this.state,
    required this.progress,
  });

  final ChecklistFillState state;
  final _ChecklistProgress progress;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool ready = state.canSubmit;
    return TpCard(
      borderColor: ready ? palette.ok.base : palette.borderStrong,
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final Widget details = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                l10n.checklistResumeProgress(
                  progress.completed,
                  progress.total,
                ),
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: TpSpace.sm),
              LinearProgressIndicator(
                value: progress.fraction,
                minHeight: 8,
                borderRadius: BorderRadius.circular(TpRadius.pill),
                backgroundColor: palette.surfaceSunken,
                color: ready ? palette.ok.base : palette.primary,
              ),
              const SizedBox(height: TpSpace.md),
              Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.sm,
                children: <Widget>[
                  TpStatusChip(
                    status: ready ? TpStatus.ok : TpStatus.warning,
                    icon: ready ? Icons.task_alt : Icons.pending_actions,
                  ),
                  if (progress.photoCount > 0)
                    _EvidenceBadge(
                      count: progress.photoCount,
                      semanticLabel: l10n.checklistAddPhotoTitle,
                    ),
                ],
              ),
            ],
          );
          final Widget ring = _ProgressRing(progress: progress, ready: ready);
          if (constraints.maxWidth < 430) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(child: details),
                const SizedBox(width: TpSpace.lg),
                ring,
              ],
            );
          }
          return Row(
            children: <Widget>[
              Expanded(child: details),
              const SizedBox(width: TpSpace.xl),
              ring,
            ],
          );
        },
      ),
    );
  }
}

class _ProgressRing extends StatelessWidget {
  const _ProgressRing({required this.progress, required this.ready});

  final _ChecklistProgress progress;
  final bool ready;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      value: '${progress.percent}%',
      child: SizedBox.square(
        dimension: 72,
        child: Stack(
          alignment: Alignment.center,
          children: <Widget>[
            SizedBox.square(
              dimension: 68,
              child: CircularProgressIndicator(
                value: progress.fraction,
                strokeWidth: 8,
                strokeCap: StrokeCap.round,
                backgroundColor: palette.surfaceSunken,
                color: ready ? palette.ok.base : palette.primary,
              ),
            ),
            Text(
              '${progress.percent}%',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _EvidenceBadge extends StatelessWidget {
  const _EvidenceBadge({required this.count, required this.semanticLabel});

  final int count;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      label: '$semanticLabel: $count',
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.info.soft,
          borderRadius: BorderRadius.circular(TpRadius.pill),
          border: Border.all(color: palette.info.base),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.md,
            vertical: TpSpace.xs,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.photo_camera_outlined,
                size: TpSizing.iconSm,
                color: palette.info.onSoft,
              ),
              const SizedBox(width: TpSpace.xs),
              Text(
                '$count',
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(color: palette.info.onSoft),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionProgressRail extends StatelessWidget {
  const _SectionProgressRail({required this.sections, required this.state});

  final List<_ChecklistSection> sections;
  final ChecklistFillState state;

  @override
  Widget build(BuildContext context) {
    int current = sections.indexWhere(
      (_ChecklistSection section) => !section.isComplete(state),
    );
    if (current < 0) current = sections.length - 1;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: <Widget>[
          for (int index = 0; index < sections.length; index++) ...<Widget>[
            _SectionStep(
              index: index,
              section: sections[index],
              state: state,
              isCurrent: index == current,
            ),
            if (index != sections.length - 1)
              Container(
                width: TpSpace.xxl,
                height: 1,
                color: TpPalette.of(context).borderStrong,
              ),
          ],
        ],
      ),
    );
  }
}

class _SectionStep extends StatelessWidget {
  const _SectionStep({
    required this.index,
    required this.section,
    required this.state,
    required this.isCurrent,
  });

  final int index;
  final _ChecklistSection section;
  final ChecklistFillState state;
  final bool isCurrent;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool complete = section.isComplete(state);
    final Color color = complete
        ? palette.ok.base
        : isCurrent
            ? palette.primary
            : palette.borderStrong;
    return SizedBox(
      width: 104,
      child: Column(
        children: <Widget>[
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: complete || isCurrent ? color : palette.surface,
              shape: BoxShape.circle,
              border: Border.all(color: color, width: TpBorderWidth.strong),
            ),
            child: complete
                ? Icon(
                    Icons.check,
                    size: TpSizing.iconMd,
                    color: palette.onPrimary,
                  )
                : Text(
                    '${index + 1}',
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: isCurrent ? palette.onPrimary : palette.text,
                        ),
                  ),
          ),
          const SizedBox(height: TpSpace.xs),
          Directionality(
            textDirection: isRtlLang(state.readLang)
                ? TextDirection.rtl
                : TextDirection.ltr,
            child: Text(
              section.title,
              maxLines: 2,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: isCurrent || complete
                        ? palette.text
                        : palette.textMuted,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({
    required this.index,
    required this.section,
    required this.state,
    required this.showTitle,
  });

  final int index;
  final _ChecklistSection section;
  final ChecklistFillState state;
  final bool showTitle;

  @override
  Widget build(BuildContext context) {
    if (!showTitle) return const SizedBox.shrink();
    final TpPalette palette = TpPalette.of(context);
    final bool complete = section.isComplete(state);
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.md),
      child: Row(
        children: <Widget>[
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: complete ? palette.ok.soft : palette.primarySoft,
              shape: BoxShape.circle,
            ),
            child: complete
                ? Icon(
                    Icons.check,
                    color: palette.ok.base,
                    size: TpSizing.iconMd,
                  )
                : Text(
                    '${index + 1}',
                    style: Theme.of(context)
                        .textTheme
                        .labelLarge
                        ?.copyWith(color: palette.primaryDark),
                  ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Directionality(
              textDirection: isRtlLang(state.readLang)
                  ? TextDirection.rtl
                  : TextDirection.ltr,
              child: Text(
                section.title,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
          ),
          if (complete)
            const TpStatusChip(
              status: TpStatus.ok,
              icon: Icons.check_circle_outline,
              isCompact: true,
            ),
        ],
      ),
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.number,
    required this.field,
    required this.state,
    required this.child,
  });

  final int number;
  final ChecklistField field;
  final ChecklistFillState state;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool complete = _isFieldComplete(field, state);
    final bool attention = _fieldNeedsAttention(field, state);
    final Color border = attention
        ? palette.critical.base
        : complete
            ? palette.ok.base
            : palette.border;
    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.md),
      borderColor: border,
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        0,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: attention
                      ? palette.critical.soft
                      : complete
                          ? palette.ok.soft
                          : palette.surfaceAlt,
                  shape: BoxShape.circle,
                ),
                child: complete && !attention
                    ? Icon(
                        Icons.check,
                        size: TpSizing.iconSm,
                        color: palette.ok.base,
                      )
                    : Text(
                        '$number',
                        style:
                            Theme.of(context).textTheme.labelMedium?.copyWith(
                                  color: attention
                                      ? palette.critical.base
                                      : palette.textSecondary,
                                ),
                      ),
              ),
              const Spacer(),
              if (attention)
                const TpStatusChip(
                  status: TpStatus.critical,
                  icon: Icons.error_outline,
                  isCompact: true,
                )
              else if (complete)
                const TpStatusChip(
                  status: TpStatus.ok,
                  icon: Icons.check_circle_outline,
                  isCompact: true,
                ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          child,
        ],
      ),
    );
  }
}

class _SignOffCard extends StatelessWidget {
  const _SignOffCard({
    required this.title,
    required this.isComplete,
    required this.signerName,
    required this.employeeId,
    required this.child,
  });

  final String title;
  final bool isComplete;
  final String signerName;
  final String? employeeId;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      borderColor: isComplete ? palette.ok.base : palette.borderStrong,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.draw_outlined,
                color: isComplete ? palette.ok.base : palette.primary,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              if (isComplete)
                const TpStatusChip(
                  status: TpStatus.ok,
                  icon: Icons.check_circle_outline,
                  isCompact: true,
                ),
            ],
          ),
          if (signerName.trim().isNotEmpty ||
              (employeeId?.trim().isNotEmpty ?? false)) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.xs,
              children: <Widget>[
                if (signerName.trim().isNotEmpty)
                  _AuditFact(
                    icon: Icons.verified_user_outlined,
                    value: signerName.trim(),
                  ),
                if (employeeId?.trim().isNotEmpty ?? false)
                  _AuditFact(
                    icon: Icons.badge_outlined,
                    value: employeeId!.trim(),
                  ),
              ],
            ),
          ],
          const SizedBox(height: TpSpace.md),
          child,
        ],
      ),
    );
  }
}

class _SubmitDock extends StatelessWidget {
  const _SubmitDock({
    required this.state,
    required this.progress,
    required this.onSubmit,
  });

  final ChecklistFillState state;
  final _ChecklistProgress progress;
  final Future<bool> Function() onSubmit;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool ready = state.canSubmit;
    return Material(
      color: palette.surface,
      child: SafeArea(
        top: false,
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: palette.border)),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              TpSpace.lg,
              TpSpace.md,
              TpSpace.lg,
              TpSpace.md,
            ),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        l10n.checklistResumeProgress(
                          progress.completed,
                          progress.total,
                        ),
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        ready ? l10n.statusOk : l10n.statusWarning,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: ready
                                  ? palette.ok.base
                                  : palette.warning.base,
                            ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: TpSpace.md),
                Flexible(
                  child: TpButton.primary(
                    label: l10n.checklistSubmitAction,
                    icon: Icons.send_outlined,
                    isBusy: state.phase == ChecklistFillPhase.submitting,
                    onPressed: ready ? () => unawaited(onSubmit()) : null,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReadingLanguagePicker extends StatelessWidget {
  const _ReadingLanguagePicker({
    required this.languages,
    required this.selected,
    required this.onChanged,
  });

  final List<ChecklistLang> languages;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String value = languages.any(
      (ChecklistLang language) => language.code == selected,
    )
        ? selected
        : kChecklistDefaultLang;
    return Semantics(
      label: langMeta(value).label,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: BorderRadius.circular(TpRadius.md),
          border: Border.all(color: palette.borderStrong),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minHeight: TpSizing.minTouchTarget,
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.md),
            child: Row(
              children: <Widget>[
                Icon(
                  Icons.translate,
                  color: palette.primary,
                  size: TpSizing.iconMd,
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      value: value,
                      isExpanded: true,
                      dropdownColor: palette.surface,
                      iconEnabledColor: palette.textSecondary,
                      onChanged: (String? next) {
                        if (next != null) onChanged(next);
                      },
                      items: <DropdownMenuItem<String>>[
                        for (final ChecklistLang language in languages)
                          DropdownMenuItem<String>(
                            value: language.code,
                            child: Directionality(
                              textDirection: language.isRtl
                                  ? TextDirection.rtl
                                  : TextDirection.ltr,
                              child: Align(
                                alignment: language.isRtl
                                    ? AlignmentDirectional.centerEnd
                                    : AlignmentDirectional.centerStart,
                                child: Text(
                                  language.native,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HeaderCard extends StatefulWidget {
  const _HeaderCard({
    required this.state,
    required this.controller,
    required this.languages,
    required this.fleetAssets,
    required this.employeeId,
  });

  final ChecklistFillState state;
  final ChecklistFillController controller;
  final List<ChecklistLang> languages;
  final List<VehicleAsset> fleetAssets;
  final String? employeeId;

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

  Future<void> _pickAsset() async {
    final VehicleAsset? selected = await showModalBottomSheet<VehicleAsset>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext context) => _ChecklistAssetPickerSheet(
        assets: widget.fleetAssets,
      ),
    );
    final String? assetNo = selected?.assetNo?.trim();
    if (assetNo == null || assetNo.isEmpty || !mounted) return;
    await widget.controller.setAsset(assetNo);
  }

  Future<void> _scanAsset() async {
    // Keep the operator on the in-progress checklist. The global scanner is
    // a navigation surface (it opens asset/tyre actions); this focused camera
    // surface instead returns the canonical QR payload to its caller.
    final String? assetNo = await showAssetCameraScanner(context);
    if (assetNo == null || assetNo.trim().isEmpty || !mounted) return;
    await widget.controller.setAsset(assetNo);
  }

  String? _contextAnswer(String type) {
    final ChecklistTemplate? template = widget.state.templateRecord?.template;
    if (template == null) return null;
    for (final ChecklistField field in template.fields) {
      if (field.type != type) continue;
      final String value =
          widget.state.answers[field.id]?.toString().trim() ?? '';
      if (value.isNotEmpty) return value;
    }
    return null;
  }

  VehicleAsset? get _selectedAsset {
    final String wanted = widget.state.assetNo?.trim().toLowerCase() ?? '';
    if (wanted.isEmpty) return null;
    for (final VehicleAsset asset in widget.fleetAssets) {
      if (asset.assetNo?.trim().toLowerCase() == wanted) return asset;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ChecklistFillState state = widget.state;
    final VehicleAsset? selectedAsset = _selectedAsset;
    final String? selectedPhoto =
        selectedAsset == null ? null : vehiclePhotoAsset(selectedAsset);
    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              SizedBox.square(
                dimension: 72,
                child: selectedPhoto == null
                    ? const Icon(Icons.local_shipping_outlined, size: 38)
                    : Image.asset(selectedPhoto, fit: BoxFit.contain),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    TpIdentifierText(
                      state.assetNo?.trim().isNotEmpty ?? false
                          ? state.assetNo!.trim()
                          : l10n.checklistNoAssetLabel,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (selectedAsset != null)
                      Text(
                        <String?>[
                          selectedAsset.make,
                          selectedAsset.model,
                          selectedAsset.vehicleType,
                        ]
                            .whereType<String>()
                            .where((String value) => value.trim().isNotEmpty)
                            .join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: TpButton.secondary(
                  label: l10n.checklistSelectAssetAction,
                  icon: Icons.manage_search_rounded,
                  onPressed: widget.fleetAssets.isEmpty ? null : _pickAsset,
                  isFullWidth: true,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: TpButton.secondary(
                  label: l10n.checklistScanAssetAction,
                  icon: Icons.qr_code_scanner_rounded,
                  onPressed: _scanAsset,
                  isFullWidth: true,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          Wrap(
            spacing: TpSpace.lg,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              if (_contextAnswer('date') case final String date)
                _AuditFact(icon: Icons.event_outlined, value: date),
              if (state.printedName.trim().isNotEmpty)
                _AuditFact(
                  icon: Icons.badge_outlined,
                  value: state.printedName.trim(),
                ),
              if (widget.employeeId?.trim().isNotEmpty ?? false)
                _AuditFact(
                  icon: Icons.verified_user_outlined,
                  value:
                      '${l10n.checklistEmployeeIdLabel}: ${widget.employeeId!.trim()}',
                ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          if ((state.assetNo?.trim().isNotEmpty ?? false) &&
              (state.site?.trim().isNotEmpty ?? false))
            TpInput(
              label: l10n.checklistSiteLabel,
              hint: state.site,
              enabled: false,
            )
          else if (state.siteOptions.isNotEmpty)
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
            enabled: false,
            suffix: const Icon(Icons.lock_outline_rounded),
          ),
          if (widget.languages.length > 1) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            _ReadingLanguagePicker(
              languages: widget.languages,
              selected: state.readLang,
              onChanged: widget.controller.setReadLang,
            ),
          ],
        ],
      ),
    );
  }
}

class _AuditFact extends StatelessWidget {
  const _AuditFact({required this.icon, required this.value});

  final IconData icon;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surfaceSunken,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.sm,
          vertical: TpSpace.xs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 16, color: palette.textMuted),
            const SizedBox(width: TpSpace.xs),
            Text(
              value,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChecklistAssetPickerSheet extends StatefulWidget {
  const _ChecklistAssetPickerSheet({required this.assets});

  final List<VehicleAsset> assets;

  @override
  State<_ChecklistAssetPickerSheet> createState() =>
      _ChecklistAssetPickerSheetState();
}

class _ChecklistAssetPickerSheetState
    extends State<_ChecklistAssetPickerSheet> {
  final TextEditingController _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String needle = _query.trim().toLowerCase();
    final List<VehicleAsset> filtered = widget.assets.where((VehicleAsset a) {
      if (!a.hasNavigableAssetNo) return false;
      if (needle.isEmpty) return true;
      return <String?>[
        a.assetNo,
        a.fleetNumber,
        a.registrationNo,
        a.make,
        a.model,
        a.vehicleType,
        a.site,
      ].whereType<String>().any(
            (String value) => value.toLowerCase().contains(needle),
          );
    }).toList(growable: false);

    return FractionallySizedBox(
      heightFactor: 0.88,
      child: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              TpSpace.lg,
              TpSpace.md,
              TpSpace.lg,
              TpSpace.sm,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  l10n.checklistSelectAssetAction,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: l10n.checklistSearchAssetHint,
                  controller: _search,
                  prefixIcon: Icons.search_rounded,
                  onChanged: (String value) => setState(() => _query = value),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                TpSpace.lg,
                TpSpace.sm,
                TpSpace.lg,
                TpSpace.xl,
              ),
              itemCount: filtered.length,
              separatorBuilder: (_, __) => const SizedBox(height: TpSpace.sm),
              itemBuilder: (BuildContext context, int index) {
                final VehicleAsset asset = filtered[index];
                final String? photo = vehiclePhotoAsset(asset);
                final String subtitle = <String?>[
                  asset.make,
                  asset.model,
                  asset.vehicleType,
                  asset.site,
                ]
                    .whereType<String>()
                    .where((String value) => value.trim().isNotEmpty)
                    .join(' · ');
                return TpCard(
                  padding: EdgeInsets.zero,
                  child: ListTile(
                    minTileHeight: 72,
                    leading: SizedBox.square(
                      dimension: 56,
                      child: photo == null
                          ? const Icon(Icons.local_shipping_outlined, size: 32)
                          : Image.asset(photo, fit: BoxFit.contain),
                    ),
                    title: TpIdentifierText(
                      asset.assetNo!,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    subtitle: subtitle.isEmpty ? null : Text(subtitle),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () => Navigator.of(context).pop(asset),
                  ),
                );
              },
            ),
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
