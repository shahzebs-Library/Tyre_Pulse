import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/admin/data/approval_policy_repository.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_copy.dart';

class ApprovalMatrixScreen extends ConsumerStatefulWidget {
  const ApprovalMatrixScreen({super.key});
  @override
  ConsumerState<ApprovalMatrixScreen> createState() =>
      _ApprovalMatrixScreenState();
}

class _ApprovalMatrixScreenState extends ConsumerState<ApprovalMatrixScreen> {
  List<ApprovalPolicy>? _policies;
  List<ApprovalPolicy> _people = [], _sites = [];
  String? _error;
  bool _busy = false;
  int _request = 0;
  String _search = '';
  String _filter = 'all';

  bool get _allowed {
    final access = ref.read(accessStateProvider);
    return ref.read(canAccessModuleProvider(ModuleKey.admin)) &&
        (access.isSuperAdmin || access.role.isAdministrator);
  }

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    final request = ++_request;
    if (!_allowed) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repository = ref.read(approvalPolicyRepositoryProvider);
      final results = await Future.wait(
        [repository.list(), repository.people(), repository.sites()],
      );
      if (!mounted || request != _request || !_allowed) return;
      setState(() {
        _policies = results[0];
        _people = results[1];
        _sites = results[2];
      });
    } on Object catch (error) {
      if (mounted && request == _request) {
        setState(() => _error = classifySupabaseError(error).error.message);
      }
    } finally {
      if (mounted && request == _request) setState(() => _busy = false);
    }
  }

  Future<void> _edit(ApprovalPolicy? policy) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) =>
            _PolicyEditor(policy: policy, people: _people, sites: _sites),
      ),
    );
    if (saved == true && mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(accessStateProvider);
    ref.watch(canAccessModuleProvider(ModuleKey.admin));
    ref.listen(workspaceContextProvider, (previous, next) {
      if (previous != next) {
        ++_request;
        setState(() {
          _policies = null;
          _people = [];
          _sites = [];
        });
        unawaited(_load());
      }
    });
    final c = AdminCopy(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(
          c.pick('Approval Matrix', 'مصفوفة الموافقات', 'منظوری میٹرکس'),
        ),
        actions: [
          IconButton(
            onPressed: _busy || !_allowed ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: c.pick('Refresh', 'تحديث', 'تازہ کریں'),
          ),
        ],
      ),
      body: !_allowed
          ? Center(
              child: Text(
                c.pick(
                  'Administrator access required.',
                  'يلزم وصول المسؤول.',
                  'منتظم کی رسائی درکار ہے۔',
                ),
              ),
            )
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(_error!),
                  ),
                )
              : _policies == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        Text(
                          c.pick(
                            'Published policies govern new submissions. Existing requests retain their route. Configuration requires a connection.',
                            'تتحكم السياسات المنشورة في الطلبات الجديدة. تحتفظ الطلبات الحالية بمسارها. يتطلب الإعداد اتصالاً.',
                            'شائع شدہ پالیسیاں نئی درخواستوں پر نافذ ہیں۔ موجودہ درخواستوں کا راستہ برقرار رہتا ہے۔ ترتیب کے لیے کنکشن ضروری ہے۔',
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          onChanged: (value) =>
                              setState(() => _search = value.toLowerCase()),
                          decoration: InputDecoration(
                            labelText: c.pick(
                              'Search policies',
                              'بحث السياسات',
                              'پالیسیاں تلاش کریں',
                            ),
                            prefixIcon: const Icon(Icons.search),
                          ),
                        ),
                        DropdownButtonFormField<String>(
                          initialValue: _filter,
                          items: ['all', 'draft', 'published', 'retired']
                              .map(
                                (s) => DropdownMenuItem(
                                  value: s,
                                  child: Text(_stateLabel(c, s)),
                                ),
                              )
                              .toList(),
                          onChanged: (s) => setState(() => _filter = s!),
                        ),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: _busy ? null : () => _edit(null),
                          icon: const Icon(Icons.add),
                          label: Text(
                            c.pick(
                              'Create draft',
                              'إنشاء مسودة',
                              'مسودہ بنائیں',
                            ),
                          ),
                        ),
                        if (_policies!.isEmpty)
                          Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(
                              c.pick(
                                'No policies configured. Legacy approval rules remain active.',
                                'لا توجد سياسات معدة. تظل قواعد الموافقة السابقة نشطة.',
                                'کوئی پالیسی ترتیب نہیں دی گئی۔ سابقہ منظوری قواعد فعال ہیں۔',
                              ),
                            ),
                          ),
                        for (final policy in _policies!.where(
                          (p) =>
                              (p['name']?.toString().toLowerCase() ?? '')
                                  .contains(_search) &&
                              (_filter == 'all' || p['state'] == _filter),
                        ))
                          Card(
                            child: ListTile(
                              title: Text(policy['name']?.toString() ?? ''),
                              subtitle: Text(
                                '${_entityLabel(c, policy['entity_type'])} · ${_stateLabel(c, policy['state'])} · v${policy['version']}',
                              ),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: _busy ? null : () => _edit(policy),
                            ),
                          ),
                      ],
                    ),
    );
  }
}

String _stateLabel(AdminCopy c, Object? state) => switch (state) {
      'draft' => c.pick('Draft', 'مسودة', 'مسودہ'),
      'published' => c.pick('Published', 'منشورة', 'شائع شدہ'),
      'retired' => c.pick('Retired', 'متقاعدة', 'ریٹائرڈ'),
      _ => c.pick('All states', 'كل الحالات', 'تمام حالتیں'),
    };
String _entityLabel(AdminCopy c, Object? type) => switch (type) {
  'inspection' => c.pick('Inspection', '?????', '??????'),
  'work_order' => c.pick('Work order execution', '????? ??? ?????', '??? ???? ?? ???'),
  'tyre_change' => c.pick('Tyre change execution', '????? ????? ??????', '???? ?????? ?? ???'),
  _ => c.pick('Checklist', '????? ?????', '??? ???'),
};

class _PolicyEditor extends ConsumerStatefulWidget {
  const _PolicyEditor({
    required this.policy,
    required this.people,
    required this.sites,
  });
  final ApprovalPolicy? policy;
  final List<ApprovalPolicy> people, sites;
  @override
  ConsumerState<_PolicyEditor> createState() => _PolicyEditorState();
}

class _PolicyEditorState extends ConsumerState<_PolicyEditor> {
  late ApprovalPolicy _policy;
  late final TextEditingController _name, _reason, _priority;
  final _form = GlobalKey<FormState>();
  bool _busy = false, _dirty = false;
  String? _error;
  DateTime? _effectiveAt;
  ApprovalPolicy? _simulation;
  List<ApprovalPolicy>? _history;
  late final Object? _workspace;

  @override
  void initState() {
    super.initState();
    _workspace = ref.read(workspaceContextProvider);
    _policy = {...?widget.policy};
    _policy.putIfAbsent('entity_type', () => 'checklist');
    _policy.putIfAbsent('state', () => 'draft');
    _policy['stages'] = (widget.policy?['stages'] as List? ?? [_newStage()])
        .map((s) => Map<String, dynamic>.from(s as Map))
        .toList();
    _name = TextEditingController(text: _policy['name'] as String? ?? '');
    _reason = TextEditingController();
    _priority = TextEditingController(text: '${_policy['priority'] ?? 0}');
  }

  ApprovalPolicy _newStage() => {
        'name': '',
        'approver_role': null,
        'approver_user_id': null,
        'require_signature': true,
        'prevent_self_approval': true,
        'distinct_reviewer': true,
        'sla_hours': 24,
      };
  bool get _draft => _policy['state'] == 'draft';
  List<ApprovalPolicy> get _stages =>
      (_policy['stages'] as List).cast<ApprovalPolicy>();
  List<String> get _roles =>
      widget.people.map((p) => p['role']).whereType<String>().toSet().toList()
        ..sort();
  void _changed(VoidCallback update) => setState(() {
        update();
        _dirty = true;
        _simulation = null;
      });

  @override
  void dispose() {
    _name.dispose();
    _reason.dispose();
    _priority.dispose();
    super.dispose();
  }

  Future<void> _act(String action) async {
    if (_busy) return;
    final access = ref.read(accessStateProvider);
    if (_workspace != ref.read(workspaceContextProvider) ||
        !ref.read(canAccessModuleProvider(ModuleKey.admin)) ||
        !(access.isSuperAdmin || access.role.isAdministrator)) {
      Navigator.of(context).pop();
      return;
    }
    final c = AdminCopy(context);
    if (action == 'save' && !_form.currentState!.validate()) return;
    if ((action == 'publish' || action == 'retire') &&
        _reason.text.trim().isEmpty) {
      setState(
        () => _error = c.pick(
          'Enter a change reason.',
          'أدخل سبب التغيير.',
          'تبدیلی کی وجہ درج کریں۔',
        ),
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repository = ref.read(approvalPolicyRepositoryProvider);
      if (action == 'save') {
        final saved = await repository.save({
          ..._policy,
          'name': _name.text.trim(),
          'priority': int.parse(_priority.text),
          'change_reason': _reason.text.trim(),
        });
        if (mounted) {
          setState(() {
            _policy = saved;
            _dirty = false;
            _simulation = null;
          });
        }
      } else if (action == 'simulate') {
        final result = await repository.simulate(_policy);
        if (mounted) setState(() => _simulation = result);
      } else if (action == 'history') {
        final result = await repository.history(_policy['id'] as String);
        if (mounted) setState(() => _history = result);
      } else {
        final saved =
            await repository.transition(_policy, action, _reason.text.trim(), effectiveAt: _effectiveAt);
        if (mounted) {
          setState(() => _policy = saved);
          Navigator.of(context).pop(true);
        }
      }
    } on Object catch (error) {
      if (mounted) {
        setState(() => _error = classifySupabaseError(error).error.message);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = AdminCopy(context);
    ref.listen(workspaceContextProvider, (_, next) {
      if (next != _workspace && mounted) Navigator.of(context).pop();
    });
    final countries = widget.sites
        .map((s) => s['country'])
        .whereType<String>()
        .toSet()
        .toList()
      ..sort();
    final sites = widget.sites
        .where(
          (s) =>
              _policy['match_country'] == null ||
              s['country'] == _policy['match_country'],
        )
        .map((s) => s['name'])
        .whereType<String>()
        .toSet()
        .toList()
      ..sort();
    return PopScope(
      canPop: !_busy,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            c.pick(
              'Approval policy',
              'سياسة الموافقة',
              'منظوری پالیسی',
            ),
          ),
        ),
        body: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(_stateLabel(c, _policy['state'])),
              if (!_draft)
                OutlinedButton(
                  onPressed: _busy
                      ? null
                      : () => _changed(() {
                            _policy.remove('id');
                            _policy.remove('updated_at');
                            _policy.remove('version');
                            _policy['state'] = 'draft';
                          }),
                  child: Text(
                    c.pick(
                      'Clone as draft',
                      'نسخ كمسودة',
                      'مسودے کے طور پر نقل کریں',
                    ),
                  ),
                ),
              TextFormField(
                controller: _name,
                enabled: _draft && !_busy,
                onChanged: (_) => _changed(() {}),
                decoration: InputDecoration(
                  labelText: c.pick(
                    'Policy name',
                    'اسم السياسة',
                    'پالیسی کا نام',
                  ),
                ),
                validator: (v) =>
                    v?.trim().isNotEmpty == true ? null : c.fieldRequired,
              ),
              _select(
                c.pick('Module', 'الوحدة', 'ماڈیول'),
                'entity_type',
                ['checklist', 'inspection', 'work_order', 'tyre_change'],
                label: (s) => _entityLabel(c, s),
                nullable: false,
              ),
              TextFormField(
                controller: _priority,
                enabled: _draft && !_busy,
                onChanged: (_) => _changed(() {}),
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: c.pick(
                    'Priority (higher wins)',
                    'الأولوية (الأعلى يفوز)',
                    'ترجیح (زیادہ مقدم)',
                  ),
                ),
                validator: (v) =>
                    int.tryParse(v ?? '') == null ? c.fieldRequired : null,
              ),
              _select(
                c.pick('Country', 'الدولة', 'ملک'),
                'match_country',
                countries,
                after: () => _policy['match_site'] = null,
              ),
              _select(c.pick('Site', 'الموقع', 'سائٹ'), 'match_site', sites),
              _select(
                c.pick(
                  'Requester role',
                  'دور مقدم الطلب',
                  'درخواست گزار کا کردار',
                ),
                'match_role',
                _roles,
              ),
              _person(
                c.pick('Requester', 'مقدم الطلب', 'درخواست گزار'),
                _policy,
                'match_user_id',
              ),
              const SizedBox(height: 16),
              Text(
                c.pick(
                  'Sequential review stages',
                  'مراحل المراجعة المتسلسلة',
                  'ترتیب وار جائزہ مراحل',
                ),
                style: Theme.of(context).textTheme.titleMedium,
              ),
              for (var index = 0; index < _stages.length; index++)
                _stage(c, index),
              if (_draft && _stages.length < 5)
                OutlinedButton.icon(
                  onPressed: _busy
                      ? null
                      : () => _changed(() => _stages.add(_newStage())),
                  icon: const Icon(Icons.add),
                  label: Text(
                    c.pick(
                      'Add stage',
                      'إضافة مرحلة',
                      'مرحلہ شامل کریں',
                    ),
                  ),
                ),
              TextFormField(
                controller: _reason,
                enabled: !_busy,
                maxLines: 2,
                decoration: InputDecoration(
                  labelText: c.pick(
                    'Change reason',
                    'سبب التغيير',
                    'تبدیلی کی وجہ',
                  ),
                ),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (_draft) ListTile(
                title: Text(c.pick('Effective date', '????? ???????', '???? ?? ?????')),
                subtitle: Text(_effectiveAt == null ? c.pick('Immediately on publication', '??? ?????', '????? ?? ????? ???') : MaterialLocalizations.of(context).formatMediumDate(_effectiveAt!)),
                onTap: _busy ? null : () async {
                  final now = DateTime.now();
                  final day = await showDatePicker(context: context, initialDate: _effectiveAt ?? now, firstDate: now, lastDate: now.add(const Duration(days: 365)));
                  if (day != null && mounted) {
                    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(now));
                    if (time != null && mounted) setState(() => _effectiveAt = DateTime(day.year, day.month, day.day, time.hour, time.minute));
                  }
                },
                trailing: _effectiveAt == null ? const Icon(Icons.schedule) : IconButton(onPressed: _busy ? null : () => setState(() => _effectiveAt = null), icon: const Icon(Icons.clear)),
              ),
              if (_draft && _policy['created_by'] == ref.read(workspaceContextProvider)?.userId && _policy['created_by'] != null)
                Text(c.pick('A different administrator must publish this draft.', '??? ?? ???? ??? ??????? ????? ???.', '?? ????? ?? ???? ????? ????? ???? ????')),
              if (_busy) const LinearProgressIndicator(),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (_draft)
                    FilledButton(
                      onPressed: _busy ? null : () => _act('save'),
                      child: Text(
                        c.pick(
                          'Save draft',
                          'حفظ المسودة',
                          'مسودہ محفوظ کریں',
                        ),
                      ),
                    ),
                  if (_policy['id'] != null)
                    OutlinedButton(
                      onPressed:
                          _busy || _dirty ? null : () => _act('simulate'),
                      child: Text(
                        c.pick(
                          'Simulate route',
                          'محاكاة المسار',
                          'راستہ آزمائیں',
                        ),
                      ),
                    ),
                  if (_draft && _policy['id'] != null)
                    FilledButton(
                      onPressed: _busy || _dirty || _simulation == null
                          ? null
                          : () => _act('publish'),
                      child: Text(c.pick('Publish', 'نشر', 'شائع کریں')),
                    ),
                  if (_policy['state'] == 'published')
                    OutlinedButton(
                      onPressed: _busy ? null : () => _act('retire'),
                      child: Text(c.pick('Retire', 'إيقاف', 'ریٹائر کریں')),
                    ),
                  if (_policy['id'] != null)
                    TextButton(
                      onPressed: _busy ? null : () => _act('history'),
                      child: Text(
                        c.pick(
                          'Change history',
                          'سجل التغييرات',
                          'تبدیلی کی تاریخ',
                        ),
                      ),
                    ),
                  TextButton(
                    onPressed:
                        _busy ? null : () => Navigator.of(context).pop(true),
                    child: Text(c.pick('Done', 'تم', 'مکمل')),
                  ),
                ],
              ),
              if (_simulation != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          c.pick(
                            'Simulation only — no submission is changed',
                            'محاكاة فقط — لا تتغير الطلبات',
                            'صرف آزمائش — کوئی درخواست تبدیل نہیں ہوتی',
                          ),
                        ),
                        Text(
                          '${_simulation!['status']} · ${_simulation!['mode']}',
                        ),
                        if (_simulation!['policy'] is Map)
                          Text(
                            '${(_simulation!['policy'] as Map)['name'] ?? ''}',
                          ),
                        Text(
                          c.pick(
                            'Publish revalidates conflicts, scope and eligible reviewers on the server.',
                            'يتحقق النشر مجدداً من التعارضات والنطاق والمراجعين المؤهلين على الخادم.',
                            'اشاعت سرور پر تنازعات، دائرہ کار اور اہل جائزہ کاروں کی دوبارہ تصدیق کرتی ہے۔',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (_history != null)
                ..._history!.map(
                  (event) => ListTile(
                    title: Text(
                      '${event['event_type'] ?? event['action'] ?? ''}',
                    ),
                    subtitle: Text(
                      '${event['created_at'] ?? ''}\n${event['reason'] ?? ''}',
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _select(
    String title,
    String key,
    List<String> options, {
    String Function(String)? label,
    bool nullable = true,
    VoidCallback? after,
  }) {
    final values = {
      ...options,
      if (_policy[key] is String) _policy[key] as String,
    }.toList();
    return DropdownButtonFormField<String>(
      key: ValueKey('$key-${_policy[key]}'),
      initialValue: _policy[key] as String?,
      decoration: InputDecoration(labelText: title),
      items: [
        if (nullable)
          DropdownMenuItem(
            child: Text(AdminCopy(context).pick('Any', 'أي', 'کوئی بھی')),
          ),
        ...values.map(
          (v) => DropdownMenuItem(value: v, child: Text(label?.call(v) ?? v)),
        ),
      ],
      onChanged: !_draft || _busy
          ? null
          : (v) => _changed(() {
                _policy[key] = v;
                after?.call();
              }),
    );
  }

  Widget _person(String title, ApprovalPolicy target, String key) {
    final person =
        widget.people.where((p) => p['id'] == target[key]).firstOrNull;
    final c = AdminCopy(context);
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(title),
      subtitle: Text(
        person == null
            ? (target[key] == null
                ? c.pick(
                    'Any eligible person',
                    'أي شخص مؤهل',
                    'کوئی بھی اہل شخص',
                  )
                : c.pick(
                    'Unavailable person — select a replacement',
                    'شخص غير متاح — اختر بديلاً',
                    'شخص دستیاب نہیں — متبادل منتخب کریں',
                  ))
            : '${person['full_name']} · ${person['role']}',
      ),
      trailing: const Icon(Icons.person_search),
      onTap: !_draft || _busy
          ? null
          : () async {
              final selected = await showDialog<String>(
                context: context,
                builder: (context) => _PeoplePicker(people: widget.people),
              );
              if (selected != null && mounted) {
                _changed(() {
                  target[key] = selected.isEmpty ? null : selected;
                  if (key == 'approver_user_id' && selected.isNotEmpty) {
                    target['approver_role'] = null;
                  }
                });
              }
            },
    );
  }

  Widget _stage(AdminCopy c, int index) {
    final stage = _stages[index];
    return Card(
      key: ObjectKey(stage),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${index + 1}. ${c.pick('Stage', 'مرحلة', 'مرحلہ')}',
                  ),
                ),
                if (_draft && _stages.length > 1)
                  IconButton(
                    onPressed: _busy
                        ? null
                        : () => _changed(() => _stages.removeAt(index)),
                    icon: const Icon(Icons.delete_outline),
                    tooltip: c.pick(
                      'Remove stage',
                      'إزالة المرحلة',
                      'مرحلہ ہٹائیں',
                    ),
                  ),
              ],
            ),
            TextFormField(
              initialValue: stage['name'] as String? ?? '',
              enabled: _draft && !_busy,
              decoration: InputDecoration(
                labelText: c.pick('Stage name', 'اسم المرحلة', 'مرحلے کا نام'),
              ),
              validator: (v) =>
                  v?.trim().isNotEmpty == true ? null : c.fieldRequired,
              onChanged: (v) => _changed(() => stage['name'] = v.trim()),
            ),
            DropdownButtonFormField<String>(
              key: ValueKey('role-$index-${stage['approver_role']}'),
              initialValue: stage['approver_role'] as String?,
              decoration: InputDecoration(
                labelText: c.pick(
                  'Reviewer role',
                  'دور المراجع',
                  'جائزہ کار کا کردار',
                ),
              ),
              items: [
                DropdownMenuItem(
                  child: Text(
                    c.pick('Named person', 'شخص محدد', 'نامزد شخص'),
                  ),
                ),
                ...{
                  ..._roles,
                  if (stage['approver_role'] is String)
                    stage['approver_role'] as String,
                }.map((r) => DropdownMenuItem(value: r, child: Text(r))),
              ],
              onChanged: !_draft || _busy
                  ? null
                  : (v) => _changed(() {
                        stage['approver_role'] = v;
                        if (v != null) stage['approver_user_id'] = null;
                      }),
              validator: (_) => stage['approver_role'] == null &&
                      stage['approver_user_id'] == null
                  ? c.fieldRequired
                  : null,
            ),
            _person(
              c.pick('Named reviewer', 'مراجع محدد', 'نامزد جائزہ کار'),
              stage,
              'approver_user_id',
            ),
            TextFormField(
              initialValue: '${stage['sla_hours'] ?? 24}',
              enabled: _draft && !_busy,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: c.pick('SLA hours', 'ساعات المهلة', 'مہلت گھنٹے'),
              ),
              validator: (v) =>
                  (int.tryParse(v ?? '') ?? 0) > 0 ? null : c.fieldRequired,
              onChanged: (v) =>
                  _changed(() => stage['sla_hours'] = int.tryParse(v)),
            ),
            for (final entry in <String, String>{
              'require_signature': c.pick(
                'Signature required',
                'التوقيع مطلوب',
                'دستخط ضروری',
              ),
              'prevent_self_approval': c.pick(
                'Prevent requester approval',
                'منع موافقة مقدم الطلب',
                'اپنی درخواست کی منظوری روکیں',
              ),
              'distinct_reviewer': c.pick(
                'Different reviewer per stage',
                'مراجع مختلف لكل مرحلة',
                'ہر مرحلے میں مختلف جائزہ کار',
              ),
            }.entries)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(entry.value),
                value: stage[entry.key] == true,
                onChanged: !_draft || _busy
                    ? null
                    : (v) => _changed(() => stage[entry.key] = v),
              ),
          ],
        ),
      ),
    );
  }
}

class _PeoplePicker extends StatefulWidget {
  const _PeoplePicker({required this.people});
  final List<ApprovalPolicy> people;
  @override
  State<_PeoplePicker> createState() => _PeoplePickerState();
}

class _PeoplePickerState extends State<_PeoplePicker> {
  String _search = '';
  @override
  Widget build(BuildContext context) {
    final c = AdminCopy(context);
    return AlertDialog(
      title: Text(c.pick('Select person', 'اختيار شخص', 'شخص منتخب کریں')),
      content: SizedBox(
        width: 420,
        height: 400,
        child: Column(
          children: [
            TextField(
              onChanged: (v) => setState(() => _search = v.toLowerCase()),
              decoration: InputDecoration(
                labelText: c.pick(
                  'Search name or role',
                  'بحث الاسم أو الدور',
                  'نام یا کردار تلاش کریں',
                ),
              ),
            ),
            Expanded(
              child: ListView(
                children: [
                  ListTile(
                    title: Text(
                      c.pick(
                        'Clear selection',
                        'مسح الاختيار',
                        'انتخاب صاف کریں',
                      ),
                    ),
                    onTap: () => Navigator.pop(context, ''),
                  ),
                  ...widget.people
                      .where(
                        (p) => '${p['full_name']} ${p['role']}'
                            .toLowerCase()
                            .contains(_search),
                      )
                      .map(
                        (p) => ListTile(
                          title: Text('${p['full_name']}'),
                          subtitle: Text(
                            '${p['role']} · ${(p['sites'] as List? ?? []).join(', ')}',
                          ),
                          onTap: () =>
                              Navigator.pop(context, p['id'] as String),
                        ),
                      ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
