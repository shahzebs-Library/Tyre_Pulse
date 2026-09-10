import 'package:flutter/material.dart';
import 'package:tyre_pulse/features/approvals/data/approval_review_context.dart';

String approvalDecisionCopy(BuildContext context,
    {bool rejection = false, bool message = false}) {
  final language = Localizations.localeOf(context).languageCode;
  if (rejection) {
    return switch (language) {
      'ar' => message ? 'تم تسجيل الرفض النهائي.' : 'رفض نهائي',
      'ur' => message ? 'حتمی مسترد کرنے کا فیصلہ درج ہو گیا۔' : 'حتمی مسترد',
      _ =>
        message ? 'The terminal rejection was recorded.' : 'Reject permanently'
    };
  }
  return switch (language) {
    'ar' => message
        ? 'أكد الخادم القرار. راجع الحالة الحالية أدناه.'
        : 'تم تسجيل القرار',
    'ur' => message
        ? 'سرور نے فیصلہ تسلیم کیا۔ موجودہ حالت نیچے دیکھیں۔'
        : 'فیصلہ درج ہو گیا',
    _ => message
        ? 'The server confirmed your decision. Review the current status below.'
        : 'Decision recorded'
  };
}

class ApprovalRouteCard extends StatelessWidget {
  const ApprovalRouteCard({required this.review, super.key});
  final ApprovalReviewContext review;

  @override
  Widget build(BuildContext context) {
    String copy(String en, String ar, String ur) =>
        switch (Localizations.localeOf(context).languageCode) {
          'ar' => ar,
          'ur' => ur,
          _ => en
        };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              copy('Approval route', 'مسار الموافقة', 'منظوری کا راستہ'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(
              review.mode == 'enforced'
                  ? copy('Published policy', 'سياسة منشورة', 'شائع شدہ پالیسی')
                  : copy(
                      'Legacy approval rules',
                      'قواعد الموافقة السابقة',
                      'سابقہ منظوری قواعد',
                    ),
            ),
            if (!review.canDecide)
              Text(
                copy(
                  'You cannot decide this stage in the current state.',
                  'لا يمكنك اتخاذ قرار في هذه المرحلة بالحالة الحالية.',
                  'موجودہ حالت میں آپ اس مرحلے کا فیصلہ نہیں کر سکتے۔',
                ),
              ),
            for (var index = 0; index < review.stages.length; index++)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  index < review.currentStage
                      ? Icons.check_circle_outline
                      : index == review.currentStage
                          ? Icons.pending_outlined
                          : Icons.circle_outlined,
                ),
                title:
                    Text('${index + 1}. ${review.stages[index]['name'] ?? ''}'),
                subtitle: Text(
                  '${review.stages[index]['approver_role'] ?? copy('Named reviewer', 'مراجع محدد', 'نامزد جائزہ کار')}',
                ),
              ),
            if (review.history.isNotEmpty)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: Text(
                  copy(
                    'Decision history',
                    'سجل القرارات',
                    'فیصلوں کی تاریخ',
                  ),
                ),
                children: [
                  for (final event in review.history)
                    ListTile(
                      title: Text(
                        '${event['decision'] ?? event['event_type'] ?? ''}',
                      ),
                      subtitle: Text(
                        '${event['actor_name'] ?? event['actor_id'] ?? ''}\n${event['accepted_at'] ?? event['created_at'] ?? ''}\n${event['note'] ?? ''}',
                      ),
                      isThreeLine: true,
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
