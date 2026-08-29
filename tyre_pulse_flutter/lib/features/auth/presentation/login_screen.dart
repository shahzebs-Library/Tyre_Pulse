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
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/security/device_biometric_authenticator.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';
import 'package:tyre_pulse/features/auth/presentation/login_country_preference_provider.dart';
import 'package:tyre_pulse/features/auth/presentation/login_security_copy.dart';
import 'package:tyre_pulse/features/auth/presentation/widgets/login_country_hero.dart';

@visibleForTesting
abstract final class LoginBannerKeys {
  static const Key error = Key('login.banner.error');
  static const Key locked = Key('login.banner.locked');
}

@visibleForTesting
abstract final class LoginActionKeys {
  static const Key biometric = Key('login.biometric');
  static const Key forgotPassword = Key('login.forgot_password');
  static const Key accessHelp = Key('login.access_help');
}

@immutable
class _LanguageOption {
  const _LanguageOption({required this.locale, required this.label});

  final Locale locale;
  final String label;
}

const List<_LanguageOption> _kLanguageOptions = <_LanguageOption>[
  _LanguageOption(locale: Locale('en'), label: 'EN'),
  _LanguageOption(locale: Locale('ar'), label: 'عربي'),
  _LanguageOption(locale: Locale('ur'), label: 'اردو'),
];

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({required this.route, super.key});

  final LoginRoute route;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _identifierController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  bool _obscurePassword = true;
  bool _isSubmitting = false;
  bool _isCheckingBiometrics = false;
  bool _hasRequestedInitialCountry = false;
  bool _hasReportedCountryPreferenceError = false;
  String? _errorMessage;
  int? _lockoutMinutes;

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _clearFeedback() {
    if (_errorMessage == null && _lockoutMinutes == null) return;
    setState(() {
      _errorMessage = null;
      _lockoutMinutes = null;
    });
  }

  Future<void> _submit() async {
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

  Future<void> _authenticateWithBiometrics() async {
    if (_isSubmitting || _isCheckingBiometrics) return;
    final LoginSecurityCopy copy = LoginSecurityCopy.of(context);
    if (_identifierController.text.trim().isEmpty ||
        _passwordController.text.isEmpty) {
      setState(() {
        _errorMessage = copy.credentialsRequired;
        _lockoutMinutes = null;
      });
      return;
    }

    setState(() {
      _isCheckingBiometrics = true;
      _errorMessage = null;
      _lockoutMinutes = null;
    });
    final DeviceBiometricResult result = await ref
        .read(deviceBiometricAuthenticatorProvider)
        .authenticate(reason: copy.biometricReason);
    if (!mounted) return;

    switch (result) {
      case DeviceBiometricResult.authenticated:
        setState(() => _isCheckingBiometrics = false);
        await _submit();
      case DeviceBiometricResult.cancelled:
        setState(() => _isCheckingBiometrics = false);
      case DeviceBiometricResult.unavailable:
        setState(() {
          _isCheckingBiometrics = false;
          _errorMessage = copy.biometricUnavailable;
        });
      case DeviceBiometricResult.lockedOut:
        setState(() {
          _isCheckingBiometrics = false;
          _errorMessage = copy.biometricLocked;
        });
      case DeviceBiometricResult.failed:
        setState(() {
          _isCheckingBiometrics = false;
          _errorMessage = copy.biometricFailed;
        });
    }
  }

  Future<void> _showLoginHelp(String message) {
    final LoginSecurityCopy copy = LoginSecurityCopy.of(context);
    return showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(copy.helpTitle),
        content: Text(message),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(AppLocalizations.of(dialogContext).actionClose),
          ),
        ],
      ),
    );
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).stateErrorMessage)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final Locale activeLocale =
        ref.watch(localeProvider) ?? Localizations.localeOf(context);
    final AsyncValue<LoginCountry?> countryPreference =
        ref.watch(loginCountryPreferenceProvider);
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

    final bool dark = Theme.of(context).brightness == Brightness.dark;
    return Theme(
      data: TpTheme.forPalette(dark ? TpPalette.dark : TpPalette.loginLight),
      child: TpScaffold(
        body: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            if (constraints.maxWidth >= 700) {
              return _wideLayout(
                context,
                selectedCountry: selectedCountry,
                activeLocale: activeLocale,
              );
            }
            return _mobileLayout(
              context,
              constraints: constraints,
              selectedCountry: selectedCountry,
              activeLocale: activeLocale,
            );
          },
        ),
      ),
    );
  }

  Widget _mobileLayout(
    BuildContext context, {
    required BoxConstraints constraints,
    required LoginCountry selectedCountry,
    required Locale activeLocale,
  }) {
    final bool hasFeedback = _errorMessage != null || _lockoutMinutes != null;
    final double feedbackExtra = hasFeedback ? 82 : 0;
    final double canvasWidth =
        constraints.maxWidth > 390 ? 390 : constraints.maxWidth;
    final String configuredVersion = ref.watch(currentAppVersionProvider);
    final String? visibleVersion =
        configuredVersion == '999.0.0' || configuredVersion.trim().isEmpty
            ? null
            : configuredVersion;

    return SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      child: Align(
        alignment: Alignment.topCenter,
        child: SizedBox(
          width: canvasWidth,
          height: 844 + feedbackExtra,
          child: Stack(
            children: <Widget>[
              Positioned(
                left: 0,
                right: 0,
                top: 0,
                height: 354,
                child: _ExactLoginHero(
                  key: const Key('login.brand.panel'),
                  country: selectedCountry,
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                top: 328,
                height: 516 + feedbackExtra,
                child: _ExactLoginForm(
                  key: const Key('login.form.card'),
                  countryControlKey: const Key('login.country.change'),
                  activeLocale: activeLocale,
                  country: selectedCountry,
                  identifierController: _identifierController,
                  passwordController: _passwordController,
                  obscurePassword: _obscurePassword,
                  isSubmitting: _isSubmitting,
                  isBiometricChecking: _isCheckingBiometrics,
                  errorMessage: _errorMessage,
                  lockoutMinutes: _lockoutMinutes,
                  appVersion: visibleVersion,
                  onSelectLocale: (Locale locale) =>
                      ref.read(localeProvider.notifier).setLocale(locale),
                  onIdentifierChanged: (String _) => _clearFeedback(),
                  onPasswordChanged: (String _) => _clearFeedback(),
                  onTogglePassword: () => setState(
                    () => _obscurePassword = !_obscurePassword,
                  ),
                  onChangeCountry: () =>
                      unawaited(_chooseCountry(selectedCountry)),
                  onForgotPassword: () => unawaited(
                    _showLoginHelp(LoginSecurityCopy.of(context).forgotHelp),
                  ),
                  onAccessHelp: () => unawaited(
                    _showLoginHelp(LoginSecurityCopy.of(context).accessHelp),
                  ),
                  onBiometric: _authenticateWithBiometrics,
                  onSubmit: _submit,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _wideLayout(
    BuildContext context, {
    required LoginCountry selectedCountry,
    required Locale activeLocale,
  }) {
    final String configuredVersion = ref.watch(currentAppVersionProvider);
    final String? visibleVersion =
        configuredVersion == '999.0.0' || configuredVersion.trim().isEmpty
            ? null
            : configuredVersion;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(TpSpace.xxl),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1060, minHeight: 620),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                flex: 9,
                child: LoginCountryHero(
                  key: const Key('login.brand.panel'),
                  country: selectedCountry,
                  compact: false,
                  onChangeCountry: () =>
                      unawaited(_chooseCountry(selectedCountry)),
                ),
              ),
              const SizedBox(width: TpSpace.xl),
              Expanded(
                flex: 11,
                child: SizedBox(
                  height: 620,
                  child: _ExactLoginForm(
                    key: const Key('login.form.card'),
                    countryControlKey: const Key('login.country.form_change'),
                    activeLocale: activeLocale,
                    country: selectedCountry,
                    identifierController: _identifierController,
                    passwordController: _passwordController,
                    obscurePassword: _obscurePassword,
                    isSubmitting: _isSubmitting,
                    isBiometricChecking: _isCheckingBiometrics,
                    errorMessage: _errorMessage,
                    lockoutMinutes: _lockoutMinutes,
                    appVersion: visibleVersion,
                    onSelectLocale: (Locale locale) =>
                        ref.read(localeProvider.notifier).setLocale(locale),
                    onIdentifierChanged: (String _) => _clearFeedback(),
                    onPasswordChanged: (String _) => _clearFeedback(),
                    onTogglePassword: () => setState(
                      () => _obscurePassword = !_obscurePassword,
                    ),
                    onChangeCountry: () =>
                        unawaited(_chooseCountry(selectedCountry)),
                    onForgotPassword: () => unawaited(
                      _showLoginHelp(LoginSecurityCopy.of(context).forgotHelp),
                    ),
                    onAccessHelp: () => unawaited(
                      _showLoginHelp(LoginSecurityCopy.of(context).accessHelp),
                    ),
                    onBiometric: _authenticateWithBiometrics,
                    onSubmit: _submit,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _countryHeroAsset(LoginCountry country) => switch (country) {
      LoginCountry.saudiArabia => 'assets/login/figma_city_background.png',
      LoginCountry.unitedArabEmirates =>
        'assets/login/united_arab_emirates_pmv_hero.webp',
      LoginCountry.egypt => 'assets/login/egypt_hero.png',
    };

class _ExactLoginHero extends StatelessWidget {
  const _ExactLoginHero({required this.country, super.key});

  final LoginCountry country;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String asset = _countryHeroAsset(country);

    return Semantics(
      key: const Key('login.country.hero'),
      container: true,
      explicitChildNodes: true,
      label: l10n.loginSelectedCountrySemantics(
        localizedLoginCountryName(l10n, country),
      ),
      child: ColoredBox(
        color: country == LoginCountry.unitedArabEmirates
            ? Colors.white
            : const Color(0xFF030A29),
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            Image.asset(
              asset,
              key: ValueKey<String>(asset),
              fit: BoxFit.cover,
              alignment: Alignment.topCenter,
              excludeFromSemantics: true,
              filterQuality: FilterQuality.high,
            ),
            if (country == LoginCountry.saudiArabia)
              Positioned(
                left: 4,
                top: 175,
                width: 236,
                height: 152,
                child: Image.asset(
                  'assets/login/figma_pump_truck.png',
                  fit: BoxFit.contain,
                  excludeFromSemantics: true,
                  filterQuality: FilterQuality.high,
                ),
              ),
            if (country != LoginCountry.unitedArabEmirates)
              const Positioned(
                left: 0,
                top: 0,
                width: 250,
                height: 176,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: <Color>[
                        Color(0xFF030A29),
                        Color(0xF2030A29),
                        Color(0x00030A29),
                      ],
                    ),
                  ),
                ),
              ),
            Positioned(
              left: country == LoginCountry.unitedArabEmirates ? 18 : 24,
              top: country == LoginCountry.unitedArabEmirates ? 15 : 44,
              width: country == LoginCountry.unitedArabEmirates ? 44 : 58,
              height: country == LoginCountry.unitedArabEmirates ? 24 : 30,
              child: Image.asset(
                'assets/login/figma_brand_pulse.png',
                fit: BoxFit.contain,
                excludeFromSemantics: true,
              ),
            ),
            Positioned(
              left: country == LoginCountry.unitedArabEmirates ? 61 : 84,
              top: country == LoginCountry.unitedArabEmirates ? 12 : 34,
              width: country == LoginCountry.unitedArabEmirates ? 104 : 126,
              child: Semantics(
                key: const Key('login.brand.title'),
                container: true,
                header: true,
                label: l10n.appTitle,
                child: ExcludeSemantics(
                  child: Text(
                    'TYRE\nPULSE',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          color: country == LoginCountry.unitedArabEmirates
                              ? const Color(0xFF092B72)
                              : Colors.white,
                          fontSize: country == LoginCountry.unitedArabEmirates
                              ? 21
                              : 24,
                          height: 0.98,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.2,
                        ),
                  ),
                ),
              ),
            ),
            if (country != LoginCountry.unitedArabEmirates)
              const Positioned(
                left: 24,
                top: 116,
                width: 28,
                height: 2,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Color(0xFFDB8F2E),
                    borderRadius: BorderRadius.all(Radius.circular(1)),
                  ),
                ),
              ),
            Positioned(
              left: country == LoginCountry.unitedArabEmirates ? 19 : 24,
              top: country == LoginCountry.unitedArabEmirates ? 80 : 130,
              right: country == LoginCountry.unitedArabEmirates ? 196 : 24,
              child: Text(
                l10n.loginOperationsTitle,
                maxLines: 2,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: country == LoginCountry.unitedArabEmirates
                          ? const Color(0xFF092B72)
                          : Colors.white,
                      fontSize:
                          country == LoginCountry.unitedArabEmirates ? 20 : 18,
                      height: 1.2,
                      fontWeight: FontWeight.w500,
                    ),
              ),
            ),
            if (country == LoginCountry.unitedArabEmirates)
              Positioned(
                left: 19,
                top: 137,
                width: 170,
                child: Text(
                  l10n.loginTagline,
                  maxLines: 3,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: const Color(0xFF193C7A),
                        fontSize: 12,
                        height: 1.45,
                        fontWeight: FontWeight.w500,
                      ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ExactLoginForm extends StatelessWidget {
  const _ExactLoginForm({
    required this.countryControlKey,
    required this.activeLocale,
    required this.country,
    required this.identifierController,
    required this.passwordController,
    required this.obscurePassword,
    required this.isSubmitting,
    required this.isBiometricChecking,
    required this.errorMessage,
    required this.lockoutMinutes,
    required this.appVersion,
    required this.onSelectLocale,
    required this.onIdentifierChanged,
    required this.onPasswordChanged,
    required this.onTogglePassword,
    required this.onChangeCountry,
    required this.onForgotPassword,
    required this.onAccessHelp,
    required this.onBiometric,
    required this.onSubmit,
    super.key,
  });

  final Key countryControlKey;
  final Locale activeLocale;
  final LoginCountry country;
  final TextEditingController identifierController;
  final TextEditingController passwordController;
  final bool obscurePassword;
  final bool isSubmitting;
  final bool isBiometricChecking;
  final String? errorMessage;
  final int? lockoutMinutes;
  final String? appVersion;
  final ValueChanged<Locale> onSelectLocale;
  final ValueChanged<String> onIdentifierChanged;
  final ValueChanged<String> onPasswordChanged;
  final VoidCallback onTogglePassword;
  final VoidCallback onChangeCountry;
  final VoidCallback onForgotPassword;
  final VoidCallback onAccessHelp;
  final Future<void> Function() onBiometric;
  final Future<void> Function() onSubmit;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final LoginSecurityCopy copy = LoginSecurityCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool hasFeedback = errorMessage != null || lockoutMinutes != null;
    final double feedbackOffset = hasFeedback ? 82 : 0;
    final bool busy = isSubmitting || isBiometricChecking;

    return Material(
      color: palette.surface,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(48)),
      clipBehavior: Clip.antiAlias,
      child: AutofillGroup(
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final double fieldWidth =
                (constraints.maxWidth - 56).clamp(240, 480).toDouble();
            final double left = (constraints.maxWidth - fieldWidth) / 2;
            return Stack(
              children: <Widget>[
                Positioned(
                  left: (constraints.maxWidth - 184) / 2,
                  top: 17,
                  width: 184,
                  height: 48,
                  child: _LanguageToggle(
                    active: activeLocale,
                    onSelect: onSelectLocale,
                  ),
                ),
                Positioned(
                  left: left,
                  top: 72,
                  width: fieldWidth,
                  child: Semantics(
                    header: true,
                    child: Text(
                      l10n.loginWelcomeTitle,
                      style:
                          Theme.of(context).textTheme.headlineMedium?.copyWith(
                                color: palette.text,
                                fontSize: 28,
                                height: 1.14,
                                fontWeight: FontWeight.w800,
                              ),
                    ),
                  ),
                ),
                Positioned(
                  left: left,
                  top: 108,
                  width: fieldWidth,
                  child: Text(
                    l10n.loginWelcomeSubtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: palette.textMuted,
                          fontSize: 13,
                          height: 1.25,
                        ),
                  ),
                ),
                Positioned(
                  left: left,
                  top: 140,
                  width: fieldWidth,
                  child: _FieldLabel(l10n.loginIdentifierLabel),
                ),
                Positioned(
                  left: left,
                  top: 159,
                  width: fieldWidth,
                  height: 48,
                  child: _ExactTextField(
                    controller: identifierController,
                    enabled: !busy,
                    hint: l10n.loginIdentifierPlaceholder,
                    prefixAsset: 'assets/login/figma_user.png',
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autofillHints: const <String>[
                      AutofillHints.username,
                      AutofillHints.email,
                    ],
                    onChanged: onIdentifierChanged,
                  ),
                ),
                Positioned(
                  left: left,
                  top: 216,
                  width: fieldWidth,
                  child: _FieldLabel(l10n.loginPasswordLabel),
                ),
                Positioned(
                  left: left,
                  top: 235,
                  width: fieldWidth,
                  height: 48,
                  child: _ExactTextField(
                    controller: passwordController,
                    enabled: !busy,
                    hint: l10n.loginPasswordPlaceholder,
                    prefixAsset: 'assets/login/figma_lock.png',
                    obscureText: obscurePassword,
                    textInputAction: TextInputAction.done,
                    autofillHints: const <String>[AutofillHints.password],
                    onChanged: onPasswordChanged,
                    onSubmitted: (String _) => unawaited(onSubmit()),
                    suffix: IconButton(
                      icon: obscurePassword
                          ? Image.asset(
                              'assets/login/figma_password_visibility.png',
                              width: 24,
                              height: 24,
                            )
                          : const Icon(Icons.visibility_off_outlined),
                      tooltip: obscurePassword
                          ? l10n.loginShowPassword
                          : l10n.loginHidePassword,
                      onPressed: busy ? null : onTogglePassword,
                    ),
                  ),
                ),
                if (hasFeedback)
                  Positioned(
                    left: left,
                    right: left,
                    top: 292,
                    child: lockoutMinutes != null
                        ? _LoginBanner(
                            key: LoginBannerKeys.locked,
                            icon: Icons.lock_outline,
                            tone: TpStatus.warning,
                            message: l10n.loginErrorLocked(lockoutMinutes!),
                          )
                        : _LoginBanner(
                            key: LoginBannerKeys.error,
                            icon: Icons.error_outline,
                            tone: TpStatus.critical,
                            message: errorMessage!,
                          ),
                  ),
                Positioned(
                  left: left,
                  top: 272 + feedbackOffset,
                  width: fieldWidth,
                  height: TpSizing.minTouchTarget,
                  child: _LoginSecurityLine(
                    controlKey: countryControlKey,
                    country: country,
                    copy: copy,
                    onTap: onChangeCountry,
                  ),
                ),
                Positioned(
                  left: left,
                  top: 320 + feedbackOffset,
                  width: fieldWidth,
                  height: 52,
                  child: TpButton.primary(
                    key: const Key('login.submit'),
                    label: l10n.actionSignIn,
                    icon: Icons.arrow_forward,
                    isFullWidth: true,
                    isBusy: isSubmitting,
                    onPressed: busy ? null : () => unawaited(onSubmit()),
                  ),
                ),
                Positioned(
                  left: left,
                  top: 374 + feedbackOffset,
                  width: fieldWidth,
                  height: 48,
                  child: _LoginHelpLinks(
                    copy: copy,
                    onForgotPassword: onForgotPassword,
                    onAccessHelp: onAccessHelp,
                  ),
                ),
                Positioned(
                  left: left,
                  top: 423 + feedbackOffset,
                  width: fieldWidth,
                  height: 16,
                  child: _LoginAlternativeDivider(label: copy.or),
                ),
                Positioned(
                  left: left + (fieldWidth * 0.19),
                  top: 438 + feedbackOffset,
                  width: fieldWidth * 0.62,
                  height: 48,
                  child: TpButton.secondary(
                    key: LoginActionKeys.biometric,
                    label: copy.biometric,
                    icon: Icons.fingerprint,
                    isFullWidth: true,
                    isBusy: isBiometricChecking,
                    onPressed: busy ? null : () => unawaited(onBiometric()),
                  ),
                ),
                Positioned(
                  left: left,
                  top: 488 + feedbackOffset,
                  width: fieldWidth,
                  height: 26,
                  child: _LoginSecurityFooter(
                    copy: copy,
                    appVersion: appVersion,
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: TpPalette.of(context).text,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
      );
}

class _ExactTextField extends StatelessWidget {
  const _ExactTextField({
    required this.controller,
    required this.enabled,
    required this.hint,
    required this.prefixAsset,
    required this.textInputAction,
    required this.autofillHints,
    required this.onChanged,
    this.keyboardType,
    this.obscureText = false,
    this.onSubmitted,
    this.suffix,
  });

  final TextEditingController controller;
  final bool enabled;
  final String hint;
  final String prefixAsset;
  final TextInputType? keyboardType;
  final TextInputAction textInputAction;
  final Iterable<String> autofillHints;
  final ValueChanged<String> onChanged;
  final bool obscureText;
  final ValueChanged<String>? onSubmitted;
  final Widget? suffix;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final OutlineInputBorder border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(9),
      borderSide: BorderSide(color: palette.border),
    );
    return TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      autofillHints: autofillHints,
      obscureText: obscureText,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: palette.text,
            fontSize: 15,
          ),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: palette.textMuted,
              fontSize: 14,
            ),
        filled: true,
        fillColor: palette.surface,
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        prefixIcon: Padding(
          padding: const EdgeInsets.all(12),
          child: Image.asset(prefixAsset, width: 24, height: 24),
        ),
        prefixIconConstraints: const BoxConstraints(
          minWidth: 48,
          minHeight: 48,
        ),
        suffixIcon: suffix,
        suffixIconConstraints: const BoxConstraints(
          minWidth: TpSizing.minTouchTarget,
          minHeight: TpSizing.minTouchTarget,
        ),
        enabledBorder: border,
        disabledBorder: border,
        focusedBorder: border.copyWith(
          borderSide: BorderSide(color: palette.focus, width: 2),
        ),
      ),
    );
  }
}

class _LanguageToggle extends StatelessWidget {
  const _LanguageToggle({required this.active, required this.onSelect});

  final Locale active;
  final ValueChanged<Locale> onSelect;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: TpPalette.of(context).surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: TpPalette.of(context).border),
      ),
      child: Row(
        children: <Widget>[
          for (final _LanguageOption option in _kLanguageOptions)
            Expanded(
              child: MergeSemantics(
                child: Semantics(
                  selected: active.languageCode == option.locale.languageCode,
                  child: TpButton(
                    key: Key(
                      'login.language.${option.locale.languageCode}',
                    ),
                    label: option.label,
                    isCompact: true,
                    isFullWidth: true,
                    variant: active.languageCode == option.locale.languageCode
                        ? TpButtonVariant.primary
                        : TpButtonVariant.secondary,
                    onPressed: () => onSelect(option.locale),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _LoginSecurityLine extends StatelessWidget {
  const _LoginSecurityLine({
    required this.controlKey,
    required this.country,
    required this.copy,
    required this.onTap,
  });

  final Key controlKey;
  final LoginCountry country;
  final LoginSecurityCopy copy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String countryName = switch (country) {
      LoginCountry.unitedArabEmirates => 'UAE',
      _ => localizedLoginCountryName(l10n, country),
    };
    final TpPalette palette = TpPalette.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: controlKey,
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Align(
          alignment: const Alignment(0, 0.25),
          child: Row(
            children: <Widget>[
              Icon(
                Icons.shield_outlined,
                size: 22,
                color: palette.primary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  copy.secureWorkspace(countryName),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: palette.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LoginHelpLinks extends StatelessWidget {
  const _LoginHelpLinks({
    required this.copy,
    required this.onForgotPassword,
    required this.onAccessHelp,
  });

  final LoginSecurityCopy copy;
  final VoidCallback onForgotPassword;
  final VoidCallback onAccessHelp;

  @override
  Widget build(BuildContext context) {
    final ButtonStyle style = TextButton.styleFrom(
      padding: EdgeInsets.zero,
      minimumSize: const Size(48, 48),
      textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500),
    );
    return Row(
      children: <Widget>[
        Expanded(
          flex: 4,
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(
              key: LoginActionKeys.forgotPassword,
              style: style,
              onPressed: onForgotPassword,
              child: Text(copy.forgot, maxLines: 2),
            ),
          ),
        ),
        Expanded(
          flex: 7,
          child: Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TextButton(
              key: LoginActionKeys.accessHelp,
              style: style,
              onPressed: onAccessHelp,
              child: Text(
                copy.access,
                maxLines: 2,
                textAlign: TextAlign.end,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _LoginAlternativeDivider extends StatelessWidget {
  const _LoginAlternativeDivider({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      children: <Widget>[
        Expanded(child: Divider(color: palette.border, height: 1)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: palette.textMuted,
                  fontSize: 11,
                ),
          ),
        ),
        Expanded(child: Divider(color: palette.border, height: 1)),
      ],
    );
  }
}

class _LoginSecurityFooter extends StatelessWidget {
  const _LoginSecurityFooter({required this.copy, required this.appVersion});

  final LoginSecurityCopy copy;
  final String? appVersion;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      children: <Widget>[
        Icon(Icons.shield_outlined, size: 17, color: palette.primary),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            '${copy.authorized} · ${copy.audited}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: palette.textSecondary,
                  fontSize: 10,
                ),
          ),
        ),
        if (appVersion != null) ...<Widget>[
          const SizedBox(width: 8),
          Text(
            copy.version(appVersion!),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: palette.textSecondary,
                  fontSize: 10,
                  fontWeight: FontWeight.w500,
                ),
          ),
        ],
      ],
    );
  }
}

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
    final TpStatusColors colors = TpPalette.of(context).forStatus(tone);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: colors.base),
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
