import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';

const Color _navy = Color(0xFF071F68);
const Color _border = Color(0xFFD7DFEC);

class ProfileDisplayPreferences extends ConsumerWidget {
  const ProfileDisplayPreferences({
    this.title = 'Language & display',
    this.appLanguageLabel = 'App language',
    this.checklistLanguageLabel = 'Checklist content language',
    this.checklistLanguageValue = 'System default',
    this.checklistLanguageCaption = 'Independent from app language',
    this.themeLabel = 'Theme',
    super.key,
  });

  final String title;
  final String appLanguageLabel;
  final String checklistLanguageLabel;
  final String checklistLanguageValue;
  final String checklistLanguageCaption;
  final String themeLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final locale = ref.watch(localeProvider);
    final mode = ref.watch(themeModeProvider);
    return Column(
      key: const Key('profile.displayPreferences'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsetsDirectional.only(start: 2, bottom: 8),
          child: Text(
            title,
            style: const TextStyle(
              color: _navy,
              fontSize: 19,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            border: Border.all(color: _border),
            borderRadius: BorderRadius.circular(9),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: <Widget>[
              _PreferenceRow(
                icon: Icons.translate,
                label: appLanguageLabel,
                trailing: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        key: const Key('profile.language'),
                        value: locale?.languageCode ?? 'system',
                        isDense: true,
                        isExpanded: true,
                        alignment: AlignmentDirectional.centerEnd,
                        icon: const Icon(Icons.chevron_right, color: _navy),
                        style: const TextStyle(color: _navy, fontSize: 15),
                        items: <DropdownMenuItem<String>>[
                          DropdownMenuItem(
                            value: 'system',
                            child: Text(l10n.profileDeviceSetting),
                          ),
                          for (final supported
                              in TpLocalizations.supportedLocales)
                            DropdownMenuItem(
                              value: supported.languageCode,
                              child: Text(
                                switch (supported.languageCode) {
                                  'ar' => 'العربية',
                                  'ur' => 'اردو',
                                  _ => 'English',
                                },
                              ),
                            ),
                        ],
                        onChanged: (value) {
                          if (value == null) return;
                          ref.read(localeProvider.notifier).setLocale(
                                value == 'system' ? null : Locale(value),
                              );
                        },
                      ),
                    ),
                    const Text(
                      'English, العربية, اردو',
                      style: TextStyle(color: _navy, fontSize: 12),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1, color: _border),
              _PreferenceRow(
                icon: Icons.article_outlined,
                label: checklistLanguageLabel,
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Flexible(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Text(
                            checklistLanguageValue,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: _navy, fontSize: 15),
                          ),
                          Text(
                            checklistLanguageCaption,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: _navy, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 9),
                    const Icon(Icons.chevron_right, color: _navy),
                  ],
                ),
                onTap: () => showDialog<void>(
                  context: context,
                  builder: (dialogContext) => AlertDialog(
                    title: Text(checklistLanguageLabel),
                    content: Text(checklistLanguageCaption),
                    actions: <Widget>[
                      TextButton(
                        onPressed: () => Navigator.of(dialogContext).pop(),
                        child: Text(
                          MaterialLocalizations.of(dialogContext)
                              .closeButtonLabel,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const Divider(height: 1, color: _border),
              _PreferenceRow(
                icon: Icons.palette_outlined,
                label: themeLabel,
                trailing: DropdownButtonHideUnderline(
                  child: DropdownButton<ThemeMode>(
                    key: const Key('profile.theme'),
                    value: mode,
                    isDense: true,
                    isExpanded: true,
                    alignment: AlignmentDirectional.centerEnd,
                    icon: const Icon(Icons.chevron_right, color: _navy),
                    style: const TextStyle(color: _navy, fontSize: 15),
                    items: <DropdownMenuItem<ThemeMode>>[
                      DropdownMenuItem(
                        value: ThemeMode.light,
                        child: Text(l10n.profileThemeLight),
                      ),
                      DropdownMenuItem(
                        value: ThemeMode.dark,
                        child: Text(l10n.profileThemeDark),
                      ),
                      DropdownMenuItem(
                        value: ThemeMode.system,
                        child: Text(l10n.profileDeviceSetting),
                      ),
                    ],
                    onChanged: (value) {
                      if (value != null) {
                        ref.read(themeModeProvider.notifier).setMode(value);
                      }
                    },
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PreferenceRow extends StatelessWidget {
  const _PreferenceRow({
    required this.icon,
    required this.label,
    required this.trailing,
    this.onTap,
  });
  final IconData icon;
  final String label;
  final Widget trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final narrow = constraints.maxWidth < 420;
          final heading = Row(
            children: <Widget>[
              Icon(icon, size: 23, color: _navy),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _navy,
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          );
          return InkWell(
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 54),
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                child: narrow
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          heading,
                          const SizedBox(height: 6),
                          Align(
                            alignment: AlignmentDirectional.centerEnd,
                            child: SizedBox(
                              width: constraints.maxWidth - 28,
                              child: trailing,
                            ),
                          ),
                        ],
                      )
                    : Row(
                        children: <Widget>[
                          Expanded(child: heading),
                          const SizedBox(width: 10),
                          Flexible(child: trailing),
                        ],
                      ),
              ),
            ),
          );
        },
      );
}
