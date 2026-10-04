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
///
/// Number matching (QR sign-in hardening): after the scan the phone first
/// PEEKS at the request - which browser, from which address, how long ago -
/// and approves only by tapping the 2-digit number the computer shows. A
/// wrong number cancels the code on the server.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/qr_login/data/qr_login_repository.dart';
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
  static const ValueKey<String> decline = ValueKey<String>('qrLogin.decline');
  static const ValueKey<String> checking = ValueKey<String>('qrLogin.checking');
  static const ValueKey<String> waiting = ValueKey<String>('qrLogin.waiting');

  /// One number option on the confirm sheet.
  static ValueKey<String> option(String number) =>
      ValueKey<String>('qrLogin.option.$number');
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

final class _Checking extends _Phase {
  const _Checking();
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
      widget.initialPayload == null ? const _Scanning() : const _Checking();

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
    setState(() => _phase = const _Checking());
    final QrLoginRepository repo = ref.read(qrLoginRepositoryProvider);
    final QrLoginPeekResult peek =
        await repo.peek(id: code.id, secret: code.secret);
    if (!mounted) return;
    final QrLoginRequestInfo info;
    switch (peek) {
      case QrLoginPeekRefused(:final QrLoginFailure reason):
        // Nothing was decided, so nothing is sent: the person is told why.
        setState(() => _phase = _Done(QrLoginRefused(reason)));
        return;
      case QrLoginPeekReady(info: final QrLoginRequestInfo ready):
        info = ready;
    }
    setState(() => _phase = const _Confirming());
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext sheetContext) => QrLoginConfirmSheet(
        personName: _personName(l10n),
        info: info,
        onPick: (String number) => Navigator.of(sheetContext).pop(number),
        onDecline: () => Navigator.of(sheetContext).pop(),
      ),
    );
    if (!mounted) return;
    // Dismissing the sheet is a decline too: the code is spent either way,
    // so nobody else can approve it while the person looks away.
    final bool approve = picked != null;
    setState(() => _phase = const _Sending());
    final QrLoginOutcome outcome = await repo.decide(
      id: code.id,
      secret: code.secret,
      approve: approve,
      match: picked,
    );
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
          _Checking() => TpLoadingState(
              key: QrLoginKeys.checking,
              message: l10n.qrLoginChecking,
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

/// The requesting browser in plain words, e.g. "Chrome on Windows", or
/// "Unknown browser" when the user agent does not say.
String qrLoginBrowserLabel(AppLocalizations l10n, String? userAgent) {
  final ({String? browser, String? os}) d = describeUserAgent(userAgent);
  final String? browser = d.browser;
  final String? os = d.os;
  if (browser == null) return l10n.qrLoginUnknownBrowser;
  // Product names are isolated so they stay in order inside RTL text.
  if (os == null) return '\u2068$browser\u2069';
  return l10n.qrLoginBrowserOnOs('\u2068$browser\u2069', '\u2068$os\u2069');
}

/// The confirmation shown before anything is decided. Public so the widget
/// test can render it on its own.
class QrLoginConfirmSheet extends StatelessWidget {
  const QrLoginConfirmSheet({
    required this.personName,
    required this.info,
    required this.onPick,
    required this.onDecline,
    super.key,
  });

  final String personName;
  final QrLoginRequestInfo info;

  /// Approves with the tapped number.
  final ValueChanged<String> onPick;
  final VoidCallback onDecline;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? ip = info.ip;
    final int? age = info.ageSeconds;
    return SingleChildScrollView(
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
          const SizedBox(height: TpSpace.lg),
          // Which computer is asking.
          DecoratedBox(
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              borderRadius: BorderRadius.circular(TpRadius.md),
              border: Border.all(color: palette.border),
            ),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    qrLoginBrowserLabel(l10n, info.userAgent),
                    style: text.titleMedium,
                  ),
                  if (ip != null) ...<Widget>[
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      // The address is isolated so its digits stay in order
                      // inside RTL text.
                      l10n.qrLoginIpAddress('\u2066$ip\u2069'),
                      style: text.bodyMedium,
                    ),
                  ],
                  if (age != null) ...<Widget>[
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      l10n.qrLoginRequestedAgo(age),
                      style: text.bodyMedium,
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          DecoratedBox(
            decoration: BoxDecoration(
              color: palette.warning.soft,
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(
                    Icons.warning_amber_rounded,
                    size: TpSizing.iconMd,
                    color: palette.warning.onSoft,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      l10n.qrLoginWarning,
                      style: text.bodyMedium
                          ?.copyWith(color: palette.warning.onSoft),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.qrLoginPickNumber,
            style: text.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: TpSpace.md),
          Row(
            children: <Widget>[
              for (int i = 0; i < info.options.length; i++) ...<Widget>[
                if (i > 0) const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: _NumberOption(
                    number: info.options[i],
                    onTap: () => onPick(info.options[i]),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          TpButton.secondary(
            key: QrLoginKeys.decline,
            label: l10n.qrLoginDecline,
            icon: Icons.block_rounded,
            isFullWidth: true,
            onPressed: onDecline,
          ),
        ],
      ),
    );
  }
}

/// One big number to tap. At least 64 logical pixels tall (the 48 minimum
/// touch target, with room for a gloved thumb), read out as "Approve with
/// number 37" by a screen reader.
class _NumberOption extends StatelessWidget {
  const _NumberOption({required this.number, required this.onTap});

  final String number;
  final VoidCallback onTap;

  static const double _height = 64;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final BorderRadius radius = BorderRadius.circular(TpRadius.lg);
    return Semantics(
      button: true,
      label: l10n.qrLoginApproveNumber(number),
      excludeSemantics: true,
      child: Material(
        color: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: BorderSide(
            color: palette.controlBorder,
            width: TpBorderWidth.strong,
          ),
        ),
        child: InkWell(
          key: QrLoginKeys.option(number),
          borderRadius: radius,
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: _height,
              minWidth: TpSizing.minTouchTarget,
            ),
            child: Center(
              child: Text(
                // Digits are always shown left to right.
                number,
                textDirection: TextDirection.ltr,
                style: text.headlineMedium?.copyWith(
                  color: palette.text,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ),
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
    QrLoginFailure.mismatch => l10n.qrLoginMismatch,
    QrLoginFailure.admin => l10n.qrLoginAdmin,
    QrLoginFailure.failed => l10n.qrLoginFailed,
  };
}
