/// The second sign-in step, as a shell gate.
///
/// A STATE, not a route, for the same reason as every other gate in
/// `shell_gates.dart` (artifact 03 section 5.6): on a route, a deep link could
/// skip it. It renders in place of the tabs while the session owes a
/// multi-factor code, so nothing behind it is reachable until the code passes.
///
/// Both buttons are real or absent (repository rule 7): Verify needs
/// [TpShellGateActions.onVerifyMfa], Sign out needs
/// [TpShellGateActions.onSignOut]. Sign out matters most here - it is the only
/// way out for somebody without their authenticator to hand.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/shell_gates.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// Length of an authenticator-app code.
const int tpMfaCodeLength = 6;

/// Keys for tests.
abstract final class TpMfaGateKeys {
  static const Key screen = Key('tp.gate.mfa');
  static const Key code = Key('tp.gate.mfa.code');
  static const Key verify = Key('tp.gate.mfa.verify');
  static const Key signOut = Key('tp.gate.mfa.signOut');
}

/// What can be wrong with the last attempt.
enum _MfaProblem { incomplete, rejected, unavailable }

/// The session owes a multi-factor code.
class TpMfaRequiredScreen extends ConsumerStatefulWidget {
  const TpMfaRequiredScreen({super.key});

  @override
  ConsumerState<TpMfaRequiredScreen> createState() =>
      _TpMfaRequiredScreenState();
}

class _TpMfaRequiredScreenState extends ConsumerState<TpMfaRequiredScreen> {
  final TextEditingController _code = TextEditingController();
  bool _busy = false;
  _MfaProblem? _problem;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit(
    Future<TpMfaVerifyResult> Function(String code) verify,
  ) async {
    if (_busy) return;
    final String code = _code.text.trim();
    if (code.length != tpMfaCodeLength) {
      setState(() => _problem = _MfaProblem.incomplete);
      return;
    }
    setState(() {
      _busy = true;
      _problem = null;
    });
    TpMfaVerifyResult result;
    try {
      result = await verify(code);
    } on Object {
      result = TpMfaVerifyResult.unavailable;
    }
    if (!mounted) return;
    switch (result) {
      case TpMfaVerifyResult.verified:
        // The session moves on and this gate is replaced; keep the button
        // busy until then so a second tap cannot spend the code twice.
        return;
      case TpMfaVerifyResult.rejected:
        _code.clear();
        setState(() {
          _busy = false;
          _problem = _MfaProblem.rejected;
        });
      case TpMfaVerifyResult.unavailable:
        setState(() {
          _busy = false;
          _problem = _MfaProblem.unavailable;
        });
    }
  }

  String? _problemText(AppLocalizations l10n) => switch (_problem) {
        null => null,
        _MfaProblem.incomplete => l10n.mfaCodeIncomplete,
        _MfaProblem.rejected => l10n.mfaCodeInvalid,
        _MfaProblem.unavailable => l10n.mfaVerifyUnavailable,
      };

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpShellGateActions actions = ref.watch(shellGateActionsProvider);
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(TpStatus.info);
    final TextTheme text = Theme.of(context).textTheme;
    final Future<TpMfaVerifyResult> Function(String code)? verify =
        actions.onVerifyMfa;

    return TpScaffold(
      key: TpMfaGateKeys.screen,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(TpSpace.xxl),
            child: ConstrainedBox(
              constraints:
                  const BoxConstraints(maxWidth: TpSizing.stateMaxWidth),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Center(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: colors.soft,
                        shape: BoxShape.circle,
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(TpSpace.lg),
                        child: Icon(
                          Icons.verified_user_outlined,
                          size: TpSizing.iconState,
                          color: colors.onSoft,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: TpSpace.xl),
                  Text(
                    l10n.mfaTitle,
                    textAlign: TextAlign.center,
                    style: text.headlineSmall,
                  ),
                  const SizedBox(height: TpSpace.sm),
                  Text(
                    l10n.mfaMessage,
                    textAlign: TextAlign.center,
                    style: text.bodyMedium,
                  ),
                  const SizedBox(height: TpSpace.xl),
                  // A code is digits read left to right in every language.
                  Directionality(
                    textDirection: TextDirection.ltr,
                    child: TpInput(
                      key: TpMfaGateKeys.code,
                      label: l10n.mfaCodeLabel,
                      controller: _code,
                      enabled: !_busy && verify != null,
                      errorText: _problemText(l10n),
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      maxLength: tpMfaCodeLength,
                      autofocus: true,
                      inputFormatters: <TextInputFormatter>[
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(tpMfaCodeLength),
                      ],
                      onChanged: (_) {
                        if (_problem != null) {
                          setState(() => _problem = null);
                        }
                      },
                      onSubmitted:
                          verify == null ? null : (_) => _submit(verify),
                    ),
                  ),
                  const SizedBox(height: TpSpace.lg),
                  if (verify != null)
                    TpButton.primary(
                      key: TpMfaGateKeys.verify,
                      label: l10n.mfaVerifyAction,
                      isBusy: _busy,
                      isFullWidth: true,
                      onPressed: _busy ? null : () => _submit(verify),
                    ),
                  if (actions.onSignOut != null) ...<Widget>[
                    const SizedBox(height: TpSpace.sm),
                    TpButton.secondary(
                      key: TpMfaGateKeys.signOut,
                      label: l10n.actionSignOut,
                      isFullWidth: true,
                      onPressed: _busy ? null : actions.onSignOut,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
