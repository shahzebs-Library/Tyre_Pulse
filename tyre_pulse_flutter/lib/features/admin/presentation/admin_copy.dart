import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/admin/data/admin_access_repository.dart';
import 'package:tyre_pulse/features/admin/domain/admin_user.dart';

class AdminCopy {
  AdminCopy(BuildContext context)
      : language = Localizations.localeOf(context).languageCode;
  final String language;
  String get sites =>
      pick('Site management', 'إدارة المواقع', 'سائٹ کا انتظام');
  String get newSite => pick('Add site', 'إضافة موقع', 'سائٹ شامل کریں');
  String get siteActive => pick('Active', 'نشط', 'فعال');
  String get archived => pick('Archived', 'مؤرشف', 'محفوظ');
  String get archiveHint => pick(
        'Turn off to archive this site.',
        'أوقف التفعيل لأرشفة هذا الموقع.',
        'اس سائٹ کو محفوظ کرنے کے لیے بند کریں۔',
      );
  String get save => pick('Save', 'حفظ', 'محفوظ کریں');
  String get fieldRequired => pick('Required', 'مطلوب', 'درکار');
  String get access => pick('Mobile access', 'صلاحيات التطبيق', 'موبائل رسائی');
  String get accessNote => pick(
        'Changes apply on the user’s next refresh.',
        'تطبق التغييرات عند تحديث المستخدم التالي.',
        'تبدیلیاں صارف کی اگلی ریفریش پر لاگو ہوں گی۔',
      );
  String get partial => pick(
        'The update could not finish. Review the refreshed state before retrying.',
        'تعذر إكمال التحديث. راجع الحالة المحدثة قبل إعادة المحاولة.',
        'تبدیلی مکمل نہیں ہوئی۔ دوبارہ کوشش سے پہلے تازہ حالت دیکھیں۔',
      );
  String overrideLabel(MobileAccessOverride value) => switch (value) {
        MobileAccessOverride.defaultAccess =>
          pick('Default', 'افتراضي', 'پہلے سے طے شدہ'),
        MobileAccessOverride.allow => pick('Allow', 'سماح', 'اجازت'),
        MobileAccessOverride.deny => pick('Deny', 'منع', 'روکیں'),
      };
  String module(ModuleKey key) => switch (key) {
        ModuleKey.inspect => pick('New inspection', 'فحص جديد', 'نیا معائنہ'),
        ModuleKey.scan => pick('Scanner', 'الماسح', 'اسکینر'),
        ModuleKey.serial => pick('Tyre search', 'بحث الإطارات', 'ٹائر تلاش'),
        ModuleKey.tyreChange =>
          pick('Tyre change', 'تغيير الإطارات', 'ٹائر کی تبدیلی'),
        ModuleKey.checklists => pick('Checklists', 'قوائم الفحص', 'چیک لسٹیں'),
        ModuleKey.meter => pick('Meter logs', 'سجلات العداد', 'میٹر ریکارڈ'),
        ModuleKey.washing =>
          pick('Vehicle washing', 'غسيل المركبات', 'گاڑیوں کی دھلائی'),
        ModuleKey.reportIssue =>
          pick('Report issue', 'الإبلاغ عن مشكلة', 'مسئلہ رپورٹ کریں'),
        ModuleKey.repairRequest =>
          pick('Repair requests', 'طلبات الإصلاح', 'مرمت کی درخواستیں'),
        ModuleKey.records =>
          pick('Tyre records', 'سجلات الإطارات', 'ٹائر ریکارڈ'),
        ModuleKey.vehicles => pick('Vehicles', 'المركبات', 'گاڑیاں'),
        ModuleKey.history => pick('History', 'السجل', 'تاریخ'),
        ModuleKey.alerts => pick('Alerts', 'التنبيهات', 'انتباہات'),
        ModuleKey.calendar => pick('Calendar', 'التقويم', 'کیلنڈر'),
        ModuleKey.accidents =>
          pick('Accident cases', 'حالات الحوادث', 'حادثات کے کیس'),
        ModuleKey.reportAccident =>
          pick('Report accident', 'الإبلاغ عن حادث', 'حادثہ رپورٹ کریں'),
        ModuleKey.workorders =>
          pick('Work orders', 'أوامر العمل', 'کام کے احکامات'),
        ModuleKey.rca => pick(
            'Root cause analysis',
            'تحليل السبب الجذري',
            'بنیادی وجہ کا تجزیہ',
          ),
        ModuleKey.tasks => pick('Tasks', 'المهام', 'کام'),
        ModuleKey.stock => pick('Stock count', 'جرد المخزون', 'اسٹاک کی گنتی'),
        ModuleKey.pm => pick(
            'Preventive maintenance',
            'الصيانة الوقائية',
            'احتیاطی دیکھ بھال',
          ),
        ModuleKey.workshop => pick('Workshop', 'الورشة', 'ورکشاپ'),
        ModuleKey.overview =>
          pick('Fleet overview', 'نظرة عامة على الأسطول', 'فلیٹ کا جائزہ'),
        ModuleKey.reports => pick('Reports', 'التقارير', 'رپورٹیں'),
        ModuleKey.analytics => pick('Analytics', 'التحليلات', 'تجزیات'),
        ModuleKey.stockManage =>
          pick('Stock management', 'إدارة المخزون', 'اسٹاک کا انتظام'),
        ModuleKey.ai => pick('Fleet AI', 'ذكاء الأسطول', 'فلیٹ اے آئی'),
        ModuleKey.team => pick('Team', 'الفريق', 'ٹیم'),
        ModuleKey.approvals => pick('Approvals', 'الموافقات', 'منظوریاں'),
        ModuleKey.admin => title,
        ModuleKey.users => users,
      };
  String pick(String en, String ar, String ur) => switch (language) {
        'ar' => ar,
        'ur' => ur,
        _ => en,
      };

  String get title => pick('Administration', 'الإدارة', 'انتظامیہ');
  String get users =>
      pick('User management', 'إدارة المستخدمين', 'صارفین کا انتظام');
  String get online => pick(
        'Changes require a connection and server approval.',
        'تتطلب التغييرات اتصالاً وموافقة الخادم.',
        'تبدیلیوں کے لیے کنکشن اور سرور کی منظوری درکار ہے۔',
      );
  String get reason => pick('Reason', 'السبب', 'وجہ');
  String get role => pick('Role', 'الدور', 'کردار');
  String get pending =>
      pick('Pending approval', 'بانتظار الموافقة', 'منظوری کا منتظر');
  String get active => pick('Approved', 'معتمد', 'منظور شدہ');
  String get locked => pick('Locked', 'مقفل', 'مقفل');
  String get saved => pick(
        'Change confirmed by the server.',
        'تم تأكيد التغيير من الخادم.',
        'سرور نے تبدیلی کی تصدیق کر دی۔',
      );
  String get empty => pick(
        'No users on this page.',
        'لا يوجد مستخدمون في هذه الصفحة.',
        'اس صفحے پر کوئی صارف نہیں۔',
      );
  String get previous => pick('Previous page', 'الصفحة السابقة', 'پچھلا صفحہ');
  String get next => pick('Next page', 'الصفحة التالية', 'اگلا صفحہ');
  String get required =>
      pick('A reason is required.', 'السبب مطلوب.', 'وجہ درکار ہے۔');
  String get builtIn => pick(
        'Choose a built-in role',
        'اختر دوراً أساسياً',
        'بلٹ ان کردار منتخب کریں',
      );
  String action(AdminUserAction action) => switch (action) {
        AdminUserAction.approve => pick('Approve', 'موافقة', 'منظور کریں'),
        AdminUserAction.lock =>
          pick('Lock access', 'قفل الوصول', 'رسائی مقفل کریں'),
        AdminUserAction.unlock =>
          pick('Restore access', 'استعادة الوصول', 'رسائی بحال کریں'),
        AdminUserAction.deactivate =>
          pick('Deactivate', 'إلغاء التنشيط', 'غیر فعال کریں'),
        AdminUserAction.setRole =>
          pick('Change role', 'تغيير الدور', 'کردار تبدیل کریں'),
      };
}
