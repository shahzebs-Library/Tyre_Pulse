/// `/admin/sites` - the site register, with region and active editing.
///
/// Ported from `mobile/app/(app)/admin/sites.tsx`, narrowed to the two fields
/// an administrator changes from a phone. RLS `sites_write` (live, checked
/// 2026-09-28) admits Admin and Manager only, so editing is offered only to
/// those roles (plus super admins, who pass `sites_org_isolation`); everybody
/// else sees the list read-only with a note saying why.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_ui.dart';

/// Mirrors the `sites_write` policy: `get_my_role() IN ('Admin','Manager')`.
bool adminCanEditSites(AccessState access) =>
    access.isSuperAdmin ||
    access.role.id == RoleId.admin ||
    access.role.id == RoleId.manager;

class AdminSitesScreen extends ConsumerStatefulWidget {
  const AdminSitesScreen({required this.route, super.key});

  final AdminSitesRoute route;

  @override
  ConsumerState<AdminSitesScreen> createState() => _AdminSitesScreenState();
}

class _AdminSitesScreenState extends ConsumerState<AdminSitesScreen> {
  final TextEditingController _search = TextEditingController();
  List<AdminSite> _sites = const <AdminSite>[];
  Object? _error;
  bool _loading = true;
  bool? _active;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<AdminSite> rows =
          await ref.read(adminRepositoryProvider).listSites();
      if (!mounted) return;
      setState(() {
        _sites = rows;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.adminSitesTitle,
        subtitle: _loading ? null : l10n.adminSitesCount(_sites.length),
        backFallback: fallback,
      ),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(
        error: adminErrorOf(_error!, l10n.adminSitesLoadFailed),
        onRetry: _load,
      );
    }
    final bool canEdit = adminCanEditSites(ref.watch(accessStateProvider));
    final List<AdminSite> shown = _sites.where((AdminSite site) {
      if (_active != null && site.isActive != _active) return false;
      return site.matches(_search.text);
    }).toList(growable: false);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          if (!canEdit) ...<Widget>[
            AdminNote(l10n.adminSitesReadOnlyNote),
            const SizedBox(height: TpSpace.md),
          ],
          TpSearchField(
            key: const Key('admin.sites.search'),
            controller: _search,
            hint: l10n.adminSitesSearchHint,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: TpSpace.md),
          TpSegmented<bool?>(
            key: const Key('admin.sites.filter'),
            expanded: true,
            value: _active,
            onChanged: (bool? value) => setState(() => _active = value),
            options: <TpSegmentedOption<bool?>>[
              TpSegmentedOption<bool?>(
                value: null,
                label: l10n.adminUsersFilterAll,
              ),
              TpSegmentedOption<bool?>(
                value: true,
                label: l10n.adminSitesActive,
              ),
              TpSegmentedOption<bool?>(
                value: false,
                label: l10n.adminSitesInactive,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          if (shown.isEmpty)
            TpEmptyState(
              icon: Icons.location_off_outlined,
              title: l10n.adminSitesEmptyTitle,
              message: _sites.isEmpty
                  ? l10n.adminSitesEmptyMessage
                  : l10n.adminUsersEmptyMessage,
            )
          else
            for (final AdminSite site in shown) ...<Widget>[
              _SiteCard(
                site: site,
                onTap: canEdit ? () => unawaited(_edit(site)) : null,
              ),
              const SizedBox(height: TpSpace.sm),
            ],
        ],
      ),
    );
  }

  Future<void> _edit(AdminSite site) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final (String?, bool)? result = await TpBottomSheet.show<(String?, bool)>(
      context: context,
      title: l10n.adminSitesEditTitle,
      builder: (BuildContext sheetContext) => _SiteEditor(site: site),
    );
    if (result == null || !mounted) return;
    try {
      await ref.read(adminRepositoryProvider).updateSite(
            siteId: site.id,
            region: result.$1,
            active: result.$2,
          );
      if (!mounted) return;
      adminShowSnack(context, l10n.adminSitesSaved);
      await _load();
    } on Object catch (error) {
      if (!mounted) return;
      adminShowSnack(
        context,
        adminErrorOf(error, l10n.adminSitesSaveFailed).message,
      );
    }
  }
}

class _SiteCard extends StatelessWidget {
  const _SiteCard({required this.site, required this.onTap});

  final AdminSite site;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String detail = <String?>[
      site.country,
      site.region ?? l10n.adminSitesNoRegion,
      site.siteCode,
    ].whereType<String>().join(' · ');
    return TpCard(
      key: Key('admin.sites.row.${site.id}'),
      onTap: onTap,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          Icon(Icons.location_on_outlined, color: palette.primaryDark),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(site.name, style: text.titleSmall),
                const SizedBox(height: 2),
                Text(
                  detail,
                  style: text.bodySmall?.copyWith(
                    color: palette.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          TpStatusChip(
            status: site.isActive ? TpStatus.ok : TpStatus.neutral,
            label:
                site.isActive ? l10n.adminSitesActive : l10n.adminSitesInactive,
            isCompact: true,
          ),
        ],
      ),
    );
  }
}

class _SiteEditor extends StatefulWidget {
  const _SiteEditor({required this.site});

  final AdminSite site;

  @override
  State<_SiteEditor> createState() => _SiteEditorState();
}

class _SiteEditorState extends State<_SiteEditor> {
  late final TextEditingController _region =
      TextEditingController(text: widget.site.region ?? '');
  late bool _active = widget.site.isActive;

  @override
  void dispose() {
    _region.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            widget.site.name,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.md),
          TextField(
            key: const Key('admin.sites.regionField'),
            controller: _region,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(labelText: l10n.adminSitesRegionLabel),
          ),
          const SizedBox(height: TpSpace.sm),
          SwitchListTile(
            key: const Key('admin.sites.activeSwitch'),
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.adminSitesActiveLabel),
            value: _active,
            onChanged: (bool value) => setState(() => _active = value),
          ),
          const SizedBox(height: TpSpace.md),
          TpButton.primary(
            key: const Key('admin.sites.save'),
            label: l10n.adminSitesSave,
            isFullWidth: true,
            onPressed: () => Navigator.of(context).pop(
              (
                _region.text.trim().isEmpty ? null : _region.text.trim(),
                _active,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
