/// One submitted checklist, read-only: who filled it, where and when, the
/// score, the sign-off ladder, the reviewer's note, and every recorded
/// answer with its remark, photos and signature.
///
/// Opened from "My checklist history" (tap a completed row). It is pushed
/// directly with [Navigator] rather than through a route, the same way the
/// history screen itself is opened pre-filtered for one asset, because the
/// router's wiring files are not edited from feature code.
///
/// # What it reads
///
/// One `checklist_submissions` row by id
/// ([ChecklistRemoteRepository.getSubmission]), and the template the sheet
/// was filled against: the row's own `template_snapshot` when it has one,
/// else the live template ([ChecklistRemoteRepository.getTemplate]). The
/// live-template read is best-effort - when it fails the answers still
/// render, labelled by field id, never a blank screen.
///
/// # How answers render
///
/// Every field goes through the SAME [ChecklistFieldAnswerTile] the fill
/// screen uses, with every mutation callback left `null` (its documented
/// read-only mode). Fields are filtered with [visibleChecklistFields]
/// against the recorded answers, so a field that was hidden while filling
/// is hidden here too, and option labels resolve through [fieldOptions]
/// with the template, in the operator's chosen checklist content language.
///
/// # Photos
///
/// The tile renders photo answers from a local file path. A photo captured
/// on THIS device shows; one captured elsewhere shows the tile's own
/// "broken image" placeholder - the same, already-shipped behaviour as the
/// approval review screen. Resolving remote storage refs is a separate
/// change.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_submission_detail.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_history_view.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';
import 'package:tyre_pulse/features/checklists/presentation/widgets/checklist_field_answer_tile.dart';

/// Stable keys for tests.
abstract final class ChecklistSubmissionDetailKeys {
  static const Key notFound = Key('checklist-detail-not-found');
  static const Key responses = Key('checklist-detail-responses');
  static const Key signOffs = Key('checklist-detail-sign-offs');
  static const Key reviewNote = Key('checklist-detail-review-note');
}

class ChecklistSubmissionDetailScreen extends ConsumerStatefulWidget {
  const ChecklistSubmissionDetailScreen({
    required this.submissionId,
    this.fallbackTitle,
    super.key,
  });

  final String submissionId;

  /// Shown in the app bar while loading (the history row's document number
  /// or template name), so the screen never opens on an empty title.
  final String? fallbackTitle;

  @override
  ConsumerState<ChecklistSubmissionDetailScreen> createState() =>
      _ChecklistSubmissionDetailScreenState();
}

class _ChecklistSubmissionDetailScreenState
    extends ConsumerState<ChecklistSubmissionDetailScreen> {
  bool _loading = true;
  AppError? _error;
  ChecklistSubmissionDetail? _detail;
  ChecklistTemplateRecord? _template;

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
    final repository = ref.read(checklistRemoteRepositoryProvider);
    try {
      final ChecklistSubmissionDetail? detail =
          await repository.getSubmission(widget.submissionId);
      ChecklistTemplateRecord? template = detail?.snapshotTemplate;
      final String? templateId = detail?.templateId;
      if (detail != null &&
          template == null &&
          templateId != null &&
          templateId.isNotEmpty) {
        try {
          template = await repository.getTemplate(templateId);
        } on Object {
          // Best-effort: the answers still render, labelled by field id.
          template = null;
        }
      }
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _template = template;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _asAppError(
          error,
          AppLocalizations.of(context).checklistApprovalLoadErrorMessage,
        );
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ChecklistSubmissionDetail? detail = _detail;
    final String title = detail?.documentNo ??
        detail?.templateName ??
        widget.fallbackTitle ??
        l10n.checklistDetailTitle;

    return TpScaffold(
      appBar: TpAppBar(
        title: title,
        subtitle: detail == null ? null : l10n.checklistDetailTitle,
        onBack: () => unawaited(Navigator.of(context).maybePop()),
      ),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    final AppError? error = _error;
    if (error != null) {
      return TpErrorState(error: error, onRetry: () => unawaited(_load()));
    }
    final ChecklistSubmissionDetail? detail = _detail;
    if (detail == null) {
      return TpEmptyState(
        key: ChecklistSubmissionDetailKeys.notFound,
        icon: Icons.search_off_outlined,
        title: l10n.checklistApprovalNotFoundTitle,
        message: l10n.checklistApprovalNotFoundMessage,
      );
    }

    final String lang = ref.watch(checklistContentLanguageProvider);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          _SummaryCard(detail: detail),
          const SizedBox(height: TpSpace.lg),
          _SectionHeader(label: l10n.checklistApprovalSignOffsTitle),
          _SignOffsCard(detail: detail, template: _template),
          if (detail.reviewNote != null) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            _ReviewNoteCard(note: detail.reviewNote!),
          ],
          const SizedBox(height: TpSpace.lg),
          _SectionHeader(label: l10n.checklistApprovalResponsesTitle),
          _ResponsesCard(
            detail: detail,
            template: _template?.template,
            lang: lang,
          ),
        ],
      ),
    );
  }
}

AppError _asAppError(Object error, String fallbackMessage) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: fallbackMessage,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

/// `2026-10-05T08:12:00Z` -> `5 Oct 2026, 11:12` in the device's time zone
/// and locale. `null` for a blank or unparseable value, never a raw string.
String? formatChecklistTimestamp(String? iso, String locale) {
  if (iso == null || iso.trim().isEmpty) return null;
  final DateTime? parsed = DateTime.tryParse(iso);
  if (parsed == null) return null;
  return DateFormat('d MMM y, HH:mm', locale).format(parsed.toLocal());
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelLarge
            ?.copyWith(color: TpPalette.of(context).textMuted),
      ),
    );
  }
}

(TpStatus, String) _approvalChip(AppLocalizations l10n, String? status) {
  return switch (checklistHistoryStateOf(status)) {
    ChecklistHistoryState.closed => (
        TpStatus.ok,
        l10n.checklistHistoryStatusClosed,
      ),
    ChecklistHistoryState.sentBack => (
        TpStatus.critical,
        l10n.checklistHistoryStatusSentBack,
      ),
    ChecklistHistoryState.waiting => (
        TpStatus.warning,
        l10n.checklistHistoryStatusWaiting,
      ),
    ChecklistHistoryState.noApproval => (
        TpStatus.neutral,
        l10n.checklistHistoryStatusNoApproval,
      ),
  };
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.detail});

  final ChecklistSubmissionDetail detail;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    final String locale = Localizations.localeOf(context).toLanguageTag();
    final (TpStatus tone, String label) =
        _approvalChip(l10n, detail.approvalStatus);
    final String? submitted =
        formatChecklistTimestamp(detail.submittedAt, locale);
    final String where = <String?>[detail.assetNo, detail.site]
        .where((String? v) => v != null && v.isNotEmpty)
        .join(' - ');
    final String? heading = detail.templateName ?? detail.title;

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  heading ?? (detail.documentNo ?? ''),
                  style: text.titleMedium,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              TpStatusChip(status: tone, label: label, isCompact: true),
            ],
          ),
          if (detail.documentNo != null && heading != null) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              detail.documentNo!,
              style: text.labelMedium?.copyWith(color: palette.textMuted),
            ),
          ],
          if (where.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Row(
              children: <Widget>[
                Icon(
                  Icons.local_shipping_outlined,
                  size: 18,
                  color: palette.textSecondary,
                ),
                const SizedBox(width: TpSpace.xs),
                Expanded(child: Text(where, style: text.bodyMedium)),
              ],
            ),
          ],
          if (submitted != null) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Row(
              children: <Widget>[
                Icon(
                  Icons.schedule_outlined,
                  size: 18,
                  color: palette.textSecondary,
                ),
                const SizedBox(width: TpSpace.xs),
                Expanded(
                  child: Text(
                    l10n.checklistDetailSubmittedOn(submitted),
                    style: text.bodyMedium,
                  ),
                ),
              ],
            ),
          ],
          if (detail.scorePct != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            TpStatusChip(
              status: detail.scorePassed == false
                  ? TpStatus.critical
                  : (detail.scorePassed == true
                      ? TpStatus.ok
                      : TpStatus.neutral),
              label: l10n.checklistApprovalScoreLine(
                detail.scorePct!,
                detail.scorePassed == false
                    ? l10n.checklistApprovalScoreFailed
                    : l10n.checklistApprovalScorePassed,
              ),
              isCompact: true,
            ),
          ],
        ],
      ),
    );
  }
}

/// One rung of the sign-off ladder.
final class _Rung {
  const _Rung({
    required this.label,
    this.name,
    this.at,
    this.signature,
  });

  final String label;
  final String? name;
  final String? at;
  final String? signature;

  bool get signed => name != null || at != null;
}

class _SignOffsCard extends StatelessWidget {
  const _SignOffsCard({required this.detail, required this.template});

  final ChecklistSubmissionDetail detail;
  final ChecklistTemplateRecord? template;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool twoStage = template?.requireAreaManager == true ||
        detail.supervisorName != null ||
        detail.supervisorAt != null ||
        detail.approvalStatus == 'pending_area_manager';
    final bool needsApproval =
        (detail.approvalStatus ?? 'not_required') != 'not_required' ||
            template?.requireApproval == true;

    final List<_Rung> rungs = <_Rung>[
      _Rung(
        label: l10n.checklistApprovalStageFilledBy,
        name: detail.printedName,
        at: detail.submittedAt,
        signature: detail.signatureData,
      ),
      if (needsApproval && twoStage)
        _Rung(
          label: l10n.checklistApprovalStageSupervisor,
          name: detail.supervisorName,
          at: detail.supervisorAt,
          signature: detail.supervisorSignature,
        ),
      if (needsApproval)
        _Rung(
          label: twoStage
              ? l10n.checklistApprovalStageAreaManager
              : l10n.checklistApprovalStageApproval,
          name: detail.approverName,
          at: detail.approvedAt,
          signature: detail.approverSignature,
        ),
    ];

    return TpCard(
      key: ChecklistSubmissionDetailKeys.signOffs,
      child: Column(
        children: <Widget>[
          for (int i = 0; i < rungs.length; i++) ...<Widget>[
            if (i > 0) const Divider(height: TpSpace.lg),
            _RungRow(rung: rungs[i]),
          ],
        ],
      ),
    );
  }
}

class _RungRow extends StatelessWidget {
  const _RungRow({required this.rung});

  final _Rung rung;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    final String locale = Localizations.localeOf(context).toLanguageTag();
    final String? at = formatChecklistTimestamp(rung.at, locale);
    final String detailLine = rung.signed
        ? <String?>[rung.name, at]
            .where((String? v) => v != null && v.isNotEmpty)
            .join(' - ')
        : l10n.checklistApprovalNotSignedYet;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              rung.signed
                  ? Icons.check_circle_outline
                  : Icons.radio_button_unchecked,
              size: 20,
              color: rung.signed ? palette.ok.base : palette.textMuted,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(rung.label, style: text.titleSmall),
                  Text(
                    detailLine,
                    style: text.bodySmall?.copyWith(
                      color: rung.signed ? null : palette.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (rung.signature != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          ChecklistReadOnlySignature(value: rung.signature),
        ],
      ],
    );
  }
}

class _ReviewNoteCard extends StatelessWidget {
  const _ReviewNoteCard({required this.note});

  final String note;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TpStatusColors colors =
        TpPalette.of(context).forStatus(TpStatus.info);
    return Container(
      key: ChecklistSubmissionDetailKeys.reviewNote,
      width: double.infinity,
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            l10n.checklistDetailReviewNote,
            style: text.labelLarge?.copyWith(color: colors.onSoft),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(note, style: text.bodyMedium?.copyWith(color: colors.onSoft)),
        ],
      ),
    );
  }
}

class _ResponsesCard extends StatelessWidget {
  const _ResponsesCard({
    required this.detail,
    required this.template,
    required this.lang,
  });

  final ChecklistSubmissionDetail detail;
  final ChecklistTemplate? template;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<ChecklistField> declared =
        template?.fields ?? const <ChecklistField>[];

    final List<ChecklistField> fields = declared.isEmpty
        // No readable template: fall back to whatever answer keys exist,
        // each labelled by its own id, so the sheet never renders blank.
        ? <ChecklistField>[
            for (final String key in detail.answers.keys.toList()..sort())
              ChecklistField(id: key, type: 'text', label: key),
          ]
        : visibleChecklistFields(declared, detail.answers);

    if (fields.isEmpty) {
      return TpCard(
        key: ChecklistSubmissionDetailKeys.responses,
        child: Text(
          l10n.checklistApprovalNoResponses,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      );
    }

    return TpCard(
      key: ChecklistSubmissionDetailKeys.responses,
      child: Column(
        children: <Widget>[
          for (final ChecklistField field in fields) _tile(field),
        ],
      ),
    );
  }

  Widget _tile(ChecklistField field) {
    final String? note = detail.notes[field.id]?.toString();
    final bool hasNote = note != null && note.trim().isNotEmpty;
    final List<ChecklistFieldOption> options =
        field.type == 'select' || field.type == 'multiselect'
            ? fieldOptions(field, template, lang)
            : const <ChecklistFieldOption>[];
    final String label = fieldLabel(field, lang);
    return ChecklistFieldAnswerTile(
      key: ValueKey<String>('detail-${field.id}'),
      field: field,
      label: label.isEmpty ? field.id : label,
      value: detail.answers[field.id],
      options: options,
      readOnly: true,
      locked: true,
      note: hasNote ? note : null,
      showNoteField: field.allowNote != false && hasNote,
      photos: detail.photos[field.id] ?? const <String>[],
      signatureBuilder: field.type == 'signature'
          ? (BuildContext context) => ChecklistReadOnlySignature(
                value: detail.signatureForField(field.id),
              )
          : null,
    );
  }
}

/// A recorded signature (SVG markup or a base64 image data URL), shown
/// read-only. Blank -> "Not signed yet"; unreadable -> "Signature saved",
/// never a broken image.
class ChecklistReadOnlySignature extends StatelessWidget {
  const ChecklistReadOnlySignature({required this.value, super.key});

  final String? value;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String? raw = value;
    if (raw == null || raw.trim().isEmpty) {
      return Text(
        l10n.checklistApprovalNotSignedYet,
        style: Theme.of(context).textTheme.bodySmall,
      );
    }
    final Widget fallback = Center(
      child: Text(
        l10n.checklistApprovalSignatureSavedLabel,
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: Colors.black87),
      ),
    );
    final String trimmed = raw.trimLeft();
    Widget image;
    if (trimmed.startsWith('<svg')) {
      image = SvgPicture.string(
        trimmed,
        fit: BoxFit.contain,
        errorBuilder: (BuildContext context, Object error, StackTrace? stack) =>
            fallback,
      );
    } else {
      final Uint8List? bytes = _decodeDataUrl(raw);
      image = bytes == null
          ? fallback
          : Image.memory(
              bytes,
              fit: BoxFit.contain,
              errorBuilder:
                  (BuildContext context, Object error, StackTrace? stack) =>
                      fallback,
            );
    }
    // A white pad in both themes: a signature is dark ink drawn on white.
    return Container(
      height: 96,
      width: double.infinity,
      padding: const EdgeInsets.all(TpSpace.xs),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: image,
    );
  }

  static Uint8List? _decodeDataUrl(String value) {
    final int comma = value.indexOf(',');
    if (comma < 0 ||
        !value.substring(0, comma).toLowerCase().contains(';base64')) {
      return null;
    }
    try {
      return base64Decode(value.substring(comma + 1));
    } on FormatException {
      return null;
    }
  }
}
