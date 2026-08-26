/// The meter-log review + photo + confirm step.
///
/// Ported from the review [Modal] in `mobile/app/(app)/meter-logs.tsx`: a
/// summary of what is about to be saved, the mandatory odometer gauge
/// photo, the optional engine-hour gauge photo (shown only when an hours
/// reading was entered), and a "Save Reading" action that stays disabled
/// until the odometer photo exists - mirroring that screen's own
/// `disabled={submitting || !odoPhoto.find(Boolean)}` exactly. Presented as
/// a bottom sheet rather than a route, per `tp_bottom_sheet.dart`'s own
/// rule against promoting an in-page modal - this is a genuinely separate
/// [ConsumerStatefulWidget] (not a plain builder closure) precisely so it
/// can read providers and own its own capture/submit state while mounted
/// inside `showModalBottomSheet`'s subtree, which still sits below the
/// application's [ProviderScope].
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_log_photo_capture.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_log_repository.dart';
import 'package:tyre_pulse/features/meter_logs/meter_logs_providers.dart';
import 'package:tyre_pulse/features/meter_logs/presentation/widgets/meter_log_photo_slot.dart';
import 'package:tyre_pulse/features/meter_logs/presentation/widgets/meter_log_signature_pad.dart';

/// What the parent screen does once the sheet has actually saved something.
final class MeterLogReviewSaved {
  const MeterLogReviewSaved({required this.flaggedForReview});

  /// Whether the confirm step preceding this sheet already told the driver
  /// this reading is below the last one - carried through purely so the
  /// success message on the MAIN screen can word itself correctly, never
  /// re-derived here.
  final bool flaggedForReview;
}

class MeterLogReviewSheet extends ConsumerStatefulWidget {
  const MeterLogReviewSheet({
    required this.workspace,
    required this.assetNo,
    required this.site,
    required this.country,
    required this.odometerKm,
    required this.engineHours,
    required this.notes,
    required this.signature,
    required this.sessionKey,
    required this.flaggedForReview,
    super.key,
  });

  final WorkspaceContext workspace;
  final String assetNo;
  final String? site;
  final String? country;
  final num odometerKm;
  final num? engineHours;
  final String? notes;
  final MeterLogSignatureCapture? signature;

  /// Keys the durable photo folder for this fill session - see
  /// `meter_log_photo_capture.dart`'s own library comment for why this is a
  /// per-session key rather than a persisted, resumable draft id.
  final String sessionKey;

  final bool flaggedForReview;

  @override
  ConsumerState<MeterLogReviewSheet> createState() =>
      _MeterLogReviewSheetState();
}

class _MeterLogReviewSheetState extends ConsumerState<MeterLogReviewSheet> {
  String? _odometerPhotoPath;
  String? _hoursPhotoPath;
  bool _capturingOdometerPhoto = false;
  bool _capturingHoursPhoto = false;
  bool _submitting = false;

  Future<void> _captureOdometerPhoto(MeterLogPhotoSource source) async {
    setState(() => _capturingOdometerPhoto = true);
    try {
      final CapturedMeterLogPhoto? photo =
          await ref.read(meterLogPhotoCaptureProvider).captureAndStore(
                sessionKey: widget.sessionKey,
                slot: 'odometer',
                source: source,
              );
      if (!mounted) return;
      if (photo != null) {
        setState(() => _odometerPhotoPath = photo.localPath);
      }
    } finally {
      if (mounted) setState(() => _capturingOdometerPhoto = false);
    }
  }

  Future<void> _captureHoursPhoto(MeterLogPhotoSource source) async {
    setState(() => _capturingHoursPhoto = true);
    try {
      final CapturedMeterLogPhoto? photo =
          await ref.read(meterLogPhotoCaptureProvider).captureAndStore(
                sessionKey: widget.sessionKey,
                slot: 'hours',
                source: source,
              );
      if (!mounted) return;
      if (photo != null) {
        setState(() => _hoursPhotoPath = photo.localPath);
      }
    } finally {
      if (mounted) setState(() => _capturingHoursPhoto = false);
    }
  }

  Future<void> _confirmSave() async {
    if (_submitting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (_odometerPhotoPath == null) {
      await showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) => AlertDialog(
          title: Text(l10n.meterLogPhotoRequiredTitle),
          content: Text(l10n.meterLogPhotoRequiredMessage),
          actions: <Widget>[
            TpButton.primary(
              label: l10n.actionClose,
              onPressed: () => Navigator.of(dialogContext).pop(),
            ),
          ],
        ),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref.read(meterLogRepositoryProvider).submitMeterReading(
            workspace: widget.workspace,
            input: SubmitMeterLogInput(
              assetNo: widget.assetNo,
              odometerKm: widget.odometerKm,
              site: widget.site,
              country: widget.country,
              odometerPhotoLocalPath: _odometerPhotoPath,
              engineHours: widget.engineHours,
              hoursPhotoLocalPath: _hoursPhotoPath,
              notes: widget.notes,
              signatureDataUrl: widget.signature?.dataUrl,
            ),
          );
      if (!mounted) return;
      Navigator.of(context)
          .pop(MeterLogReviewSaved(flaggedForReview: widget.flaggedForReview));
    } on Object {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l10n.meterLogTryAgainFallback)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool showHours = widget.engineHours != null;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                _SummaryRow(
                  label: l10n.meterLogAssetLabel,
                  value: widget.assetNo,
                ),
                if (widget.site != null && widget.site!.trim().isNotEmpty)
                  _SummaryRow(
                    label: l10n.meterLogSiteLabel,
                    value: widget.site!,
                  ),
                _SummaryRow(
                  label: l10n.meterLogOdometerLabel,
                  value: widget.odometerKm.toString(),
                ),
                if (showHours)
                  _SummaryRow(
                    label: l10n.meterLogEngineHoursLabel,
                    value: widget.engineHours.toString(),
                  ),
              ],
            ),
          ),
          if (widget.flaggedForReview) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpCard(
              borderColor: palette.warning.base,
              background: palette.warning.soft,
              child: Row(
                children: <Widget>[
                  Icon(Icons.flag_outlined, color: palette.warning.base),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      l10n.meterLogFlaggedNote,
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: palette.warning.onSoft),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          MeterLogPhotoSlot(
            label: l10n.meterLogPhotographGaugeLabel,
            localPath: _odometerPhotoPath,
            isCapturing: _capturingOdometerPhoto,
            onCapture: _captureOdometerPhoto,
            cameraLabel: l10n.meterLogPhotoCamera,
            galleryLabel: l10n.meterLogPhotoGallery,
            noneLabel: l10n.meterLogPhotoNone,
          ),
          if (showHours) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            MeterLogPhotoSlot(
              label: l10n.meterLogEngineHoursLabel,
              localPath: _hoursPhotoPath,
              isCapturing: _capturingHoursPhoto,
              onCapture: _captureHoursPhoto,
              cameraLabel: l10n.meterLogPhotoCamera,
              galleryLabel: l10n.meterLogPhotoGallery,
              noneLabel: l10n.meterLogPhotoNone,
            ),
          ],
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.meterLogSaveReadingAction,
            icon: Icons.check_circle_outline,
            isBusy: _submitting,
            isFullWidth: true,
            onPressed: _submitting ? null : _confirmSave,
          ),
          const SizedBox(height: TpSpace.lg),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.labelMedium),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}
