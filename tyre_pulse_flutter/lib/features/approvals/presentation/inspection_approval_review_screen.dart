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
/// `VehicleTyreDiagram` + `diagramPositions` + `tyreConditionLabel` from
/// `features/tyre_diagram` directly, per that file's own library comment:
/// "Vehicle picking is deliberately NOT duplicated here ... the same way
/// this whole port consumes `features/tyre_diagram`'s widget and engine,
/// rather than re-querying ... a second, possibly-drifting way". This
/// feature follows the SAME established convention for the SAME reason.
/// What it does NOT do is import `features/inspections/domain/
/// tyre_position_reading.dart` - that decode belongs to a SIBLING
/// top-level feature's own domain layer, and per this codebase's
/// established convention (`inspection_approval_signature_pad.dart`'s own
/// library comment), sibling top-level features do not share domain/
/// presentation code even when a decode looks similar. The raw-cell
/// classification this screen needs instead comes from `features/
/// tyre_diagram/domain/tyre_completeness.dart`'s `readTyreEntries`/
/// `classifyEntry` - the SAME foundational, shape-agnostic decoder
/// `VehicleTyreDiagram` itself is built on, so "which positions actually
/// carry evidence" can never disagree between the diagram and the summary
/// list underneath it.
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
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/inspection_approval_signature_pad.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';

/// Which decision is currently in flight, so the two action buttons can
/// each show their own busy indicator without either being pressed twice.
enum _DecisionBusy { approving, rejecting }

class InspectionApprovalReviewScreen extends ConsumerStatefulWidget {
  const InspectionApprovalReviewScreen({required this.route, super.key});

  final InspectionApprovalReviewRoute route;

  @override
  ConsumerState<InspectionApprovalReviewScreen> createState() =>
      _InspectionApprovalReviewScreenState();
}

class _InspectionApprovalReviewScreenState
    extends ConsumerState<InspectionApprovalReviewScreen> {
  bool _loading = true;
  AppError? _loadError;
  InspectionApprovalItem? _item;

  InspectionApprovalSignatureCapture? _approverSignature;
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
    _noteController.dispose();
    super.dispose();
  }

  String get _inspectionId => widget.route.inspectionId.value;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final InspectionApprovalItem? item = await ref
          .read(inspectionApprovalRepositoryProvider)
          .byId(_inspectionId);
      if (!mounted) return;
      setState(() {
        _item = item;
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

  Future<void> _decide(bool approved) async {
    final InspectionApprovalItem? item = _item;
    if (item == null || _busy != null) return;
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (approved) {
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

    final _DecisionBusy nextBusy = approved
        ? _DecisionBusy.approving
        : _DecisionBusy.rejecting;
    setState(() => _busy = nextBusy);
    try {
      final String trimmedNote = _noteController.text.trim();
      await ref
          .read(inspectionApprovalRepositoryProvider)
          .decide(
            InspectionApprovalDecision(
              inspectionId: item.id,
              approved: approved,
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

      final String outcomeTitle = approved
          ? l10n.inspectionApprovalApprovedOutcomeTitle
          : l10n.inspectionApprovalReturnedOutcomeTitle;
      final String outcomeMessage = approved
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
    final String title = _item == null
        ? l10n.inspectionApprovalReviewTitle
        : _titleFor(_item!, l10n.inspectionApprovalFallbackTitle);

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
      approverName: _approverName,
      approverSignature: _approverSignature,
      noteController: _noteController,
      busy: _busy,
      onSignatureChanged: (InspectionApprovalSignatureCapture? capture) {
        setState(() => _approverSignature = capture);
      },
      onApprove: () => _decide(true),
      onReturn: () => _decide(false),
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
    required this.approverName,
    required this.approverSignature,
    required this.noteController,
    required this.busy,
    required this.onSignatureChanged,
    required this.onApprove,
    required this.onReturn,
  });

  final InspectionApprovalItem item;
  final String? approverName;
  final InspectionApprovalSignatureCapture? approverSignature;
  final TextEditingController noteController;
  final _DecisionBusy? busy;
  final ValueChanged<InspectionApprovalSignatureCapture?> onSignatureChanged;
  final VoidCallback onApprove;
  final VoidCallback onReturn;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<TyreEntryPair> entries = readTyreEntries(item.tyreConditions);
    final Map<String, Map<String, Object?>> tyreData =
        <String, Map<String, Object?>>{
          for (final TyreEntryPair pair in entries) pair.key: pair.entry,
        };
    final List<String> positions = diagramPositions(
      item.vehicleType ?? '',
      item.assetNo,
    );

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        _SummaryCard(item: item),
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.inspectionApprovalTyreConditionsTitle(entries.length),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        TpCard(
          child: entries.isEmpty
              ? Text(
                  l10n.inspectionApprovalNoTyreConditions,
                  style: Theme.of(context).textTheme.bodySmall,
                )
              : _TyreConditionsSection(
                  vehicleType: item.vehicleType ?? '',
                  assetNo: item.assetNo,
                  positions: positions,
                  tyreData: tyreData,
                ),
        ),
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
          child:
              item.inspectorSignature != null &&
                  item.inspectorSignature!.isNotEmpty
              ? Image.memory(
                  _decodeSignatureDataUrl(item.inspectorSignature!),
                  height: 110,
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stack) => Text(
                    l10n.inspectionSignatureMissing,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                )
              : Text(
                  l10n.inspectionSignatureMissing,
                  style: Theme.of(context).textTheme.bodySmall,
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
            onApprove: onApprove,
            onReturn: onReturn,
          ),
      ],
    );
  }
}

/// Decodes a `data:image/png;base64,...` signature payload. Shared by every
/// READ-ONLY signature display in this screen - the inspector's own mark and
/// a signature already carried by a DECIDED item are both shown as a plain
/// static image, never through [InspectionApprovalSignaturePad], because
/// that pad's "Draw a new signature" action would invite redrawing a
/// signature that already belongs to a finished decision. The pad is used
/// ONLY where a NEW signature is actually being captured - see
/// [_DecisionForm].
Uint8List _decodeSignatureDataUrl(String dataUrl) {
  final int comma = dataUrl.indexOf(',');
  final String b64 = comma < 0 ? dataUrl : dataUrl.substring(comma + 1);
  return base64Decode(b64);
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.item});

  final InspectionApprovalItem item;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String? meterLine = _meterLine(item);

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
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
    required this.positions,
    required this.tyreData,
  });

  final String vehicleType;
  final String? assetNo;
  final List<String> positions;
  final Map<String, Map<String, Object?>> tyreData;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<_TouchedPosition> touched = <_TouchedPosition>[
      for (final String position in positions)
        if (classifyEntry(tyreData[position]).state != TyreSlotState.blank)
          _TouchedPosition(position, classifyEntry(tyreData[position])),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Center(
          child: VehicleTyreDiagram(
            vehicleType: vehicleType,
            assetNo: assetNo,
            positions: positions,
            tyreData: tyreData,
            width: MediaQuery.sizeOf(context).width - (TpSpace.lg * 4),
          ),
        ),
        if (touched.isNotEmpty) ...[
          const SizedBox(height: TpSpace.md),
          for (final _TouchedPosition t in touched)
            _PositionSummaryRow(
              position: t.position,
              classification: t.classification,
            ),
        ],
        if (touched.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: TpSpace.sm),
            child: Text(
              l10n.inspectionApprovalNoTyreConditions,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}

class _TouchedPosition {
  const _TouchedPosition(this.position, this.classification);

  final String position;
  final EntryClassification classification;
}

class _PositionSummaryRow extends StatelessWidget {
  const _PositionSummaryRow({
    required this.position,
    required this.classification,
  });

  final String position;
  final EntryClassification classification;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TyreCondition condition = normaliseCondition(
      classification.condition,
    );
    final String? pressureText = _pressureText(classification.pressure);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: <Widget>[
          SizedBox(
            width: 64,
            child: TpIdentifierText(
              position,
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          Expanded(
            child: Text(
              tyreConditionLabel(l10n, condition),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          if (pressureText != null)
            Text(
              l10n.tyreDiagramPressureDetail(pressureText),
              style: Theme.of(context).textTheme.bodySmall,
            ),
        ],
      ),
    );
  }

  static String? _pressureText(Object? raw) {
    if (raw == null) return null;
    if (raw is num) {
      return raw == raw.roundToDouble()
          ? raw.toInt().toString()
          : raw.toString();
    }
    final String s = raw.toString().trim();
    return s.isEmpty ? null : s;
  }
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
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: palette.textMuted),
                  ),
                ),
              if (approvedAt != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    approvedAt,
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: palette.textMuted),
                  ),
                ),
              const SizedBox(height: TpSpace.md),
              Text(
                l10n.inspectionApprovalApproverSignatureLabel,
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: TpSpace.sm),
              if (item.approverSignature != null &&
                  item.approverSignature!.isNotEmpty)
                Image.memory(
                  _decodeSignatureDataUrl(item.approverSignature!),
                  height: 110,
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stack) => Text(
                    l10n.inspectionSignatureMissing,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                )
              else
                Text(
                  l10n.inspectionSignatureMissing,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// "Approved by <name>" / "Returned by <name>", or `null` when
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
    required this.onApprove,
    required this.onReturn,
  });

  final String? approverName;
  final InspectionApprovalSignatureCapture? approverSignature;
  final TextEditingController noteController;
  final _DecisionBusy? busy;
  final ValueChanged<InspectionApprovalSignatureCapture?> onSignatureChanged;
  final VoidCallback onApprove;
  final VoidCallback onReturn;

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
        TpCard(
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
                    style: Theme.of(context).textTheme.bodySmall
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
        const SizedBox(height: TpSpace.lg),
        Row(
          children: <Widget>[
            Expanded(
              child: TpButton.danger(
                label: l10n.inspectionApprovalReturnButton,
                icon: Icons.undo_outlined,
                isBusy: busy == _DecisionBusy.rejecting,
                onPressed: isBusy ? null : onReturn,
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: TpButton.primary(
                label: l10n.inspectionApprovalApproveButton,
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
