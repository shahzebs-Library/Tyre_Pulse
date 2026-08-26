/// Checklist approval review - the decision screen.
///
/// Opens one submission for sign-off: the sign-off ladder (who has signed
/// what, and when), every recorded response, and either an APPROVE
/// (capturing the reviewer's own signature) or a SEND BACK action for the
/// rung that is genuinely outstanding, to the person who may act on it.
///
/// Ported from `mobile/app/(app)/checklists/approvals/[submissionId].tsx`
/// (`mobile/` is READ-ONLY reference material - see `AGENTS.md`), and
/// structurally mirrors this feature's own sibling
/// `inspection_approval_review_screen.dart` (loading/error/not-found
/// states, the two-button decision form, the "stay here or back to list"
/// outcome dialog).
///
/// # Where the stage/status decision is made
///
/// The outstanding stage is `stageFor(templateLike, item.asSubmissionLike)`
/// (see [_stage]) and the status a decision resolves to is
/// `nextStatusFor(templateLike, item.asSubmissionLike, approved)`, called
/// directly inside [_decide] - BOTH straight from `checklist_approval.dart`,
/// never re-derived. This screen's ONLY job with respect to the ladder is
/// to ask those two functions what is true right now and act accordingly;
/// the actual delivery (and the re-validation against server state at
/// delivery time) belongs entirely to
/// `checklist_approval_sync_engine.dart`'s [ChecklistApprovalSyncEngine].
///
/// # Why there is no client-side "blocked from closing" check
///
/// The sibling mobile screen additionally computes `canClose(template,
/// submission.answers)` from `checklistMarks.ts` and disables Approve when
/// a blocking mark is still present. This port deliberately does NOT
/// reproduce that check: `checklist_approval.dart`'s own library comment
/// states plainly that the blocking-marks engine "belongs to the checklist
/// FIELD/marks engine (a parallel, separate domain) ... this library
/// never receives and never will" read it, and this feature's own
/// boundary is `lib/features/checklists/` for exactly one file
/// ([ChecklistFieldAnswerTile]) - `checklist_marks.dart` is not among the
/// files this feature may import. The server's own
/// `guard_checklist_approval_stages` trigger still refuses a close while a
/// blocking mark is present (raising a `P0001`/`22023`, mapped by
/// `supabase_error_mapper.dart` to `SupabaseFailureCause.serverRaise` and
/// passed through to the reviewer as [ChecklistApprovalDecisionOutcome.
/// blocked]'s error message) - so this is a real, disclosed narrowing of
/// what the CLIENT checks before attempting a decision, not a narrowing of
/// what the SERVER enforces. See this port's final report for the full
/// reasoning.
///
/// # Reusing [ChecklistFieldAnswerTile] for read-only answers
///
/// [_ResponsesSection] renders every field the template declares (in
/// declared order, `type: 'section'` entries included - the tile already
/// renders those as a header) through [ChecklistFieldAnswerTile] with
/// every mutation callback left `null`, exactly the mode that widget's own
/// library comment documents for "a reviewer looking at an already
/// submitted sheet". This is a disclosed IMPROVEMENT over the mobile
/// reference screen's own flat text-based answer list (which shows values
/// only for `isValueField` types and never a field's photos/signature at
/// all): every field type - including `photo` and `signature` - renders
/// through the SAME widget the fill screen uses, so a reviewer sees the
/// evidence a fitter attached, not only the text answer beside it.
///
/// Two things are deliberately NOT reproduced from the checklist FIELD
/// engine, to keep this feature's dependency on `lib/features/checklists/`
/// to the one widget it is scoped to reuse: `visibleWhen` filtering (every
/// non-section field renders, regardless of whether it would have been
/// hidden at fill time - a hidden field's own recorded value is typically
/// absent anyway, so this shows at most a harmless blank row) and shared
/// `option_sets` resolution (`fieldOptions` is called with `template:
/// null`, so a `select`/`multiselect` field always uses its OWN `options`/
/// `optionsI18n`, never a shared legend a later template edit may have
/// replaced).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/tp_back.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/checklist_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_sync_engine.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_template_info.dart';
import 'package:tyre_pulse/features/approvals/domain/approval_decision_requirements.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/checklist_approval_signature_pad.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/checklist_approval_status_chip.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/checklists/presentation/widgets/checklist_field_answer_tile.dart';

/// Which decision is currently in flight, so the two action buttons can
/// each show their own busy indicator without either being pressed twice.
enum _DecisionBusy { approving, rejecting }

class ChecklistApprovalReviewScreen extends ConsumerStatefulWidget {
  const ChecklistApprovalReviewScreen({required this.route, super.key});

  final ChecklistApprovalReviewRoute route;

  @override
  ConsumerState<ChecklistApprovalReviewScreen> createState() =>
      _ChecklistApprovalReviewScreenState();
}

class _ChecklistApprovalReviewScreenState
    extends ConsumerState<ChecklistApprovalReviewScreen> {
  bool _loading = true;
  AppError? _loadError;
  ChecklistApprovalItem? _item;
  ChecklistApprovalTemplateInfo? _templateInfo;

  ChecklistApprovalSignatureCapture? _approverSignature;
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _noteController = TextEditingController();
  String? _approverName;
  _DecisionBusy? _busy;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    unawaited(_loadApproverName());
  }

  @override
  void dispose() {
    _nameController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  String get _submissionId => widget.route.submissionId.value;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final ChecklistApprovalItem? item =
          await ref.read(checklistApprovalRepositoryProvider).byId(_submissionId);
      ChecklistApprovalTemplateInfo? templateInfo;
      final String? templateId = item?.templateId;
      if (templateId != null && templateId.isNotEmpty) {
        // Best-effort - see the library comment: labels degrade to field
        // ids and the ladder is treated as single-stage when this fails.
        templateInfo =
            await ref.read(checklistApprovalRepositoryProvider).templateInfo(
                  templateId,
                );
      }
      if (!mounted) return;
      setState(() {
        _item = item;
        _templateInfo = templateInfo;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _loadError = _asAppError(
          context,
          error,
          AppLocalizations.of(context).checklistApprovalLoadErrorMessage,
        );
        _loading = false;
      });
    }
  }

  /// Best-effort, and independent of [_load]'s own retry - a display name
  /// that failed to resolve must never block viewing or deciding this
  /// submission.
  Future<void> _loadApproverName() async {
    final String userId = ref.read(workspaceContextProvider)?.userId ?? '';
    if (userId.isEmpty) return;
    final String? name = await ref
        .read(checklistApprovalRepositoryProvider)
        .currentUserDisplayName(userId);
    if (!mounted) return;
    setState(() {
      _approverName = name;
      if (_nameController.text.trim().isEmpty && name != null) {
        _nameController.text = name;
      }
    });
  }

  ApprovalTemplateLike get _templateLike =>
      _templateInfo?.asTemplateLike ?? const ApprovalTemplateLike();

  ApprovalStage? get _stage =>
      stageFor(_templateLike, _item?.asSubmissionLike);

  Future<void> _decide(bool approved) async {
    final ChecklistApprovalItem? item = _item;
    final ApprovalStage? stage = _stage;
    if (item == null || _busy != null) return;

    final AppLocalizations l10n = AppLocalizations.of(context);
    final ApprovalDecisionInput input = ApprovalDecisionInput(
      approved: approved,
      name: _nameController.text,
      signature: _approverSignature?.dataUrl,
      note: _noteController.text,
    );
    final String? missing = _localizedRequirementError(l10n, stage, input);
    if (missing != null) {
      await _showInfoDialog(
        context,
        title: approved
            ? l10n.checklistApprovalRequirementTitle
            : l10n.checklistApprovalReasonRequiredTitle,
        message: missing,
      );
      return;
    }

    final String targetStatus = nextStatusFor(
      _templateLike,
      item.asSubmissionLike,
      approved,
    );
    final String priorStatus = item.approvalStatus ?? '';
    final String trimmedName = _nameController.text.trim();
    final String trimmedNote = _noteController.text.trim();
    final String? approverId = ref.read(workspaceContextProvider)?.userId;

    setState(() {
      _busy = approved ? _DecisionBusy.approving : _DecisionBusy.rejecting;
    });
    try {
      final ChecklistApprovalDecisionResult result = await ref
          .read(checklistApprovalSyncEngineProvider)
          .decideNow(
            submissionId: item.id,
            stage: stage!,
            priorApprovalStatus: priorStatus,
            targetStatus: targetStatus,
            approved: approved,
            approverName: trimmedName.isEmpty ? null : trimmedName,
            approverSignature: _approverSignature?.dataUrl,
            approverId: approverId,
            reviewNote: trimmedNote.isEmpty ? null : trimmedNote,
          );
      if (!mounted) return;

      switch (result.outcome) {
        case ChecklistApprovalDecisionOutcome.deliveredNow:
          // Reload in place, exactly like the sibling inspection review
          // screen: the queue only lists what is still outstanding, so
          // the row just decided is already gone from it, and arriving
          // here from a notification leaves nothing to go back to.
          // Reloading shows the decided state - proof the decision was
          // saved - and the reviewer chooses when to leave.
          await _load();
          if (!mounted) return;
          final bool goToList = await TpDialog.confirm(
            context: context,
            title: _outcomeTitle(l10n, approved, targetStatus),
            message: _outcomeMessage(l10n, approved, targetStatus),
            cancelLabel: l10n.checklistApprovalStayHereAction,
            confirmLabel: l10n.checklistApprovalBackToListAction,
          );
          if (mounted && goToList) {
            TpBack.pop(
              context,
              fallback: TpBackFallbacks.forRoute(widget.route),
            );
          }
          break;
        case ChecklistApprovalDecisionOutcome.queued:
          // The write could not reach the server right now but is safely
          // durable on this device and will sync automatically - matches
          // AGENTS.md rule 9. Nothing on the server changed, so there is
          // nothing new to show here. The dialog is shown and dismissed
          // BEFORE popping - a `ScaffoldMessenger` reached from a context
          // that has already been navigated away from is not safe to use.
          await _showInfoDialog(
            context,
            title: l10n.checklistApprovalQueuedTitle,
            message: l10n.checklistApprovalQueuedOffline,
          );
          if (!mounted) return;
          TpBack.pop(context, fallback: TpBackFallbacks.forRoute(widget.route));
          break;
        case ChecklistApprovalDecisionOutcome.blocked:
          await _showInfoDialog(
            context,
            title: l10n.checklistApprovalSaveFailedTitle,
            message: result.error?.message ??
                l10n.checklistApprovalDecideGenericError,
          );
          break;
      }
    } on Object catch (error) {
      if (!mounted) return;
      final AppError appError = _asAppError(
        context,
        error,
        l10n.checklistApprovalDecideGenericError,
      );
      await _showInfoDialog(
        context,
        title: l10n.checklistApprovalSaveFailedTitle,
        message: appError.message,
      );
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  String _outcomeTitle(AppLocalizations l10n, bool approved, String targetStatus) {
    if (!approved) return l10n.checklistApprovalSentBackTitle;
    return targetStatus == 'pending_area_manager'
        ? l10n.checklistApprovalSignedOffTitle
        : l10n.checklistApprovalApprovedTitle;
  }

  String _outcomeMessage(
    AppLocalizations l10n,
    bool approved,
    String targetStatus,
  ) {
    if (!approved) return l10n.checklistApprovalSentBackMessage;
    return targetStatus == 'pending_area_manager'
        ? l10n.checklistApprovalSignedOffMessage
        : l10n.checklistApprovalApprovedMessage;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final ChecklistApprovalItem? item = _item;
    final String title = item == null
        ? l10n.checklistApprovalReviewTitle
        : _titleFor(item, l10n.checklistApprovalFallbackTitle);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(title: title, backFallback: fallback),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_loadError != null) {
      return TpErrorState(error: _loadError!, onRetry: _load);
    }
    final ChecklistApprovalItem? item = _item;
    if (item == null) {
      return TpEmptyState(
        icon: Icons.help_outline,
        title: l10n.checklistApprovalNotFoundTitle,
        message: l10n.checklistApprovalNotFoundMessage,
      );
    }

    final workspace = ref.watch(workspaceContextProvider);
    final ApprovalStage? stage = _stage;
    final bool myTurn = canDecide(
      _templateLike,
      item.asSubmissionLike,
      workspace?.role.rawValue,
      isSuperAdmin: workspace?.isSuperAdmin ?? false,
    );

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        Align(
          alignment: Alignment.centerLeft,
          child: ChecklistApprovalStatusChip(
            summary: statusSummary(_templateLike, item.asSubmissionLike),
          ),
        ),
        const SizedBox(height: TpSpace.md),
        _SummaryCard(item: item),
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.checklistApprovalSignOffsTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        _SignOffLadder(item: item, templateInfo: _templateInfo, l10n: l10n),
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.checklistApprovalResponsesTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        _ResponsesSection(item: item, templateInfo: _templateInfo),
        const SizedBox(height: TpSpace.lg),
        if (stage == null)
          _DecidedInfoCard(
            l10n: l10n,
            text: checklistApprovalStatusLabel(
              l10n,
              statusSummary(_templateLike, item.asSubmissionLike),
            ),
          )
        else if (!myTurn)
          _DecidedInfoCard(
            l10n: l10n,
            text: l10n.checklistApprovalNotYourRung(
              checklistApprovalStatusLabel(
                l10n,
                statusSummary(_templateLike, item.asSubmissionLike),
              ),
            ),
          )
        else
          _DecisionForm(
            l10n: l10n,
            closing: nextStatusFor(_templateLike, item.asSubmissionLike, true) ==
                'approved',
            approverSignature: _approverSignature,
            onSignatureChanged: (capture) =>
                setState(() => _approverSignature = capture),
            nameController: _nameController,
            noteController: _noteController,
            busy: _busy,
            onApprove: () => _decide(true),
            onReturn: () => _decide(false),
          ),
      ],
    );
  }

  static String _titleFor(ChecklistApprovalItem item, String fallback) {
    final String title = item.title?.trim() ?? '';
    if (title.isNotEmpty) return title;
    final String templateName = item.templateName?.trim() ?? '';
    return templateName.isNotEmpty ? templateName : fallback;
  }
}

/// Mirrors `decisionRequirementError`'s own branch order exactly, so the
/// message chosen here can never disagree with what the domain gate
/// actually refused - see the library comment on why the domain's own
/// [decisionRequirementError] cannot be shown directly (it returns a
/// pinned English sentence).
String? _localizedRequirementError(
  AppLocalizations l10n,
  ApprovalStage? stage,
  ApprovalDecisionInput input,
) {
  if (decisionRequirementError(stage, input) == null) return null;
  if (stage == null) return l10n.checklistApprovalNothingToDecide;
  if (!input.approved) return l10n.checklistApprovalReasonRequiredMessage;
  if ((input.name ?? '').trim().isEmpty) {
    return l10n.checklistApprovalNameRequiredMessage;
  }
  return l10n.checklistApprovalSignatureRequiredMessage;
}

/// A single-button acknowledgement dialog - mirrors
/// `inspection_approval_review_screen.dart`'s own private
/// `_showInfoDialog` exactly (same styling constants; there is no shared
/// design-system primitive for a pure info message).
Future<void> _showInfoDialog(
  BuildContext context, {
  required String title,
  required String message,
}) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final TpPalette palette = TpPalette.of(context);
  return showDialog<void>(
    context: context,
    barrierColor: palette.overlay,
    builder: (BuildContext dialogContext) {
      return AlertDialog(
        backgroundColor: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.lg),
        ),
        title: Text(title, style: Theme.of(dialogContext).textTheme.titleLarge),
        content: Text(message, style: Theme.of(dialogContext).textTheme.bodyMedium),
        actionsPadding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          0,
          TpSpace.lg,
          TpSpace.lg,
        ),
        actions: <Widget>[
          TpButton.primary(
            label: l10n.actionClose,
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
        ],
      );
    },
  );
}

/// Mirrors `inspection_approval_review_screen.dart`'s own private
/// `_asAppError`: any [AppError]/[SupabaseFailure] already carries a
/// message safe to show; anything else falls back to [fallbackMessage].
AppError _asAppError(
  BuildContext context,
  Object error,
  String fallbackMessage,
) {
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

String? _formatDateTime(String? iso) {
  if (iso == null || iso.isEmpty) return null;
  final DateTime? parsed = DateTime.tryParse(iso);
  if (parsed == null) return null;
  final DateTime local = parsed.toLocal();
  final String y = local.year.toString().padLeft(4, '0');
  final String m = local.month.toString().padLeft(2, '0');
  final String d = local.day.toString().padLeft(2, '0');
  final String hh = local.hour.toString().padLeft(2, '0');
  final String mm = local.minute.toString().padLeft(2, '0');
  return '$y-$m-$d $hh:$mm';
}

Uint8List _decodeSignatureDataUrl(String dataUrl) {
  final int comma = dataUrl.indexOf(',');
  final String b64 = comma < 0 ? dataUrl : dataUrl.substring(comma + 1);
  return base64Decode(b64);
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.item});

  final ChecklistApprovalItem item;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _SummaryRow(
            icon: Icons.description_outlined,
            text: item.templateName?.trim().isNotEmpty ?? false
                ? item.templateName!.trim()
                : l10n.valueUnavailable,
          ),
          if (item.documentNo != null)
            _SummaryRow(icon: Icons.sell_outlined, text: item.documentNo!),
          if (item.site != null || item.assetNo != null)
            _SummaryRow(
              icon: Icons.place_outlined,
              text: <String?>[item.site, item.assetNo]
                  .where((v) => v != null && v.isNotEmpty)
                  .join(' | '),
            ),
          _SummaryRow(
            icon: Icons.event_outlined,
            text: _formatDateTime(item.submittedAt) ?? l10n.valueUnavailable,
          ),
          if (item.scorePct != null)
            _SummaryRow(
              icon: Icons.emoji_events_outlined,
              text: l10n.checklistApprovalScoreLine(
                item.scorePct!,
                item.scorePassed == false
                    ? l10n.checklistApprovalScoreFailed
                    : l10n.checklistApprovalScorePassed,
              ),
            ),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: <Widget>[
          Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(text, style: Theme.of(context).textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}

/// Rung 0 (who filled it in) plus every rung `approvalProgress` returns.
class _SignOffLadder extends StatelessWidget {
  const _SignOffLadder({
    required this.item,
    required this.templateInfo,
    required this.l10n,
  });

  final ChecklistApprovalItem item;
  final ChecklistApprovalTemplateInfo? templateInfo;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ApprovalTemplateLike templateLike =
        templateInfo?.asTemplateLike ?? const ApprovalTemplateLike();
    final List<ApprovalRung> progress =
        approvalProgress(templateLike, item.asSubmissionLike);
    final bool twoStage = isTwoStage(templateLike);

    return TpCard(
      child: Column(
        children: <Widget>[
          _RungRow(
            index: 1,
            label: l10n.checklistApprovalStageFilledBy,
            name: item.printedName,
            at: item.submittedAt,
            done: true,
            current: false,
            signature: item.signatureData,
          ),
          for (int i = 0; i < progress.length; i++)
            _RungRow(
              index: i + 2,
              label: progress[i].key == ApprovalStage.areaManager
                  ? l10n.checklistApprovalStageAreaManager
                  : twoStage
                      ? l10n.checklistApprovalStageSupervisor
                      : l10n.checklistApprovalStageApproval,
              name: progress[i].name,
              at: progress[i].at,
              done: progress[i].done,
              current: progress[i].current,
              signature: progress[i].signature,
            ),
        ],
      ),
    );
  }
}

class _RungRow extends StatelessWidget {
  const _RungRow({
    required this.index,
    required this.label,
    required this.name,
    required this.at,
    required this.done,
    required this.current,
    required this.signature,
  });

  final int index;
  final String label;
  final String? name;
  final String? at;
  final bool done;
  final bool current;
  final String? signature;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors tint = palette.forStatus(
      done ? TpStatus.ok : (current ? TpStatus.warning : TpStatus.neutral),
    );
    final bool hasSignature = signature != null && signature!.trim().isNotEmpty;
    final String? whenText = at == null ? null : _formatDateTime(at);
    // A person's name may be Latin-script even in an Arabic/Urdu reading
    // - isolate it so it does not flip the surrounding metadata line's
    // reading direction, matching `TpDirection.isolateLtr`'s established
    // use for exactly this over an identifier concatenated into
    // translated text elsewhere in this codebase.
    final String? isolatedName = (name != null && name!.trim().isNotEmpty)
        ? TpDirection.isolateLtr(name!.trim())
        : null;
    final String metaText = (done || isolatedName != null)
        ? <String?>[isolatedName, whenText]
            .where((v) => v != null && v.isNotEmpty)
            .join(' | ')
        : l10n.checklistApprovalNotSignedYet;

    final Widget row = Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: done ? tint.soft : Colors.transparent,
              border: Border.all(color: tint.base, width: 1.5),
            ),
            child: SizedBox(
              width: 26,
              height: 26,
              child: Center(
                child: done
                    ? Icon(Icons.check, size: 14, color: tint.base)
                    : Text(
                        '$index',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: tint.base,
                        ),
                      ),
              ),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(label, style: Theme.of(context).textTheme.labelLarge),
                Text(
                  metaText,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
              ],
            ),
          ),
          if (hasSignature) Icon(Icons.remove_red_eye_outlined, size: 18, color: palette.textMuted),
        ],
      ),
    );

    if (!hasSignature) return row;
    return InkWell(
      onTap: () => _openSignature(context, label, name, signature!),
      child: row,
    );
  }

  static Future<void> _openSignature(
    BuildContext context,
    String title,
    String? name,
    String dataUrl,
  ) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return showDialog<void>(
      context: context,
      barrierColor: palette.overlay,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          backgroundColor: palette.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(TpRadius.lg),
          ),
          title: Text(title, style: Theme.of(dialogContext).textTheme.titleLarge),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              SizedBox(
                height: 190,
                child: Image.memory(
                  _decodeSignatureDataUrl(dataUrl),
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stack) =>
                      Text(l10n.checklistApprovalSignatureSavedLabel),
                ),
              ),
              if (name != null && name.trim().isNotEmpty) ...<Widget>[
                const SizedBox(height: TpSpace.sm),
                Text(name.trim(), style: Theme.of(dialogContext).textTheme.bodyMedium),
              ],
            ],
          ),
          actions: <Widget>[
            TpButton.primary(
              label: l10n.actionClose,
              onPressed: () => Navigator.of(dialogContext).pop(),
            ),
          ],
        );
      },
    );
  }
}

/// Renders every field the template declares through the SAME read-only
/// [ChecklistFieldAnswerTile] the fill screen uses - see the library
/// comment for the exact reasoning and disclosed trade-offs.
class _ResponsesSection extends StatelessWidget {
  const _ResponsesSection({required this.item, required this.templateInfo});

  final ChecklistApprovalItem item;
  final ChecklistApprovalTemplateInfo? templateInfo;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<ChecklistField> fields = templateInfo?.fields ?? const <ChecklistField>[];

    if (fields.isEmpty) {
      // No template could be read (or it genuinely has no fields) - fall
      // back to whatever `answers` keys exist, each as a plain, read-only
      // text field labelled by its own id. Still renders through the SAME
      // tile, so a submission with no readable template degrades to
      // "labels read as field ids", never to a blank screen.
      final List<String> keys = item.answers.keys.toList(growable: false)
        ..sort();
      if (keys.isEmpty) {
        return TpCard(
          child: Text(
            l10n.checklistApprovalNoResponses,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        );
      }
      return TpCard(
        child: Column(
          children: <Widget>[
            for (final String key in keys)
              ChecklistFieldAnswerTile(
                key: ValueKey<String>(key),
                field: ChecklistField(id: key, type: 'text', label: key),
                label: key,
                value: item.answers[key],
                readOnly: true,
                note: item.notes[key]?.toString(),
                showNoteField: (item.notes[key]?.toString().trim().isNotEmpty ?? false),
              ),
          ],
        ),
      );
    }

    return TpCard(
      child: Column(
        children: <Widget>[
          for (final ChecklistField field in fields)
            _buildTile(context, field),
        ],
      ),
    );
  }

  Widget _buildTile(BuildContext context, ChecklistField field) {
    final String label = fieldLabel(field);
    final Object? value = item.answers[field.id];
    final String? note = item.notes[field.id]?.toString();

    List<ChecklistFieldOption> options = const <ChecklistFieldOption>[];
    if (field.type == 'select' || field.type == 'multiselect') {
      options = fieldOptions(field);
    }

    final List<String> photos = item.photos[field.id] ?? const <String>[];

    // A `signature`-type field's own mark, falling back to the
    // submission's PRIMARY signature only when this field carries none
    // AND no other field's signature is recorded either - see the library
    // comment on why a stronger reconstruction is not possible from the
    // read side alone.
    final String? fieldSignature = item.signatures[field.id] ??
        (item.signatures.isEmpty ? item.signatureData : null);

    return ChecklistFieldAnswerTile(
      key: ValueKey<String>(field.id),
      field: field,
      label: label,
      value: value,
      options: options,
      readOnly: true,
      note: note,
      showNoteField: field.allowNote != false && (note?.trim().isNotEmpty ?? false),
      photos: photos,
      signatureBuilder: field.type == 'signature'
          ? (BuildContext context) => _ReadOnlySignature(dataUrl: fieldSignature)
          : null,
    );
  }
}

class _ReadOnlySignature extends StatelessWidget {
  const _ReadOnlySignature({required this.dataUrl});

  final String? dataUrl;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    if (dataUrl == null || dataUrl!.trim().isEmpty) {
      // "Not signed yet" - the same wording `_RungRow` uses for an
      // outstanding rung - not `checklistApprovalNoResponses`, which
      // states a different fact (nothing was answered at all).
      return Text(
        l10n.checklistApprovalNotSignedYet,
        style: Theme.of(context).textTheme.bodySmall,
      );
    }
    return Container(
      height: 110,
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      child: Image.memory(
        _decodeSignatureDataUrl(dataUrl!),
        fit: BoxFit.contain,
        errorBuilder: (context, error, stack) => Center(
          child: Text(
            l10n.checklistApprovalSignatureSavedLabel,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ),
    );
  }
}

class _DecidedInfoCard extends StatelessWidget {
  const _DecidedInfoCard({required this.l10n, required this.text});

  final AppLocalizations l10n;
  final String text;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      child: Row(
        children: <Widget>[
          Icon(Icons.info_outline, color: palette.textMuted),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(text, style: Theme.of(context).textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}

class _DecisionForm extends StatelessWidget {
  const _DecisionForm({
    required this.l10n,
    required this.closing,
    required this.approverSignature,
    required this.onSignatureChanged,
    required this.nameController,
    required this.noteController,
    required this.busy,
    required this.onApprove,
    required this.onReturn,
  });

  final AppLocalizations l10n;
  final bool closing;
  final ChecklistApprovalSignatureCapture? approverSignature;
  final ValueChanged<ChecklistApprovalSignatureCapture?> onSignatureChanged;
  final TextEditingController nameController;
  final TextEditingController noteController;
  final _DecisionBusy? busy;
  final VoidCallback onApprove;
  final VoidCallback onReturn;

  @override
  Widget build(BuildContext context) {
    final bool isBusy = busy != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          l10n.checklistApprovalYourDecisionTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        TpCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                closing
                    ? l10n.checklistApprovalAreaManagerSignatureLabel
                    : l10n.checklistApprovalSupervisorSignatureLabel,
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: TpSpace.sm),
              ChecklistApprovalSignaturePad(
                value: approverSignature?.dataUrl,
                onChanged: onSignatureChanged,
              ),
              const SizedBox(height: TpSpace.md),
              TpInput(
                label: l10n.checklistApprovalYourNameLabel,
                controller: nameController,
                hint: l10n.checklistApprovalYourNamePlaceholder,
              ),
              const SizedBox(height: TpSpace.md),
              TpInput(
                label: l10n.checklistApprovalNoteLabel,
                controller: noteController,
                hint: l10n.checklistApprovalNoteHint,
                maxLines: 3,
              ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.lg),
        Row(
          children: <Widget>[
            Expanded(
              child: TpButton.danger(
                label: l10n.checklistApprovalReturnButton,
                icon: Icons.undo_outlined,
                isBusy: busy == _DecisionBusy.rejecting,
                onPressed: isBusy ? null : onReturn,
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: TpButton.primary(
                label: closing
                    ? l10n.checklistApprovalApproveAndCloseButton
                    : l10n.checklistApprovalSignOffButton,
                icon: Icons.check_circle_outline,
                isBusy: busy == _DecisionBusy.approving,
                onPressed: isBusy ? null : onApprove,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
