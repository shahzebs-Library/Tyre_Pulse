/// The sign-in screen.
///
/// # Why this file exists
///
/// Nothing in this app was reachable before it. `mobile/app/(auth)/login.tsx`
/// is the production reference this ports (READ ONLY - see AGENTS.md); the
/// UI shape below mirrors it (logo block, language toggle, card with an
/// identifier field, a password field and a submit button, a footer
/// tagline) but is built entirely on this project's own design system
/// (`core/design_system/design_system.dart`) rather than on hand-rolled
/// styling, and it does none of the business logic the reference screen does
/// inline.
///
/// # This is a thin renderer over [SignInOutcome], on purpose
///
/// `sign_in_outcome.dart`'s own library comment says exactly this: the
/// reference screen "folds all three [outcomes] into one string built ad hoc
/// inside the screen; that logic belongs in the domain layer so a login
/// SCREEN... can be a thin renderer over a typed answer." All four
/// [SignInOutcome] branches are handled below and NONE of them re-derives a
/// message, re-checks a lockout, or special-cases "no account found" versus
/// "wrong password" - [SignInRejected.error] and [SignInFailed.error] each
/// already carry the single, safe-to-display sentence
/// [AppError.message] promises. Only [SignInLocked] renders differently, and
/// only because it is a genuinely different situation (a rate limit, not a
/// credentials failure) with its own field, [SignInLocked.lockoutMinutes].
///
/// # This screen never navigates on success
///
/// [AuthController.signIn] reports its result through the exact same
/// `AuthRepository.sessionChanges` stream every other sign-in path uses -
/// see that method's own doc comment: "there is exactly one code path that
/// ever moves this controller into [AuthSessionPhase.authenticated]". Once
/// that stream resolves, `resolveRedirect` in `app_router.dart` is the
/// single place that decides where the app goes next (honouring
/// [LoginRoute.from], the location the user was trying to reach before the
/// redirect first sent them here). Calling `context.go`/`context.push` from
/// this screen on [SignInSucceeded] would race that redirect for no reason;
/// the correct, and only, response here is to stop showing the busy state
/// and let the router do its job.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// Keys for the two distinct banner renderings this screen can show, so a
/// test can assert on WHICH one rendered rather than only on its text -
/// mirroring `TpStateKeys`'s own reasoning in `tp_states.dart`: "these exist
/// so a test can assert that two states really are DIFFERENT renderings...
/// reviewing for that does not work."
@visibleForTesting
abstract final class LoginBannerKeys {
  /// [SignInRejected], [SignInFailed], or the client-side "both fields are
  /// required" check - all rendered as the same critical-toned banner shape,
  /// each with its own message.
  static const Key error = Key('login.banner.error');

  /// [SignInLocked] only. Warning-toned, with its own icon, so a genuine
  /// rate limit can never be mistaken for a credentials failure at a glance.
  static const Key locked = Key('login.banner.locked');
}

/// One selectable interface language on the sign-in card.
///
/// Deliberately NOT routed through [AppLocalizations]. Each [label] names a
/// language in its own script - translating "EN" or "اردو" into whichever
/// language happens to be active right now would read as nonsense, which is
/// exactly why `mobile/app/(auth)/login.tsx`'s own `LANG_OPTIONS` constant
/// hardcodes 'EN' / 'ع' / 'اردو' regardless of the active language too.
@immutable
class _LanguageOption {
  const _LanguageOption({required this.locale, required this.label});

  final Locale locale;
  final String label;
}

const List<_LanguageOption> _kLanguageOptions = <_LanguageOption>[
  _LanguageOption(locale: Locale('en'), label: 'EN'),
  _LanguageOption(locale: Locale('ar'), label: 'ع'),
  _LanguageOption(locale: Locale('ur'), label: 'اردو'),
];

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({required this.route, super.key});

  /// [LoginRoute] carries [LoginRoute.from] - see the library comment for
  /// why this screen does not need to read it itself. Threaded through
  /// anyway, matching every other registered screen in this codebase.
  final LoginRoute route;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _identifierController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  bool _obscurePassword = true;
  bool _isSubmitting = false;

  /// The message for [LoginBannerKeys.error] - either the client-side
  /// "required" check, or [AppError.message] off a [SignInRejected] or
  /// [SignInFailed]. Null while nothing has gone wrong yet.
  String? _errorMessage;

  /// Set only for [SignInLocked]. Kept separate from [_errorMessage] rather
  /// than folded into one "last problem" field, because the two states must
  /// render through two different keys - see [LoginBannerKeys].
  int? _lockoutMinutes;

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// Clears whatever banner is showing the moment the person edits either
  /// field - an error left on screen after they have already changed what
  /// caused it reads as still being true.
  void _clearFeedback() {
    if (_errorMessage != null || _lockoutMinutes != null) {
      setState(() {
        _errorMessage = null;
        _lockoutMinutes = null;
      });
    }
  }

  Future<void> _submit() async {
    // The button already disables itself while `_isSubmitting` is true (see
    // `build` below); this is the same guard applied a second time against a
    // fast double-tap, or a keyboard "done" submit racing an in-flight tap.
    if (_isSubmitting) return;

    final AppLocalizations l10n = AppLocalizations.of(context);
    final String identifier = _identifierController.text.trim();
    final String password = _passwordController.text;

    if (identifier.isEmpty || password.isEmpty) {
      setState(() {
        _errorMessage = l10n.loginErrorRequired;
        _lockoutMinutes = null;
      });
      return;
    }

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
      _lockoutMinutes = null;
    });

    final SignInOutcome outcome = await ref
        .read(authControllerProvider.notifier)
        .signIn(identifier: identifier, password: password);

    // The router's redirect may already be in the process of unmounting this
    // widget by the time this await returns - see the library comment.
    if (!mounted) return;

    switch (outcome) {
      case SignInSucceeded():
        setState(() => _isSubmitting = false);
      case SignInLocked(:final lockoutMinutes):
        setState(() {
          _isSubmitting = false;
          _lockoutMinutes = lockoutMinutes;
        });
      case SignInRejected(:final error):
        setState(() {
          _isSubmitting = false;
          _errorMessage = error.message;
        });
      case SignInFailed(:final error):
        setState(() {
          _isSubmitting = false;
          _errorMessage = error.message;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final Locale? activeLocale = ref.watch(localeProvider);

    return TpScaffold(
      // No app bar and no back fallback: signed out, this screen IS the
      // root of the app, exactly as Home is once signed in - see
      // `tp_scaffold.dart`'s own library comment on what a null
      // `backFallback` means.
      body: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          return SingleChildScrollView(
            padding: const EdgeInsets.all(TpSpace.xxl),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: constraints.maxHeight - (TpSpace.xxl * 2),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Center(
                    child: Column(
                      children: <Widget>[
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: palette.primarySoft,
                            shape: BoxShape.circle,
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(TpSpace.lg),
                            child: Icon(
                              Icons.tire_repair_outlined,
                              size: TpSizing.iconState,
                              color: palette.primaryDark,
                            ),
                          ),
                        ),
                        const SizedBox(height: TpSpace.md),
                        Text(
                          l10n.appTitle,
                          style: Theme.of(context).textTheme.headlineMedium,
                        ),
                        const SizedBox(height: TpSpace.xs),
                        Text(
                          l10n.loginAppSubtitle,
                          style: Theme.of(context)
                              .textTheme
                              .bodyMedium
                              ?.copyWith(color: palette.textMuted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: TpSpace.xxl),
                  TpCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        _LanguageToggle(
                          active: activeLocale,
                          onSelect: (Locale locale) => ref
                              .read(localeProvider.notifier)
                              .setLocale(locale),
                        ),
                        const SizedBox(height: TpSpace.lg),
                        Text(
                          l10n.loginCardTitle,
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: TpSpace.xs),
                        Text(
                          l10n.loginCardSubtitle,
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: palette.textMuted),
                        ),
                        const SizedBox(height: TpSpace.lg),
                        if (_lockoutMinutes != null) ...<Widget>[
                          _LoginBanner(
                            key: LoginBannerKeys.locked,
                            icon: Icons.lock_outline,
                            tone: TpStatus.warning,
                            message: l10n.loginErrorLocked(_lockoutMinutes!),
                          ),
                          const SizedBox(height: TpSpace.md),
                        ] else if (_errorMessage != null) ...<Widget>[
                          _LoginBanner(
                            key: LoginBannerKeys.error,
                            icon: Icons.error_outline,
                            tone: TpStatus.critical,
                            message: _errorMessage!,
                          ),
                          const SizedBox(height: TpSpace.md),
                        ],
                        TpInput(
                          label: l10n.loginIdentifierLabel,
                          controller: _identifierController,
                          hint: l10n.loginIdentifierPlaceholder,
                          prefixIcon: Icons.person_outline,
                          enabled: !_isSubmitting,
                          keyboardType: TextInputType.emailAddress,
                          textInputAction: TextInputAction.next,
                          onChanged: (String _) => _clearFeedback(),
                        ),
                        const SizedBox(height: TpSpace.lg),
                        TpInput(
                          label: l10n.loginPasswordLabel,
                          controller: _passwordController,
                          hint: l10n.loginPasswordPlaceholder,
                          prefixIcon: Icons.lock_outline,
                          enabled: !_isSubmitting,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          onChanged: (String _) => _clearFeedback(),
                          onSubmitted: (String _) => unawaited(_submit()),
                          suffix: IconButton(
                            icon: Icon(
                              _obscurePassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            tooltip: _obscurePassword
                                ? l10n.loginShowPassword
                                : l10n.loginHidePassword,
                            onPressed: () => setState(
                              () => _obscurePassword = !_obscurePassword,
                            ),
                          ),
                        ),
                        const SizedBox(height: TpSpace.xl),
                        TpButton.primary(
                          label: l10n.actionSignIn,
                          icon: Icons.arrow_forward,
                          isFullWidth: true,
                          isBusy: _isSubmitting,
                          onPressed:
                              _isSubmitting ? null : () => unawaited(_submit()),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: TpSpace.xxl),
                  Text(
                    l10n.loginTagline,
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: palette.textMuted),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

/// A row of three language chips, one per [_kLanguageOptions] entry.
///
/// [active] is [Locale.languageCode]-compared, not identity-compared: the
/// value read back from [localeProvider] after `setLocale` is the exact
/// [Locale] passed to it, but comparing by language code rather than by
/// object equality is what keeps this correct if a future caller ever
/// constructs a [Locale] with a region subtag for one of these languages.
class _LanguageToggle extends StatelessWidget {
  const _LanguageToggle({required this.active, required this.onSelect});

  final Locale? active;
  final ValueChanged<Locale> onSelect;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        for (int i = 0; i < _kLanguageOptions.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(width: TpSpace.sm),
          Expanded(
            child: TpButton(
              key: Key(
                'login.language.${_kLanguageOptions[i].locale.languageCode}',
              ),
              label: _kLanguageOptions[i].label,
              isCompact: true,
              isFullWidth: true,
              variant: active?.languageCode ==
                      _kLanguageOptions[i].locale.languageCode
                  ? TpButtonVariant.primary
                  : TpButtonVariant.secondary,
              onPressed: () => onSelect(_kLanguageOptions[i].locale),
            ),
          ),
        ],
      ],
    );
  }
}

/// The shared banner shape both [LoginBannerKeys] render through - same
/// layout, different [icon], [tone] and [message] per key. See
/// `tp_states.dart`'s [TpStateView] for the equivalent full-screen version;
/// this is the form-level counterpart, screen-local because nothing else in
/// this codebase yet needs an inline (non-full-screen) status banner.
class _LoginBanner extends StatelessWidget {
  const _LoginBanner({
    required super.key,
    required this.icon,
    required this.tone,
    required this.message,
  });

  final IconData icon;
  final TpStatus tone;
  final String message;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(tone);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base, width: TpBorderWidth.hairline),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, size: TpSizing.iconSm, color: colors.onSoft),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                message,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSoft),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
