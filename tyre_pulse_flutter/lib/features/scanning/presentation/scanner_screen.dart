/// The scanner screen: a live camera surface and -
/// always, regardless - a manual-entry field that resolves through the
/// identical chain a scan would.
///
/// Manual entry is therefore not a fallback bolted on for today's gap; it is
/// this feature's real, independent, always-available path. A scanned
/// payload and a typed code both resolve through the exact same
/// [ScannerController.submit] - see that file's own doc comment for why
/// that single entry point matters.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_route_resolver.dart';
import 'package:tyre_pulse/features/scanning/presentation/camera_access.dart';
import 'package:tyre_pulse/features/scanning/presentation/scanner_controller.dart';

/// Where Back goes when the scanner has no history of its own - reached from
/// a bar tap or a quick action, never a route this screen's own back
/// fallback table names, so [TpBackFallbacks.forRoute] resolves it to Home.
final String _scannerBackFallback = TpBackFallbacks.forRoute(
  const ScannerRoute(),
);

class ScannerScreen extends ConsumerStatefulWidget {
  const ScannerScreen({super.key});

  @override
  ConsumerState<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends ConsumerState<ScannerScreen> {
  final TextEditingController _codeController = TextEditingController();

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  void _submitField() {
    final String value = _codeController.text;
    if (value.trim().isEmpty) {
      return;
    }
    FocusScope.of(context).unfocus();
    // A fire-and-forget kick-off, not a swallowed failure: `submit` cannot
    // throw (see its own doc comment), and the RESULT it produces is read
    // back through `scannerControllerProvider`'s state, not through this
    // call's return value. `unawaited` says that on purpose, so
    // `unawaited_futures` (an analyzer ERROR in this project) does not read
    // this as a dropped failure.
    unawaited(ref.read(scannerControllerProvider.notifier).submit(value));
  }

  void _retry(String rawInput) {
    unawaited(ref.read(scannerControllerProvider.notifier).submit(rawInput));
  }

  void _reset() {
    _codeController.clear();
    ref.read(scannerControllerProvider.notifier).reset();
  }

  void _open(TpRoute route) {
    // A push, not a go: the scanner is a task's starting point, and popping
    // whatever this opens must return here, not replace this screen away.
    context.push(route.location);
  }

  @override
  Widget build(BuildContext context) {
    final ScannerState state = ref.watch(scannerControllerProvider);
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpScaffold(
      backFallback: _scannerBackFallback,
      appBar: TpAppBar(
        title: l10n.scannerTitle,
        backFallback: _scannerBackFallback,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const _CameraArea(),
            const SizedBox(height: TpSpace.xxl),
            _ManualEntrySection(
              controller: _codeController,
              isBusy: state is ScannerResolving,
              onSubmit: _submitField,
            ),
            if (state is ScannerResolved) ...<Widget>[
              const SizedBox(height: TpSpace.xl),
              _ResultSection(
                result: state.result,
                onOpen: _open,
                onUseAsset: (String assetNo) => context.pop(assetNo),
                onRetry: _retry,
                onLookUpAnother: _reset,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The area a live camera preview would occupy, or the honest explanation of
/// why it does not today.
class _CameraArea extends ConsumerWidget {
  const _CameraArea();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CameraAccess access = ref.watch(cameraAccessProvider);
    final ScannerState scannerState = ref.watch(scannerControllerProvider);

    return switch (access) {
      CameraAccessGranted() when scannerState is ScannerIdle =>
        const _LiveCameraScanner(),
      CameraAccessGranted() => const _CameraPausedNotice(),
      CameraAccessDenied(reason: final String reason) => SizedBox(
          height: 240,
          child: TpPermissionDeniedState(reason: reason),
        ),
      CameraUnavailableInThisBuild() => const _CameraUnavailableNotice(),
    };
  }
}

class _LiveCameraScanner extends ConsumerStatefulWidget {
  const _LiveCameraScanner();

  @override
  ConsumerState<_LiveCameraScanner> createState() => _LiveCameraScannerState();
}

class _LiveCameraScannerState extends ConsumerState<_LiveCameraScanner> {
  late final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    autoZoom: true,
  );

  bool _submitted = false;

  @override
  void dispose() {
    unawaited(_controller.dispose());
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_submitted) return;
    final String? code = firstScannedCode(capture);
    if (code == null) return;
    _submitted = true;
    unawaited(ref.read(scannerControllerProvider.notifier).submit(code));
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return ClipRRect(
      borderRadius: BorderRadius.circular(TpRadius.lg),
      child: SizedBox(
        height: 240,
        child: MobileScanner(
          key: ScannerScreenKeys.cameraPreview,
          controller: _controller,
          onDetect: _onDetect,
          errorBuilder: (BuildContext context, MobileScannerException error) {
            if (error.errorCode == MobileScannerErrorCode.permissionDenied) {
              return TpPermissionDeniedState(
                reason: l10n.scannerCameraPermissionDeniedReason,
              );
            }
            return const _CameraUnavailableNotice();
          },
        ),
      ),
    );
  }
}

class _CameraPausedNotice extends StatelessWidget {
  const _CameraPausedNotice();

  @override
  Widget build(BuildContext context) => const SizedBox(
        height: 240,
        child: Center(child: Icon(Icons.qr_code_2, size: TpSizing.iconState)),
      );
}

/// The honest "no scanning package in this build" notice.
///
/// Deliberately not [TpNotConfiguredState] (that state means an
/// administrator can turn this on for the organisation - a build gap is not
/// that) and not [TpScreenNotAvailableState] (that state replaces a whole
/// screen that has not been written - most of THIS screen, the manual-entry
/// path, has been). Reusing either would describe something that is not
/// actually true, so this is its own small, honest rendering instead,
/// built from the same design-system primitives.
class _CameraUnavailableNotice extends StatelessWidget {
  const _CameraUnavailableNotice();

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpCard(
      isDashed: true,
      padding: const EdgeInsets.all(TpSpace.xxl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Icon(
            Icons.qr_code_scanner,
            size: TpSizing.iconState,
            color: palette.unknown.base,
          ),
          const SizedBox(height: TpSpace.md),
          Text(
            l10n.scannerCameraUnavailableTitle,
            style: text.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            l10n.scannerCameraUnavailableMessage,
            style: text.bodyMedium,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _ManualEntrySection extends StatelessWidget {
  const _ManualEntrySection({
    required this.controller,
    required this.isBusy,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final bool isBusy;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          l10n.scannerManualEntryLabel,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        TpInput(
          label: l10n.scannerCodeFieldLabel,
          controller: controller,
          hint: l10n.scannerCodeFieldHint,
          textInputAction: TextInputAction.done,
          enabled: !isBusy,
          onSubmitted: (String _) => onSubmit(),
        ),
        const SizedBox(height: TpSpace.md),
        TpButton.primary(
          label: l10n.scannerLookUpAction,
          onPressed: isBusy ? null : onSubmit,
          isBusy: isBusy,
          isFullWidth: true,
          icon: Icons.search,
        ),
      ],
    );
  }
}

/// Renders whichever of the four [ScanLookupResult] shapes [result] is.
class _ResultSection extends StatelessWidget {
  const _ResultSection({
    required this.result,
    required this.onOpen,
    required this.onUseAsset,
    required this.onRetry,
    required this.onLookUpAnother,
  });

  final ScanLookupResult result;
  final ValueChanged<TpRoute> onOpen;
  final ValueChanged<String> onUseAsset;
  final ValueChanged<String> onRetry;
  final VoidCallback onLookUpAnother;

  @override
  Widget build(BuildContext context) {
    return switch (result) {
      AssetScanMatch() => _MatchCard(
          result: result,
          onOpen: onOpen,
          onUseAsset: onUseAsset,
          onLookUpAnother: onLookUpAnother,
        ),
      TyreScanMatch() => _MatchCard(
          result: result,
          onOpen: onOpen,
          onUseAsset: null,
          onLookUpAnother: onLookUpAnother,
        ),
      ScanNoMatch() => _NoMatchCard(result: result, onOpen: onOpen),
      ScanLookupFailed(error: final AppError error) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TpErrorState(error: error, onRetry: () => onRetry(result.rawInput)),
            const SizedBox(height: TpSpace.md),
            TpButton.text(
              label: AppLocalizations.of(context).scannerOpenSerialSearchAction,
              onPressed: () => onOpen(primaryRouteFor(result)),
              icon: Icons.search,
            ),
          ],
        ),
    };
  }
}

/// A matched asset or a matched tyre, with every action
/// `scan_route_resolver.dart` offers for it.
class _MatchCard extends StatelessWidget {
  const _MatchCard({
    required this.result,
    required this.onOpen,
    required this.onUseAsset,
    required this.onLookUpAnother,
  });

  final ScanLookupResult result;
  final ValueChanged<TpRoute> onOpen;
  final ValueChanged<String>? onUseAsset;
  final VoidCallback onLookUpAnother;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final List<ScanRouteAction> actions = actionsFor(result);
    final String? subtitle = _subtitleFor(result);

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(_iconFor(result), size: TpSizing.iconLg),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    TpIdentifierText(
                      _titleFor(result),
                      style: text.titleMedium,
                    ),
                    if (subtitle != null) Text(subtitle, style: text.bodySmall),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          if (result case AssetScanMatch(asset: final AssetLookupRecord asset))
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.sm),
              child: TpButton.primary(
                label: l10n.scannerUseAssetAction,
                onPressed: asset.assetNo.trim().isEmpty
                    ? null
                    : () => onUseAsset?.call(asset.assetNo),
                isFullWidth: true,
                icon: Icons.check_circle_outline_rounded,
              ),
            ),
          for (final ScanRouteAction action in actions)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.sm),
              child: TpButton.secondary(
                label: _labelFor(l10n, action.intent),
                onPressed: () => onOpen(action.route),
                isFullWidth: true,
              ),
            ),
          TpButton.text(
            label: l10n.scannerScanAnotherAction,
            onPressed: onLookUpAnother,
            icon: Icons.refresh,
          ),
        ],
      ),
    );
  }

  IconData _iconFor(ScanLookupResult result) => switch (result) {
        AssetScanMatch() => Icons.local_shipping_outlined,
        TyreScanMatch() => Icons.confirmation_number_outlined,
        _ => Icons.check_circle_outline,
      };

  String _titleFor(ScanLookupResult result) => switch (result) {
        AssetScanMatch(asset: final AssetLookupRecord asset) =>
          asset.assetNo.isEmpty ? result.code : asset.assetNo,
        _ => result.code,
      };

  String? _subtitleFor(ScanLookupResult result) => switch (result) {
        AssetScanMatch(asset: final AssetLookupRecord asset) => _joinNonBlank(
            <String?>[asset.vehicleType, asset.site],
          ),
        TyreScanMatch(tyre: final TyreLookupRecord tyre) =>
          _joinNonBlank(<String?>[
            tyre.brand,
            tyre.size,
            tyre.bestPosition,
          ]),
        _ => null,
      };

  String _labelFor(AppLocalizations l10n, ScanActionIntent intent) {
    return switch (intent) {
      ScanActionIntent.viewAsset => l10n.scannerViewAssetAction,
      ScanActionIntent.startInspection => l10n.scannerStartInspectionAction,
      ScanActionIntent.viewTyre => l10n.scannerViewTyreAction,
      ScanActionIntent.searchManually => l10n.scannerOpenSerialSearchAction,
    };
  }
}

/// A clean miss: nothing matched, so the manual-entry path this feature's
/// exit criterion requires is offered as an explicit action, on top of the
/// inline field already above it on the same screen.
class _NoMatchCard extends StatelessWidget {
  const _NoMatchCard({required this.result, required this.onOpen});

  final ScanLookupResult result;
  final ValueChanged<TpRoute> onOpen;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpEmptyState(
      icon: Icons.help_outline,
      title: l10n.scannerNoMatchTitle,
      message: l10n.scannerNoMatchMessage,
      actionLabel: l10n.scannerOpenSerialSearchAction,
      onAction: () => onOpen(primaryRouteFor(result)),
    );
  }
}

/// Joins the non-blank entries of [parts] with a plain separator, or returns
/// null when none of them carried anything - null, never an empty string,
/// so a caller can tell "nothing to show" from "an empty line to show".
String? _joinNonBlank(List<String?> parts) {
  final List<String> clean = parts
      .whereType<String>()
      .map((String value) => value.trim())
      .where((String value) => value.isNotEmpty)
      .toList();
  return clean.isEmpty ? null : clean.join(' - ');
}

/// Stable keys used by integration and accessibility tests.
abstract final class ScannerScreenKeys {
  static const ValueKey<String> cameraPreview =
      ValueKey<String>('scanner.cameraPreview');
}

/// Returns the first non-blank decoded value in a camera capture.
///
/// Kept pure so barcode selection is testable without starting a camera.
@visibleForTesting
String? firstScannedCode(BarcodeCapture capture) {
  for (final Barcode barcode in capture.barcodes) {
    final String? value = barcode.rawValue?.trim();
    if (value != null && value.isNotEmpty) return value;
  }
  return null;
}
