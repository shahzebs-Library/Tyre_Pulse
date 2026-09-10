/// Inspection approval review.
///
/// Opens one pending inspection for sign-off: shows the recorded tyre
/// conditions (coloured by condition via `features/tyre_diagram`'s shared
/// diagram engine - see the library comment on why this feature depends on
/// that one but not on `features/inspections`), the odometer/hour-meter
/// readings and observations, and the inspector's drawn signature, then
/// lets a supervisor either APPROVE - capturing their own drawn signature -
/// or RETURN it with a note that re-opens it to the field.
///
/// Ported from `mobile/app/(app)/inspection/approvals/[id].tsx`
/// (`mobile/` is READ-ONLY reference material).
///
/// # Why `features/tyre_diagram` and not `features/inspections`
///
/// `features/inspections/presentation/inspection_detail_screen.dart` reads
/// the exact same `inspections.tyre_conditions` column for the exact same
/// purpose (showing a supervisor/inspector what was recorded) and reuses
/// `TyreDiagramBoard` + `diagramPositions` from `features/tyre_diagram`
/// directly - the shared vehicle-layout board (diagram + stat row + list
/// view), the same way this whole port consumes `features/tyre_diagram`'s
/// widgets and engine rather than re-querying or re-rendering a second,
/// possibly-drifting way. This feature follows the SAME established
/// convention for the SAME reason. What it does NOT do is import
/// `features/inspections/domain/tyre_position_reading.dart` - that decode
/// belongs to a SIBLING top-level feature's own domain layer, and per this
/// codebase's established convention (`inspection_approval_signature_pad
/// .dart`'s own library comment), sibling top-level features do not share
/// domain/presentation code even when a decode looks similar. The raw-cell
/// entry this screen needs instead comes from `features/tyre_diagram/domain/
/// tyre_completeness.dart`'s `readTyreEntries` - the SAME foundational,
/// shape-agnostic decoder `TyreDiagramBoard` and `TyreDetailScreen`
/// themselves are built on, so "what this wheel carries" can never disagree
/// between the board and the detail screen it opens.
library;

import 'dart:async';
import 'dart:io';
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
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_route_actions.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_route_card.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_signature_preview.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/inspection_approval_signature_pad.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_matcher.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_detail_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';

/// Which decision is currently in flight, so the two action buttons can
/// each show their own busy indicator without either being pressed twice.
enum _DecisionBusy { approving, rejecting }

/// Stable finders for approval truth/progress and the guarded decision bar.
@visibleForTesting
abstract final class InspectionApprovalReviewKeys {
  static const Key evidenceProgress =
      Key('inspection-approval-evidence-progress');
  static const Key approvalBlockedReason =
      Key('inspection-approval-approval-blocked-reason');
  static const Key approve = Key('inspection-approval-approve');
  static const Key returnForCorrection =
      Key('inspection-approval-return-for-correction');
}

class InspectionApprovalReviewScreen extends ConsumerStatefulWidget {
  const InspectionApprovalReviewScreen({required this.route, super.key});

  final InspectionApprovalReviewRoute route;

  @override
  ConsumerState<InspectionApprovalReviewScreen> createState() =>
      _InspectionApprovalReviewScreenState();
}

class _InspectionApprovalReviewScreenState
    extends ConsumerState<InspectionApprovalReviewScreen> {
  bool _didStartInitialLoad = false;
  bool _loading = true;
  AppError? _loadError;
  InspectionApprovalItem? _item;
  Map<String, TyreFitment> _installedTyres = const <String, TyreFitment>{};
  AppError? _fitmentError;

  InspectionApprovalSignatureCapture? _approverSignature;
  final TextEditingController _noteController = TextEditingController();
  String? _approverName;
  _DecisionBusy? _busy;

  @override
  void initState() {
    super.initState();
    unawaited(_loadApproverName());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_didStartInitialLoad) return;
    _didStartInitialLoad = true;
    unawaited(_load());
  }

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  String get _inspectionId => widget.route.inspectionId.value;

  Future<void> _load() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final InspectionApprovalItem? item = await ref
          .read(inspectionApprovalRepositoryProvider)
          .byId(_inspectionId);
      Map<String, TyreFitment> installedTyres = const <String, TyreFitment>{};
      AppError? fitmentError;
      final String assetNo = item?.assetNo?.trim() ?? '';
      if (item != null && assetNo.isNotEmpty) {
        try {
          final fitments =
              await ref.read(tyreFitmentRepositoryProvider).activeForAsset(
                    assetNo: assetNo,
                    country: ref.read(workspaceContextProvider)?.activeCountry,
                  );
          installedTyres = fitmentsByInspectionSlot(
            vehicleType: item.vehicleType ?? '',
            assetNo: assetNo,
            fitments: fitments,
          );
        } on AppError catch (error) {
          fitmentError = error;
        } on Object catch (error) {
          fitmentError = AppError(
            kind: AppErrorKind.unknown,
            message: l10n.inspectionApprovalFitmentsUnavailable,
            technical: 'activeForAsset($assetNo) failed: $error',
            isRetryable: true,
          );
        }
      }
      if (!mounted) return;
      setState(() {
        _item = item;
        _installedTyres = installedTyres;
        _fitmentError = fitmentError;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _loadError = _asAppError(
          context,
          error,
          AppLocalizations.of(context).inspectionApprovalLoadErrorMessage,
        );
        _loading = false;
      });
    }
  }

  /// Best-effort, and independent of [_load]'s own retry - a display name
  /// that failed to resolve must never block viewing or deciding this
  /// inspection.
  Future<void> _loadApproverName() async {
    final String userId = ref.read(workspaceContextProvider)?.userId ?? '';
    if (userId.isEmpty) return;
    final String? name = await ref
        .read(inspectionApprovalRepositoryProvider)
        .currentUserDisplayName(userId);
    if (!mounted) return;
    setState(() => _approverName = name);
  }

  Future<void> _decide(bool approved, {bool reject = false}) async {
    final InspectionApprovalItem? item = _item;
    if (item == null || _busy != null) return;
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (approved) {
      final _ApprovalEvidenceSummary evidence = _approvalEvidenceSummary(item);
      if (!evidence.canApprove) {
        await _showInfoDialog(
          context,
          title: l10n.inspectionApprovalTyreConditionsTitle(
            evidence.checkedCount,
          ),
          message: l10n.inspectionTyresIncompleteLead(
            evidence.blockingCount,
            evidence.expected!,
          ),
        );
        return;
      }
      if (_approverSignature == null) {
        await _showInfoDialog(
          context,
          title: l10n.inspectionApprovalSignatureRequiredTitle,
          message: l10n.inspectionApprovalSignatureRequiredMessage,
        );
        return;
      }
    } else if (_noteController.text.trim().isEmpty) {
      await _showInfoDialog(
        context,
        title: l10n.inspectionApprovalReasonRequiredTitle,
        message: l10n.inspectionApprovalReasonRequiredMessage,
      );
      return;
    }

    final _DecisionBusy nextBusy =
        approved ? _DecisionBusy.approving : _DecisionBusy.rejecting;
    setState(() => _busy = nextBusy);
    try {
      final String trimmedNote = _noteController.text.trim();
      await ref.read(inspectionApprovalRepositoryProvider).decide(
            InspectionApprovalDecision(
              inspectionId: item.id,
              reviewContext: item.reviewContext,
              approved: approved,
              decision:
                  approved ? 'approved' : (reject ? 'rejected' : 'returned'),
              approverSignature: _approverSignature?.dataUrl,
              approverName: _approverName,
              reviewNote: trimmedNote.isEmpty ? null : trimmedNote,
              existingNotes: item.notes,
            ),
          );

      // STAY ON THE RECORD JUST SIGNED - reload it in place rather than
      // navigating away. Mirrors the mobile screen's own explicit choice:
      // the queue only holds items still pending, so the row just decided
      // would already be gone, and arriving here from a notification
      // leaves nothing to go back to. Reloading shows the decided state -
      // proof the decision was saved - and the operator chooses when to
      // leave via the dialog below.
      await _load();
      if (!mounted) return;

      final String outcomeTitle =
          reject || item.reviewContext?.mode == 'enforced'
              ? approvalDecisionCopy(context, rejection: reject)
              : approved
                  ? l10n.inspectionApprovalApprovedOutcomeTitle
                  : l10n.inspectionApprovalReturnedOutcomeTitle;
      final String outcomeMessage =
          reject || item.reviewContext?.mode == 'enforced'
              ? approvalDecisionCopy(context, rejection: reject, message: true)
              : approved
                  ? l10n.inspectionApprovalApprovedOutcomeMessage
                  : l10n.inspectionApprovalReturnedOutcomeMessage;
      final bool goToList = await TpDialog.confirm(
        context: context,
        title: outcomeTitle,
        message: outcomeMessage,
        cancelLabel: l10n.inspectionApprovalStayHereAction,
        confirmLabel: l10n.inspectionApprovalBackToListAction,
      );
      if (mounted && goToList) {
        TpBack.pop(context, fallback: TpBackFallbacks.forRoute(widget.route));
      }
    } on Object catch (error) {
      if (!mounted) return;
      final AppError appError = _asAppError(
        context,
        error,
        l10n.inspectionApprovalDecideGenericError,
      );
      await _showInfoDialog(
        context,
        title: l10n.inspectionApprovalSaveFailedTitle,
        message: appError.message,
      );
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final InspectionApprovalItem? item = _item;
    final _ApprovalEvidenceSummary? evidence =
        item == null ? null : _approvalEvidenceSummary(item);
    final String title = item == null
        ? l10n.inspectionApprovalReviewTitle
        : _titleFor(item, l10n.inspectionApprovalFallbackTitle);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(title: title, backFallback: fallback),
      bottomNavigationBar: item?.isPending == true &&
              (item?.reviewContext == null ||
                  item!.reviewContext!.canDecide ||
                  item.reviewContext!.canReturn)
          ? _ApprovalDecisionActionBar(
              busy: _busy,
              canApprove: evidence!.canApprove &&
                  (item?.reviewContext?.canDecide ?? true),
              blockedReason: evidence.canApprove
                  ? null
                  : '${l10n.inspectionTyresIncompleteLead(
                      evidence.blockingCount,
                      evidence.expected!,
                    )} ${evidence.blockingCodes.join(', ')}',
              onApprove: () => _decide(true),
              onReturn: () => _decide(false),
              onReject: item?.reviewContext?.canDecide == true
                  ? () => _decide(false, reject: true)
                  : null,
            )
          : null,
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_loadError != null) {
      return TpErrorState(error: _loadError!, onRetry: _load);
    }
    final InspectionApprovalItem? item = _item;
    if (item == null) {
      return TpEmptyState(
        icon: Icons.help_outline,
        title: l10n.inspectionNotFoundTitle,
        message: l10n.inspectionApprovalNotFoundMessage,
      );
    }
    return _ReviewBody(
      item: item,
      onRefresh: _load,
      installedTyres: _installedTyres,
      fitmentError: _fitmentError,
      approverName: _approverName,
      approverSignature: _approverSignature,
      noteController: _noteController,
      busy: _busy,
      onSignatureChanged: (InspectionApprovalSignatureCapture? capture) {
        setState(() => _approverSignature = capture);
      },
    );
  }

  static String _titleFor(InspectionApprovalItem item, String fallback) {
    final String assetAndType = <String?>[
      item.assetNo,
      item.vehicleType,
    ].where((String? v) => v != null && v.trim().isNotEmpty).join(' - ');
    return assetAndType.isNotEmpty ? assetAndType : fallback;
  }
}

/// A single-button acknowledgement dialog, styled exactly like
/// `TpDialog.confirm` (same overlay colour, shape, actions padding) but
/// with only one action - there is no shared design-system primitive for a
/// pure info message today, and adding one is outside this feature's
/// scope; the styling constants are matched here rather than duplicated
/// under a fresh, drifting set of values.
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
        content: Text(
          message,
          style: Theme.of(dialogContext).textTheme.bodyMedium,
        ),
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

/// Mirrors `scan_lookup.dart`'s own private `_asAppError`: any
/// [AppError]/[SupabaseFailure] already carries a message safe to show;
/// anything else falls back to [fallbackMessage] rather than a raw driver
/// message.
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

/// `YYYY-MM-DD HH:mm`, in the device's local time zone. Deliberately
/// numeric rather than locale-aware month names, mirroring
/// `InspectionDetailScreen._formatDate`'s own choice over the same table.
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

class _ReviewBody extends StatelessWidget {
  const _ReviewBody({
    required this.item,
    required this.onRefresh,
    required this.installedTyres,
    required this.fitmentError,
    required this.approverName,
    required this.approverSignature,
    required this.noteController,
    required this.busy,
    required this.onSignatureChanged,
  });

  final InspectionApprovalItem item;
  final Future<void> Function() onRefresh;
  final Map<String, TyreFitment> installedTyres;
  final AppError? fitmentError;
  final String? approverName;
  final InspectionApprovalSignatureCapture? approverSignature;
  final TextEditingController noteController;
  final _DecisionBusy? busy;
  final ValueChanged<InspectionApprovalSignatureCapture?> onSignatureChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<TyreEntryPair> entries = readTyreEntries(item.tyreConditions);
    // Rebuild the complete resolved capture layout while retaining each
    // submitted spelling as the data key for the slot it belongs to. This is
    // important for partially completed legacy rows: using only the submitted
    // keys collapses an untouched half of a rear dual pair and makes approval
    // look like a different vehicle from capture. Conversely, replacing every
    // key with the current V1 ids loses readings stored under V2/canonical
    // codes. The matcher gives us both truths without inventing a second
    // approval-only resolver.
    final List<String> positions = _approvalPositions(
      vehicleType: item.vehicleType ?? '',
      assetNo: item.assetNo,
      submitted: entries,
    );
    final Map<String, Map<String, Object?>> tyreData = _approvalTyreData(
      vehicleType: item.vehicleType ?? '',
      assetNo: item.assetNo,
      positions: positions,
      submitted: entries,
      installedTyres: installedTyres,
    );
    final _ApprovalEvidenceSummary evidence = _approvalEvidenceSummary(item);

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        if (item.reviewContext != null)
          ApprovalRouteCard(review: item.reviewContext!),
        if (item.reviewContext != null)
          ApprovalRouteActions(
              type: 'inspection',
              entityId: item.id,
              review: item.reviewContext!,
              onRefresh: onRefresh),
        _SummaryCard(item: item),
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.inspectionApprovalTyreConditionsTitle(evidence.checkedCount),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        _ApprovalEvidenceProgress(summary: evidence),
        const SizedBox(height: TpSpace.sm),
        if (entries.isEmpty)
          TpCard(
            child: Text(
              l10n.inspectionApprovalNoTyreConditions,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          )
        else
          _TyreConditionsSection(
            vehicleType: item.vehicleType ?? '',
            assetNo: item.assetNo,
            siteName: item.site,
            positions: positions,
            tyreData: tyreData,
          ),
        if (fitmentError != null) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          TpCard(
            background: TpPalette.of(context).forStatus(TpStatus.warning).soft,
            child: Text(
              l10n.inspectionApprovalFitmentsUnavailable,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ],
        if (entries.any(_isImmediateTyreFinding)) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          _ImmediateTyreFindings(
            vehicleType: item.vehicleType ?? '',
            assetNo: item.assetNo,
            entries: entries,
          ),
        ],
        if (item.photoEvidence.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Text(
            '${l10n.washPhotosLabel} (${item.photoEvidence.length})',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          _SubmittedEvidenceGallery(evidence: item.photoEvidence),
        ],
        if ((item.findings ?? item.notes)?.trim().isNotEmpty ?? false) ...[
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.inspectionObservationsLabel,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          TpCard(child: Text((item.findings ?? item.notes ?? '').trim())),
        ],
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.inspectionInspectorSignatureLabel,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        TpCard(
          child: ApprovalSignaturePreview(
            value: item.inspectorSignature,
            height: 110,
            fallback: Text(
              l10n.inspectionSignatureMissing,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ),
        const SizedBox(height: TpSpace.lg),
        if (!item.isPending)
          _DecidedSection(item: item)
        else
          _DecisionForm(
            approverName: approverName,
            approverSignature: approverSignature,
            noteController: noteController,
            busy: busy,
            onSignatureChanged: onSignatureChanged,
          ),
      ],
    );
  }
}

Map<String, Map<String, Object?>> _approvalTyreData({
  required String vehicleType,
  required String? assetNo,
  required List<String> positions,
  required List<TyreEntryPair> submitted,
  required Map<String, TyreFitment> installedTyres,
}) {
  final Map<String, Map<String, Object?>> result =
      <String, Map<String, Object?>>{
    for (final TyreEntryPair pair in submitted)
      pair.key: <String, Object?>{...pair.entry},
  };
  if (installedTyres.isEmpty) return result;

  final String resolvedKey = resolveVehicleType(vehicleType, assetNo);
  final DiagramLayout layout =
      kTyreDiagramLayouts[resolvedKey] ?? kTyreDiagramLayouts['Pickup']!;
  for (final MatchedTyreSlot matched
      in matchPositionsToLayout(layout, positions)) {
    final TyreFitment? fitment = installedTyres[matched.id];
    if (fitment == null) continue;
    final Map<String, Object?> merged = <String, Object?>{
      ...?result[matched.positionId],
      if (fitment.serialNo != null) 'installed_serial': fitment.serialNo,
      if (fitment.brand != null) 'installed_brand': fitment.brand,
      if (fitment.size != null) 'installed_size': fitment.size,
    };
    result[matched.positionId] = merged;
    // The shared diagram deliberately double-looks up the caller spelling
    // and the geometry slot id. Supplying both keeps list/layout mode and the
    // read-only detail sheet on the same authoritative fitment identity.
    result[matched.id] = merged;
  }
  return result;
}

@immutable
class _ApprovalEvidenceSummary {
  const _ApprovalEvidenceSummary({
    required this.result,
    required this.checkedCount,
  });

  final TyreCompletenessResult result;
  final int checkedCount;

  int? get expected => result.expected;

  /// Unknown and foreign legacy layouts remain reviewable: the shared engine
  /// deliberately refuses to invent a wheel count for them. A known, matched
  /// layout is approvable only when every expected slot has deliberate
  /// evidence. Pressure remains advisory, matching `requireEvidence: true`.
  bool get canApprove =>
      !result.applicable || !result.known || !result.matched || result.ok;

  int get blockingCount => result.blocked.length;

  /// Canonical spoken position codes, in vehicle-layout order. Showing these
  /// beside a disabled Approve action tells the reviewer exactly which wheels
  /// must be returned for correction instead of only saying "form invalid".
  List<String> get blockingCodes => <String>[
        for (final TyreSlotStatus slot in result.blocked) slot.code,
      ];
}

_ApprovalEvidenceSummary _approvalEvidenceSummary(
  InspectionApprovalItem item,
) {
  final List<TyreEntryPair> entries = readTyreEntries(item.tyreConditions);
  final Map<String, Map<String, Object?>> data = <String, Map<String, Object?>>{
    for (final TyreEntryPair pair in entries) pair.key: pair.entry,
  };
  final TyreCompletenessResult result = tyreCompleteness(
    item.vehicleType,
    item.assetNo,
    data,
    const TyreCompletenessOptions(requireEvidence: true),
  );
  final int checkedCount = result.known && result.matched
      ? result.slots.where((TyreSlotStatus slot) {
          return slot.state == TyreSlotState.complete ||
              slot.state == TyreSlotState.incomplete;
        }).length
      : entries.where((TyreEntryPair pair) {
          final TyreSlotState state = classifyEntry(pair.entry).state;
          return state == TyreSlotState.complete ||
              state == TyreSlotState.incomplete;
        }).length;
  return _ApprovalEvidenceSummary(
    result: result,
    checkedCount: checkedCount,
  );
}

class _ApprovalEvidenceProgress extends StatelessWidget {
  const _ApprovalEvidenceProgress({required this.summary});

  final _ApprovalEvidenceSummary summary;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final int? expected = summary.expected;
    final bool hasExpectation = summary.result.applicable &&
        summary.result.known &&
        summary.result.matched &&
        expected != null;
    final TpStatus tone = !hasExpectation
        ? TpStatus.neutral
        : summary.canApprove
            ? TpStatus.ok
            : TpStatus.warning;
    final TpStatusColors colors = palette.forStatus(tone);
    final String status = !summary.result.applicable
        ? l10n.tyreDiagramTyrelessMessage
        : !hasExpectation || summary.checkedCount == 0
            ? l10n.statusUnknown
            : l10n.inspectionPositionsRecorded(
                summary.checkedCount,
                expected,
              );

    return TpCard(
      key: InspectionApprovalReviewKeys.evidenceProgress,
      background: colors.soft,
      borderColor: colors.base,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                hasExpectation && summary.canApprove
                    ? Icons.fact_check_outlined
                    : hasExpectation
                        ? Icons.rule_folder_outlined
                        : Icons.help_outline,
                color: colors.onSoft,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  status,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: colors.onSoft,
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
              if (hasExpectation)
                TpStatusChip(
                  status: tone,
                  label: '${summary.checkedCount}/$expected',
                  isCompact: true,
                ),
            ],
          ),
          if (hasExpectation && !summary.canApprove) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              l10n.inspectionTyresIncompleteLead(
                summary.blockingCount,
                expected,
              ),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSoft,
                  ),
            ),
            const SizedBox(height: TpSpace.sm),
            Wrap(
              key: const Key('inspection-approval-missing-positions'),
              spacing: TpSpace.xs,
              runSpacing: TpSpace.xs,
              children: <Widget>[
                for (final String code in summary.blockingCodes)
                  TpStatusChip(
                    status: TpStatus.warning,
                    label: code,
                    isCompact: true,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

List<String> _approvalPositions({
  required String vehicleType,
  required String? assetNo,
  required List<TyreEntryPair> submitted,
}) {
  if (isTyrelessEquipment(vehicleType)) return const <String>[];
  final String resolvedKey = resolveVehicleType(vehicleType, assetNo);
  final DiagramLayout layout =
      kTyreDiagramLayouts[resolvedKey] ?? kTyreDiagramLayouts['Pickup']!;
  if (submitted.isEmpty) {
    return <String>[for (final TyreSlot slot in layout.tyres) slot.id];
  }

  final Set<String> submittedKeys = <String>{
    for (final TyreEntryPair pair in submitted) pair.key.toUpperCase(),
  };
  final Map<String, String> submittedPositionBySlot = <String, String>{};
  for (final MatchedTyreSlot match in matchPositionsToLayout(
    layout,
    <String>[for (final TyreEntryPair pair in submitted) pair.key],
  )) {
    // A fully foreign vocabulary makes the shared matcher return the whole
    // layout as a safe visual fallback. Do not mistake those fallback ids for
    // submitted storage keys.
    if (submittedKeys.contains(match.positionId.toUpperCase())) {
      submittedPositionBySlot[match.id] = match.positionId;
    }
  }
  return <String>[
    for (final TyreSlot slot in layout.tyres)
      submittedPositionBySlot[slot.id] ?? slot.id,
  ];
}

/// Supplies artwork selection with axle evidence that already exists in the
/// canonical tyre layout. This is especially important for pump inspections:
/// the class name alone cannot truthfully distinguish the incompatible
/// four- and five-axle reference boards, while the inspected slot layout can.
bool _isImmediateTyreFinding(TyreEntryPair pair) {
  final TyreCondition condition = normaliseCondition(
    pair.entry['condition']?.toString(),
  );
  return condition == TyreCondition.flat || condition == TyreCondition.puncture;
}

class _ImmediateTyreFindings extends StatelessWidget {
  const _ImmediateTyreFindings({
    required this.vehicleType,
    required this.assetNo,
    required this.entries,
  });

  final String vehicleType;
  final String? assetNo;
  final List<TyreEntryPair> entries;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String resolvedKey = resolveVehicleType(vehicleType, assetNo);
    final DiagramLayout layout =
        kTyreDiagramLayouts[resolvedKey] ?? kTyreDiagramLayouts['Pickup']!;
    final Map<String, String> displayCodeBySubmittedPosition = <String, String>{
      for (final MatchedTyreSlot slot in matchPositionsToLayout(
        layout,
        <String>[for (final TyreEntryPair pair in entries) pair.key],
      ))
        slot.positionId: legacyPositionCode(layout.key, slot.id),
    };

    return Wrap(
      key: const Key('inspection-approval-immediate-tyre-findings'),
      spacing: TpSpace.sm,
      runSpacing: TpSpace.sm,
      children: <Widget>[
        for (final TyreEntryPair pair in entries)
          if (_isImmediateTyreFinding(pair))
            Builder(
              builder: (BuildContext context) {
                final TyreCondition condition = normaliseCondition(
                  pair.entry['condition']?.toString(),
                );
                final String code =
                    displayCodeBySubmittedPosition[pair.key] ?? pair.key;
                return TpStatusChip(
                  key: Key(
                    'inspection-approval-tyre-finding-${pair.key}',
                  ),
                  status: tyreConditionStatus(condition),
                  icon: condition == TyreCondition.puncture
                      ? Icons.report_problem_outlined
                      : Icons.warning_amber_rounded,
                  label: '${TpDirection.isolateLtr(code)} · '
                      '${tyreConditionLabel(l10n, condition)}',
                );
              },
            ),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.item});

  final InspectionApprovalItem item;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? meterLine = _meterLine(item);
    final TpPalette palette = TpPalette.of(context);
    final String title = item.title?.trim().isNotEmpty == true
        ? item.title!.trim()
        : l10n.inspectionApprovalFallbackTitle;
    final String identity = <String?>[item.assetNo, item.vehicleType]
        .where((String? value) => value?.trim().isNotEmpty == true)
        .map((String? value) => value!.trim())
        .join(' - ');

    return TpCard(
      background: palette.primarySoft,
      borderColor: palette.primary.withValues(alpha: 0.28),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.primary,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: SizedBox.square(
                  dimension: 48,
                  child: Icon(
                    Icons.fact_check_outlined,
                    color: palette.onPrimary,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    if (identity.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 2),
                      TpIdentifierText(
                        identity,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              if (item.isPending)
                TpStatusChip(
                  status: TpStatus.warning,
                  label: l10n.inspectionApprovalsPendingBadge,
                  isCompact: true,
                ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          Divider(height: 1, color: palette.border),
          const SizedBox(height: TpSpace.sm),
          if (item.site != null && item.site!.trim().isNotEmpty)
            _SummaryRow(icon: Icons.place_outlined, text: item.site!),
          _SummaryRow(
            icon: Icons.person_outline,
            text: item.inspector?.trim().isNotEmpty == true
                ? item.inspector!.trim()
                : l10n.inspectionInspectorUnknown,
          ),
          _SummaryRow(
            icon: Icons.event_outlined,
            text: _formatDateTime(item.createdAt) ?? l10n.valueUnavailable,
          ),
          if (meterLine != null)
            _SummaryRow(icon: Icons.speed_outlined, text: meterLine),
        ],
      ),
    );
  }

  static String? _meterLine(InspectionApprovalItem item) {
    final List<String> parts = <String>[
      if (item.odometerKm != null) '${item.odometerKm} km',
      if (item.hourMeter != null) '${item.hourMeter} h',
    ];
    return parts.isEmpty ? null : parts.join('    ');
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

class _TyreConditionsSection extends StatelessWidget {
  const _TyreConditionsSection({
    required this.vehicleType,
    required this.assetNo,
    required this.siteName,
    required this.positions,
    required this.tyreData,
  });

  final String vehicleType;
  final String? assetNo;
  final String? siteName;
  final List<String> positions;
  final Map<String, Map<String, Object?>> tyreData;

  @override
  Widget build(BuildContext context) {
    final String resolvedClass = resolveVehicleType(vehicleType, assetNo);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TpStatusChip(
            key: const Key('inspection-approval-resolved-vehicle-class'),
            status: TpStatus.info,
            icon: Icons.local_shipping_outlined,
            label: resolvedClass,
          ),
        ),
        const SizedBox(height: TpSpace.sm),
        TyreDiagramBoard(
          vehicleType: vehicleType,
          assetNo: assetNo,
          positions: positions,
          tyreData: tyreData,
          onPositionTap: (String position) => unawaited(
            pushTyreDetailScreen(
              context,
              positionCode: position,
              vehicleType: vehicleType,
              entry: tyreData[position],
              assetNo: assetNo,
              siteName: siteName,
              // This inspection has already been submitted for approval -
              // there is no live draft to write a corrected reading back
              // into, so "Adjust reading" on Take Action renders honestly
              // disabled.
            ),
          ),
          // Exactly the same available width as the submitted-inspection
          // detail and capture screens. The previous extra card inset made
          // this copy of the shared board visibly smaller and made dual
          // inner/outer tyres look like a different layout even though the
          // underlying engine was shared.
          width: MediaQuery.sizeOf(context).width - (TpSpace.lg * 2),
          compact: true,
          captureMode: true,
        ),
      ],
    );
  }
}

/// Read-only visual evidence from the SAME submitted inspection row.
///
/// Private `tp-storage://` references are resolved through the authenticated
/// Storage client into short-lived signed URLs. A denied, missing, expired or
/// unsupported reference stays visible in an explicit unavailable tile so
/// approval evidence can never disappear merely because this device cannot
/// open it.
class _SubmittedEvidenceGallery extends StatelessWidget {
  const _SubmittedEvidenceGallery({required this.evidence});

  final List<InspectionApprovalPhotoEvidence> evidence;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      key: const Key('inspection-approval-evidence-gallery'),
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth >= 260 ? 2 : 1;
        final double width = columns == 1
            ? constraints.maxWidth
            : (constraints.maxWidth - TpSpace.sm) / columns;
        return Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (int index = 0; index < evidence.length; index++)
              SizedBox(
                width: width,
                child: _SubmittedEvidenceCard(
                  evidence: evidence[index],
                  index: index,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _SubmittedEvidenceCard extends StatelessWidget {
  const _SubmittedEvidenceCard({
    required this.evidence,
    required this.index,
  });

  final InspectionApprovalPhotoEvidence evidence;
  final int index;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TyreCondition? condition = _knownCondition(evidence.condition);
    final TpStatus status =
        condition == null ? TpStatus.info : tyreConditionStatus(condition);
    final TpStatusColors statusColors = palette.forStatus(status);
    final String position = evidence.position?.trim() ?? '';
    final String label = position.isEmpty
        ? '${l10n.inspectionPhotoLabel} ${index + 1}'
        : position;

    return Semantics(
      container: true,
      label: '$label, ${l10n.inspectionHistorySubmittedSection}',
      child: TpCard(
        key: Key('inspection-approval-evidence-$index'),
        padding: EdgeInsets.zero,
        borderColor: statusColors.base,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(TpRadius.lg - 1),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              AspectRatio(
                aspectRatio: 4 / 3,
                child: _SubmittedEvidencePreview(
                  reference: evidence.reference,
                  index: index,
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(TpSpace.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (position.isEmpty)
                      Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelLarge,
                      )
                    else
                      TpIdentifierText(
                        label,
                        key: Key(
                          'inspection-approval-evidence-position-$index',
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                    if (condition != null) ...<Widget>[
                      const SizedBox(height: TpSpace.xs),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TpStatusChip(
                          status: status,
                          label: tyreConditionLabel(l10n, condition),
                          isCompact: true,
                        ),
                      ),
                    ],
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      l10n.inspectionHistorySubmittedSection,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.textMuted,
                          ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SubmittedEvidencePreview extends ConsumerWidget {
  const _SubmittedEvidencePreview({
    required this.reference,
    required this.index,
  });

  final String reference;
  final int index;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final Widget preview = _imageForReference(context, ref);
    return ColoredBox(
      color: palette.surfaceSunken,
      child: preview,
    );
  }

  Widget _imageForReference(BuildContext context, WidgetRef ref) {
    final Uint8List? bytes = _dataImageBytes(reference);
    if (bytes != null) {
      return Image.memory(
        bytes,
        key: Key('inspection-approval-evidence-image-$index'),
        fit: BoxFit.cover,
        errorBuilder: _unavailableBuilder,
      );
    }

    final Uri? uri = Uri.tryParse(reference);
    if (needsPrivateStorageResolution(reference)) {
      final AsyncValue<String> resolved =
          ref.watch(inspectionApprovalEvidenceUrlProvider(reference));
      return resolved.when(
        data: _resolvedPrivateImage,
        loading: () => _EvidenceReferenceState(
          reference: reference,
          index: index,
          loading: true,
        ),
        error: (Object error, StackTrace stackTrace) => _EvidenceReferenceState(
          reference: reference,
          index: index,
          onRetry: () =>
              ref.invalidate(inspectionApprovalEvidenceUrlProvider(reference)),
        ),
      );
    }
    if (uri != null &&
        (uri.scheme.toLowerCase() == 'http' ||
            uri.scheme.toLowerCase() == 'https') &&
        uri.host.isNotEmpty) {
      return Image.network(
        reference,
        key: Key('inspection-approval-evidence-image-$index'),
        fit: BoxFit.cover,
        loadingBuilder: (
          BuildContext context,
          Widget child,
          ImageChunkEvent? progress,
        ) {
          if (progress == null) return child;
          return _EvidenceReferenceState(
            reference: reference,
            index: index,
            loading: true,
          );
        },
        errorBuilder: _unavailableBuilder,
      );
    }

    final String? localPath = _localPath(reference, uri);
    if (localPath != null) {
      return Image.file(
        File(localPath),
        key: Key('inspection-approval-evidence-image-$index'),
        fit: BoxFit.cover,
        errorBuilder: _unavailableBuilder,
      );
    }

    return _EvidenceReferenceState(reference: reference, index: index);
  }

  Widget _resolvedPrivateImage(String signedUrl) {
    // Supabase returns https in production. Supporting an image data URI here
    // is harmless and keeps the renderer total for a compatible resolver.
    final Uint8List? bytes = _dataImageBytes(signedUrl);
    if (bytes != null) {
      return Image.memory(
        bytes,
        key: Key('inspection-approval-evidence-image-$index'),
        fit: BoxFit.cover,
        errorBuilder: _unavailableBuilder,
      );
    }
    final Uri? uri = Uri.tryParse(signedUrl);
    if (uri == null ||
        (uri.scheme.toLowerCase() != 'http' &&
            uri.scheme.toLowerCase() != 'https') ||
        uri.host.isEmpty) {
      return _EvidenceReferenceState(reference: reference, index: index);
    }
    return Image.network(
      signedUrl,
      key: Key('inspection-approval-evidence-image-$index'),
      fit: BoxFit.cover,
      loadingBuilder: (
        BuildContext context,
        Widget child,
        ImageChunkEvent? progress,
      ) {
        if (progress == null) return child;
        return _EvidenceReferenceState(
          reference: reference,
          index: index,
          loading: true,
        );
      },
      errorBuilder: _unavailableBuilder,
    );
  }

  Widget _unavailableBuilder(
    BuildContext context,
    Object error,
    StackTrace? stackTrace,
  ) {
    return _EvidenceReferenceState(reference: reference, index: index);
  }
}

class _EvidenceReferenceState extends StatelessWidget {
  const _EvidenceReferenceState({
    required this.reference,
    required this.index,
    this.loading = false,
    this.onRetry,
  });

  final String reference;
  final int index;
  final bool loading;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      key: Key('inspection-approval-evidence-unavailable-$index'),
      padding: const EdgeInsets.all(TpSpace.sm),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Icon(
            loading
                ? Icons.cloud_download_outlined
                : Icons.broken_image_outlined,
            color: palette.textMuted,
            size: onRetry == null ? TpSizing.iconLg : TpSizing.iconMd,
          ),
          SizedBox(height: onRetry == null ? TpSpace.xs : 0),
          Text(
            loading ? l10n.inspectionPhotoLabel : l10n.valueUnavailable,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelMedium,
          ),
          SizedBox(height: onRetry == null ? TpSpace.xs : 0),
          Expanded(
            child: Align(
              alignment: Alignment.topCenter,
              child: Directionality(
                textDirection: TextDirection.ltr,
                child: SelectableText(
                  reference,
                  key: Key('inspection-approval-evidence-reference-$index'),
                  maxLines: 3,
                  textAlign: TextAlign.left,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: palette.textMuted,
                      ),
                ),
              ),
            ),
          ),
          if (onRetry != null)
            SizedBox.square(
              dimension: TpSizing.iconLg,
              child: IconButton(
                key: Key('inspection-approval-evidence-retry-$index'),
                onPressed: onRetry,
                tooltip: l10n.actionRetry,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                iconSize: TpSizing.iconSm,
                icon: const Icon(Icons.refresh),
              ),
            ),
        ],
      ),
    );
  }
}

TyreCondition? _knownCondition(String? raw) {
  return switch (raw?.trim().toLowerCase()) {
    'good' => TyreCondition.good,
    'worn' || 'wear' => TyreCondition.worn,
    'damaged' || 'damage' => TyreCondition.damaged,
    'puncture' => TyreCondition.puncture,
    'flat' => TyreCondition.flat,
    'missing' => TyreCondition.missing,
    _ => null,
  };
}

Uint8List? _dataImageBytes(String reference) {
  final Uri? uri = Uri.tryParse(reference);
  if (uri == null || uri.scheme.toLowerCase() != 'data') return null;
  try {
    final UriData? data = uri.data;
    if (data == null || !data.mimeType.toLowerCase().startsWith('image/')) {
      return null;
    }
    return Uint8List.fromList(data.contentAsBytes());
  } on FormatException {
    return null;
  }
}

String? _localPath(String reference, Uri? uri) {
  if (uri?.scheme.toLowerCase() == 'file') {
    try {
      return uri!.toFilePath(windows: Platform.isWindows);
    } on UnsupportedError {
      return null;
    } on FormatException {
      return null;
    }
  }
  if (reference.startsWith('/') ||
      reference.startsWith(r'\\') ||
      RegExp(r'^[A-Za-z]:[\\/]').hasMatch(reference)) {
    return reference;
  }
  return null;
}

class _DecidedSection extends StatelessWidget {
  const _DecidedSection({required this.item});

  final InspectionApprovalItem item;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool approved = item.isApproved;
    final TpStatusColors colors = palette.forStatus(
      approved ? TpStatus.ok : TpStatus.critical,
    );
    final String? approvedAt = _formatDateTime(item.approvedAt);
    final String decisionLabel = approved
        ? l10n.inspectionApprovalDecisionApproved
        : l10n.inspectionApprovalDecisionReturned;
    final String? decidedByLine = _decidedByLine(l10n, item, approved);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          l10n.inspectionApprovalDecisionTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        TpCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Icon(
                    approved ? Icons.check_circle : Icons.cancel,
                    color: colors.base,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      decisionLabel,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                ],
              ),
              if (decidedByLine != null)
                Padding(
                  padding: const EdgeInsets.only(top: TpSpace.sm),
                  child: Text(
                    decidedByLine,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: palette.textMuted),
                  ),
                ),
              if (approvedAt != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    approvedAt,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: palette.textMuted),
                  ),
                ),
              const SizedBox(height: TpSpace.md),
              Text(
                l10n.inspectionApprovalApproverSignatureLabel,
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: TpSpace.sm),
              ApprovalSignaturePreview(
                value: item.approverSignature,
                height: 110,
                fallback: Text(
                  l10n.inspectionSignatureMissing,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// "Approved by &lt;name&gt;" / "Returned by &lt;name&gt;", or `null` when
  /// `approver_email` was never recorded. The identifier is LTR-isolated -
  /// see the library comment on `TpDirection.isolateLtr` for why an email
  /// address embedded in translated prose needs it.
  static String? _decidedByLine(
    AppLocalizations l10n,
    InspectionApprovalItem item,
    bool approved,
  ) {
    final String email = item.approverEmail?.trim() ?? '';
    if (email.isEmpty) return null;
    final String isolated = TpDirection.isolateLtr(email);
    return approved
        ? l10n.inspectionApprovalApprovedBy(isolated)
        : l10n.inspectionApprovalReturnedBy(isolated);
  }
}

class _DecisionForm extends StatelessWidget {
  const _DecisionForm({
    required this.approverName,
    required this.approverSignature,
    required this.noteController,
    required this.busy,
    required this.onSignatureChanged,
  });

  final String? approverName;
  final InspectionApprovalSignatureCapture? approverSignature;
  final TextEditingController noteController;
  final _DecisionBusy? busy;
  final ValueChanged<InspectionApprovalSignatureCapture?> onSignatureChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool isBusy = busy != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          l10n.inspectionApprovalYourDecisionTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        IgnorePointer(
          ignoring: isBusy,
          child: TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.inspectionApprovalApproverSignatureLabel,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(height: TpSpace.sm),
                InspectionApprovalSignaturePad(
                  onChanged: onSignatureChanged,
                  height: 170,
                ),
                if (approverName != null && approverName!.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: TpSpace.sm),
                    child: Text(
                      l10n.inspectionApprovalSigningAs(
                        TpDirection.isolateLtr(approverName!.trim()),
                      ),
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: TpPalette.of(context).textMuted),
                    ),
                  ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: l10n.inspectionApprovalNoteLabel,
                  controller: noteController,
                  hint: l10n.inspectionApprovalNoteHint,
                  maxLines: 3,
                  textCapitalization: TextCapitalization.sentences,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ApprovalDecisionActionBar extends StatelessWidget {
  const _ApprovalDecisionActionBar({
    required this.busy,
    required this.canApprove,
    required this.blockedReason,
    required this.onApprove,
    required this.onReturn,
    this.onReject,
  });

  final _DecisionBusy? busy;
  final bool canApprove;
  final String? blockedReason;
  final VoidCallback onApprove;
  final VoidCallback onReturn;
  final VoidCallback? onReject;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool isBusy = busy != null;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
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
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (blockedReason != null) ...<Widget>[
                Row(
                  key: InspectionApprovalReviewKeys.approvalBlockedReason,
                  children: <Widget>[
                    Icon(
                      Icons.info_outline,
                      size: TpSizing.iconSm,
                      color: palette.forStatus(TpStatus.warning).onSoft,
                    ),
                    const SizedBox(width: TpSpace.xs),
                    Expanded(
                      child: Text(
                        blockedReason!,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: palette.forStatus(TpStatus.warning).onSoft,
                            ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: TpSpace.sm),
              ],
              Row(
                children: <Widget>[
                  Expanded(
                    child: TpButton.danger(
                      key: InspectionApprovalReviewKeys.returnForCorrection,
                      label: l10n.inspectionApprovalReturnButton,
                      icon: Icons.undo_outlined,
                      isBusy: busy == _DecisionBusy.rejecting,
                      onPressed: isBusy ? null : onReturn,
                    ),
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    child: TpButton.primary(
                      key: InspectionApprovalReviewKeys.approve,
                      label: l10n.inspectionApprovalApproveButton,
                      icon: Icons.check_circle_outline,
                      isBusy: busy == _DecisionBusy.approving,
                      onPressed: isBusy || !canApprove ? null : onApprove,
                    ),
                  ),
                ],
              ),
              if (onReject != null)
                TextButton(
                    onPressed: isBusy ? null : onReject,
                    child:
                        Text(approvalDecisionCopy(context, rejection: true))),
            ],
          ),
        ),
      ),
    );
  }
}
