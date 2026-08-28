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
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';
import 'package:tyre_pulse/features/auth/presentation/login_country_preference_provider.dart';
import 'package:tyre_pulse/features/auth/presentation/widgets/login_country_hero.dart';
import 'package:tyre_pulse/features/auth/presentation/widgets/login_operations_scope.dart';

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
/// language in its own script - translating "English", "العربية", or "اردو"
/// into whichever language happens to be active right now would read as
/// nonsense. The production React Native screen follows the same rule for its
/// language options.
@immutable
class _LanguageOption {
  const _LanguageOption({required this.locale, required this.label});

  final Locale locale;
  final String label;
}

const List<_LanguageOption> _kLanguageOptions = <_LanguageOption>[
  _LanguageOption(locale: Locale('en'), label: 'English'),
  _LanguageOption(locale: Locale('ar'), label: 'العربية'),
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
  bool _hasRequestedInitialCountry = false;
  bool _hasReportedCountryPreferenceError = false;

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

  Future<void> _chooseCountry(LoginCountry selected) async {
    final LoginCountry? country = await showLoginCountryPicker(
      context: context,
      selected: selected,
    );
    if (!mounted || country == null) return;
    try {
      await ref.read(loginCountryPreferenceProvider.notifier).select(country);
    } on Object {
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.stateErrorMessage)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final Locale? activeLocale = ref.watch(localeProvider);
    final AsyncValue<LoginCountry?> countryPreference = ref.watch(
      loginCountryPreferenceProvider,
    );
    final LoginCountry? storedCountry = countryPreference.asData?.value;
    final LoginCountry selectedCountry =
        storedCountry ?? LoginCountry.saudiArabia;

    if (countryPreference is AsyncData<LoginCountry?> &&
        storedCountry == null &&
        !_hasRequestedInitialCountry) {
      _hasRequestedInitialCountry = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_chooseCountry(selectedCountry));
      });
    }

    if (countryPreference.hasError && !_hasReportedCountryPreferenceError) {
      _hasReportedCountryPreferenceError = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context).stateErrorMessage),
          ),
        );
      });
    }

    return Theme(
      data: TpTheme.forPalette(TpPalette.loginLight),
      child: TpScaffold(
        // No app bar and no back fallback: signed out, this screen IS the
        // root of the app, exactly as Home is once signed in - see
        // `tp_scaffold.dart`'s own library comment on what a null
        // `backFallback` means.
        body: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final bool useSplitLayout = constraints.maxWidth >= 700;
            final double horizontalPadding =
                useSplitLayout ? TpSpace.xxl : TpSpace.lg;
            final Widget form = _LoginFormCard(
              activeLocale: activeLocale ?? Localizations.localeOf(context),
              identifierController: _identifierController,
              passwordController: _passwordController,
              obscurePassword: _obscurePassword,
              isSubmitting: _isSubmitting,
              errorMessage: _errorMessage,
              lockoutMinutes: _lockoutMinutes,
              onSelectLocale: (Locale locale) =>
                  ref.read(localeProvider.notifier).setLocale(locale),
              onIdentifierChanged: (String _) => _clearFeedback(),
              onPasswordChanged: (String _) => _clearFeedback(),
              onTogglePassword: () => setState(
                () => _obscurePassword = !_obscurePassword,
              ),
              onSubmit: _submit,
            );

            return SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: EdgeInsets.symmetric(
                horizontal: horizontalPadding,
                vertical: TpSpace.lg,
              ),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: constraints.maxHeight - (TpSpace.lg * 2),
                ),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 1060),
                    child: useSplitLayout
                        ? Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Expanded(
                                flex: 9,
                                child: LoginCountryHero(
                                  key: const Key('login.brand.panel'),
                                  country: selectedCountry,
                                  compact: false,
                                  onChangeCountry: () => unawaited(
                                    _chooseCountry(selectedCountry),
                                  ),
                                ),
                              ),
                              const SizedBox(width: TpSpace.xl),
                              Expanded(flex: 11, child: form),
                            ],
                          )
                        : Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: <Widget>[
                              LoginCountryHero(
                                key: const Key('login.brand.panel'),
                                country: selectedCountry,
                                compact: true,
                                onChangeCountry: () =>
                                    unawaited(_chooseCountry(selectedCountry)),
                              ),
                              const SizedBox(height: TpSpace.lg),
                              form,
                            ],
                          ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _LoginFormCard extends StatelessWidget {
  const _LoginFormCard({
    required this.activeLocale,
    required this.identifierController,
    required this.passwordController,
    required this.obscurePassword,
    required this.isSubmitting,
    required this.errorMessage,
    required this.lockoutMinutes,
    required this.onSelectLocale,
    required this.onIdentifierChanged,
    required this.onPasswordChanged,
    required this.onTogglePassword,
    required this.onSubmit,
  });

  final Locale activeLocale;
  final TextEditingController identifierController;
  final TextEditingController passwordController;
  final bool obscurePassword;
  final bool isSubmitting;
  final String? errorMessage;
  final int? lockoutMinutes;
  final ValueChanged<Locale> onSelectLocale;
  final ValueChanged<String> onIdentifierChanged;
  final ValueChanged<String> onPasswordChanged;
  final VoidCallback onTogglePassword;
  final Future<void> Function() onSubmit;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    return TpCard(
      key: const Key('login.form.card'),
      padding: const EdgeInsets.all(TpSpace.xxl),
      child: AutofillGroup(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            _LanguageToggle(active: activeLocale, onSelect: onSelectLocale),
            const SizedBox(height: TpSpace.xl),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: palette.primarySoft,
                    borderRadius: BorderRadius.circular(TpRadius.md),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(TpSpace.sm),
                    child: Icon(
                      Icons.login_outlined,
                      color: palette.primaryDark,
                      size: TpSizing.iconLg,
                    ),
                  ),
                ),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Semantics(
                        header: true,
                        child: Text(
                          l10n.loginWelcomeTitle,
                          style: text.headlineSmall,
                        ),
                      ),
                      const SizedBox(height: TpSpace.xs),
                      Text(
                        l10n.loginWelcomeSubtitle,
                        style: text.bodySmall?.copyWith(
                          color: palette.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.lg),
            const LoginOperationsScope(),
            const SizedBox(height: TpSpace.xl),
            if (lockoutMinutes != null) ...<Widget>[
              _LoginBanner(
                key: LoginBannerKeys.locked,
                icon: Icons.lock_outline,
                tone: TpStatus.warning,
                message: l10n.loginErrorLocked(lockoutMinutes!),
              ),
              const SizedBox(height: TpSpace.md),
            ] else if (errorMessage != null) ...<Widget>[
              _LoginBanner(
                key: LoginBannerKeys.error,
                icon: Icons.error_outline,
                tone: TpStatus.critical,
                message: errorMessage!,
              ),
              const SizedBox(height: TpSpace.md),
            ],
            TpInput(
              label: l10n.loginIdentifierLabel,
              controller: identifierController,
              hint: l10n.loginIdentifierPlaceholder,
              prefixIcon: Icons.badge_outlined,
              enabled: !isSubmitting,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              onChanged: onIdentifierChanged,
            ),
            const SizedBox(height: TpSpace.lg),
            TpInput(
              label: l10n.loginPasswordLabel,
              controller: passwordController,
              hint: l10n.loginPasswordPlaceholder,
              prefixIcon: Icons.lock_outline,
              enabled: !isSubmitting,
              obscureText: obscurePassword,
              textInputAction: TextInputAction.done,
              onChanged: onPasswordChanged,
              onSubmitted: (String _) => unawaited(onSubmit()),
              suffix: IconButton(
                icon: Icon(
                  obscurePassword
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                ),
                tooltip: obscurePassword
                    ? l10n.loginShowPassword
                    : l10n.loginHidePassword,
                onPressed: isSubmitting ? null : onTogglePassword,
              ),
            ),
            const SizedBox(height: TpSpace.xl),
            TpButton.primary(
              label: l10n.actionSignIn,
              icon: Icons.arrow_forward,
              isFullWidth: true,
              isBusy: isSubmitting,
              onPressed: isSubmitting ? null : () => unawaited(onSubmit()),
            ),
          ],
        ),
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
            child: MergeSemantics(
              child: Semantics(
                selected: active?.languageCode ==
                    _kLanguageOptions[i].locale.languageCode,
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
