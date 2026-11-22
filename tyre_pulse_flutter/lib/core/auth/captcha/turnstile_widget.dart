/// The Turnstile security check as a widget: the platform view plus a status
/// line that says what is happening and offers Try again when it can.
///
/// The owning screen keeps the token (via [TurnstileCaptcha.onTokenChanged])
/// and calls [TurnstileController.reset] after EVERY attempt, because a
/// Turnstile token is single use.
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/auth/captcha/turnstile_captcha.dart';

/// Lets the owning screen re-arm the check after an attempt.
final class TurnstileController {
  _TurnstileCaptchaState? _state;

  /// Drops the current token and shows a fresh, unsolved challenge. A check
  /// that had failed or timed out is rebuilt from scratch.
  void reset() => _state?._resetAfterAttempt();
}

/// Total height the check needs at [scaler]: the view (or, when the check
/// failed, the Try again button in its place) plus a two-line status line.
/// Screens with absolute layouts reserve exactly this much.
double turnstileBlockHeight(TextScaler scaler) =>
    kTurnstileViewHeight + 4 + math.max(24, scaler.scale(13) * 1.35 * 2 + 4);

class TurnstileCaptcha extends StatefulWidget {
  const TurnstileCaptcha({
    required this.siteKey,
    required this.factory,
    required this.controller,
    required this.onTokenChanged,
    this.loadTimeout = kTurnstileLoadTimeout,
    super.key,
  });

  final String siteKey;
  final TurnstileViewFactory factory;
  final TurnstileController controller;

  /// Called with the new token, or null whenever the token is gone (expired,
  /// failed, reset, disposed).
  final ValueChanged<String?> onTokenChanged;

  final Duration loadTimeout;

  @override
  State<TurnstileCaptcha> createState() => _TurnstileCaptchaState();
}

class _TurnstileCaptchaState extends State<TurnstileCaptcha> {
  TurnstileViewHandle? _handle;
  TurnstileState _state = const TurnstileState.loading();
  Timer? _loadTimer;
  bool? _builtDark;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    widget.controller._state = this;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final bool dark = Theme.of(context).brightness == Brightness.dark;
    if (_handle == null || _builtDark != dark) _recreate(dark);
  }

  @override
  void didUpdateWidget(TurnstileCaptcha oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      if (oldWidget.controller._state == this) {
        oldWidget.controller._state = null;
      }
      widget.controller._state = this;
    }
    if (oldWidget.siteKey != widget.siteKey ||
        oldWidget.factory != widget.factory) {
      _recreate(_builtDark ?? false);
    }
  }

  @override
  void dispose() {
    _loadTimer?.cancel();
    _handle?.dispose();
    if (widget.controller._state == this) widget.controller._state = null;
    super.dispose();
  }

  void _recreate(bool dark) {
    _loadTimer?.cancel();
    _handle?.dispose();
    final int generation = ++_generation;
    _builtDark = dark;
    final bool hadToken = _state.hasToken;
    _state = const TurnstileState.loading();
    _handle = widget.factory.create(
      siteKey: widget.siteKey,
      dark: dark,
      onEvent: (TurnstileEvent event) {
        if (generation == _generation) _onEvent(event);
      },
    );
    _loadTimer = Timer(widget.loadTimeout, () {
      if (!mounted || generation != _generation) return;
      _setState(_state.timedOut());
    });
    if (hadToken) _notifyLater(null);
  }

  void _onEvent(TurnstileEvent event) {
    if (!mounted) return;
    if (event is TurnstileReady || event is TurnstileToken) {
      _loadTimer?.cancel();
    }
    _setState(_state.apply(event));
  }

  void _setState(TurnstileState next) {
    if (next == _state) return;
    final String? before = _state.token;
    setState(() => _state = next);
    if (before != next.token) widget.onTokenChanged(next.token);
  }

  /// Notifies outside the build phase (recreate can run from
  /// didChangeDependencies).
  void _notifyLater(String? token) {
    scheduleMicrotask(() {
      if (mounted) widget.onTokenChanged(token);
    });
  }

  void _resetAfterAttempt() {
    if (!mounted) return;
    if (_state.canRetry || _state.status == TurnstileStatus.loading) {
      _retry();
      return;
    }
    _setState(_state.afterReset());
    unawaited(_handle?.reset());
  }

  /// Expired, failed or timed out: start again with a fresh page.
  void _retry() => setState(() => _recreate(_builtDark ?? false));

  String _statusText(AppLocalizations l10n) => switch (_state.status) {
        TurnstileStatus.loading => l10n.captchaLoading,
        TurnstileStatus.waiting => l10n.captchaPrompt,
        TurnstileStatus.solved => l10n.captchaSolved,
        TurnstileStatus.expired => l10n.captchaExpired,
        TurnstileStatus.failed => l10n.captchaLoadFailed,
        TurnstileStatus.timedOut => l10n.captchaTimedOut,
      };

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? style = Theme.of(context).textTheme.bodySmall?.copyWith(
          fontSize: 13,
          height: 1.35,
          color: _state.canRetry ? palette.text : palette.textMuted,
        );
    final IconData icon = switch (_state.status) {
      TurnstileStatus.solved => Icons.verified_user_outlined,
      TurnstileStatus.loading ||
      TurnstileStatus.waiting =>
        Icons.shield_outlined,
      _ => Icons.error_outline,
    };
    return SizedBox(
      height: turnstileBlockHeight(MediaQuery.textScalerOf(context)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Semantics(
            container: true,
            label: l10n.captchaSemanticLabel,
            child: SizedBox(
              key: const Key('captcha.view'),
              height: kTurnstileViewHeight,
              // When the check cannot be used, its slot holds the way back:
              // a full-size Try again button that rebuilds the page.
              child: _state.canRetry
                  ? Center(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: OutlinedButton.icon(
                          key: const Key('captcha.retry'),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(48, 48),
                          ),
                          onPressed: _retry,
                          icon: const Icon(Icons.refresh),
                          label: Text(l10n.actionRetry),
                        ),
                      ),
                    )
                  : _handle?.view ?? const SizedBox.shrink(),
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(icon, size: 18, color: style?.color),
                const SizedBox(width: 8),
                Expanded(
                  child: Semantics(
                    liveRegion: true,
                    child: Text(
                      _statusText(l10n),
                      key: const Key('captcha.status'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: style,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
