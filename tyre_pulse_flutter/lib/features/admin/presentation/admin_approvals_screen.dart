import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/admin/data/admin_approvals_repository.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_copy.dart';

class AdminApprovalsScreen extends ConsumerStatefulWidget {
  const AdminApprovalsScreen({super.key});
  @override
  ConsumerState<AdminApprovalsScreen> createState() =>
      _AdminApprovalsScreenState();
}

class _AdminApprovalsScreenState extends ConsumerState<AdminApprovalsScreen> {
  AdminApprovalKind _kind = AdminApprovalKind.upload;
  List<AdminApprovalItem> _items = [];
  bool _busy = false;
  bool _more = false;
  String? _error;
  int _generation = 0;
  BuildContext? _reviewDialogContext;

  void _closeReview() {
    final dialogContext = _reviewDialogContext;
    _reviewDialogContext = null;
    if (dialogContext != null && dialogContext.mounted) {
      final route = ModalRoute.of(dialogContext);
      if (route != null && route.isActive) {
        final navigator = Navigator.of(dialogContext);
        if (route.isCurrent) {
          navigator.pop();
        } else {
          navigator.removeRoute(route);
        }
      }
    }
  }

  String _text(String en, String ar, String ur) =>
      AdminCopy(context).pick(en, ar, ur);
  bool get _allowed {
    final workspace = ref.read(workspaceContextProvider);
    return workspace != null &&
        (workspace.effectivePermissions.isSuperAdmin ||
            workspace.role.isAdministrator) &&
        ref.read(canAccessModuleProvider(ModuleKey.approvals));
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  Future<void> _load({bool more = false}) async {
    final generation = ++_generation;
    final workspace = ref.read(workspaceContextProvider);
    if (!_allowed || workspace == null) {
      setState(() {
        _items = [];
        _busy = false;
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      if (!more) _items = [];
      if (!more) _more = false;
    });
    try {
      final items = await ref
          .read(adminApprovalsRepositoryProvider)
          .page(workspace, _kind, more ? _items.length : 0);
      if (!mounted || generation != _generation) return;
      setState(() {
        _items = [..._items, ...items];
        _more = items.length == 25;
      });
    } on Object {
      if (!mounted || generation != _generation) return;
      setState(
        () => _error = _text(
          'Could not load the queue. Retry online.',
          'تعذر تحميل الطلبات. أعد المحاولة عند الاتصال.',
          'قطار لوڈ نہیں ہوئی۔ آن لائن دوبارہ کوشش کریں۔',
        ),
      );
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  Future<void> _review(AdminApprovalItem item) async {
    if (_busy || !_allowed) return;
    final workspace = ref.read(workspaceContextProvider)!;
    final generation = ++_generation;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final rows = await ref
          .read(adminApprovalsRepositoryProvider)
          .uploadRows(workspace, item.id);
      if (!mounted ||
          generation != _generation ||
          ref.read(workspaceContextProvider) != workspace) {
        return;
      }
      String reason = '';
      final decision = await showDialog<bool>(
        context: context,
        builder: (dialogContext) {
          _reviewDialogContext = dialogContext;
          return AlertDialog(
            title: Text(item.title),
            content: SingleChildScrollView(
              child: SizedBox(
                width: double.maxFinite,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${item.uploadType} · ${rows.length} ${_text('rows', 'صفوف', 'قطاریں')}',
                    ),
                    SizedBox(
                      height: 230,
                      child: ListView.builder(
                        itemCount: rows.length,
                        itemBuilder: (_, index) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: SelectableText(
                            '${index + 1}. ${jsonEncode(rows[index])}',
                          ),
                        ),
                      ),
                    ),
                    TextField(
                      onChanged: (value) => reason = value,
                      maxLength: 1000,
                      decoration: InputDecoration(
                        labelText: _text(
                          'Reason for rejection',
                          'سبب الرفض',
                          'مسترد کرنے کی وجہ',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: Text(_text('Cancel', 'إلغاء', 'منسوخ')),
              ),
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: Text(_text('Reject', 'رفض', 'مسترد')),
              ),
              if (item.canApproveUpload)
                FilledButton(
                  onPressed: () => Navigator.pop(dialogContext, true),
                  child: Text(
                    _text(
                      'Approve import',
                      'اعتماد الاستيراد',
                      'درآمد منظور کریں',
                    ),
                  ),
                ),
            ],
          );
        },
      );
      _reviewDialogContext = null;
      if (decision == null ||
          !mounted ||
          generation != _generation ||
          ref.read(workspaceContextProvider) != workspace ||
          !_allowed) {
        return;
      }
      if (!decision && reason.trim().isEmpty) {
        setState(
          () => _error = _text(
            'A rejection reason is required.',
            'سبب الرفض مطلوب.',
            'مسترد کرنے کی وجہ درکار ہے۔',
          ),
        );
        return;
      }
      await ref
          .read(adminApprovalsRepositoryProvider)
          .decide(workspace, item, decision, reason);
      if (!mounted || generation != _generation) return;
      await _load();
    } on Object {
      if (!mounted || generation != _generation) return;
      // The server may already have committed. Require a fresh queue read
      // before presenting this item as actionable again.
      setState(() {
        _items = [];
        _more = false;
      });
      setState(
        () => _error = _text(
          'Could not confirm the action. Refresh to check its current status before retrying.',
          'تعذر تأكيد الإجراء. حدّث للتحقق من الحالة قبل إعادة المحاولة.',
          'کارروائی کی تصدیق نہیں ہوئی۔ دوبارہ کوشش سے پہلے تازہ حالت دیکھیں۔',
        ),
      );
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(workspaceContextProvider, (previous, next) {
      if (previous != next) {
        _closeReview();
        _load();
      }
    });
    ref.listen(canAccessModuleProvider(ModuleKey.approvals), (previous, next) {
      if (previous != next) {
        _closeReview();
        _load();
      }
    });
    return TpScaffold(
      backFallback: TpRoutePaths.adminConsole,
      appBar: TpAppBar(
        title: _text(
          'Upload and closure approvals',
          'اعتماد الملفات وطلبات الإغلاق',
          'اپ لوڈ اور بندش کی منظوری',
        ),
        backFallback: TpRoutePaths.adminConsole,
      ),
      body: !_allowed
          ? TpPermissionDeniedState(
              reason: _text(
                'Administrator access is required.',
                'صلاحية المسؤول مطلوبة.',
                'منتظم کی رسائی درکار ہے۔',
              ),
            )
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: SegmentedButton<AdminApprovalKind>(
                    segments: [
                      ButtonSegment(
                        value: AdminApprovalKind.upload,
                        label: Text(_text('Uploads', 'الملفات', 'اپ لوڈ')),
                      ),
                      ButtonSegment(
                        value: AdminApprovalKind.closure,
                        label: Text(
                          _text(
                            'Closure requests',
                            'طلبات الإغلاق',
                            'بندش کی درخواستیں',
                          ),
                        ),
                      ),
                    ],
                    selected: {
                      _kind,
                    },
                    onSelectionChanged: _busy
                        ? null
                        : (value) {
                            setState(() => _kind = value.single);
                            _load();
                          },
                  ),
                ),
                if (_busy) const LinearProgressIndicator(),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(_error!),
                  ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () async {
                      if (!_busy) await _load();
                    },
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(12),
                      children: [
                        if (!_busy && _items.isEmpty && _error == null)
                          Text(
                            _text(
                              'No pending requests.',
                              'لا توجد طلبات معلقة.',
                              'کوئی زیر التوا درخواست نہیں۔',
                            ),
                          ),
                        if (_error != null)
                          TextButton(
                            onPressed: _busy ? null : _load,
                            child: Text(
                              _text(
                                'Refresh',
                                'تحديث',
                                'تازہ کریں',
                              ),
                            ),
                          ),
                        for (final item in _items)
                          Card(
                            child: ListTile(
                              title: Text(item.title),
                              subtitle: Text(
                                [
                                  item.detail,
                                  if (item.rowCount != null)
                                    '${item.uploadType} · ${item.rowCount} ${_text('rows', 'صفوف', 'قطاریں')}',
                                ].join('\n'),
                              ),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: _busy
                                  ? null
                                  : () {
                                      if (item.kind ==
                                          AdminApprovalKind.upload) {
                                        _review(item);
                                      } else {
                                        context.push(
                                          AccidentCaseRoute(
                                            accidentId: AccidentId(
                                              item.id,
                                            ),
                                          ).location,
                                        );
                                      }
                                    },
                            ),
                          ),
                        if (_more)
                          TextButton(
                            onPressed: _busy ? null : () => _load(more: true),
                            child: Text(
                              _text(
                                'Load more',
                                'تحميل المزيد',
                                'مزید لوڈ کریں',
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
