/// "Sign in on a computer": scan the QR the web sign-in page shows, confirm,
/// and approve (or decline) it from this already signed-in phone.
///
/// Reached from Profile (every signed-in role) and from the global scanner,
/// which hands any `tyrepulse://qr-login` payload here instead of looking it
/// up as an asset code. Opened with [openQrLogin] (a pushed page, the same
/// way "Report a problem" is opened) - `routes.dart` is one of the seven
/// wiring files agents may not edit, so this flow adds no route.
///
/// The decision is ONLINE ONLY (see `qr_login_repository.dart`): a code lasts
/// two minutes and a queued approval would sign a browser in long after the
/// person stopped looking at it.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/qr_login/domain/qr_login.dart';
import 'package:tyre_pulse/features/qr_login/qr_login_providers.dart';
import 'package:tyre_pulse/features/scanning/presentation/camera_access.dart';

/// Opens the flow. When [initialPayload] is given (the global scanner already
/// read a sign-in code), the camera step is skipped and the person goes
/// straight to the confirmation.
Future<void> openQrLogin(BuildContext context, {String? initialPayload}) {
  return Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (BuildContext _) =>
          QrLoginScreen(initialPayload: initialPayload),
    ),
  );
}

/// Stable finders for tests.
abstract final class QrLoginKeys {
  static const ValueKey<String> camera = ValueKey<String>('qrLogin.camera');
  static const ValueKey<String> confirmSheet =
      ValueKey<String>('qrLogin.confirmSheet');
  static const ValueKey<String> approve = ValueKey<String>('qrLogin.approve');
  static const ValueKey<String> cancel = ValueKey<String>('qrLogin.cancel');
  static const ValueKey<String> waiting = ValueKey<String>('qrLogin.waiting');
  static const ValueKey<String> sending = ValueKey<String>('qrLogin.sending');
  static const ValueKey<String> result = ValueKey<String>('qrLogin.result');
}

/// Where the flow is.
sealed class _Phase {
  const _Phase();
}

final class _Scanning extends _Phase {
  const _Scanning();
}

final class _NotACode extends _Phase {
  const _NotACode();
}

final class _Confirming extends _Phase {
  const _Confirming();
}

final class _Sending extends _Phase {
  const _Sending();
}

final class _Done extends _Phase {
  const _Done(this.outcome);

  final QrLoginOutcome outcome;
}

class QrLoginScreen extends ConsumerStatefulWidget {
  const QrLoginScreen({this.initialPayload, super.key});

  final String? initialPayload;

  @override
  ConsumerState<QrLoginScreen> createState() => _QrLoginScreenState();
}

class _QrLoginScreenState extends ConsumerState<QrLoginScreen> {
  late _Phase _phase =
      widget.initialPayload == null ? const _Scanning() : const _Confirming();

  /// True while one payload is being handled, so a second detection or a
  /// double tap can never send two decisions for one scan.
  bool _handling = false;

  @override
  void initState() {
    super.initState();
    final String? initial = widget.initialPayload;
    if (initial != null) {
      // After the first frame: the sheet needs a mounted context.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_handlePayload(initial));
      });
    }
  }

  String _personName(AppLocalizations l10n) =>
      ref.read(qrLoginPersonNameProvider) ?? l10n.qrLoginYourAccount;

  Future<void> _handlePayload(String raw) async {
    if (_handling) return;
    _handling = true;
    try {
      await _decide(raw);
    } finally {
      _handling = false;
    }
  }

  Future<void> _decide(String raw) async {
    final ({String id, String secret})? code = parseQrLoginPayload(raw);
    if (code == null) {
      setState(() => _phase = const _NotACode());
      return;
    }
    setState(() => _phase = const _Confirming());
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool? answer = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext sheetContext) => QrLoginConfirmSheet(
        personName: _personName(l10n),
        onApprove: () => Navigator.of(sheetContext).pop(true),
        onCancel: () => Navigator.of(sheetContext).pop(false),
      ),
    );
    if (!mounted) return;
    // Dismissing the sheet is a decline too: the code is spent either way,
    // so nobody else can approve it while the person looks away.
    final bool approve = answer ?? false;
    setState(() => _phase = const _Sending());
    final QrLoginOutcome outcome = await ref
        .read(qrLoginRepositoryProvider)
        .decide(id: code.id, secret: code.secret, approve: approve);
    if (!mounted) return;
    setState(() => _phase = _Done(outcome));
  }

  void _scanAgain() => setState(() => _phase = const _Scanning());

  void _close() => unawaited(Navigator.of(context).maybePop());

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final _Phase phase = _phase;
    return TpScaffold(
      appBar: TpAppBar(title: l10n.qrLoginAction, onBack: _close),
      body: SafeArea(
        top: false,
        child: switch (phase) {
          _Scanning() => _ScanStep(onPayload: _handlePayload),
          _NotACode() => TpStateView(
              key: QrLoginKeys.result,
              icon: Icons.qr_code_2_rounded,
              tone: TpStatus.warning,
              title: l10n.qrLoginNotACodeTitle,
              message: l10n.qrLoginNotACodeMessage,
              primaryActionLabel: l10n.qrLoginScanAgain,
              onPrimaryAction: _scanAgain,
              secondaryActionLabel: l10n.actionClose,
              onSecondaryAction: _close,
            ),
          _Confirming() => TpStateView(
              // Not a spinner: nothing is in flight until the person answers
              // the sheet in front of this.
              key: QrLoginKeys.waiting,
              icon: Icons.computer_rounded,
              tone: TpStatus.info,
              title: l10n.qrLoginWaiting,
              message: l10n.qrLoginConfirmTitle,
            ),
          _Sending() => TpLoadingState(
              key: QrLoginKeys.sending,
              message: l10n.qrLoginSending,
            ),
          _Done(:final QrLoginOutcome outcome) => QrLoginResultView(
              outcome: outcome,
              onScanAgain: _scanAgain,
              onClose: _close,
            ),
        },
      ),
    );
  }
}

/// The camera step. Any readable QR is handed up; [parseQrLoginPayload]
/// decides whether it is a sign-in code.
class _ScanStep extends ConsumerStatefulWidget {
  const _ScanStep({required this.onPayload});

  final Future<void> Function(String raw) onPayload;

  @override
  ConsumerState<_ScanStep> createState() => _ScanStepState();
}

class _ScanStepState extends ConsumerState<_ScanStep> {
  late final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const <BarcodeFormat>[BarcodeFormat.qrCode],
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
      final String value = (barcode.rawValue ?? '').trim();
      if (value.isEmpty) continue;
      _accepted = true;
      unawaited(widget.onPayload(value));
      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final CameraAccess access = ref.watch(cameraAccessProvider);

    final Widget camera = switch (access) {
      CameraAccessDenied(reason: final String reason) =>
        TpPermissionDeniedState(reason: reason),
      CameraUnavailableInThisBuild() => TpStateView(
          icon: Icons.no_photography_outlined,
          tone: TpStatus.warning,
          title: l10n.scannerCameraUnavailableTitle,
          message: l10n.scannerCameraUnavailableMessage,
        ),
      CameraAccessGranted() => ClipRRect(
          borderRadius: BorderRadius.circular(TpRadius.lg),
          child: Stack(
            fit: StackFit.expand,
            children: <Widget>[
              MobileScanner(
                key: QrLoginKeys.camera,
                controller: _controller,
                onDetect: _onDetect,
                errorBuilder: (
                  BuildContext context,
                  MobileScannerException error,
                ) {
                  if (error.errorCode ==
                      MobileScannerErrorCode.permissionDenied) {
                    return TpPermissionDeniedState(
                      reason: l10n.scannerCameraPermissionDeniedReason,
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
                    width: 220,
                    height: 220,
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
        ),
    };

    return Padding(
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            l10n.qrLoginScanIntro,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: TpSpace.lg),
          Expanded(child: camera),
        ],
      ),
    );
  }
}

/// The confirmation shown before anything is sent. Public so the widget
/// test can render it on its own.
class QrLoginConfirmSheet extends StatelessWidget {
  const QrLoginConfirmSheet({
    required this.personName,
    required this.onApprove,
    required this.onCancel,
    super.key,
  });

  final String personName;
  final VoidCallback onApprove;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      key: QrLoginKeys.confirmSheet,
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Icon(
            Icons.computer_rounded,
            size: TpSizing.iconState,
            color: palette.info.base,
          ),
          const SizedBox(height: TpSpace.md),
          Text(
            l10n.qrLoginConfirmTitle,
            style: text.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: TpSpace.sm),
          // The name is isolated so a Latin name stays in order inside an
          // Arabic or Urdu sentence.
          Text(
            l10n.qrLoginConfirmMessage('\u2068$personName\u2069'),
            style: text.bodyMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            key: QrLoginKeys.approve,
            label: l10n.qrLoginApprove,
            icon: Icons.check_rounded,
            isFullWidth: true,
            onPressed: onApprove,
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.secondary(
            key: QrLoginKeys.cancel,
            label: l10n.actionCancel,
            isFullWidth: true,
            onPressed: onCancel,
          ),
        ],
      ),
    );
  }
}

/// The plain-English ending: signed in, declined, or why not.
class QrLoginResultView extends StatelessWidget {
  const QrLoginResultView({
    required this.outcome,
    required this.onScanAgain,
    required this.onClose,
    super.key,
  });

  final QrLoginOutcome outcome;
  final VoidCallback onScanAgain;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return switch (outcome) {
      QrLoginDecided(approved: true) => TpStateView(
          key: QrLoginKeys.result,
          icon: Icons.check_circle_outline_rounded,
          tone: TpStatus.ok,
          title: l10n.qrLoginApprovedTitle,
          message: l10n.qrLoginApprovedMessage,
          primaryActionLabel: l10n.actionClose,
          onPrimaryAction: onClose,
        ),
      QrLoginDecided(approved: false) => TpStateView(
          key: QrLoginKeys.result,
          icon: Icons.block_rounded,
          tone: TpStatus.neutral,
          title: l10n.qrLoginDeclinedTitle,
          message: l10n.qrLoginDeclinedMessage,
          primaryActionLabel: l10n.actionClose,
          onPrimaryAction: onClose,
          secondaryActionLabel: l10n.qrLoginScanAgain,
          onSecondaryAction: onScanAgain,
        ),
      QrLoginRefused(:final QrLoginFailure reason) => TpStateView(
          key: QrLoginKeys.result,
          icon: reason == QrLoginFailure.needsSignal
              ? Icons.signal_cellular_off_rounded
              : reason == QrLoginFailure.expired
                  ? Icons.timer_off_outlined
                  : Icons.error_outline_rounded,
          tone: reason == QrLoginFailure.expired ||
                  reason == QrLoginFailure.needsSignal
              ? TpStatus.warning
              : TpStatus.critical,
          title: l10n.qrLoginFailedTitle,
          message: qrLoginFailureText(l10n, reason),
          primaryActionLabel: l10n.qrLoginScanAgain,
          onPrimaryAction: onScanAgain,
          secondaryActionLabel: l10n.actionClose,
          onSecondaryAction: onClose,
        ),
    };
  }
}

/// The sentence for each failure.
String qrLoginFailureText(AppLocalizations l10n, QrLoginFailure reason) {
  return switch (reason) {
    QrLoginFailure.invalid => l10n.qrLoginInvalid,
    QrLoginFailure.expired => l10n.qrLoginExpired,
    QrLoginFailure.consumed => l10n.qrLoginConsumed,
    QrLoginFailure.alreadyApproved ||
    QrLoginFailure.alreadyDenied =>
      l10n.qrLoginAlreadyDecided,
    QrLoginFailure.notAllowed => l10n.qrLoginNotAllowed,
    QrLoginFailure.signedOut => l10n.qrLoginSignedOut,
    QrLoginFailure.needsSignal => l10n.qrLoginNeedsSignal,
    QrLoginFailure.unavailable => l10n.qrLoginUnavailable,
    QrLoginFailure.failed => l10n.qrLoginFailed,
  };
}
