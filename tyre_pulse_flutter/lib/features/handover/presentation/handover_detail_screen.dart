/// One vehicle handover: the full field record plus the two-stage sign-off.
///
/// A supervisor signs the first rung and the fleet incharge the closing one; an
/// incharge-level signer closes both in one signature. Who may sign is computed
/// locally by `handover_approval.dart` to show or hide the sign-off bar, but the
/// server (`decide_handover_approval`) is the authority - this screen always
/// goes through that RPC, never a direct table write.
library;

import 'dart:async';

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
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/handover/data/handover_remote_repository.dart';
import 'package:tyre_pulse/features/handover/domain/handover_approval.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';
import 'package:tyre_pulse/features/handover/handover_providers.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_copy.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_pdf.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_ui.dart';
import 'package:tyre_pulse/features/handover/presentation/widgets/handover_photo_grid.dart';
import 'package:tyre_pulse/features/handover/presentation/widgets/handover_signature_pad.dart';

enum _DecisionBusy { approving, rejecting }

class HandoverDetailScreen extends ConsumerStatefulWidget {
  const HandoverDetailScreen({required this.route, super.key});

  final HandoverDetailRoute route;

  @override
  ConsumerState<HandoverDetailScreen> createState() =>
      _HandoverDetailScreenState();
}

class _HandoverDetailScreenState extends ConsumerState<HandoverDetailScreen> {
  bool _loading = true;
  AppError? _loadError;
  HandoverRecord? _record;
  String? _signerName;
  String? _signature;
  final TextEditingController _note = TextEditingController();
  _DecisionBusy? _busy;
  bool _sharing = false;
  int _loadGeneration = 0;

  String get _handoverId => widget.route.handoverId.value;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    unawaited(_loadSignerName());
  }

  @override
  void didUpdateWidget(covariant HandoverDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.route.handoverId.value == _handoverId) return;
    _record = null;
    _loadError = null;
    _loading = true;
    _signature = null;
    _busy = null;
    _note.clear();
    Future<void>.microtask(() {
      if (mounted) unawaited(_load());
    });
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final int generation = ++_loadGeneration;
    final String requestedId = _handoverId;
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final HandoverRecord? record =
          await ref.read(handoverRemoteRepositoryProvider).byId(requestedId);
      if (!mounted || generation != _loadGeneration || requestedId != _handoverId) {
        return;
      }
      setState(() {
        _record = record;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted || generation != _loadGeneration || requestedId != _handoverId) {
        return;
      }
      setState(() {
        _loadError = handoverAsAppError(
          error,
          AppLocalizations.of(context).handoverListLoadFailed,
        );
        _loading = false;
      });
    }
  }

  Future<void> _loadSignerName() async {
    final String userId = ref.read(workspaceContextProvider)?.userId ?? '';
    if (userId.isEmpty) return;
    final String? name =
        await ref.read(handoverRemoteRepositoryProvider).currentUserDisplayName(userId);
    if (!mounted) return;
    setState(() => _signerName = name);
  }

  bool get _canDecide {
    final HandoverRecord? record = _record;
    if (record == null) return false;
    final WorkspaceContext? ctx = ref.read(workspaceContextProvider);
    final bool isSuper = ctx?.isSuperAdmin ?? false;
    final String roleToken = ctx?.role.token ?? '';
    return canDecide(record.approval, roleToken, isSuperAdmin: isSuper);
  }

  bool get _isPending {
    final String? status = _record?.approvalStatus;
    return status == 'pending_supervisor' || status == 'pending_incharge';
  }

  Future<void> _decide(bool approved) async {
    final HandoverRecord? record = _record;
    if (record == null || _busy != null) return;
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (approved) {
      if (_signature == null || _signature!.trim().isEmpty) {
        await showHandoverInfoDialog(
          context,
          title: l10n.handoverSignNeededTitle,
          message: l10n.handoverSignNeededMessage,
        );
        return;
      }
    } else if (_note.text.trim().isEmpty) {
      await showHandoverInfoDialog(
        context,
        title: l10n.handoverReasonNeededTitle,
        message: l10n.handoverReasonNeededMessage,
      );
      return;
    }

    setState(() => _busy = approved ? _DecisionBusy.approving : _DecisionBusy.rejecting);
    try {
      final String note = _note.text.trim();
      await ref.read(handoverRemoteRepositoryProvider).decide(
            HandoverDecision(
              handoverId: record.id,
              approved: approved,
              signatureDataUrl: approved ? _signature : null,
              note: note.isEmpty ? null : note,
            ),
          );
      ref
        ..invalidate(pendingHandoversProvider)
        ..invalidate(myHandoversProvider);
      setState(() => _signature = null);
      _note.clear();
      await _load();
      if (!mounted) return;

      final bool goToList = await TpDialog.confirm(
        context: context,
        title: approved ? l10n.handoverSignedTitle : l10n.handoverReturnedTitle,
        message:
            approved ? l10n.handoverSignedMessage : l10n.handoverReturnedMessage,
        cancelLabel: l10n.handoverStayHere,
        confirmLabel: l10n.handoverBackToList,
      );
      if (mounted && goToList) {
        TpBack.pop(context, fallback: TpBackFallbacks.forRoute(widget.route));
      }
    } on Object catch (error) {
      if (!mounted) return;
      final AppError appError =
          handoverAsAppError(error, l10n.handoverSignFailedMessage);
      await showHandoverInfoDialog(
        context,
        title: l10n.handoverSignFailedTitle,
        message: appError.message,
      );
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _share() async {
    final HandoverRecord? record = _record;
    if (record == null || _sharing) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() => _sharing = true);
    try {
      final HandoverShareResult result =
          await shareHandoverPdf(record: record, l10n: l10n);
      if (!mounted) return;
      if (result == HandoverShareResult.failed) {
        await showHandoverInfoDialog(
          context,
          title: l10n.handoverDetailTitle,
          message: l10n.handoverPdfShareFailed,
        );
      }
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final HandoverRecord? record = _record;
    final String title = record == null
        ? l10n.handoverDetailTitle
        : (record.assetNo.isNotEmpty ? record.assetNo : l10n.handoverDetailTitle);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: title,
        backFallback: fallback,
        actions: <Widget>[
          if (record != null)
            IconButton(
              tooltip: l10n.handoverSharePdf,
              onPressed: _sharing ? null : () => unawaited(_share()),
              icon: _sharing
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.ios_share),
            ),
        ],
      ),
      bottomNavigationBar: (record != null && _isPending && _canDecide)
          ? _DecisionActionBar(
              busy: _busy,
              onApprove: () => unawaited(_decide(true)),
              onReturn: () => unawaited(_decide(false)),
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
    final HandoverRecord? record = _record;
    if (record == null) {
      return TpEmptyState(
        icon: Icons.help_outline,
        title: l10n.handoverNotFoundTitle,
        message: l10n.handoverNotFoundMessage,
      );
    }
    return _DetailBody(
      record: record,
      canDecide: _isPending && _canDecide,
      signerName: _signerName,
      signature: _signature,
      note: _note,
      busy: _busy,
      onSignatureChanged: (String? s) => setState(() => _signature = s),
    );
  }
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({
    required this.record,
    required this.canDecide,
    required this.signerName,
    required this.signature,
    required this.note,
    required this.busy,
    required this.onSignatureChanged,
  });

  final HandoverRecord record;
  final bool canDecide;
  final String? signerName;
  final String? signature;
  final TextEditingController note;
  final _DecisionBusy? busy;
  final ValueChanged<String?> onSignatureChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxl,
      ),
      children: <Widget>[
        _SummaryCard(record: record),
        const SizedBox(height: TpSpace.lg),
        _MetaCard(record: record),
        if (record.damages.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Text(
            '${l10n.handoverDamageSectionTitle} (${record.effectiveDamageCount})',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          for (final HandoverDamageMarker m in record.damages)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.sm),
              child: _DamageCard(marker: m),
            ),
        ],
        if (record.photos.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Text(
            '${l10n.handoverPhotosLabel} (${record.photos.length})',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          HandoverPhotoGrid(references: record.photos),
        ],
        if ((record.notes ?? '').trim().isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.handoverNotesLabel,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          TpCard(child: Text(record.notes!.trim())),
        ],
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.handoverSignatureLabel,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        HandoverSignaturePreview(
          value: record.signatureUrl,
          fallback: Text(
            l10n.handoverSignatureMissing,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.handoverSignoffTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        _SignoffLadder(record: record),
        if ((record.reviewNote ?? '').trim().isNotEmpty &&
            record.approvalStatus == 'rejected') ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          TpCard(
            background: TpPalette.of(context).forStatus(TpStatus.critical).soft,
            borderColor: TpPalette.of(context).forStatus(TpStatus.critical).base,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.handoverReviewNoteLabel,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(height: TpSpace.xs),
                Text(record.reviewNote!.trim()),
              ],
            ),
          ),
        ],
        if (canDecide) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          _DecisionForm(
            signerName: signerName,
            signature: signature,
            note: note,
            busy: busy,
            onSignatureChanged: onSignatureChanged,
          ),
        ],
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.record});

  final HandoverRecord record;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String typeLabel = record.handoverType == null
        ? l10n.handoverNavTitle
        : handoverTypeLabel(l10n, record.handoverType!);
    return TpCard(
      background: palette.primarySoft,
      borderColor: palette.primary.withValues(alpha: 0.28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.primary,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: SizedBox.square(
                  dimension: 48,
                  child: Icon(Icons.swap_horiz, color: palette.onPrimary),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    TpIdentifierText(
                      record.assetNo.isEmpty ? '-' : record.assetNo,
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    Text(typeLabel, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              TpStatusChip(
                status: handoverStatusTone(record.approvalStatus),
                label: handoverStatusText(l10n, record.approvalStatus),
                isCompact: true,
              ),
            ],
          ),
          if (record.documentNo != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              '${l10n.handoverDocumentNoLabel}: ${record.documentNo}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: palette.textMuted),
            ),
          ],
        ],
      ),
    );
  }
}

class _MetaCard extends StatelessWidget {
  const _MetaCard({required this.record});

  final HandoverRecord record;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<(String, String)> rows = <(String, String)>[
      if ((record.fromDriver ?? '').trim().isNotEmpty)
        (l10n.handoverFromDriverLabel, record.fromDriver!.trim()),
      if ((record.toDriver ?? '').trim().isNotEmpty)
        (l10n.handoverToDriverLabel, record.toDriver!.trim()),
      if (record.odometerKm != null)
        (l10n.handoverOdometerLabel, '${_num(record.odometerKm!)} km'),
      if (record.fuelLevelPct != null)
        (l10n.handoverFuelLabel, '${_num(record.fuelLevelPct!)}%'),
      if (record.conditionRating != null)
        (
          l10n.handoverConditionLabel,
          handoverConditionLabel(l10n, record.conditionRating!),
        ),
      if (record.cleanliness != null)
        (
          l10n.handoverCleanlinessLabel,
          handoverCleanlinessLabel(l10n, record.cleanliness!),
        ),
      (
        l10n.handoverCapturedLabel,
        formatHandoverDateTime(record.handoverAt ?? record.createdAt) ??
            l10n.valueUnavailable,
      ),
    ];
    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (int i = 0; i < rows.length; i++) ...<Widget>[
            if (i > 0) const Divider(height: TpSpace.lg),
            _MetaRow(label: rows[i].$1, value: rows[i].$2),
          ],
        ],
      ),
    );
  }

  static String _num(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();
}

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          flex: 2,
          child: Text(
            label,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: palette.textMuted),
          ),
        ),
        const SizedBox(width: TpSpace.md),
        Expanded(
          flex: 3,
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ],
    );
  }
}

class _DamageCard extends StatelessWidget {
  const _DamageCard({required this.marker});

  final HandoverDamageMarker marker;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '${handoverDamageViewLabel(l10n, marker.view)} - '
                  '${handoverDamageTypeLabel(l10n, marker.type)}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              TpStatusChip(
                status: handoverDamageLevelTone(marker.level),
                label: handoverDamageLevelLabel(l10n, marker.level),
                isCompact: true,
              ),
            ],
          ),
          if (marker.note != null && marker.note!.trim().isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              marker.note!.trim(),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          if (marker.photoUrl != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            SizedBox(
              height: 120,
              child: HandoverPhotoGrid(references: <String>[marker.photoUrl!]),
            ),
          ],
        ],
      ),
    );
  }
}

class _SignoffLadder extends StatelessWidget {
  const _SignoffLadder({required this.record});

  final HandoverRecord record;

  @override
  Widget build(BuildContext context) {
    final List<HandoverRung> rungs = approvalProgress(record.approval);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (int i = 0; i < rungs.length; i++)
          Padding(
            padding: EdgeInsets.only(bottom: i == rungs.length - 1 ? 0 : TpSpace.sm),
            child: _RungTile(rung: rungs[i]),
          ),
      ],
    );
  }
}

class _RungTile extends StatelessWidget {
  const _RungTile({required this.rung});

  final HandoverRung rung;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TpStatus tone = rung.done
        ? TpStatus.ok
        : rung.current
            ? TpStatus.warning
            : TpStatus.neutral;
    final TpStatusColors colors = palette.forStatus(tone);
    final String label = rung.key == HandoverStage.supervisor
        ? l10n.handoverRungSupervisor
        : l10n.handoverRungIncharge;
    final String state = rung.done
        ? l10n.handoverRungSigned
        : rung.current
            ? l10n.handoverRungWaiting
            : l10n.handoverRungPending;
    final String? at = formatHandoverDateTime(rung.at);

    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      borderColor: rung.current ? colors.base : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            rung.done
                ? Icons.check_circle
                : rung.current
                    ? Icons.hourglass_top
                    : Icons.radio_button_unchecked,
            color: colors.base,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(label, style: Theme.of(context).textTheme.titleSmall),
                if (rung.name != null && rung.name!.trim().isNotEmpty)
                  Text(
                    rung.name!.trim(),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                if (at != null)
                  Text(
                    at,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: palette.textMuted),
                  ),
              ],
            ),
          ),
          TpStatusChip(status: tone, label: state, isCompact: true),
        ],
      ),
    );
  }
}

class _DecisionForm extends StatelessWidget {
  const _DecisionForm({
    required this.signerName,
    required this.signature,
    required this.note,
    required this.busy,
    required this.onSignatureChanged,
  });

  final String? signerName;
  final String? signature;
  final TextEditingController note;
  final _DecisionBusy? busy;
  final ValueChanged<String?> onSignatureChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool isBusy = busy != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          l10n.handoverYourDecisionTitle,
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
                  l10n.handoverSignatureSignLabel,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(height: TpSpace.sm),
                HandoverSignaturePad(
                  onChanged: onSignatureChanged,
                  height: 170,
                ),
                if (signerName != null && signerName!.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: TpSpace.sm),
                    child: Row(
                      children: <Widget>[
                        Text(
                          '${l10n.handoverSigningAs} ',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: TpPalette.of(context).textMuted),
                        ),
                        Flexible(
                          child: Text(
                            TpDirection.isolateLtr(signerName!.trim()),
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(color: TpPalette.of(context).textMuted),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: l10n.handoverSignNoteLabel,
                  controller: note,
                  hint: l10n.handoverSignNoteHint,
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

class _DecisionActionBar extends StatelessWidget {
  const _DecisionActionBar({
    required this.busy,
    required this.onApprove,
    required this.onReturn,
  });

  final _DecisionBusy? busy;
  final VoidCallback onApprove;
  final VoidCallback onReturn;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final Color critical = palette.forStatus(TpStatus.critical).base;
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
          child: Row(
            children: <Widget>[
              Expanded(
                child: SizedBox(
                  height: 52,
                  child: OutlinedButton.icon(
                    onPressed: isBusy ? null : onReturn,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: critical,
                      side: BorderSide(
                        color: isBusy ? palette.border : critical,
                        width: 1.5,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(TpRadius.md),
                      ),
                    ),
                    icon: busy == _DecisionBusy.rejecting
                        ? SizedBox(
                            width: TpSizing.iconSm,
                            height: TpSizing.iconSm,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: critical,
                            ),
                          )
                        : const Icon(Icons.undo_outlined),
                    label: Text(l10n.handoverSignReturn),
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: TpButton.primary(
                  label: l10n.handoverSignApprove,
                  icon: Icons.check_circle_outline,
                  isBusy: busy == _DecisionBusy.approving,
                  onPressed: isBusy ? null : onApprove,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
