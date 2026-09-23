/// Role workspaces composed from recorded case data. Unsupported fields remain
/// visible and unrecorded; controls require a real caller-owned action.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_workflow.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_workflow_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_damage_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';

class AccidentWorkshopAssessmentWorkspace extends StatelessWidget {
  const AccidentWorkshopAssessmentWorkspace({
    required this.snapshot,
    this.onViewDamage,
    this.onSaveAssessment,
    this.onSubmitAssessment,
    super.key,
  });
  final AccidentCaseSnapshot snapshot;
  final VoidCallback? onViewDamage;
  final VoidCallback? onSaveAssessment;
  final VoidCallback? onSubmitAssessment;

  @override
  Widget build(BuildContext context) {
    final c = _Copy(context);
    final record = snapshot.accident;
    final photo = vehiclePhotoAssetFor(
      assetNo: record.assetNo,
      vehicleType: record.vehicleType,
    );
    final damage = _damage(record.damageDescription);
    final workflow = AccidentCaseWorkflowCopy.of(context);
    final copy = AccidentCopy.of(context);
    return _Flow(
      children: [
        _RoleHeader(
          snapshot: snapshot,
          workstreamKey: 'assessment',
          title: workflow('workspaceAssessment'),
        ),
        _Title(
          c.t(
            'Repair assessment report',
            'تقرير تقييم الإصلاح',
            'مرمت کی تشخیصی رپورٹ',
          ),
        ),
        _Panel(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 96,
                height: 90,
                child: photo == null
                    ? Icon(
                        Icons.local_shipping_outlined,
                        size: 46,
                        color: TpPalette.of(context).primary,
                      )
                    : Image.asset(photo, fit: BoxFit.contain),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      c.value(record.vehicleType),
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const SizedBox(height: TpSpace.xs),
                    TpIdentifierText(record.assetNo),
                    Text('${copy('plate')}: ${c.value(record.plateNumber)}'),
                    Text(
                      [record.site, record.location]
                          .whereType<String>()
                          .where((v) => v.trim().isNotEmpty)
                          .join(' · '),
                    ),
                    TextButton(
                      onPressed: onViewDamage,
                      child: Text(
                        c.t(
                          'View damage map',
                          'عرض خريطة الأضرار',
                          'نقصان کا نقشہ دیکھیں',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        _Section(
          number: 1,
          title: c.t(
            'Safety and mobility',
            'السلامة والحركة',
            'حفاظت اور نقل و حرکت',
          ),
          child: _Facts(
            items: [
              (workflow('safeToMove'), null),
              (workflow('towingRequired'), null),
              (workflow('vehicleOffRoad'), null),
            ],
          ),
        ),
        _Section(
          number: 2,
          title: c.t('Damage assessment', 'تقييم الأضرار', 'نقصان کا جائزہ'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Facts(
                items: [
                  (
                    copy('damageCondition'),
                    humaniseAccidentToken(record.damageCondition)
                  ),
                  (copy('description'), record.damageDescription),
                ],
              ),
              if (damage.marks.isNotEmpty) ...[
                const SizedBox(height: TpSpace.sm),
                for (final mark in damage.marks) _DamageRow(mark: mark),
              ],
            ],
          ),
        ),
        _Section(
          number: 3,
          title: c.t(
            'Labour and parts estimate',
            'تقدير العمالة وقطع الغيار',
            'مزدوری اور پرزوں کا تخمینہ',
          ),
          child: _Facts(
            items: [
              (workflow('labourHours'), null),
              (workflow('labourCost'), null),
              (
                c.t('Parts estimate', 'تقدير قطع الغيار', 'پرزوں کا تخمینہ'),
                null
              ),
              (copy('estimatedDamage'), _amount(record.estimatedDamageCost)),
              (workflow('partsAvailability'), null),
              (copy('repairCost'), _amount(record.repairCost)),
            ],
          ),
        ),
        _Section(
          number: 4,
          title: c.t(
            'Repair route recommendation',
            'توصية مسار الإصلاح',
            'مرمت کے راستے کی سفارش',
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _RouteChoices(recorded: record.repairType),
              const SizedBox(height: TpSpace.md),
              _Facts(
                items: [
                  (copy('repairType'), record.repairType),
                  (copy('workshop'), record.workshopName),
                  (copy('exactLocation'), record.workshopLocation),
                  (copy('expectedRelease'), record.expectedReleaseDate),
                  (
                    c.t(
                      'Quotation status',
                      'حالة عرض السعر',
                      'قیمت پیشکش کی حالت',
                    ),
                    null
                  ),
                ],
              ),
            ],
          ),
        ),
        _Section(
          icon: Icons.attach_file,
          title: c.t(
            'Required attachments',
            'المرفقات المطلوبة',
            'مطلوبہ منسلکات',
          ),
          child: _Facts(
            items: [
              (workflow('workshopAssessmentDocument'), null),
              (workflow('repairQuotationDocument'), null),
              (
                workflow('accidentPhotos'),
                record.photos.isEmpty ? null : '${record.photos.length}'
              ),
              (
                c.t(
                  'Recovery request',
                  'طلب نقل المركبة',
                  'گاڑی منتقل کرنے کی درخواست',
                ),
                null
              ),
            ],
          ),
        ),
        _Notice(
          text: c.t(
            'Assessment documents and vendor quotations are not recorded in this case data.',
            'مستندات التقييم وعروض أسعار المورد غير مسجلة في بيانات القضية.',
            'اس کیس میں تشخیص کی دستاویزات اور وینڈر کی قیمت پیشکش درج نہیں ہیں۔',
          ),
        ),
        _Participants(
          snapshot: snapshot,
          title: c.t(
            'After submission, notify',
            'الإشعار بعد الإرسال',
            'جمع کرانے کے بعد اطلاع دیں',
          ),
        ),
        _Actions(
          actions: [
            (
              c.t('Save assessment', 'حفظ التقييم', 'تشخیص محفوظ کریں'),
              Icons.bookmark_border,
              onSaveAssessment
            ),
            (
              c.t(
                'Submit assessment and route',
                'إرسال التقييم والمسار',
                'تشخیص اور راستہ جمع کریں',
              ),
              Icons.lock_outline,
              onSubmitAssessment
            ),
          ],
        ),
      ],
    );
  }
}

class AccidentExternalWorkshopWorkspace extends StatelessWidget {
  const AccidentExternalWorkshopWorkspace({
    required this.snapshot,
    this.onEditVendor,
    this.onContactWorkshop,
    this.onAcceptVehicle,
    super.key,
  });
  final AccidentCaseSnapshot snapshot;
  final VoidCallback? onEditVendor;
  final VoidCallback? onContactWorkshop;
  final VoidCallback? onAcceptVehicle;

  @override
  Widget build(BuildContext context) {
    final c = _Copy(context);
    final record = snapshot.accident;
    final copy = AccidentCopy.of(context);
    final workflow = AccidentCaseWorkflowCopy.of(context);
    return _Flow(
      children: [
        _Title('${record.reference} · ${record.assetNo}'),
        _Panel(
          child: _Facts(
            items: [
              (copy('repairType'), record.repairType),
              (c.t('Dispatch status', 'حالة الإرسال', 'روانگی کی حالت'), null),
              (c.t('Transit elapsed', 'مدة النقل', 'سفر کا گزرا وقت'), null),
              (
                c.t(
                  'Vendor repair SLA',
                  'مهلة إصلاح المورد',
                  'وینڈر مرمت کی مدت',
                ),
                null
              ),
            ],
          ),
        ),
        _Notice(
          text: c.t(
            'Signed vehicle acceptance and the vendor SLA start are not recorded.',
            'استلام المركبة الموقع وبدء مهلة المورد غير مسجلين.',
            'گاڑی کی دستخط شدہ وصولی اور وینڈر کی مدت کا آغاز درج نہیں ہے۔',
          ),
        ),
        _Section(
          number: 1,
          title:
              c.t('Destination and vendor', 'الوجهة والمورد', 'منزل اور وینڈر'),
          child: Column(
            children: [
              _Facts(
                items: [
                  (copy('workshop'), record.workshopName),
                  (copy('exactLocation'), record.workshopLocation),
                  (
                    c.t('Vendor contact', 'جهة اتصال المورد', 'وینڈر رابطہ'),
                    null
                  ),
                  (
                    c.t(
                      'Phone / email',
                      'الهاتف / البريد الإلكتروني',
                      'فون / ای میل',
                    ),
                    null
                  ),
                  (
                    c.t(
                      'Workshop registration / tax number',
                      'رقم تسجيل الورشة / الضريبة',
                      'ورکشاپ رجسٹریشن / ٹیکس نمبر',
                    ),
                    null
                  ),
                  (
                    c.t(
                      'Assigned vendor inspector',
                      'مفتش المورد المعين',
                      'مقررہ وینڈر معائنہ کار',
                    ),
                    null
                  ),
                ],
              ),
              _Actions(
                actions: [
                  (
                    c.t(
                      'Edit vendor details',
                      'تعديل بيانات المورد',
                      'وینڈر کی تفصیلات بدلیں',
                    ),
                    Icons.edit_outlined,
                    onEditVendor
                  ),
                  (
                    c.t(
                      'Contact workshop',
                      'الاتصال بالورشة',
                      'ورکشاپ سے رابطہ',
                    ),
                    Icons.call_outlined,
                    onContactWorkshop
                  ),
                ],
              ),
            ],
          ),
        ),
        _Section(
          number: 2,
          title: c.t('Dispatch details', 'تفاصيل الإرسال', 'روانگی کی تفصیلات'),
          child: _Facts(
            items: [
              (c.t('Sent by', 'أرسل بواسطة', 'روانہ کرنے والا'), null),
              (c.t('Origin', 'نقطة الانطلاق', 'روانگی کی جگہ'), null),
              (c.t('Departure', 'وقت المغادرة', 'روانگی کا وقت'), null),
              (c.t('Destination', 'الوجهة', 'منزل'), record.workshopName),
              (c.t('Carrier', 'الناقل', 'ٹرانسپورٹر'), null),
              (
                c.t('Transport driver', 'سائق النقل', 'نقل و حمل کا ڈرائیور'),
                null
              ),
              (c.t('Recovery vehicle', 'مركبة النقل', 'ریکوری گاڑی'), null),
              (c.t('Estimated arrival', 'الوصول المتوقع', 'متوقع آمد'), null),
            ],
          ),
        ),
        _Section(
          number: 3,
          title: c.t(
            'Vehicle handover condition',
            'حالة تسليم المركبة',
            'حوالگی کے وقت گاڑی کی حالت',
          ),
          child: _Facts(
            items: [
              (c.t('Odometer', 'عداد المسافة', 'اوڈومیٹر'), null),
              (c.t('Engine hours', 'ساعات المحرك', 'انجن کے گھنٹے'), null),
              (c.t('Fuel', 'الوقود', 'ایندھن'), null),
              (c.t('Keys', 'المفاتيح', 'چابیاں'), null),
              (
                c.t(
                  'Documents sent',
                  'المستندات المرسلة',
                  'ارسال کردہ دستاویزات',
                ),
                null
              ),
              (
                c.t(
                  'Accessories / checklist',
                  'الملحقات / قائمة التحقق',
                  'لوازمات / چیک لسٹ',
                ),
                null
              ),
              (
                c.t(
                  'Outgoing damage photos',
                  'صور الأضرار عند التسليم',
                  'روانگی کے نقصان کی تصاویر',
                ),
                null
              ),
              (
                c.t(
                  'Outgoing condition signed by',
                  'موقع حالة التسليم',
                  'روانگی کی حالت پر دستخط کنندہ',
                ),
                null
              ),
            ],
          ),
        ),
        _Section(
          number: 4,
          title: c.t('Workshop receipt', 'استلام الورشة', 'ورکشاپ کی وصولی'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _UnavailableFields(
                labels: [
                  c.t(
                    'Arrived date / time',
                    'تاريخ / وقت الوصول',
                    'آمد کی تاریخ / وقت',
                  ),
                  c.t(
                    'Received by — name and designation',
                    'المستلم — الاسم والوظيفة',
                    'وصول کنندہ — نام اور عہدہ',
                  ),
                  c.t(
                    'Incoming odometer / engine hours / fuel',
                    'عداد المسافة / ساعات المحرك / الوقود عند الوصول',
                    'آمد کا اوڈومیٹر / انجن گھنٹے / ایندھن',
                  ),
                  c.t(
                    'Condition matches dispatch',
                    'الحالة تطابق التسليم',
                    'حالت روانگی سے مطابقت رکھتی ہے',
                  ),
                  c.t(
                    'Additional damage / remarks',
                    'أضرار إضافية / ملاحظات',
                    'اضافی نقصان / تبصرے',
                  ),
                ],
              ),
              _UnavailableFields(
                labels: [
                  c.t('Receiving photos', 'صور الاستلام', 'وصولی کی تصاویر'),
                  c.t(
                    'Signed handover paper',
                    'ورقة التسليم الموقعة',
                    'دستخط شدہ حوالگی کاغذ',
                  ),
                  c.t(
                    'Vendor receiver signature',
                    'توقيع مستلم المورد',
                    'وینڈر وصول کنندہ کے دستخط',
                  ),
                  c.t(
                    'Sender / driver signature',
                    'توقيع المرسل / السائق',
                    'بھیجنے والے / ڈرائیور کے دستخط',
                  ),
                ],
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                tristate: true,
                value: null,
                onChanged: null,
                title: Text(
                  c.t(
                    'Custody acceptance',
                    'قبول عهدة المركبة',
                    'گاڑی کی تحویل قبول کرنا',
                  ),
                ),
                subtitle: Text(c.missing),
              ),
              FilledButton.icon(
                onPressed: onAcceptVehicle,
                icon: const Icon(Icons.lock_outline),
                label: Text(
                  c.t(
                    'Sign and accept vehicle',
                    'التوقيع واستلام المركبة',
                    'دستخط کرکے گاڑی قبول کریں',
                  ),
                ),
              ),
            ],
          ),
        ),
        _Section(
          title: c.t('Handover milestones', 'مراحل التسليم', 'حوالگی کے مراحل'),
          child: _Facts(
            items: [
              (workflow('vehicleDispatchedMilestone'), null),
              (workflow('externalWorkshopArrivalMilestone'), null),
              (
                c.t('Signed acceptance', 'الاستلام الموقع', 'دستخط شدہ قبولیت'),
                null
              ),
              (workflow('vendorQuotationReceivedMilestone'), null),
            ],
          ),
        ),
        _Panel(
          child: _Facts(
            items: [
              (copy('expectedRelease'), record.expectedReleaseDate),
              (copy('actualRelease'), record.releaseDate),
              (copy('nextAction'), record.nextStep),
            ],
          ),
        ),
      ],
    );
  }
}

class AccidentTimelineNotificationsWorkspace extends StatefulWidget {
  const AccidentTimelineNotificationsWorkspace({
    required this.snapshot,
    this.notifications = const [],
    this.onViewAllNotifications,
    this.onManageRecipients,
    this.onAddNote,
    this.onNotifyParticipants,
    super.key,
  });
  final AccidentCaseSnapshot snapshot;
  final List<AppNotification> notifications;
  final VoidCallback? onViewAllNotifications;
  final VoidCallback? onManageRecipients;
  final VoidCallback? onAddNote;
  final VoidCallback? onNotifyParticipants;

  @override
  State<AccidentTimelineNotificationsWorkspace> createState() =>
      _AccidentTimelineNotificationsWorkspaceState();
}

class _AccidentTimelineNotificationsWorkspaceState
    extends State<AccidentTimelineNotificationsWorkspace> {
  final _timelineKey = GlobalKey();
  final _notificationsKey = GlobalKey();
  final _participantsKey = GlobalKey();

  void _show(GlobalKey key) {
    final context = key.currentContext;
    if (context != null) {
      unawaited(
        Scrollable.ensureVisible(
          context,
          duration: const Duration(milliseconds: 250),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _Copy(context);
    final copy = AccidentCopy.of(context);
    final projection = AccidentCaseWorkflowProjection(widget.snapshot);
    final record = widget.snapshot.accident;
    final notifications = widget.notifications
        .where(
          (n) =>
              n.entityId == record.id &&
              (n.entityType ?? n.type ?? '').toLowerCase().contains('accident'),
        )
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return _Flow(
      children: [
        _Title(
          c.t(
            'Case timeline & notifications',
            'سجل القضية والإشعارات',
            'کیس کی ٹائم لائن اور اطلاعات',
          ),
        ),
        TpIdentifierText('${record.reference} · ${record.assetNo}'),
        _Panel(
          child: _Facts(
            items: [
              (copy('caseStatus'), record.caseStatus ?? record.status),
              (
                c.t('Current owner', 'المسؤول الحالي', 'موجودہ ذمہ دار'),
                _owner(projection.activeWorkstream)
              ),
              (c.t('Next SLA', 'المهلة التالية', 'اگلی مقررہ مدت'), null),
              (c.t('Due in', 'متبقي للموعد', 'مقررہ وقت میں باقی'), null),
            ],
          ),
        ),
        Wrap(
          spacing: TpSpace.sm,
          children: [
            TextButton(
              onPressed: () => _show(_timelineKey),
              child: Text(c.t('Timeline', 'السجل الزمني', 'ٹائم لائن')),
            ),
            TextButton(
              onPressed: () => _show(_notificationsKey),
              child: Text(c.t('Notifications', 'الإشعارات', 'اطلاعات')),
            ),
            TextButton(
              onPressed: () => _show(_participantsKey),
              child: Text(c.t('Participants', 'المشاركون', 'شرکاء')),
            ),
          ],
        ),
        _Section(
          sectionKey: _timelineKey,
          title: c.t(
            'Recorded workstream updates',
            'تحديثات مسارات العمل المسجلة',
            'درج شدہ ورک اسٹریم اپ ڈیٹس',
          ),
          child: Column(
            children: [
              if (record.createdAt != null)
                _EventRow(
                  title: c.t(
                    'Accident reported',
                    'تم الإبلاغ عن الحادث',
                    'حادثہ رپورٹ ہوا',
                  ),
                  date: record.createdAt!,
                  detail: record.reporterName,
                  status: null,
                ),
              if (projection.datedUpdates.isEmpty) Text(c.missing),
              for (final stream in projection.datedUpdates)
                _EventRow(
                  title: workstreamLabel(copy, stream.key),
                  date: stream.updatedAt!,
                  detail: [
                    if (_owner(stream) != null) _owner(stream)!,
                    if (stream.notes?.trim().isNotEmpty == true) stream.notes!,
                    if (stream.naReason?.trim().isNotEmpty == true)
                      stream.naReason!,
                  ].join('\n'),
                  status: stream.status,
                ),
            ],
          ),
        ),
        _Section(
          sectionKey: _notificationsKey,
          icon: Icons.mail_outline,
          title: c.t('Notification log', 'سجل الإشعارات', 'اطلاعات کا ریکارڈ'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (notifications.isEmpty) Text(c.missing),
              for (final notification in notifications)
                _EventRow(
                  title: c.value(notification.title),
                  date: notification.createdAt,
                  detail: notification.body,
                  status: notification.isRead
                      ? c.t('Read', 'مقروء', 'پڑھا گیا')
                      : c.t('Unread', 'غير مقروء', 'نہیں پڑھا گیا'),
                ),
              _Facts(
                items: [
                  (
                    c.t(
                      'Email delivery / recipients',
                      'تسليم البريد / المستلمون',
                      'ای میل کی ترسیل / وصول کنندگان',
                    ),
                    null
                  ),
                ],
              ),
              OutlinedButton(
                onPressed: widget.onViewAllNotifications,
                child: Text(
                  c.t(
                    'View all notifications',
                    'عرض جميع الإشعارات',
                    'تمام اطلاعات دیکھیں',
                  ),
                ),
              ),
            ],
          ),
        ),
        KeyedSubtree(
          key: _participantsKey,
          child: _Participants(
            snapshot: widget.snapshot,
            title: c.t(
              'Participants and ownership',
              'المشاركون والمسؤولية',
              'شرکاء اور ذمہ داری',
            ),
          ),
        ),
        OutlinedButton.icon(
          onPressed: widget.onManageRecipients,
          icon: const Icon(Icons.groups_outlined),
          label: Text(
            c.t(
              'Manage recipient groups',
              'إدارة مجموعات المستلمين',
              'وصول کنندگان کے گروپس سنبھالیں',
            ),
          ),
        ),
        _Actions(
          actions: [
            (
              c.t(
                'Add timeline note',
                'إضافة ملاحظة للسجل',
                'ٹائم لائن میں نوٹ شامل کریں',
              ),
              Icons.edit_outlined,
              widget.onAddNote
            ),
            (
              c.t(
                'Notify participants',
                'إشعار المشاركين',
                'شرکاء کو اطلاع دیں',
              ),
              Icons.campaign_outlined,
              widget.onNotifyParticipants
            ),
          ],
        ),
      ],
    );
  }
}

class _Copy {
  _Copy(this.context);
  final BuildContext context;
  String t(String en, String ar, String ur) =>
      switch (Localizations.localeOf(context).languageCode) {
        'ar' => ar,
        'ur' => ur,
        _ => en
      };
  String get missing => AccidentCopy.of(context)('notRecorded');
  String value(String? value) =>
      value?.trim().isNotEmpty == true ? value!.trim() : missing;
}

class _Flow extends StatelessWidget {
  const _Flow({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i != 0) const SizedBox(height: TpSpace.md),
            children[i],
          ],
        ],
      );
}

class _Title extends StatelessWidget {
  const _Title(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Text(
        text,
        style: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w800,
              color: TpPalette.of(context).text,
            ),
      );
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) =>
      TpCard(padding: const EdgeInsets.all(TpSpace.md), child: child);
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.child,
    this.number,
    this.icon,
    this.sectionKey,
  });
  final String title;
  final Widget child;
  final int? number;
  final IconData? icon;
  final Key? sectionKey;
  @override
  Widget build(BuildContext context) => Column(
        key: sectionKey,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (number != null)
                CircleAvatar(
                  radius: 12,
                  backgroundColor: TpPalette.of(context).primary,
                  child: Text(
                    '$number',
                    style: TextStyle(
                      color: TpPalette.of(context).onPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                )
              else
                Icon(
                  icon ?? Icons.subject,
                  color: TpPalette.of(context).primary,
                  size: 21,
                ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          _Panel(child: child),
        ],
      );
}

class _Facts extends StatelessWidget {
  const _Facts({required this.items});
  final List<(String, String?)> items;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final columns = constraints.maxWidth >= 500 ? 2 : 1;
          final width =
              (constraints.maxWidth - (columns - 1) * TpSpace.lg) / columns;
          return Wrap(
            spacing: TpSpace.lg,
            runSpacing: TpSpace.sm,
            children: [
              for (final item in items)
                SizedBox(
                  width: width,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            item.$1,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        const SizedBox(width: TpSpace.sm),
                        Expanded(
                          child: Text(
                            _Copy(context).value(item.$2),
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      );
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(TpSpace.md),
        decoration: BoxDecoration(
          color: TpPalette.of(context).forStatus(TpStatus.warning).soft,
          border: Border.all(
            color: TpPalette.of(context).forStatus(TpStatus.warning).base,
          ),
          borderRadius: BorderRadius.circular(TpRadius.sm),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              Icons.info_outline,
              color: TpPalette.of(context).forStatus(TpStatus.warning).base,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(child: Text(text)),
          ],
        ),
      );
}

class _Actions extends StatelessWidget {
  const _Actions({required this.actions});
  final List<(String, IconData, VoidCallback?)> actions;
  @override
  Widget build(BuildContext context) => Wrap(
        spacing: TpSpace.sm,
        runSpacing: TpSpace.sm,
        children: [
          for (final action in actions)
            OutlinedButton.icon(
              onPressed: action.$3,
              icon: Icon(action.$2),
              label: Text(action.$1),
            ),
        ],
      );
}

class _UnavailableFields extends StatelessWidget {
  const _UnavailableFields({required this.labels});
  final List<String> labels;
  @override
  Widget build(BuildContext context) => Column(
        children: [
          for (final label in labels)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.md),
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: label,
                  enabled: false,
                  border: const OutlineInputBorder(),
                ),
                child: Text(_Copy(context).missing),
              ),
            ),
        ],
      );
}

class _RoleHeader extends StatelessWidget {
  const _RoleHeader({
    required this.snapshot,
    required this.workstreamKey,
    required this.title,
  });
  final AccidentCaseSnapshot snapshot;
  final String workstreamKey;
  final String title;
  @override
  Widget build(BuildContext context) {
    final c = _Copy(context);
    final stream =
        snapshot.workstreams.where((w) => w.key == workstreamKey).firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Title('${snapshot.accident.reference} · ${snapshot.accident.assetNo}'),
        const SizedBox(height: TpSpace.sm),
        Text(
          '$title · ${c.value(stream?.status)}',
          style: TextStyle(
            color: TpPalette.of(context).primary,
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          '${c.t('Owner', 'المسؤول', 'ذمہ دار')}: ${c.value(_owner(stream))}',
        ),
        const Divider(),
        _Facts(
          items: [
            (
              c.t(
                'Last recorded update',
                'آخر تحديث مسجل',
                'آخری درج شدہ اپ ڈیٹ',
              ),
              stream?.updatedAt == null
                  ? null
                  : _date(context, stream!.updatedAt!)
            ),
            (
              c.t(
                'Received / elapsed / SLA',
                'الاستلام / المدة / المهلة',
                'وصولی / گزرا وقت / مقررہ مدت',
              ),
              null
            ),
            if (stream?.progressPct != null)
              (
                AccidentCaseWorkflowCopy.of(context)('recordedProgress'),
                '${stream!.progressPct}%'
              ),
            if (stream?.notes?.trim().isNotEmpty == true)
              ('Notes', stream!.notes),
            if (stream?.naReason?.trim().isNotEmpty == true)
              ('Waiver reason', stream!.naReason),
          ],
        ),
      ],
    );
  }
}

class _Participants extends StatelessWidget {
  const _Participants({required this.snapshot, required this.title});
  final AccidentCaseSnapshot snapshot;
  final String title;
  @override
  Widget build(BuildContext context) {
    final c = _Copy(context);
    final owners =
        snapshot.workstreams.where((w) => _owner(w) != null).toList();
    return _Section(
      icon: Icons.notifications_none,
      title: title,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (owners.isEmpty) Text(c.missing),
          for (final owner in owners)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(
                children: [
                  Icon(
                    Icons.person_outline,
                    color: TpPalette.of(context).primary,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      '${workstreamLabel(AccidentCopy.of(context), owner.key)}: ${_owner(owner)}',
                    ),
                  ),
                ],
              ),
            ),
          const Divider(),
          Text(
            '${c.t('Named recipients and delivery confirmation', 'المستلمون بالأسماء وتأكيد التسليم', 'وصول کنندگان کے نام اور ترسیل کی تصدیق')}: ${c.missing}',
          ),
        ],
      ),
    );
  }
}

class _RouteChoices extends StatelessWidget {
  const _RouteChoices({required this.recorded});
  final String? recorded;
  @override
  Widget build(BuildContext context) {
    final w = AccidentCaseWorkflowCopy.of(context);
    final token = (recorded ?? '').trim().toLowerCase().replaceAll('_', ' ');
    final routes = [
      ('internal workshop', w('internalWorkshop'), Icons.build_outlined),
      ('external workshop', w('externalWorkshop'), Icons.domain),
      ('on site repair', w('onSiteRepair'), Icons.local_shipping_outlined),
    ];
    return Wrap(
      spacing: TpSpace.sm,
      runSpacing: TpSpace.sm,
      children: [
        for (final route in routes)
          Container(
            width: 140,
            padding: const EdgeInsets.all(TpSpace.md),
            decoration: BoxDecoration(
              color:
                  token == route.$1 ? TpPalette.of(context).primarySoft : null,
              border: Border.all(
                color: token == route.$1
                    ? TpPalette.of(context).primary
                    : TpPalette.of(context).border,
              ),
              borderRadius: BorderRadius.circular(TpRadius.sm),
            ),
            child: Column(
              children: [
                Icon(route.$3, color: TpPalette.of(context).primary),
                const SizedBox(height: TpSpace.sm),
                Text(route.$2, textAlign: TextAlign.center),
                if (token == route.$1)
                  Icon(
                    Icons.check_circle,
                    color: TpPalette.of(context).primary,
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _DamageRow extends StatelessWidget {
  const _DamageRow({required this.mark});
  final AccidentDamageMark mark;
  @override
  Widget build(BuildContext context) {
    final copy = AccidentCopy.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.car_crash_outlined,
            color: TpPalette.of(context)
                .forStatus(
                  mark.severity == AccidentDamageSeverity.severe
                      ? TpStatus.critical
                      : TpStatus.warning,
                )
                .base,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  mark.areaLabel ?? accidentDamageZoneLabel(copy, mark.zoneId),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                Text(
                  '${accidentDamageTypeCopyLabel(copy, mark.damageType)} · ${accidentDamageSeverityLabel(copy, mark.severity)}',
                ),
                if (mark.note?.trim().isNotEmpty == true) Text(mark.note!),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EventRow extends StatelessWidget {
  const _EventRow({
    required this.title,
    required this.date,
    required this.detail,
    required this.status,
  });
  final String title;
  final DateTime date;
  final String? detail;
  final String? status;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
        decoration: BoxDecoration(
          border:
              Border(bottom: BorderSide(color: TpPalette.of(context).border)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: TpPalette.of(context).primarySoft,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.history,
                color: TpPalette.of(context).primary,
                size: 20,
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  if (detail?.trim().isNotEmpty == true) Text(detail!),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    _date(context, date),
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                  Text(
                    _Copy(context).value(status),
                    style: TextStyle(color: TpPalette.of(context).primary),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
}

String? _owner(AccidentWorkstream? stream) {
  final text = [stream?.team, stream?.ownerRole]
      .whereType<String>()
      .where((v) => v.trim().isNotEmpty)
      .join(' / ');
  return text.isEmpty ? null : text;
}

String? _amount(num? value) =>
    value != null && value.isFinite ? value.toString() : null;
String _date(BuildContext context, DateTime value) {
  final local = value.toLocal();
  final labels = MaterialLocalizations.of(context);
  return '${labels.formatShortDate(local)} · ${labels.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
}

AccidentDamageMap _damage(String? value) {
  if (value?.trim().isEmpty ?? true) return const AccidentDamageMap.empty();
  try {
    final decoded = jsonDecode(value!);
    return decoded is Map<String, dynamic>
        ? AccidentDamageMap.fromJson(decoded)
        : const AccidentDamageMap.empty();
  } on FormatException {
    return const AccidentDamageMap.empty();
  }
}
