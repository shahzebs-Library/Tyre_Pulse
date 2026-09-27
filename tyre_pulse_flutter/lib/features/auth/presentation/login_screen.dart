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
                height: 844 - _kCompactFormTop + feedbackExtra,
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

/// The highlight end of the gold rim and rules.
const Color _kLoginGoldLight = Color(0xFFF1CB85);

/// Height of the compact hero. It runs [_kFormEdgeDip] past the form's top so
/// the lowest point of the form's curved edge still sits over artwork, never
/// over the scaffold background (mocks 01-03 give the artwork the whole upper
/// half of the phone).
const double _kCompactHeroHeight = 424;

/// Top of the compact form, and how far its curved edge dips at the physical
/// left. `_kCompactFormTop + _kFormEdgeDip == _kCompactHeroHeight`.
const double _kCompactFormTop = 344;
const double _kFormEdgeDip = 80;

/// Every country uses its full-resolution landmark composition. The earlier
/// Saudi cut-outs were low-resolution crops of the mock with its white curve
/// baked in, which showed as a hard box around the machine.
String _countryHeroAsset(LoginCountry country) => switch (country) {
      LoginCountry.saudiArabia => 'assets/login/saudi_arabia_hero.png',
      LoginCountry.unitedArabEmirates =>
        'assets/login/united_arab_emirates_hero.png',
      LoginCountry.egypt => 'assets/login/egypt_hero.png',
    };

/// Where each composition is anchored inside the compact hero, so the
/// landmark and the PMV machine both sit above the form's curved edge.
Alignment _countryHeroAlignment(LoginCountry country) => switch (country) {
      LoginCountry.saudiArabia => const Alignment(0, 0.86),
      LoginCountry.unitedArabEmirates => const Alignment(0, 0.66),
      LoginCountry.egypt => const Alignment(0, 0.84),
    };

/// Brightness 1.1x, a touch of contrast and saturation; alpha untouched.
const List<double> _kHeroLift = <double>[
  1.16, 0.02, 0.02, 0, 4, //
  0.02, 1.16, 0.02, 0, 4, //
  0.02, 0.02, 1.16, 0, 6, //
  0, 0, 0, 1, 0, //
];

const List<Shadow> _kHeroTextShadow = <Shadow>[
  Shadow(color: Color(0x99000000), blurRadius: 10, offset: Offset(0, 1)),
];

/// The night navy the artwork is composed on, used behind the image while it
/// decodes and for the legibility scrim behind the brand lockup.
const Color _kHeroNight = Color(0xFF030A29);

class _ExactLoginHero extends StatelessWidget {
  const _ExactLoginHero({required this.country, super.key});

  final LoginCountry country;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String asset = _countryHeroAsset(country);
    final TextTheme text = Theme.of(context).textTheme;

    return Semantics(
      key: const Key('login.country.hero'),
      container: true,
      explicitChildNodes: true,
      label: l10n.loginSelectedCountrySemantics(
        localizedLoginCountryName(l10n, country),
      ),
      child: ColoredBox(
        color: _kHeroNight,
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            // A gentle lift in exposure and contrast so the night artwork
            // reads as lit landmarks rather than a dark photo on a phone
            // screen outdoors.
            ColorFiltered(
              colorFilter: const ColorFilter.matrix(_kHeroLift),
              child: Image.asset(
                asset,
                key: ValueKey<String>(asset),
                fit: BoxFit.cover,
                alignment: _countryHeroAlignment(country),
                excludeFromSemantics: true,
                filterQuality: FilterQuality.high,
              ),
            ),
            // A soft wash from the physical top-left only, so the lockup reads
            // on any sky while the landmark and machine keep full brightness.
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(-1.1, -1.05),
                  radius: 1.15,
                  colors: <Color>[
                    Color(0xD9030A29),
                    Color(0x80030A29),
                    Color(0x00030A29),
                  ],
                  stops: <double>[0, 0.45, 1],
                ),
              ),
            ),
            // The faint geometric lattice of the mocks, fading out long
            // before it reaches the landmark.
            const Positioned(
              left: 0,
              top: 0,
              width: 240,
              height: 220,
              child: ExcludeSemantics(
                child: CustomPaint(painter: _LatticePainter()),
              ),
            ),
            // Physically anchored top-left in every language: the artwork is
            // not mirrored in RTL, so the copy stays over the open sky and
            // never over the landmark. The brand lockup is a logo and stays
            // left-to-right; the localized title keeps its own direction.
            Positioned(
              left: 24,
              top: 56,
              right: 72,
              child: _LoginEntrance(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  textDirection: TextDirection.ltr,
                  children: <Widget>[
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      textDirection: TextDirection.ltr,
                      children: <Widget>[
                        Image.asset(
                          'assets/login/figma_brand_pulse.png',
                          width: 66,
                          height: 34,
                          fit: BoxFit.contain,
                          excludeFromSemantics: true,
                        ),
                        const SizedBox(width: 6),
                        Semantics(
                          key: const Key('login.brand.title'),
                          container: true,
                          header: true,
                          label: l10n.appTitle,
                          child: ExcludeSemantics(
                            child: Text(
                              'TYRE\nPULSE',
                              textDirection: TextDirection.ltr,
                              style: text.titleLarge?.copyWith(
                                color: Colors.white,
                                fontSize: 27,
                                height: 0.94,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 0.6,
                                shadows: _kHeroTextShadow,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 22),
                    const SizedBox(
                      width: 34,
                      height: 3,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: <Color>[_kLoginGoldLight, _kLoginGold],
                          ),
                          borderRadius: BorderRadius.all(Radius.circular(2)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      l10n.loginHeroTitle,
                      textAlign: TextAlign.left,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: text.titleLarge?.copyWith(
                        color: Colors.white,
                        fontSize: 20,
                        height: 1.2,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.1,
                        shadows: _kHeroTextShadow,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints the thin eight-point star lattice from the mocks' top-left corner,
/// fading radially so it never competes with the artwork.
class _LatticePainter extends CustomPainter {
  const _LatticePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final Rect bounds = Offset.zero & size;
    canvas.saveLayer(bounds, Paint());
    final Paint line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.8
      ..color = const Color(0x383D6BC4);
    const double cell = 38;
    for (double y = -cell / 2; y < size.height + cell; y += cell) {
      for (double x = -cell / 2; x < size.width + cell; x += cell) {
        final Offset c = Offset(x, y);
        const double r = cell * 0.36;
        canvas
          ..drawRect(
            Rect.fromCenter(center: c, width: r * 2, height: r * 2),
            line,
          )
          ..save()
          ..translate(c.dx, c.dy)
          ..rotate(0.785398)
          ..drawRect(
            Rect.fromCenter(center: Offset.zero, width: r * 2, height: r * 2),
            line,
          )
          ..restore();
      }
    }
    canvas
      ..drawRect(
        bounds,
        Paint()
          ..blendMode = BlendMode.dstIn
          ..shader = const RadialGradient(
            center: Alignment.topLeft,
            radius: 1.1,
            colors: <Color>[Color(0xFFFFFFFF), Color(0x00FFFFFF)],
          ).createShader(bounds),
      )
      ..restore();
  }

  @override
  bool shouldRepaint(_LatticePainter oldDelegate) => false;
}

/// A short fade-and-rise for the first frame of the screen. It is skipped
/// entirely when the platform asks for reduced motion, and never hides its
/// child from assistive technology while it runs.
class _LoginEntrance extends StatelessWidget {
  const _LoginEntrance({required this.child, this.delay = 0});

  final Widget child;

  /// Fraction of the run spent waiting before this piece moves, so the hero
  /// copy and the form settle in sequence rather than all at once.
  final double delay;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: 1),
      duration: const Duration(milliseconds: 560),
      curve: Interval(delay, 1, curve: Curves.easeOutCubic),
      builder: (BuildContext context, double t, Widget? child) => Opacity(
        opacity: t,
        alwaysIncludeSemantics: true,
        child: Transform.translate(
          offset: Offset(0, (1 - t) * 14),
          child: child,
        ),
      ),
      child: child,
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

  static const double _rimWidth = 2.5;

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
    final Path edge = _edge(rect);
    // A warm glow first, then the rim itself brightening towards the physical
    // right where the curve flattens out under the landmark.
    canvas
      ..drawPath(
        edge,
        Paint()
          ..color = rimColor.withValues(alpha: 0.35)
          ..style = PaintingStyle.stroke
          ..strokeWidth = _rimWidth * 3
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3)
          ..isAntiAlias = true,
      )
      ..drawPath(
        edge,
        Paint()
          ..shader = LinearGradient(
            colors: <Color>[rimColor, _kLoginGoldLight, rimColor],
            stops: const <double>[0, 0.62, 1],
          ).createShader(rect)
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
            return _LoginEntrance(
              delay: 0.12,
              child: Stack(
                children: <Widget>[
                  Positioned(
                    left: toggleLeft,
                    top: 28,
                    width: toggleWidth,
                    height: 52,
                    child: _LanguageToggle(
                      active: activeLocale,
                      onSelect: onSelectLocale,
                    ),
                  ),
                  Positioned(
                    left: left,
                    top: 90,
                    width: fieldWidth,
                    child: Semantics(
                      header: true,
                      child: Text(
                        l10n.loginWelcomeTitle,
                        style: Theme.of(context)
                            .textTheme
                            .headlineMedium
                            ?.copyWith(
                              color: palette.text,
                              fontSize: 30,
                              height: 1.1,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.3,
                            ),
                      ),
                    ),
                  ),
                  Positioned(
                    left: left,
                    top: 127,
                    width: fieldWidth,
                    child: Text(
                      l10n.loginSignInSubtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: palette.textMuted,
                            fontSize: 14,
                            height: 1.25,
                          ),
                    ),
                  ),
                  Positioned(
                    left: left,
                    top: 158,
                    width: fieldWidth,
                    child: _FieldLabel(l10n.loginIdentifierLabel),
                  ),
                  Positioned(
                    left: left,
                    top: 177,
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
                    top: 234,
                    width: fieldWidth,
                    child: _FieldLabel(l10n.loginPasswordLabel),
                  ),
                  Positioned(
                    left: left,
                    top: 253,
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
                      top: 310,
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
                    top: 316 + feedbackOffset,
                    width: fieldWidth,
                    height: 52,
                    child: _SignInButtonDepth(
                      enabled: !busy,
                      child: TpButton.primary(
                        key: const Key('login.submit'),
                        label: l10n.actionSignIn,
                        isFullWidth: true,
                        isBusy: isSubmitting,
                        onPressed: busy ? null : () => unawaited(onSubmit()),
                      ),
                    ),
                  ),
                  Positioned(
                    left: left,
                    top: 370 + feedbackOffset,
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
                      top: 420 + feedbackOffset,
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
                      top: 474 + feedbackOffset,
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
              ),
            );
          },
        ),
      ),
    );
  }
}

/// Lifts the primary action off the page with a soft green glow, so the one
/// thing to do on this screen reads first (mocks 01-03), and gives its label
/// the mock's larger, bolder weight. The glow drops away while disabled.
class _SignInButtonDepth extends StatelessWidget {
  const _SignInButtonDepth({required this.enabled, required this.child});

  final bool enabled;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TpRadius.md),
        boxShadow: enabled
            ? <BoxShadow>[
                BoxShadow(
                  color: palette.primary.withValues(alpha: 0.3),
                  blurRadius: 16,
                  spreadRadius: -4,
                  offset: const Offset(0, 8),
                ),
              ]
            : const <BoxShadow>[],
      ),
      child: Theme(
        data: theme.copyWith(
          textTheme: theme.textTheme.copyWith(
            labelLarge: theme.textTheme.labelLarge?.copyWith(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
            ),
          ),
        ),
        child: child,
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

class _ExactTextField extends StatefulWidget {
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
  State<_ExactTextField> createState() => _ExactTextFieldState();
}

/// Tracks focus only so the field's own icon and divider can pick up the
/// focus colour together with the border, the way the mocks show an active
/// field.
class _ExactTextFieldState extends State<_ExactTextField> {
  final FocusNode _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocusChange);
  }

  void _onFocusChange() => setState(() {});

  @override
  void dispose() {
    _focus
      ..removeListener(_onFocusChange)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool focused = _focus.hasFocus;
    final OutlineInputBorder border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide(color: palette.border),
    );
    return TextField(
      controller: widget.controller,
      focusNode: _focus,
      enabled: widget.enabled,
      keyboardType: widget.keyboardType,
      textInputAction: widget.textInputAction,
      autofillHints: widget.autofillHints,
      obscureText: widget.obscureText,
      onChanged: widget.onChanged,
      onSubmitted: widget.onSubmitted,
      cursorColor: palette.focus,
      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: palette.text,
            fontSize: 15,
            fontWeight: FontWeight.w500,
          ),
      decoration: InputDecoration(
        hintText: widget.hint,
        hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: palette.textMuted.withValues(alpha: 0.8),
              fontSize: 14,
            ),
        filled: true,
        fillColor: focused ? palette.surface : palette.surfaceAlt,
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        prefixIcon: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Image.asset(
                widget.prefixAsset,
                width: 22,
                height: 22,
                color: focused ? palette.focus : null,
                excludeFromSemantics: true,
              ),
            ),
            SizedBox(
              width: 1,
              height: 24,
              child: ColoredBox(
                color: focused
                    ? palette.focus.withValues(alpha: 0.5)
                    : palette.border,
              ),
            ),
            const SizedBox(width: 12),
          ],
        ),
        prefixIconConstraints: const BoxConstraints(
          minWidth: 48,
          minHeight: 48,
        ),
        suffixIcon: widget.suffix,
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
        elevation: selected ? 2 : 0,
        shadowColor: palette.text,
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
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
      minimumSize: const Size(48, 48),
      textStyle: Theme.of(context).textTheme.labelMedium?.copyWith(
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
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
          style: IconButton.styleFrom(
            backgroundColor: palette.primarySoft,
            foregroundColor: palette.primary,
            disabledBackgroundColor: palette.surfaceAlt,
            side: BorderSide(color: palette.primary.withValues(alpha: 0.25)),
          ),
          onPressed: onBiometric,
          icon: isBiometricChecking
              ? SizedBox(
                  width: TpSizing.iconSm,
                  height: TpSizing.iconSm,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      palette.primary,
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
    Widget rule({required bool leading}) => Flexible(
          child: SizedBox(
            width: 92,
            height: 1.5,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: AlignmentDirectional.centerStart,
                  end: AlignmentDirectional.centerEnd,
                  colors: leading
                      ? const <Color>[Color(0x00D29A45), _kLoginGold]
                      : const <Color>[_kLoginGold, Color(0x00D29A45)],
                ),
              ),
            ),
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
                  rule(leading: true),
                  const SizedBox(width: TpSpace.md),
                  Image.asset(
                    'assets/login/figma_location.png',
                    width: 22,
                    height: 22,
                    excludeFromSemantics: true,
                  ),
                  const SizedBox(width: TpSpace.md),
                  rule(leading: false),
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
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.2,
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
