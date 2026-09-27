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
  static const Key passwordToggle = Key('login.password_toggle');
  static const Key forgotPassword = Key('login.forgot_password');
  static const Key accessHelp = Key('login.access_help');
}

@immutable
class _LanguageOption {
  const _LanguageOption({
    required this.locale,
    required this.shortLabel,
    required this.name,
  });

  final Locale locale;

  /// What the segmented pill shows (mocks 01-03: EN / العربية / اردو).
  final String shortLabel;

  /// What a screen reader announces. Each language is named in itself, the
  /// universal convention for a language picker, so these are not l10n keys.
  final String name;
}

const List<_LanguageOption> _kLanguageOptions = <_LanguageOption>[
  _LanguageOption(locale: Locale('en'), shortLabel: 'EN', name: 'English'),
  _LanguageOption(
    locale: Locale('ar'),
    shortLabel: 'العربية',
    name: 'العربية',
  ),
  _LanguageOption(locale: Locale('ur'), shortLabel: 'اردو', name: 'اردو'),
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
      case SignInSsoRequired(:final error):
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
                height: _kCompactHeroHeight,
                child: _ExactLoginHero(
                  key: const Key('login.brand.panel'),
                  country: selectedCountry,
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                top: _kCompactFormTop,
                height: 516 + feedbackExtra,
                child: _ExactLoginForm(
                  key: const Key('login.form.card'),
                  curvedTop: true,
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
                    curvedTop: false,
                    // The wide hero already carries the country control.
                    countryControlKey: null,
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

/// The brand gold used by the mock family for the hero rule, the form's
/// curved rim and the country footer rules.
const Color _kLoginGold = Color(0xFFD29A45);

/// Height of the compact hero. It runs 40dp past the form's top so the lowest
/// point of the form's curved edge still sits over artwork, never over the
/// scaffold background.
const double _kCompactHeroHeight = 368;

/// Top of the compact form, and how far its curved edge dips at the physical
/// left. `_kCompactFormTop + _kFormEdgeDip == _kCompactHeroHeight`.
const double _kCompactFormTop = 328;
const double _kFormEdgeDip = 40;

String _countryHeroAsset(LoginCountry country) => switch (country) {
      LoginCountry.saudiArabia => 'assets/login/figma_city_background.png',
      LoginCountry.unitedArabEmirates =>
        'assets/login/united_arab_emirates_hero.png',
      LoginCountry.egypt => 'assets/login/egypt_hero.png',
    };

/// Where each country's artwork is anchored inside the compact hero, chosen
/// so the landmark and the PMV machine both sit above the form's curved edge
/// (mocks 01-03). The Saudi composition is a pre-cropped 390dp export and is
/// anchored at its top edge like before.
Alignment _countryHeroAlignment(LoginCountry country) => switch (country) {
      LoginCountry.saudiArabia => Alignment.topCenter,
      LoginCountry.unitedArabEmirates => const Alignment(0, 0.15),
      LoginCountry.egypt => const Alignment(0, 0.2),
    };

const List<Shadow> _kHeroTextShadow = <Shadow>[
  Shadow(color: Color(0x99000000), blurRadius: 8),
];

class _ExactLoginHero extends StatelessWidget {
  const _ExactLoginHero({required this.country, super.key});

  final LoginCountry country;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String asset = _countryHeroAsset(country);
    final bool saudi = country == LoginCountry.saudiArabia;

    return Semantics(
      key: const Key('login.country.hero'),
      container: true,
      explicitChildNodes: true,
      label: l10n.loginSelectedCountrySemantics(
        localizedLoginCountryName(l10n, country),
      ),
      child: ColoredBox(
        color: const Color(0xFF030A29),
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            Image.asset(
              asset,
              key: ValueKey<String>(asset),
              fit: BoxFit.cover,
              alignment: _countryHeroAlignment(country),
              excludeFromSemantics: true,
              filterQuality: FilterQuality.high,
            ),
            if (saudi) ...<Widget>[
              // The Saudi export carries a light band at its bottom edge.
              // Fading it to the night ground keeps the curved form edge
              // reading as the only boundary, as in the mock.
              const Positioned(
                left: 0,
                right: 0,
                top: 270,
                bottom: 0,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: <Color>[
                        Color(0x000A0E1A),
                        Color(0xFF0A0E1A),
                        Color(0xFF0A0E1A),
                      ],
                      stops: <double>[0, 0.56, 1],
                    ),
                  ),
                ),
              ),
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
              // Masks only the lettering baked into the Saudi export's
              // top-left corner; it fades out before the landmark begins, so
              // the artwork itself is never dimmed.
              const Positioned(
                left: 0,
                top: 0,
                width: 185,
                height: 176,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: <Color>[
                        Color(0xFF030A29),
                        Color(0xFF030A29),
                        Color(0x00030A29),
                      ],
                      stops: <double>[0, 0.81, 1],
                    ),
                  ),
                ),
              ),
            ],
            Positioned(
              left: 24,
              top: 44,
              width: 58,
              height: 30,
              child: Image.asset(
                'assets/login/figma_brand_pulse.png',
                fit: BoxFit.contain,
                excludeFromSemantics: true,
              ),
            ),
            Positioned(
              left: 84,
              top: 34,
              width: 126,
              child: Semantics(
                key: const Key('login.brand.title'),
                container: true,
                header: true,
                label: l10n.appTitle,
                child: ExcludeSemantics(
                  child: Text(
                    'TYRE\nPULSE',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          color: Colors.white,
                          fontSize: 24,
                          height: 0.98,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.2,
                          shadows: _kHeroTextShadow,
                        ),
                  ),
                ),
              ),
            ),
            const Positioned(
              left: 24,
              top: 116,
              width: 28,
              height: 2,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: _kLoginGold,
                  borderRadius: BorderRadius.all(Radius.circular(1)),
                ),
              ),
            ),
            Positioned(
              left: 24,
              top: 130,
              width: 176,
              child: Text(
                l10n.loginHeroTitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: Colors.white,
                      fontSize: 18,
                      height: 1.2,
                      fontWeight: FontWeight.w500,
                      shadows: _kHeroTextShadow,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The compact form's top edge: a curve that dips at the physical left and
/// rises to the right, finished with a thin gold rim (mocks 01-03).
///
/// The curve is deliberately physical rather than directional: it follows the
/// landmark artwork above it, which is not mirrored in RTL either.
@immutable
class _LoginFormEdge extends ShapeBorder {
  const _LoginFormEdge({required this.dip, required this.rimColor});

  final double dip;
  final Color rimColor;

  static const double _rimWidth = 2;

  Path _edge(Rect rect) => Path()
    ..moveTo(rect.left, rect.top + dip)
    ..cubicTo(
      rect.left + rect.width * 0.3,
      rect.top,
      rect.left + rect.width * 0.6,
      rect.top,
      rect.right,
      rect.top,
    );

  @override
  EdgeInsetsGeometry get dimensions => EdgeInsets.zero;

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) => _edge(rect)
    ..lineTo(rect.right, rect.bottom)
    ..lineTo(rect.left, rect.bottom)
    ..close();

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) =>
      getOuterPath(rect, textDirection: textDirection);

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    canvas.drawPath(
      _edge(rect),
      Paint()
        ..color = rimColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = _rimWidth
        ..isAntiAlias = true,
    );
  }

  @override
  ShapeBorder scale(double t) =>
      _LoginFormEdge(dip: dip * t, rimColor: rimColor);

  @override
  bool operator ==(Object other) =>
      other is _LoginFormEdge && other.dip == dip && other.rimColor == rimColor;

  @override
  int get hashCode => Object.hash(dip, rimColor);
}

class _ExactLoginForm extends StatelessWidget {
  const _ExactLoginForm({
    required this.curvedTop,
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

  /// Compact phones draw the mock's curved, gold-rimmed top edge over the
  /// hero. The wide split layout keeps a plain rounded card beside its hero.
  final bool curvedTop;

  /// Key of the country footer control, or null when the country control
  /// lives elsewhere (the wide hero owns it, so the form does not repeat it).
  final Key? countryControlKey;
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
    final Key? footerKey = countryControlKey;

    return Material(
      color: palette.surface,
      shape: curvedTop
          ? const _LoginFormEdge(dip: _kFormEdgeDip, rimColor: _kLoginGold)
          : const RoundedRectangleBorder(
              borderRadius: BorderRadius.vertical(top: Radius.circular(48)),
            ),
      clipBehavior: Clip.antiAlias,
      child: AutofillGroup(
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final double fieldWidth =
                (constraints.maxWidth - 56).clamp(240, 480).toDouble();
            final double left = (constraints.maxWidth - fieldWidth) / 2;
            final double toggleWidth = fieldWidth < 232 ? fieldWidth : 232.0;
            final double toggleLeft = (constraints.maxWidth - toggleWidth) / 2;
            return Stack(
              children: <Widget>[
                Positioned(
                  left: toggleLeft,
                  top: 26,
                  width: toggleWidth,
                  height: 52,
                  child: _LanguageToggle(
                    active: activeLocale,
                    onSelect: onSelectLocale,
                  ),
                ),
                Positioned(
                  left: left,
                  top: 88,
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
                  top: 124,
                  width: fieldWidth,
                  child: Text(
                    l10n.loginSignInSubtitle,
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
                  top: 156,
                  width: fieldWidth,
                  child: _FieldLabel(l10n.loginIdentifierLabel),
                ),
                Positioned(
                  left: left,
                  top: 175,
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
                  top: 232,
                  width: fieldWidth,
                  child: _FieldLabel(l10n.loginPasswordLabel),
                ),
                Positioned(
                  left: left,
                  top: 251,
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
                    suffix: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        SizedBox(
                          width: 1,
                          height: 28,
                          child: ColoredBox(color: palette.border),
                        ),
                        IconButton(
                          key: LoginActionKeys.passwordToggle,
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
                      ],
                    ),
                  ),
                ),
                if (hasFeedback)
                  Positioned(
                    left: left,
                    right: left,
                    top: 308,
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
                  top: 315 + feedbackOffset,
                  width: fieldWidth,
                  height: 52,
                  child: TpButton.primary(
                    key: const Key('login.submit'),
                    label: l10n.actionSignIn,
                    isFullWidth: true,
                    isBusy: isSubmitting,
                    onPressed: busy ? null : () => unawaited(onSubmit()),
                  ),
                ),
                Positioned(
                  left: left,
                  top: 372 + feedbackOffset,
                  width: fieldWidth,
                  height: 48,
                  child: _LoginQuietActions(
                    copy: copy,
                    isBiometricChecking: isBiometricChecking,
                    onForgotPassword: onForgotPassword,
                    onAccessHelp: onAccessHelp,
                    onBiometric: busy ? null : () => unawaited(onBiometric()),
                  ),
                ),
                if (footerKey != null)
                  Positioned(
                    left: left,
                    top: 424 + feedbackOffset,
                    width: fieldWidth,
                    height: 52,
                    child: _CountryFooter(
                      controlKey: footerKey,
                      country: country,
                      onTap: onChangeCountry,
                    ),
                  ),
                if (appVersion != null)
                  Positioned(
                    left: left,
                    top: 482 + feedbackOffset,
                    width: fieldWidth,
                    height: 18,
                    child: Text(
                      copy.version(appVersion!),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.textMuted,
                            fontSize: 10,
                          ),
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

/// One segmented pill (mocks 01-03): short labels, thin dividers between
/// unselected neighbours, and the active language filled in the form's navy
/// ink. Each segment announces the full language name and its selected state.
class _LanguageToggle extends StatelessWidget {
  const _LanguageToggle({required this.active, required this.onSelect});

  final Locale active;
  final ValueChanged<Locale> onSelect;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final int selectedIndex = _kLanguageOptions.indexWhere(
      (_LanguageOption option) =>
          option.locale.languageCode == active.languageCode,
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: palette.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(1),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (int index = 0;
                index < _kLanguageOptions.length;
                index++) ...<Widget>[
              if (index > 0)
                Center(
                  child: SizedBox(
                    width: 1,
                    height: 20,
                    child: ColoredBox(
                      color:
                          index - 1 == selectedIndex || index == selectedIndex
                              ? Colors.transparent
                              : palette.border,
                    ),
                  ),
                ),
              Expanded(
                child: _LanguageSegment(
                  option: _kLanguageOptions[index],
                  selected: index == selectedIndex,
                  onTap: () => onSelect(_kLanguageOptions[index].locale),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _LanguageSegment extends StatelessWidget {
  const _LanguageSegment({
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final _LanguageOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final BorderRadius radius = BorderRadius.circular(10);
    return Semantics(
      key: Key('login.language.${option.locale.languageCode}'),
      container: true,
      button: true,
      inMutuallyExclusiveGroup: true,
      selected: selected,
      label: option.name,
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: selected ? palette.text : Colors.transparent,
        borderRadius: radius,
        child: InkWell(
          onTap: onTap,
          borderRadius: radius,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
              child: Text(
                option.shortLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: selected ? palette.surface : palette.text,
                      fontSize: 14,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Forgot-password, device biometrics and access help, kept reachable but
/// visually quiet: the mocks show none of them, yet each is a working path
/// (administrator help dialogs, and the platform biometric bridge).
class _LoginQuietActions extends StatelessWidget {
  const _LoginQuietActions({
    required this.copy,
    required this.isBiometricChecking,
    required this.onForgotPassword,
    required this.onAccessHelp,
    required this.onBiometric,
  });

  final LoginSecurityCopy copy;
  final bool isBiometricChecking;
  final VoidCallback onForgotPassword;
  final VoidCallback onAccessHelp;
  final VoidCallback? onBiometric;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final ButtonStyle style = TextButton.styleFrom(
      foregroundColor: palette.textSecondary,
      padding: EdgeInsets.zero,
      minimumSize: const Size(48, 48),
      textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500),
    );
    return Row(
      children: <Widget>[
        Expanded(
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
        IconButton(
          key: LoginActionKeys.biometric,
          tooltip: copy.biometric,
          color: palette.textSecondary,
          onPressed: onBiometric,
          icon: isBiometricChecking
              ? SizedBox(
                  width: TpSizing.iconSm,
                  height: TpSizing.iconSm,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      palette.textSecondary,
                    ),
                  ),
                )
              : const Icon(Icons.fingerprint),
        ),
        Expanded(
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

/// The mock's footer - gold rule, location pin, gold rule, full country name -
/// kept as the functional 48dp country control (design-qa: the static footer
/// is intentionally the country selector).
class _CountryFooter extends StatelessWidget {
  const _CountryFooter({
    required this.controlKey,
    required this.country,
    required this.onTap,
  });

  final Key controlKey;
  final LoginCountry country;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String countryName = localizedLoginCountryName(l10n, country);
    const Widget rule = Flexible(
      child: SizedBox(
        width: 88,
        height: 1,
        child: ColoredBox(color: _kLoginGold),
      ),
    );
    return Semantics(
      container: true,
      button: true,
      label: l10n.loginSelectedCountrySemantics(countryName),
      hint: l10n.loginChangeCountryAction,
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: controlKey,
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  rule,
                  const SizedBox(width: TpSpace.md),
                  Image.asset(
                    'assets/login/figma_location.png',
                    width: 22,
                    height: 22,
                    excludeFromSemantics: true,
                  ),
                  const SizedBox(width: TpSpace.md),
                  rule,
                ],
              ),
              const SizedBox(height: 4),
              Text(
                countryName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: palette.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
              ),
            ],
          ),
        ),
      ),
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
