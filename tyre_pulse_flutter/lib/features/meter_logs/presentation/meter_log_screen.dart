/// Daily Meter Log entry screen.
///
/// Ported from `mobile/app/(app)/meter-logs.tsx` (`mobile/` is READ-ONLY
/// reference material - see `AGENTS.md` rule "Never edit them from this
/// project"). That screen's own file comment states the design; the parts
/// this port must preserve exactly:
///
/// For fleets without telematics, drivers record the actual meter reading
/// each day and photograph the gauge as proof. The odometer reading
/// advances `vehicle_fleet.current_km` via a server trigger (V213), so
/// "current km" stays real. The write is offline-safe (the offline command
/// queue). A live "last reading" panel warns on a rollback but never blocks
/// one (V340) - a genuine correction or a meter swap must never be lost.
///
/// # Two-step entry: fields here, photo + confirm on the review sheet
///
/// [_handleContinue] validates the asset and the odometer reading, shows a
/// confirmation dialog for a below-last reading or an implausible daily
/// jump, and only THEN opens `MeterLogReviewSheet` - the mandatory gauge
/// photo is captured there, not on this screen, mirroring the reference's
/// own `handleContinue` / review `Modal` split exactly.
///
/// # Asset scanning is a plain typed field, not a camera scanner - a
/// # disclosed, deliberate simplification
///
/// The reference screen embeds its own `expo-camera` barcode scanner
/// (`CameraView` inside a full-screen `Modal`) as an alternative way to
/// fill the asset field. This port does not reuse
/// `features/scanning/presentation/scanner_screen.dart` here: that screen
/// is a full ROUTE with its own navigation/result-return plumbing designed
/// around the scan-then-push-to-inspection flow (`scan_route_resolver
/// .dart`), and wiring it into a bottom-sheet-driven form would mean either
/// pushing a second route mid-form (crossing branches, which
/// `app_router.dart`'s own library comment names as the one rule this
/// application's router exists to prevent - "pushing into the inspect
/// branch instead would cross branches") or duplicating its camera/
/// permission machinery here. Given the task's own explicit authorisation
/// for exactly this trade-off, this screen instead offers a plain, debounced
/// asset text field with the SAME auto-fill-on-lookup behaviour the
/// reference achieves via scanning - `VehicleFleetRepository.byAssetNo` is
/// queried 350ms after the user stops typing, matching the reference's own
/// debounce window exactly. Typing a full asset number already works
/// identically either way; only the barcode CAMERA shortcut is not ported.
///
/// # Site auto-fill: only when not already set by the user
///
/// [_siteTouched] mirrors the reference's own `siteTouched` ref: it starts
/// `true` whenever the route carried an explicit site, or the workspace's
/// [WorkspaceContext.legacySite] pre-filled one, and flips `true` the
/// moment the driver edits the site field directly. While `false`, a
/// resolved asset's own site fills the field ONLY if it is still blank -
/// never overwriting a value the driver already set.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_reading.dart';
import 'package:tyre_pulse/features/meter_logs/meter_logs_providers.dart';
import 'package:tyre_pulse/features/meter_logs/presentation/widgets/meter_log_recent_sheet.dart';
import 'package:tyre_pulse/features/meter_logs/presentation/widgets/meter_log_review_sheet.dart';
import 'package:tyre_pulse/features/meter_logs/presentation/widgets/meter_log_signature_pad.dart';
import 'package:uuid/uuid.dart';

/// A same-day jump beyond this many km is almost certainly a typo, not a
/// shift's genuine distance. Mirrors `IMPLAUSIBLE_DAILY_KM` in
/// `mobile/app/(app)/meter-logs.tsx`.
const num _kImplausibleDailyKm = 2000;

const Duration _kLookupDebounce = Duration(milliseconds: 350);

class MeterLogScreen extends ConsumerStatefulWidget {
  const MeterLogScreen({required this.route, super.key});

  final MeterLogRoute route;

  @override
  ConsumerState<MeterLogScreen> createState() => _MeterLogScreenState();
}

class _MeterLogScreenState extends ConsumerState<MeterLogScreen> {
  static const Uuid _uuid = Uuid();

  final TextEditingController _assetController = TextEditingController();
  final TextEditingController _siteController = TextEditingController();
  final TextEditingController _odometerController = TextEditingController();
  final TextEditingController _engineHoursController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();

  bool _siteTouched = false;
  Timer? _lookupDebounce;
  LastOdometerReading? _last;
  bool _loadingLast = false;
  MeterLogSignatureCapture? _signature;
  bool _isProcessingContinue = false;

  late String _sessionKey;

  @override
  void initState() {
    super.initState();
    _sessionKey = _uuid.v4();

    final String? routeAsset = widget.route.assetNo?.value;
    if (routeAsset != null && routeAsset.trim().isNotEmpty) {
      _assetController.text = routeAsset.trim();
    }

    final String? routeSite = widget.route.siteName?.value;
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? legacySite = workspace?.legacySite?.trim();
    if (routeSite != null && routeSite.trim().isNotEmpty) {
      _siteController.text = routeSite.trim();
      _siteTouched = true;
    } else if (legacySite != null && legacySite.isNotEmpty) {
      _siteController.text = legacySite;
      _siteTouched = true;
    }

    _assetController.addListener(_onAssetChanged);
    if (_assetController.text.trim().isNotEmpty) {
      _onAssetChanged();
    }
  }

  @override
  void dispose() {
    _lookupDebounce?.cancel();
    _assetController.removeListener(_onAssetChanged);
    _assetController.dispose();
    _siteController.dispose();
    _odometerController.dispose();
    _engineHoursController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _onAssetChanged() {
    _lookupDebounce?.cancel();
    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      setState(() {
        _last = null;
        _loadingLast = false;
      });
      return;
    }
    setState(() => _loadingLast = true);
    _lookupDebounce = Timer(
      _kLookupDebounce,
      () => unawaited(_performLookup(asset)),
    );
  }

  Future<void> _performLookup(String asset) async {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);

    final LastOdometerReading? last = await ref
        .read(meterLogRepositoryProvider)
        .getLastOdometer(asset);
    final VehicleDetailOutcome assetOutcome = await ref
        .read(vehicleFleetRepositoryProvider)
        .byAssetNo(
          scope: vehicleCacheScopeFor(workspace),
          assetNo: asset,
          country: workspace?.activeCountry,
        );

    if (!mounted) return;
    // A stale response for an asset the driver has since changed away from
    // must never overwrite the panel or the site field for the CURRENT one.
    if (_assetController.text.trim() != asset) return;

    setState(() {
      _last = last;
      _loadingLast = false;
    });

    String? masterSite;
    if (assetOutcome is VehicleDetailLoaded) {
      masterSite = assetOutcome.asset.site;
    } else if (assetOutcome is VehicleDetailFromCache) {
      masterSite = assetOutcome.asset.site;
    }
    final String trimmedMasterSite = masterSite?.trim() ?? '';
    if (trimmedMasterSite.isNotEmpty &&
        !_siteTouched &&
        _siteController.text.trim().isEmpty) {
      _siteController.text = trimmedMasterSite;
    }
  }

  void _onSiteEdited(String _) {
    _siteTouched = true;
  }

  Future<void> _handleContinue() async {
    if (_isProcessingContinue) return;
    final AppLocalizations l10n = AppLocalizations.of(context);

    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      _showSnack(l10n.meterLogWorkspaceLoadingMessage);
      return;
    }

    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      await _showInfoDialog(
        title: l10n.meterLogAssetRequiredTitle,
        message: l10n.meterLogAssetRequiredMessage,
      );
      return;
    }

    final num? km = _parseNum(_odometerController.text);
    if (km == null) {
      await _showInfoDialog(
        title: l10n.meterLogReadingRequiredTitle,
        message: l10n.meterLogReadingRequiredMessage,
      );
      return;
    }
    if (km < 0) {
      await _showInfoDialog(
        title: l10n.meterLogInvalidReadingTitle,
        message: l10n.meterLogInvalidReadingMessage,
      );
      return;
    }

    final num? lastKm = _last?.odometerKm;
    final bool belowLast = lastKm != null && km < lastKm;
    final num? delta = lastKm != null ? km - lastKm : null;
    final bool bigJump = delta != null && delta > _kImplausibleDailyKm;

    setState(() => _isProcessingContinue = true);
    try {
      if (belowLast) {
        final bool proceed = await TpDialog.confirm(
          context: context,
          title: l10n.meterLogBelowLastTitle,
          message: l10n.meterLogBelowLastMessage(_formatKm(lastKm)),
          cancelLabel: l10n.meterLogRecheckAction,
          confirmLabel: l10n.meterLogSaveAndFlagAction,
        );
        if (!proceed) return;
      } else if (bigJump) {
        final bool proceed = await TpDialog.confirm(
          context: context,
          title: l10n.meterLogBigJumpTitle,
          message: l10n.meterLogBigJumpMessage(_formatKm(delta)),
          cancelLabel: l10n.meterLogRecheckAction,
          confirmLabel: l10n.meterLogLogAnywayAction,
        );
        if (!proceed) return;
      }

      if (!mounted) return;
      await _openReviewSheet(
        workspace: workspace,
        assetNo: asset,
        odometerKm: km,
        flaggedForReview: belowLast,
      );
    } finally {
      if (mounted) setState(() => _isProcessingContinue = false);
    }
  }

  Future<void> _openReviewSheet({
    required WorkspaceContext workspace,
    required String assetNo,
    required num odometerKm,
    required bool flaggedForReview,
  }) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final num? hours = _parseNum(_engineHoursController.text);
    final String site = _siteController.text.trim();
    final String notes = _notesController.text.trim();

    final MeterLogReviewSaved? saved =
        await TpBottomSheet.show<MeterLogReviewSaved>(
          context: context,
          title: l10n.meterLogReviewTitle,
          builder: (BuildContext sheetContext) => MeterLogReviewSheet(
            workspace: workspace,
            assetNo: assetNo,
            site: site.isEmpty ? null : site,
            country: workspace.activeCountry,
            odometerKm: odometerKm,
            engineHours: hours,
            notes: notes.isEmpty ? null : notes,
            signature: _signature,
            sessionKey: _sessionKey,
            flaggedForReview: flaggedForReview,
          ),
        );

    if (saved == null || !mounted) return;

    final AppLocalizations currentL10n = AppLocalizations.of(context);
    _showSnack(
      saved.flaggedForReview
          ? currentL10n.meterLogSavedAndFlaggedMessage
          : currentL10n.meterLogSavedMessage,
    );
    _resetForm();
  }

  void _resetForm() {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? legacySite = workspace?.legacySite?.trim();

    _lookupDebounce?.cancel();
    _assetController.clear();
    _siteController.text = (legacySite != null && legacySite.isNotEmpty)
        ? legacySite
        : '';
    _siteTouched = legacySite != null && legacySite.isNotEmpty;
    _odometerController.clear();
    _engineHoursController.clear();
    _notesController.clear();
    setState(() {
      _signature = null;
      _last = null;
      _loadingLast = false;
      _sessionKey = _uuid.v4();
    });
  }

  Future<void> _openRecentReadings() {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpBottomSheet.show<void>(
      context: context,
      title: l10n.meterLogRecentTitle,
      builder: (BuildContext sheetContext) => const MeterLogRecentSheet(),
    );
  }

  Future<void> _showInfoDialog({
    required String title,
    required String message,
  }) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: <Widget>[
          TpButton.primary(
            label: l10n.actionClose,
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
        ],
      ),
    );
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.meterLogNavTitle,
        subtitle: _todayLabel(),
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.history),
            tooltip: l10n.meterLogRecentTitle,
            onPressed: _openRecentReadings,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpInput(
                  label: l10n.meterLogAssetLabel,
                  controller: _assetController,
                  hint: l10n.meterLogAssetHint,
                  textCapitalization: TextCapitalization.characters,
                  isRequired: true,
                ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: l10n.meterLogSiteLabel,
                  controller: _siteController,
                  hint: l10n.meterLogSiteHint,
                  onChanged: _onSiteEdited,
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  l10n.meterLogSiteHelp,
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: TpPalette.of(context).textMuted),
                ),
              ],
            ),
          ),
          if (_assetController.text.trim().isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            _LastReadingPanel(loading: _loadingLast, last: _last),
          ],
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: TpInput(
              label: l10n.meterLogOdometerLabel,
              controller: _odometerController,
              hint: l10n.meterLogOdometerHint,
              isRequired: true,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpInput(
                  label: l10n.meterLogEngineHoursLabel,
                  controller: _engineHoursController,
                  hint: l10n.meterLogEngineHoursHint,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  inputFormatters: <TextInputFormatter>[
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                  ],
                  onChanged: (String _) => setState(() {}),
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  _engineHoursController.text.trim().isNotEmpty
                      ? l10n.meterLogEngineHoursHelpWithHours
                      : l10n.meterLogEngineHoursHelpWithoutHours,
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: TpPalette.of(context).textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: TpInput(
              label: l10n.meterLogNotesLabel,
              controller: _notesController,
              hint: l10n.meterLogNotesHint,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.meterLogSignatureLabel,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.sm),
                MeterLogSignaturePad(
                  value: _signature?.dataUrl,
                  onChanged: (MeterLogSignatureCapture? capture) {
                    setState(() => _signature = capture);
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.meterLogContinueAction,
            icon: Icons.arrow_forward,
            isBusy: _isProcessingContinue,
            isFullWidth: true,
            onPressed: _isProcessingContinue ? null : _handleContinue,
          ),
        ],
      ),
    );
  }

  static String _todayLabel() {
    final DateTime now = DateTime.now();
    final String y = now.year.toString().padLeft(4, '0');
    final String m = now.month.toString().padLeft(2, '0');
    final String d = now.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }
}

/// Parses a typed reading exactly like `Number(odometer)` in the reference:
/// blank is "not entered" (`null`), anything that does not parse is also
/// `null` (the reference's own `Number.isNaN` check), never zero-guessed.
num? _parseNum(String raw) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  return num.tryParse(trimmed);
}

/// Groups the integer part of [value] with thousands separators - `128000`
/// becomes `128,000` - keeping any decimal part verbatim. This feature's own
/// small copy of the technique `VehicleAsset.formatVehicleOdometer`
/// (`features/assets/domain/vehicle_asset.dart`) already applies to the
/// sibling `vehicle_fleet.current_km` column, kept separate rather than
/// imported across the top-level feature boundary - see
/// `meter_log_signature_pad.dart`'s own library comment for why sibling
/// top-level features do not share presentation/formatting code in this
/// port.
String _formatKm(num value) {
  final bool negative = value < 0;
  final num magnitude = negative ? -value : value;
  final String base = magnitude == magnitude.roundToDouble()
      ? magnitude.toInt().toString()
      : magnitude.toString();
  final int dot = base.indexOf('.');
  final String intPart = dot < 0 ? base : base.substring(0, dot);
  final String fractionPart = dot < 0 ? '' : base.substring(dot);

  final StringBuffer grouped = StringBuffer();
  for (int i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 == 0) {
      grouped.write(',');
    }
    grouped.write(intPart[i]);
  }
  return '${negative ? '-' : ''}$grouped$fractionPart';
}

class _LastReadingPanel extends StatelessWidget {
  const _LastReadingPanel({required this.loading, required this.last});

  final bool loading;
  final LastOdometerReading? last;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final num? km = last?.odometerKm;

    if (loading) {
      return TpCard(
        child: Row(
          children: <Widget>[
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: TpSpace.sm),
            Text(
              l10n.meterLogLastReadingChecking,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      );
    }

    if (km == null) {
      return TpCard(
        child: Row(
          children: <Widget>[
            Icon(Icons.help_outline, color: palette.textMuted),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                l10n.meterLogLastReadingUnknown,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ],
        ),
      );
    }

    return TpCard(
      background: palette.info.soft,
      borderColor: palette.info.base,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.speed_outlined, color: palette.info.base),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              l10n.meterLogLastReadingKnown(
                _formatKm(km),
                last?.readingDate ?? l10n.valueUnavailable,
              ),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: palette.info.onSoft,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
