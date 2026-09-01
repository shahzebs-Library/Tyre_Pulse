/// A focused camera scanner that returns an asset code to the form that
/// opened it.
///
/// Unlike [ScannerScreen], this surface does not navigate away from an
/// in-progress form. It unwraps the same JSON/URL/bare-code payloads through
/// [extractScanCode] and pops the canonical code back to the caller. Meter,
/// washing and checklist forms therefore share one camera implementation and
/// cannot drift into decorative QR buttons that do nothing.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_payload.dart';
import 'package:tyre_pulse/features/scanning/presentation/camera_access.dart';

Future<String?> showAssetCameraScanner(BuildContext context) {
  return showDialog<String>(
    context: context,
    useSafeArea: false,
    builder: (BuildContext context) => const _AssetCameraScannerDialog(),
  );
}

class _AssetCameraScannerDialog extends ConsumerStatefulWidget {
  const _AssetCameraScannerDialog();

  @override
  ConsumerState<_AssetCameraScannerDialog> createState() =>
      _AssetCameraScannerDialogState();
}

class _AssetCameraScannerDialogState
    extends ConsumerState<_AssetCameraScannerDialog> {
  late final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    autoZoom: true,
  );
  bool _accepted = false;

  @override
  void dispose() {
    unawaited(_controller.dispose());
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_accepted) return;
    for (final Barcode barcode in capture.barcodes) {
      final String code = extractScanCode(barcode.rawValue ?? '');
      if (code.isEmpty) continue;
      _accepted = true;
      Navigator.of(context).pop(code);
      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final CameraAccess access = ref.watch(cameraAccessProvider);

    return Material(
      color: palette.surface,
      child: SafeArea(
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: TpSpace.sm,
                vertical: TpSpace.xs,
              ),
              child: Row(
                children: <Widget>[
                  IconButton(
                    tooltip: l10n.actionClose,
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                  Expanded(
                    child: Text(
                      l10n.scannerTitle,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  const SizedBox(width: TpSizing.minTouchTarget),
                ],
              ),
            ),
            Expanded(
              child: switch (access) {
                CameraAccessDenied(reason: final String reason) =>
                  TpPermissionDeniedState(reason: reason),
                CameraUnavailableInThisBuild() => TpStateView(
                    icon: Icons.no_photography_outlined,
                    tone: TpStatus.warning,
                    title: l10n.scannerCameraUnavailableTitle,
                    message: l10n.scannerCameraUnavailableMessage,
                  ),
                CameraAccessGranted() => Stack(
                    fit: StackFit.expand,
                    children: <Widget>[
                      MobileScanner(
                        key: AssetCameraScannerKeys.preview,
                        controller: _controller,
                        onDetect: _onDetect,
                        errorBuilder: (
                          BuildContext context,
                          MobileScannerException error,
                        ) {
                          if (error.errorCode ==
                              MobileScannerErrorCode.permissionDenied) {
                            return TpPermissionDeniedState(
                              reason:
                                  l10n.scannerCameraPermissionDeniedReason,
                            );
                          }
                          return TpStateView(
                            icon: Icons.no_photography_outlined,
                            tone: TpStatus.warning,
                            title: l10n.scannerCameraUnavailableTitle,
                            message: l10n.scannerCameraUnavailableMessage,
                          );
                        },
                      ),
                      IgnorePointer(
                        child: Center(
                          child: Container(
                            width: 250,
                            height: 250,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(TpRadius.lg),
                              border: Border.all(
                                color: palette.onPrimary,
                                width: TpBorderWidth.strong,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
              },
            ),
            Padding(
              padding: const EdgeInsets.all(TpSpace.lg),
              child: Text(
                l10n.scannerCodeFieldHint,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

abstract final class AssetCameraScannerKeys {
  static const ValueKey<String> preview =
      ValueKey<String>('assetCameraScanner.preview');
}
