/// Country-specific login artwork and the visual-country chooser.
///
/// This file deliberately owns presentation only. [LoginCountry] changes the
/// landmark artwork shown before sign-in; it never participates in workspace,
/// organisation, permission, or backend country scoping.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';

@visibleForTesting
abstract final class LoginCountryKeys {
  static const Key hero = Key('login.country.hero');
  static const Key change = Key('login.country.change');
  static const Key picker = Key('login.country.picker');

  static Key option(LoginCountry country) =>
      Key('login.country.option.${country.storageValue}');
}

String _assetPath(LoginCountry country) => switch (country) {
      LoginCountry.saudiArabia => 'assets/login/figma_city_background.png',
      LoginCountry.unitedArabEmirates =>
        'assets/login/united_arab_emirates_pmv_hero.webp',
      LoginCountry.egypt => 'assets/login/egypt_hero.png',
    };

String localizedLoginCountryName(
  AppLocalizations l10n,
  LoginCountry country,
) =>
    switch (country) {
      LoginCountry.saudiArabia => l10n.loginCountrySaudiArabia,
      LoginCountry.unitedArabEmirates => l10n.loginCountryUnitedArabEmirates,
      LoginCountry.egypt => l10n.loginCountryEgypt,
    };

class LoginCountryHero extends StatelessWidget {
  const LoginCountryHero({
    required this.country,
    required this.compact,
    required this.onChangeCountry,
    super.key,
  });

  final LoginCountry country;
  final bool compact;
  final VoidCallback onChangeCountry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String countryName = localizedLoginCountryName(l10n, country);
    final BorderRadius radius = BorderRadius.circular(TpRadius.xl);

    return Semantics(
      key: LoginCountryKeys.hero,
      container: true,
      label: l10n.loginSelectedCountrySemantics(countryName),
      child: SizedBox(
        height: compact ? 300 : 620,
        child: ClipRRect(
          borderRadius: radius,
          child: Stack(
            fit: StackFit.expand,
            children: <Widget>[
              Image.asset(
                _assetPath(country),
                key: ValueKey<String>(_assetPath(country)),
                fit: BoxFit.cover,
                alignment: const Alignment(0, 0.18),
                excludeFromSemantics: true,
                filterQuality: FilterQuality.medium,
              ),
              const ColoredBox(color: Color(0x52020B1E)),
              DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.28),
                    width: TpBorderWidth.hairline,
                  ),
                  borderRadius: radius,
                ),
              ),
              Padding(
                padding: EdgeInsets.all(compact ? TpSpace.lg : TpSpace.xxl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: palette.surface,
                            borderRadius: BorderRadius.circular(TpRadius.md),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(TpSpace.sm),
                            child: Icon(
                              Icons.tire_repair_outlined,
                              size: compact
                                  ? TpSizing.iconLg
                                  : TpSizing.iconState,
                              color: palette.primaryDark,
                            ),
                          ),
                        ),
                        const SizedBox(width: TpSpace.md),
                        Expanded(
                          child: Semantics(
                            key: const Key('login.brand.title'),
                            header: true,
                            child: Text(
                              l10n.appTitle,
                              style: (compact
                                      ? text.headlineSmall
                                      : text.headlineMedium)
                                  ?.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                                shadows: const <Shadow>[
                                  Shadow(
                                    color: Color(0xA6000000),
                                    blurRadius: 8,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const Spacer(),
                    Text(
                      l10n.loginOperationsTitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: (compact ? text.titleLarge : text.headlineSmall)
                          ?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        shadows: const <Shadow>[
                          Shadow(
                            color: Color(0xB8000000),
                            blurRadius: 10,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: TpSpace.md),
                    Material(
                      color: palette.surface,
                      borderRadius: BorderRadius.circular(TpRadius.md),
                      child: InkWell(
                        key: LoginCountryKeys.change,
                        onTap: onChangeCountry,
                        borderRadius: BorderRadius.circular(TpRadius.md),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(
                            minHeight: TpSizing.minTouchTarget,
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: TpSpace.md,
                              vertical: TpSpace.sm,
                            ),
                            child: Row(
                              children: <Widget>[
                                Icon(
                                  Icons.location_on_outlined,
                                  color: palette.primaryDark,
                                  size: TpSizing.iconMd,
                                ),
                                const SizedBox(width: TpSpace.sm),
                                Expanded(
                                  child: Text(
                                    countryName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.labelLarge?.copyWith(
                                      color: palette.text,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: TpSpace.sm),
                                Text(
                                  l10n.loginChangeCountryAction,
                                  style: text.labelMedium?.copyWith(
                                    color: palette.primaryDark,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Future<LoginCountry?> showLoginCountryPicker({
  required BuildContext context,
  required LoginCountry selected,
}) {
  final AppLocalizations l10n = AppLocalizations.of(context);

  return TpBottomSheet.show<LoginCountry>(
    context: context,
    title: l10n.loginSelectCountryTitle,
    builder: (BuildContext sheetContext) {
      final TpPalette palette = TpPalette.of(sheetContext);
      final TextTheme text = Theme.of(sheetContext).textTheme;

      return Semantics(
        key: LoginCountryKeys.picker,
        container: true,
        label: l10n.loginCountrySelectorSemantics,
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                l10n.loginSelectCountrySubtitle,
                style: text.bodyMedium?.copyWith(color: palette.textMuted),
              ),
              const SizedBox(height: TpSpace.lg),
              for (final LoginCountry country
                  in LoginCountry.values) ...<Widget>[
                _CountryOption(
                  country: country,
                  selected: selected == country,
                  onTap: () => Navigator.of(sheetContext).pop(country),
                ),
                if (country != LoginCountry.values.last)
                  const SizedBox(height: TpSpace.md),
              ],
            ],
          ),
        ),
      );
    },
  );
}

class _CountryOption extends StatelessWidget {
  const _CountryOption({
    required this.country,
    required this.selected,
    required this.onTap,
  });

  final LoginCountry country;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String countryName = localizedLoginCountryName(l10n, country);

    return MergeSemantics(
      child: Semantics(
        button: true,
        selected: selected,
        label: countryName,
        child: TpCard(
          key: LoginCountryKeys.option(country),
          onTap: onTap,
          padding: const EdgeInsets.all(TpSpace.sm),
          borderColor: selected ? palette.primary : palette.border,
          background: selected ? palette.primarySoft : palette.surface,
          child: Row(
            children: <Widget>[
              ClipRRect(
                borderRadius: BorderRadius.circular(TpRadius.sm),
                child: Image.asset(
                  _assetPath(country),
                  width: 84,
                  height: 60,
                  fit: BoxFit.cover,
                  alignment: const Alignment(0, 0.2),
                  excludeFromSemantics: true,
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Text(
                  countryName,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Icon(
                selected ? Icons.check_circle : Icons.circle_outlined,
                color: selected ? palette.primary : palette.textMuted,
                size: TpSizing.iconLg,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
