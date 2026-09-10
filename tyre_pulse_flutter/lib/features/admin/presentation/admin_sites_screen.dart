import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/data/admin_sites_repository.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_copy.dart';
import 'package:uuid/uuid.dart';

class AdminSitesScreen extends ConsumerStatefulWidget {
  const AdminSitesScreen({super.key});
  @override
  ConsumerState<AdminSitesScreen> createState() => _AdminSitesScreenState();
}

class _AdminSitesScreenState extends ConsumerState<AdminSitesScreen> {
  int _offset = 0;
  Future<void> _edit([AdminSite? site]) async {
    await Navigator.of(context)
        .push<void>(MaterialPageRoute(builder: (_) => _SiteEditor(site: site)));
    if (mounted) ref.invalidate(adminSitesPageProvider);
  }

  @override
  Widget build(BuildContext context) {
    final copy = AdminCopy(context);
    final l10n = AppLocalizations.of(context);
    final access = ref.watch(accessStateProvider);
    final allowed = ref.watch(canAccessModuleProvider(ModuleKey.admin)) &&
        (access.isSuperAdmin || access.role.isAdministrator);
    return TpScaffold(
      backFallback: TpRoutePaths.home,
      appBar: TpAppBar(title: copy.sites, backFallback: TpRoutePaths.home),
      body: !allowed
          ? TpPermissionDeniedState(reason: l10n.deniedAdminOnly)
          : ref.watch(adminSitesPageProvider(_offset)).when(
                loading: () => const TpLoadingState(),
                error: (error, stack) => TpErrorState(
                  error: mapSupabaseError(error),
                  onRetry: () =>
                      ref.invalidate(adminSitesPageProvider(_offset)),
                ),
                data: (sites) => RefreshIndicator(
                  onRefresh: () =>
                      ref.refresh(adminSitesPageProvider(_offset).future),
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    children: [
                      Text(copy.online),
                      FilledButton.icon(
                        onPressed: _edit,
                        icon: const Icon(Icons.add),
                        label: Text(copy.newSite),
                      ),
                      if (sites.isEmpty)
                        Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(
                            copy.pick(
                              'No sites on this page.',
                              'لا توجد مواقع في هذه الصفحة.',
                              'اس صفحے پر کوئی سائٹ نہیں۔',
                            ),
                          ),
                        ),
                      for (final site in sites)
                        Card(
                          child: ListTile(
                            title: Text(site.name),
                            subtitle: Text(
                              '${site.country}${site.city == null ? '' : ' · ${site.city}'}\n${site.active ? copy.siteActive : copy.archived}',
                            ),
                            trailing: const Icon(Icons.edit_outlined),
                            onTap: () => _edit(site),
                          ),
                        ),
                      Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        spacing: 16,
                        children: [
                          if (_offset > 0)
                            TextButton(
                              onPressed: () => setState(() => _offset -= 50),
                              child: Text(copy.previous),
                            ),
                          if (sites.length == 50)
                            TextButton(
                              onPressed: () => setState(() => _offset += 50),
                              child: Text(copy.next),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
    );
  }
}

class _SiteEditor extends ConsumerStatefulWidget {
  const _SiteEditor({this.site});
  final AdminSite? site;
  @override
  ConsumerState<_SiteEditor> createState() => _SiteEditorState();
}

class _SiteEditorState extends ConsumerState<_SiteEditor> {
  late final WorkspaceContext? _openedWorkspace;

  @override
  void initState() {
    super.initState();
    _openedWorkspace = ref.read(workspaceContextProvider);
  }

  final _form = GlobalKey<FormState>();
  // Retain the identity across failed attempts so an unknown outcome cannot
  // turn a manual retry into a second site.
  final _createId = const Uuid().v4();
  late String _name = widget.site?.name ?? '';
  late String _country = widget.site?.country ??
      ref.read(workspaceContextProvider)?.activeCountry ??
      '';
  late String _region = widget.site?.region ?? '';
  late String _city = widget.site?.city ?? '';
  late bool _active = widget.site?.active ?? true;
  bool _saving = false;
  String? _error;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    _form.currentState!.save();
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null || workspace != _openedWorkspace) {
      setState(
        () => _error = AdminCopy(context).pick(
          'Your workspace changed. Reopen this form before saving.',
          'تغيرت مساحة العمل. أعد فتح النموذج قبل الحفظ.',
          'آپ کی ورک اسپیس بدل گئی ہے۔ محفوظ کرنے سے پہلے فارم دوبارہ کھولیں۔',
        ),
      );
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(adminSitesRepositoryProvider).save(
            workspace,
            existing: widget.site,
            createId: _createId,
            name: _name,
            country: _country,
            region: _region,
            city: _city,
            active: _active,
          );
      if (!mounted) return;
      ref.invalidate(adminSitesPageProvider);
      Navigator.of(context).pop();
    } on Object catch (error) {
      if (mounted) setState(() => _error = mapSupabaseError(error).message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = AdminCopy(context);
    return TpScaffold(
      appBar: TpAppBar(
        title: widget.site == null ? copy.newSite : copy.sites,
        onBack: () => Navigator.of(context).maybePop(),
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(copy.online),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            TextFormField(
              initialValue: _name,
              enabled: !_saving,
              decoration: InputDecoration(
                labelText: copy.pick('Site name', 'اسم الموقع', 'سائٹ کا نام'),
              ),
              validator: (v) =>
                  v == null || v.trim().isEmpty ? copy.fieldRequired : null,
              onSaved: (v) => _name = v!,
            ),
            TextFormField(
              initialValue: _country,
              enabled: !_saving,
              decoration: InputDecoration(
                labelText: copy.pick('Country', 'الدولة', 'ملک'),
              ),
              validator: (v) =>
                  v == null || v.trim().isEmpty ? copy.fieldRequired : null,
              onSaved: (v) => _country = v!,
            ),
            TextFormField(
              initialValue: _region,
              enabled: !_saving,
              decoration: InputDecoration(
                labelText: copy.pick('Region', 'المنطقة', 'علاقہ'),
              ),
              onSaved: (v) => _region = v ?? '',
            ),
            TextFormField(
              initialValue: _city,
              enabled: !_saving,
              decoration: InputDecoration(
                labelText: copy.pick('City', 'المدينة', 'شہر'),
              ),
              onSaved: (v) => _city = v ?? '',
            ),
            SwitchListTile(
              title: Text(copy.siteActive),
              subtitle: Text(copy.archiveHint),
              value: _active,
              onChanged: _saving ? null : (v) => setState(() => _active = v),
            ),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Text(copy.save),
            ),
            if (_saving) const LinearProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
