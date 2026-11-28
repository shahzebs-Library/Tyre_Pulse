/// The full "All services" menu Home opens from its hamburger icon and from
/// the "More" action.
///
/// One full page, pushed with [Navigator] (no route of its own), listing
/// every Home tile the person can reach, grouped by [HomeSectionSpec] with a
/// heading per section, searchable by label. It owns no navigation: the
/// caller supplies each tile's label and icon ([HomeServiceMeta]) and what a
/// tap does ([HomeServicesMenuScreen.onOpen]), so the catalogue, its access
/// filter and the destinations all stay in `home_screen.dart`, in one place.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/home/home_layout.dart';

/// A tile's visible label and icon.
typedef HomeServiceMeta = ({String label, IconData icon});

/// Keys the tests (and only the tests) find the menu's parts by.
abstract final class HomeServicesMenuKeys {
  /// The scrolling list. Kept on the historic sheet key so older tests that
  /// scroll "the services sheet" still find it.
  static const Key list = Key('home.action.servicesSheet');
  static const Key search = Key('home.services.search');
  static const Key empty = Key('home.services.empty');
  static Key section(String id) => Key('home.services.section.$id');
  static Key tile(String id) => Key('home.services.tile.$id');
}

/// The localised heading for a [HomeSectionSpec.id].
String homeServicesSectionTitle(AppLocalizations l10n, String id) =>
    switch (id) {
      'field' => l10n.homeServicesSectionField,
      'fleet' => l10n.homeServicesSectionFleet,
      'maintenance' => l10n.homeServicesSectionMaintenance,
      'management' => l10n.homeServicesSectionManagement,
      'approvals' => l10n.homeServicesSectionApprovals,
      _ => id,
    };

/// How many tiles share one row at [width] with [textScale].
///
/// Three on a phone; two when the screen is very narrow or the text is
/// enlarged past 1.3x (three columns of two-line labels at 2x text do not
/// fit); more on a tablet.
int homeServicesColumns(double width, double textScale) {
  if (width < 340 || textScale > 1.3) return 2;
  if (width >= 900) return 6;
  if (width >= 600) return 4;
  return 3;
}

class HomeServicesMenuScreen extends StatefulWidget {
  const HomeServicesMenuScreen({
    required this.sections,
    required this.metaFor,
    required this.onOpen,
    super.key,
  });

  /// Already filtered to what the person can access; an empty section is
  /// hidden regardless.
  final List<HomeSectionSpec> sections;
  final HomeServiceMeta Function(String id) metaFor;

  /// Called with the tile id after the menu has closed itself.
  final void Function(String id) onOpen;

  @override
  State<HomeServicesMenuScreen> createState() => _HomeServicesMenuScreenState();
}

class _HomeServicesMenuScreenState extends State<HomeServicesMenuScreen> {
  final TextEditingController _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  void _open(String id) {
    Navigator.of(context).pop();
    widget.onOpen(id);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String needle = _query.text.trim().toLowerCase();

    final List<(HomeSectionSpec, List<HomeTileSpec>)> groups =
        <(HomeSectionSpec, List<HomeTileSpec>)>[
      for (final HomeSectionSpec section in widget.sections)
        (
          section,
          <HomeTileSpec>[
            for (final HomeTileSpec tile in section.tiles)
              if (needle.isEmpty ||
                  widget.metaFor(tile.id).label.toLowerCase().contains(needle))
                tile,
          ],
        ),
    ]
            .where(((HomeSectionSpec, List<HomeTileSpec>) g) => g.$2.isNotEmpty)
            .toList();

    return Scaffold(
      backgroundColor: palette.background,
      appBar: TpAppBar(
        title: l10n.homeServicesTitle,
        onBack: () => Navigator.of(context).maybePop(),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: TextField(
                key: HomeServicesMenuKeys.search,
                controller: _query,
                onChanged: (_) => setState(() {}),
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: l10n.homeServicesSearchHint,
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _query.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: l10n.homeServicesClearSearch,
                          icon: const Icon(Icons.close_rounded),
                          onPressed: () => setState(_query.clear),
                        ),
                  filled: true,
                  fillColor: palette.surface,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(TpRadius.md),
                    borderSide: BorderSide(color: palette.controlBorder),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(TpRadius.md),
                    borderSide: BorderSide(color: palette.controlBorder),
                  ),
                ),
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints box) {
                  final int columns = homeServicesColumns(
                    box.maxWidth,
                    MediaQuery.textScalerOf(context).scale(10) / 10,
                  );
                  return ListView(
                    key: HomeServicesMenuKeys.list,
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                    children: <Widget>[
                      if (groups.isEmpty)
                        Padding(
                          key: HomeServicesMenuKeys.empty,
                          padding: const EdgeInsets.symmetric(vertical: 48),
                          child: Column(
                            children: <Widget>[
                              Icon(
                                Icons.search_off_rounded,
                                size: 40,
                                color: palette.textMuted,
                              ),
                              const SizedBox(height: 12),
                              Text(
                                l10n.homeServicesEmpty,
                                textAlign: TextAlign.center,
                                style: text.titleMedium?.copyWith(
                                  color: palette.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      for (final (
                            HomeSectionSpec section,
                            List<HomeTileSpec> tiles
                          ) in groups) ...<Widget>[
                        Padding(
                          key: HomeServicesMenuKeys.section(section.id),
                          padding: const EdgeInsetsDirectional.only(
                            top: 16,
                            bottom: 10,
                            start: 4,
                          ),
                          child: Semantics(
                            header: true,
                            child: Text(
                              homeServicesSectionTitle(l10n, section.id),
                              style: text.titleMedium?.copyWith(
                                color: palette.text,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ),
                        for (int start = 0;
                            start < tiles.length;
                            start += columns)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                for (int i = start; i < start + columns; i++)
                                  Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 5,
                                      ),
                                      child: i < tiles.length
                                          ? _ServiceTile(
                                              key: HomeServicesMenuKeys.tile(
                                                tiles[i].id,
                                              ),
                                              meta: widget.metaFor(tiles[i].id),
                                              onTap: () => _open(tiles[i].id),
                                            )
                                          : const SizedBox.shrink(),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                      ],
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({required this.meta, required this.onTap, super.key});

  final HomeServiceMeta meta;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      label: meta.label,
      excludeSemantics: true,
      child: Material(
        color: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
          side: BorderSide(color: palette.border),
        ),
        child: InkWell(
          onTap: onTap,
          customBorder: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(TpRadius.md),
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 96),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(6, 12, 6, 10),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Container(
                    width: 48,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: palette.primarySoft,
                      shape: BoxShape.circle,
                    ),
                    child: TpIcon(meta.icon, size: 24, color: palette.primary),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    meta.label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: text.bodySmall?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w700,
                      height: 1.2,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
