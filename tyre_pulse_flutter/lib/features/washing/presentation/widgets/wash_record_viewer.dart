/// A saved wash record, laid out for an auditor.
///
/// Read-only by design: the phone offers no edit. Drivers cannot update
/// `wash_records` at all (the UPDATE policy admits Admin, Manager and
/// Director only), and corrections are made on the web, where every change
/// is kept by the `wash_changes_audit` trigger. The screen says so at the
/// top so nobody looks for an edit button.
///
/// The one action offered is a supervisor's verification, through the
/// `verify_wash_record` RPC (server-stamped, never by the person who logged
/// the wash). A supervisor's own entry needs no check and says so.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/data/wash_repository.dart';
import 'package:tyre_pulse/features/washing/domain/wash_areas.dart';
import 'package:tyre_pulse/features/washing/domain/wash_details.dart';
import 'package:tyre_pulse/features/washing/domain/wash_evidence.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_area_grid.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_vehicle_views.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';

class WashRecordViewer extends ConsumerStatefulWidget {
  const WashRecordViewer({required this.wash, this.onVerified, super.key});
  final WashRecord wash;

  /// Called after a successful verification so a list can reload.
  final VoidCallback? onVerified;

  static const ValueKey<String> readOnlyNote =
      ValueKey<String>('washing.viewer.readOnly');
  static const ValueKey<String> recordId =
      ValueKey<String>('washing.viewer.recordId');
  static const ValueKey<String> verification =
      ValueKey<String>('washing.viewer.verification');
  static const ValueKey<String> verifyAction =
      ValueKey<String>('washing.viewer.verify');

  @override
  ConsumerState<WashRecordViewer> createState() => _WashRecordViewerState();
}

class _WashRecordViewerState extends ConsumerState<WashRecordViewer> {
  final TextEditingController _note = TextEditingController();
  bool _busy = false;
  bool _verifiedHere = false;
  String? _error;

  WashRecord get wash => widget.wash;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    final AppLocalizations l = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(washRepositoryProvider).verifyWash(
            wash.id,
            note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          );
      if (!mounted) return;
      setState(() => _verifiedHere = true);
      widget.onVerified?.call();
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l.washVerifyDone)));
    } on Object {
      if (!mounted) return;
      setState(() => _error = l.washVerifyFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    Widget detail(String title, String? value, {Key? key}) => ListTile(
          key: key,
          dense: true,
          contentPadding: EdgeInsets.zero,
          title: Text(title),
          subtitle:
              Text(value?.isNotEmpty == true ? value! : l.washNotRecorded),
        );
    Widget heading(String title) => Padding(
          padding: const EdgeInsets.only(top: TpSpace.md, bottom: TpSpace.xs),
          child: Text(title, style: text.titleMedium),
        );

    final shots = washShotsFromRecord(wash.photos, wash.washDetails);
    Widget photoGroup(String title, bool Function(WashShot?) keep) {
      final group = <({String ref, WashShot? shot})>[
        for (final s in shots)
          if (keep(s.shot)) s,
      ];
      if (group.isEmpty) return const SizedBox.shrink();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: text.labelLarge),
          const SizedBox(height: TpSpace.xs),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (final s in group)
                SizedBox(
                  width: 120,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      ClipRRect(
                        borderRadius: BorderRadius.circular(TpRadius.sm),
                        child: SizedBox(
                          width: 120,
                          height: 90,
                          child: ref
                              .watch(privateStorageImageUrlProvider(s.ref))
                              .when(
                                data: (url) => Image.network(
                                  url,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) =>
                                      const Icon(Icons.broken_image_outlined),
                                ),
                                error: (_, __) =>
                                    const Icon(Icons.broken_image_outlined),
                                loading: () => const Center(
                                  child: CircularProgressIndicator(),
                                ),
                              ),
                        ),
                      ),
                      Text(
                        s.shot == null
                            ? l.washNotRecorded
                            : l.washPhotoStamp(
                                washStampTime(s.shot!.takenAt),
                                s.shot!.hasGps
                                    ? washGpsLabel(s.shot!)
                                    : l.washGpsNone,
                              ),
                        style: text.labelSmall
                            ?.copyWith(color: palette.textSecondary),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text('${l.washViewRecord} · ${wash.assetNo}')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Container(
              key: WashRecordViewer.readOnlyNote,
              padding: const EdgeInsets.all(TpSpace.sm),
              decoration: BoxDecoration(
                color: palette.info.soft,
                borderRadius: BorderRadius.circular(TpRadius.md),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(
                    Icons.lock_rounded,
                    size: 18,
                    color: palette.info.onSoft,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      l.washReadOnlyNote,
                      style:
                          text.bodySmall?.copyWith(color: palette.info.onSoft),
                    ),
                  ),
                ],
              ),
            ),
            heading(l.washAuditTitle),
            detail(
              l.washRecordIdLabel,
              wash.id,
              key: WashRecordViewer.recordId,
            ),
            detail(
              l.washAssetLabel,
              <String?>[wash.assetNo, wash.vehicleType]
                  .whereType<String>()
                  .join(' · '),
            ),
            detail(l.washSiteLabel, wash.site),
            detail(
              l.washEnteredByLabel,
              wash.entryName ?? wash.entryUsername ?? wash.washedBy,
            ),
            detail(
              l.washDateLabel,
              <String?>[wash.washDate, wash.washTime]
                  .whereType<String>()
                  .join(' '),
            ),
            detail(l.washCapturedOnDevice, wash.capturedAt),
            detail(l.washReceivedAt, wash.createdAt),
            detail(l.washTypeLabel, wash.washType),
            detail(
              l.washViewsTitle,
              washViewsFromDetails(wash.washDetails)
                  .map((v) => washViewName(l, v))
                  .join(', '),
            ),
            detail(
              l.washAreasLabel,
              washAreasFromDetails(wash.washDetails)
                  .map((a) => washAreaName(l, a))
                  .join(', '),
            ),
            detail(l.washCostLabel, l.washCostNoCharge),
            detail(l.washStatusLabel, wash.status),
            if (wash.nextWashDue != null)
              ListTile(
                key: const ValueKey<String>('washing.viewer.nextDue'),
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.event_repeat_rounded),
                title: Text(l.washNextDue(wash.nextWashDue!)),
              ),
            _verificationBlock(context),
            heading(l.washPhotosLabel),
            if (shots.isEmpty) Text(l.washNotRecorded),
            photoGroup(
              l.washPhotosBefore,
              (s) => s?.stage == WashShotStage.before,
            ),
            photoGroup(
              l.washPhotosAfter,
              (s) => s?.stage == WashShotStage.after,
            ),
            photoGroup(l.washPhotosLabel, (s) => s == null),
            heading(l.washChemicalUseLabel),
            if (detailItems(wash.washDetails, 'chemicals').isEmpty)
              Text(
                wash.washDetails?['chemical_status'] == 'none'
                    ? l.washNoChemical
                    : l.washNotRecorded,
              ),
            for (final c in detailItems(wash.washDetails, 'chemicals'))
              detail(
                c['name'] as String? ?? '',
                ['manufacturer', 'quantity', 'unit', 'dilution', 'sds_url']
                    .map((k) => c[k] as String? ?? '')
                    .where((s) => s.isNotEmpty)
                    .join(' · '),
              ),
            heading(l.washChecklistTitle),
            if (detailItems(wash.washDetails, 'checklist').isEmpty)
              Text(l.washNotRecorded),
            for (final c in detailItems(wash.washDetails, 'checklist'))
              detail(
                washCheckLabel(l, c['label'] as String? ?? ''),
                [
                  washResultLabels(l)[c['result']] ?? l.washNotChecked,
                  c['note'] as String? ?? '',
                ].where((s) => s.isNotEmpty).join(' · '),
              ),
            if (wash.notes != null) detail(l.washNotesLabel, wash.notes),
          ],
        ),
      ),
    );
  }

  static String _stamp(String? iso) {
    final DateTime? t = DateTime.tryParse(iso ?? '');
    return t == null ? (iso ?? '') : washStampTime(t);
  }

  Widget _verificationBlock(BuildContext context) {
    final AppLocalizations l = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final WorkspaceContext? me = ref.watch(workspaceContextProvider);
    final String? status = _verifiedHere ? 'verified' : wash.verificationStatus;
    final String line = switch (status) {
      'pending' => l.washVerificationPending,
      'verified' => _verifiedHere
          ? l.washVerifyDone
          : l.washVerificationVerified(
              wash.verifiedByName ?? l.washNotRecorded,
              _stamp(wash.verifiedAt),
            ),
      'not_required' => l.washVerificationNotRequired,
      _ => l.washVerificationUnknown,
    };
    final bool isCreator = me != null && me.userId == wash.createdBy;
    final bool canVerify = status == 'pending' &&
        me != null &&
        !isCreator &&
        (me.isSuperAdmin ||
            isWashVerifierRole(me.role.rawValue) ||
            isWashVerifierRole(me.role.displayName));
    final Color tone = switch (status) {
      'pending' => palette.warning.base,
      'verified' || 'not_required' => palette.ok.base,
      _ => palette.textMuted,
    };
    return Container(
      key: WashRecordViewer.verification,
      margin: const EdgeInsets.only(top: TpSpace.sm),
      padding: const EdgeInsets.all(TpSpace.sm),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: tone),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(l.washVerificationLabel, style: text.labelLarge),
          const SizedBox(height: 2),
          Text(
            line,
            style: text.bodyMedium?.copyWith(
              color: tone,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (wash.verificationNote != null &&
              status == 'verified' &&
              !_verifiedHere)
            Text(wash.verificationNote!, style: text.bodySmall),
          if (status == 'pending' && isCreator)
            Padding(
              padding: const EdgeInsets.only(top: TpSpace.xs),
              child: Text(
                l.washVerifyOwnEntry,
                style: text.bodySmall?.copyWith(color: palette.textSecondary),
              ),
            ),
          if (canVerify) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            TextField(
              controller: _note,
              maxLength: 500,
              decoration: InputDecoration(
                labelText: l.washVerifyNoteHint,
                isDense: true,
              ),
            ),
            if (_error != null)
              Text(
                _error!,
                style: text.bodySmall?.copyWith(color: palette.critical.base),
              ),
            const SizedBox(height: TpSpace.xs),
            FilledButton.icon(
              key: WashRecordViewer.verifyAction,
              onPressed: _busy ? null : _verify,
              icon: _busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.verified_rounded),
              label: Text(l.washVerifyAction),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
