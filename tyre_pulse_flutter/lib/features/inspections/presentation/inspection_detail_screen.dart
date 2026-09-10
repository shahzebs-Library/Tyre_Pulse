/// Read-only detail for ONE inspection - whichever of the two places it
/// might live: still sitting in this device's own submission queue, or
/// already a confirmed `inspections` row on the server.
///
/// [InspectionDetailRoute.inspectionId] carries either id transparently:
/// a queued entry's client-generated idempotency key, or a synced row's
/// server id. [_load] tries the queue first (cheap, local, and the only
/// place a `failed`/`pending` item's live status can be read from) and
/// falls back to the remote repository - the same "local truth first"
/// preference [InspectionWizardController.resumeOrStart] already applies
/// to drafts.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/reporting/inspection_report_pdf.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/inspection_signature_pad.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_detail_screen.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';
import 'package:tyre_pulse/features/tyres/presentation/serial_search_deps.dart';

/// One shape both sources ([QueuedInspection] and [InspectionRecord]) are
/// normalised into, so the render half of this screen does not need to
/// branch on where the data came from more than once.
@immutable
class _InspectionView {
  const _InspectionView({
    required this.id,
    required this.assetNo,
    required this.vehicleType,
    required this.site,
    required this.inspector,
    required this.inspectionDate,
    required this.status,
    required this.tyreConditions,
    this.approvalStatus,
    this.notes,
    this.findings,
    this.odometerKm,
    this.hourMeter,
    this.signature,
    this.gpsLat,
    this.gpsLng,
    this.gpsAccuracy,
    this.isLocalOnly = false,
    this.queueStatus,
    this.queueError,
  });

  factory _InspectionView.fromQueued(QueuedInspection q) {
    final InspectionPayload p = q.payload;
    return _InspectionView(
      id: q.id,
      assetNo: p.assetNo,
      vehicleType: p.vehicleType,
      site: p.site,
      inspector: p.inspector,
      inspectionDate: p.inspectionDate,
      status: p.status,
      tyreConditions: p.tyreConditions,
      approvalStatus: p.approvalStatus,
      notes: p.notes,
      findings: p.findings,
      odometerKm: p.odometerKm,
      hourMeter: p.hourMeter,
      signature: p.inspectorSignature,
      gpsLat: p.gpsFix?.latitude,
      gpsLng: p.gpsFix?.longitude,
      gpsAccuracy: p.gpsFix?.accuracyMeters,
      isLocalOnly: true,
      queueStatus: q.status,
      queueError: q.error,
    );
  }

  factory _InspectionView.fromRecord(InspectionRecord r) {
    final DateTime? parsedDate = DateTime.tryParse(r.inspectionDate);
    return _InspectionView(
      id: r.id,
      assetNo: r.assetNo,
      vehicleType: r.vehicleType,
      site: r.site,
      inspector: r.inspector,
      inspectionDate: parsedDate ?? DateTime.now(),
      status: r.status,
      tyreConditions: r.typedTyreConditions(),
      approvalStatus: r.approvalStatus,
      notes: r.notes,
      findings: r.findings,
      odometerKm: r.odometerKm,
      hourMeter: r.hourMeter,
      signature: r.inspectorSignature,
      gpsLat: r.gpsLat,
      gpsLng: r.gpsLng,
      gpsAccuracy: r.gpsAccuracy,
    );
  }

  final String id;
  final String assetNo;
  final String vehicleType;
  final String site;
  final String inspector;
  final DateTime inspectionDate;
  final String status;
  final Map<String, TyrePositionReading> tyreConditions;
  final String? approvalStatus;
  final String? notes;
  final String? findings;
  final int? odometerKm;
  final double? hourMeter;
  final String? signature;
  final double? gpsLat;
  final double? gpsLng;
  final double? gpsAccuracy;

  /// True when this view was built from the on-device queue rather than
  /// a confirmed server row.
  final bool isLocalOnly;
  final InspectionQueueStatus? queueStatus;
  final String? queueError;

  bool get hasGps => gpsLat != null && gpsLng != null;
}

class InspectionDetailScreen extends ConsumerStatefulWidget {
  const InspectionDetailScreen({required this.route, super.key});

  final InspectionDetailRoute route;

  @override
  ConsumerState<InspectionDetailScreen> createState() =>
      _InspectionDetailScreenState();
}

class _InspectionDetailScreenState
    extends ConsumerState<InspectionDetailScreen> {
  bool _didStartInitialLoad = false;
  bool _loading = true;
  AppError? _error;
  _InspectionView? _view;
  bool _isRetrying = false;
  bool _isSharing = false;
  Map<String, TyreFitment> _installedTyres = const <String, TyreFitment>{};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_didStartInitialLoad) return;
    _didStartInitialLoad = true;
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final String id = widget.route.inspectionId.value;
    try {
      final QueuedInspection? queued =
          await ref.read(inspectionSubmissionQueueProvider).byId(id);
      if (queued != null) {
        final Map<String, TyreFitment> installed =
            await _loadInstalledTyres(_InspectionView.fromQueued(queued));
        if (!mounted) return;
        setState(() {
          _view = _InspectionView.fromQueued(queued);
          _installedTyres = installed;
          _loading = false;
        });
        return;
      }

      final InspectionRecord? record =
          await ref.read(inspectionRemoteRepositoryProvider).byId(id);
      final _InspectionView? nextView =
          record == null ? null : _InspectionView.fromRecord(record);
      final Map<String, TyreFitment> installed = nextView == null
          ? const <String, TyreFitment>{}
          : await _loadInstalledTyres(nextView);
      if (!mounted) return;
      setState(() {
        _view = nextView;
        _installedTyres = installed;
        _loading = false;
      });
    } on Object {
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      setState(() {
        _error = AppError(
          kind: AppErrorKind.unknown,
          message: l10n.inspectionDetailLoadErrorMessage,
          technical: 'InspectionDetailScreen._load failed',
          isRetryable: true,
        );
        _loading = false;
      });
    }
  }

  Future<Map<String, TyreFitment>> _loadInstalledTyres(
    _InspectionView view,
  ) async {
    if (view.assetNo.trim().isEmpty) return const <String, TyreFitment>{};
    try {
      final fitments =
          await ref.read(tyreFitmentRepositoryProvider).activeForAsset(
                assetNo: view.assetNo,
                country: ref.read(workspaceContextProvider)?.activeCountry,
              );
      return fitmentsByInspectionSlot(
        vehicleType: view.vehicleType,
        assetNo: view.assetNo,
        fitments: fitments,
      );
    } on Object {
      // The historical inspection remains fully readable and shareable. The
      // report labels current fitment identity as unavailable instead of
      // substituting the inspection's old serial or exposing a backend error.
      return const <String, TyreFitment>{};
    }
  }

  Future<void> _shareReport() async {
    final _InspectionView? view = _view;
    if (view == null || _isSharing) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() => _isSharing = true);
    try {
      await shareInspectionReportPdf(
        InspectionReportData(
          id: view.id,
          assetNo: view.assetNo,
          vehicleType: view.vehicleType,
          site: view.site,
          inspector: view.inspector,
          inspectionDate: view.inspectionDate,
          status: view.status,
          approvalStatus: view.approvalStatus,
          odometerKm: view.odometerKm,
          hourMeter: view.hourMeter,
          notes: view.notes,
          findings: view.findings,
          gpsLat: view.gpsLat,
          gpsLng: view.gpsLng,
          tyreConditions: <String, Map<String, Object?>>{
            for (final entry in view.tyreConditions.entries)
              entry.key: entry.value.toEntry(),
          },
          installedTyres: _installedTyres,
        ),
        _reportCopy(
          l10n,
          rtl: Directionality.of(context) == TextDirection.rtl,
        ),
      );
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.inspectionReportShareFailedMessage)),
      );
    } finally {
      if (mounted) setState(() => _isSharing = false);
    }
  }

  Future<void> _retry() async {
    setState(() => _isRetrying = true);
    try {
      await ref.read(inspectionSyncEngineProvider).flushQueue();
    } on Object {
      // Best-effort - the queue entry's own status (re-read below) already
      // says whether it is still pending, failed again, or gone because it
      // finally synced. Nothing further to report here.
    } finally {
      if (mounted) {
        setState(() => _isRetrying = false);
      }
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.inspectionDetailTitle,
        backFallback: fallback,
        actions: _view == null
            ? null
            : <Widget>[
                IconButton(
                  key: const Key('inspection-detail-share-pdf'),
                  tooltip: l10n.inspectionReportShareAction,
                  onPressed: _isSharing ? null : _shareReport,
                  icon: _isSharing
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.picture_as_pdf_outlined),
                ),
              ],
      ),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(error: _error!, onRetry: _load);
    }
    final _InspectionView? view = _view;
    if (view == null) {
      return TpEmptyState(
        title: l10n.inspectionNotFoundTitle,
        message: l10n.inspectionNotFoundMessage,
      );
    }
    return _DetailBody(view: view, isRetrying: _isRetrying, onRetry: _retry);
  }
}

InspectionReportCopy _reportCopy(
  AppLocalizations l10n, {
  required bool rtl,
}) {
  return InspectionReportCopy(
    title: l10n.inspectionReportTitle,
    asset: l10n.serialSearchAsset,
    vehicleType: l10n.vehiclesFieldType,
    site: l10n.serialSearchSite,
    date: l10n.inspectionReportDate,
    inspector: l10n.inspectionReportInspector,
    status: l10n.inspectionReportStatus,
    odometer: l10n.inspectionOdometerLabel,
    hourMeter: l10n.inspectionHourMeterLabel,
    location: l10n.inspectionGpsSectionTitle,
    summary: l10n.inspectionReportSummaryTitle,
    layout: l10n.inspectionReportLayoutTitle,
    readings: l10n.inspectionReportReadingsTitle,
    position: l10n.serialSearchPosition,
    currentFitment: l10n.inspectionReportCurrentFitment,
    condition: l10n.inspectionConditionLabel,
    pressure: l10n.inspectionPressureShort,
    tread: l10n.inspectionTreadDepthShort,
    notes: l10n.inspectionNotesLabel,
    notRecorded: l10n.inspectionNotRecordedYet,
    notAvailable: l10n.inspectionReportNotAvailable,
    observations: l10n.inspectionObservationsLabel,
    generated: l10n.inspectionReportGenerated,
    good: l10n.tyreConditionGood,
    worn: l10n.tyreConditionWorn,
    critical: l10n.statusCritical,
    rtl: rtl,
  );
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({
    required this.view,
    required this.isRetrying,
    required this.onRetry,
  });

  final _InspectionView view;
  final bool isRetrying;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final List<String> positions = diagramPositions(
      view.vehicleType,
      view.assetNo,
    );

    return ListView(
      padding: const EdgeInsets.all(TpSpace.lg),
      children: <Widget>[
        if (view.isLocalOnly)
          _QueueBanner(view: view, onRetry: onRetry, isRetrying: isRetrying),
        TpCard(
          margin: const EdgeInsets.only(bottom: TpSpace.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      view.assetNo,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                  ),
                  TpStatusChip(
                    status: _statusTone(view.status),
                    label: view.status.isEmpty
                        ? l10n.inspectionStatusUnknown
                        : view.status,
                  ),
                ],
              ),
              Text(view.vehicleType),
              const SizedBox(height: TpSpace.sm),
              _InfoRow(icon: Icons.place_outlined, text: view.site),
              _InfoRow(
                icon: Icons.person_outline,
                text: view.inspector.isEmpty
                    ? l10n.inspectionInspectorUnknown
                    : view.inspector,
              ),
              _InfoRow(
                icon: Icons.event_outlined,
                text: _formatDate(view.inspectionDate),
              ),
              if (view.approvalStatus != null)
                Padding(
                  padding: const EdgeInsets.only(top: TpSpace.sm),
                  child: TpStatusChip(
                    status: _approvalTone(view.approvalStatus!),
                    label: view.approvalStatus!,
                    isCompact: true,
                  ),
                ),
            ],
          ),
        ),
        if ((view.odometerKm != null) || (view.hourMeter != null))
          TpCard(
            margin: const EdgeInsets.only(bottom: TpSpace.lg),
            child: Row(
              children: <Widget>[
                if (view.odometerKm != null)
                  Expanded(
                    child: _MetricTile(
                      label: l10n.inspectionOdometerLabel,
                      value: '${view.odometerKm} km',
                    ),
                  ),
                if (view.hourMeter != null)
                  Expanded(
                    child: _MetricTile(
                      label: l10n.inspectionHourMeterLabel,
                      value: '${view.hourMeter} h',
                    ),
                  ),
              ],
            ),
          ),
        Text(
          l10n.inspectionTyrePositionsTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        TyreDiagramBoard(
          vehicleType: view.vehicleType,
          assetNo: view.assetNo,
          positions: positions,
          tyreData: <String, Map<String, Object?>>{
            for (final entry in view.tyreConditions.entries)
              entry.key: entry.value.toEntry(),
          },
          onPositionTap: (String position) => unawaited(
            pushTyreDetailScreen(
              context,
              positionCode: position,
              vehicleType: view.vehicleType,
              entry: view.tyreConditions[position]?.toEntry(),
              assetNo: view.assetNo,
              siteName: view.site,
              // This is a read, already-recorded inspection - there is no
              // live draft to write a corrected reading back into, so
              // "Adjust reading" renders honestly disabled on Take Action.
            ),
          ),
          width: MediaQuery.sizeOf(context).width - (TpSpace.lg * 2),
        ),
        if ((view.findings ?? view.notes ?? '').trim().isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.inspectionObservationsLabel,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          TpCard(child: Text((view.findings ?? view.notes ?? '').trim())),
        ],
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.inspectionInspectorSignatureLabel,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        if (view.signature != null && view.signature!.isNotEmpty)
          InspectionSignaturePad(
            value: view.signature,
            readOnly: true,
          )
        else
          Text(
            l10n.inspectionSignatureMissing,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: palette.textMuted),
          ),
        const SizedBox(height: TpSpace.lg),
        Text(
          l10n.inspectionGpsSectionTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        if (view.hasGps)
          TpCard(
            child: Text(
              l10n.inspectionGpsCoordinates(
                view.gpsLat!.toStringAsFixed(5),
                view.gpsLng!.toStringAsFixed(5),
              ),
            ),
          )
        else
          Text(
            l10n.inspectionGpsUnavailable,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: palette.textMuted),
          ),
      ],
    );
  }

  static String _formatDate(DateTime d) {
    final DateTime local = d.toLocal();
    final String y = local.year.toString().padLeft(4, '0');
    final String m = local.month.toString().padLeft(2, '0');
    final String day = local.day.toString().padLeft(2, '0');
    final String hh = local.hour.toString().padLeft(2, '0');
    final String mm = local.minute.toString().padLeft(2, '0');
    return '$y-$m-$day $hh:$mm';
  }

  static TpStatus _statusTone(String status) {
    final String s = status.toLowerCase();
    if (s.contains('done') || s.contains('complete')) return TpStatus.ok;
    if (s.contains('overdue') || s.contains('cancel')) {
      return TpStatus.critical;
    }
    if (s.contains('progress') || s.contains('pending')) {
      return TpStatus.info;
    }
    return TpStatus.neutral;
  }

  static TpStatus _approvalTone(String approval) {
    final String a = approval.toLowerCase();
    if (a.contains('approved')) return TpStatus.ok;
    if (a.contains('reject')) return TpStatus.critical;
    if (a.contains('pending')) return TpStatus.warning;
    return TpStatus.neutral;
  }
}

class _QueueBanner extends StatelessWidget {
  const _QueueBanner({
    required this.view,
    required this.onRetry,
    required this.isRetrying,
  });

  final _InspectionView view;
  final VoidCallback onRetry;
  final bool isRetrying;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool failed = view.queueStatus == InspectionQueueStatus.failed;
    final TpStatus tone = failed ? TpStatus.critical : TpStatus.info;
    final TpStatusColors colors = palette.forStatus(tone);

    return Container(
      margin: const EdgeInsets.only(bottom: TpSpace.lg),
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            failed ? Icons.error_outline : Icons.cloud_upload_outlined,
            color: colors.onSoft,
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  failed
                      ? l10n.inspectionQueueFailedLabel
                      : l10n.inspectionQueuePendingLabel,
                  style: Theme.of(context)
                      .textTheme
                      .labelLarge
                      ?.copyWith(color: colors.onSoft),
                ),
                if (failed && view.queueError != null)
                  Text(
                    view.queueError!,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: colors.onSoft),
                  ),
              ],
            ),
          ),
          TpButton.text(
            label: l10n.inspectionRetrySyncButton,
            isBusy: isRetrying,
            onPressed: isRetrying ? null : onRetry,
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        children: <Widget>[
          Icon(icon, size: TpSizing.iconSm),
          const SizedBox(width: TpSpace.xs),
          Text(text, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: Theme.of(context).textTheme.labelSmall),
        Text(value, style: Theme.of(context).textTheme.titleMedium),
      ],
    );
  }
}
