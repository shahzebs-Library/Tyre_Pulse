import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_ai_chat_screen.dart';

import 'admin_test_support.dart';

const Widget _screen = AdminAiChatScreen(route: AdminAiChatRoute());

void main() {
  testWidgets('sends the question and renders the service answer', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo = FakeAdminRepository();
    await pumpAdmin(tester, _screen, repository: repo);
    expect(find.text('Ask a question'), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('admin.ai.input')),
      'How often to rotate?',
    );
    await tester.tap(find.byKey(const Key('admin.ai.send')));
    await tester.pumpAndSettle();

    expect(repo.aiConversations.single.single.content, 'How often to rotate?');
    expect(find.text('How often to rotate?'), findsOneWidget);
    expect(find.text('Rotate steer tyres every 20,000 km.'), findsOneWidget);
  });

  testWidgets('a refusal is stated, not written as an answer, and retries', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo = FakeAdminRepository()
      ..aiError = const AdminAiException(AdminAiFailure.disabled);
    await pumpAdmin(tester, _screen, repository: repo);

    await tester.enterText(find.byKey(const Key('admin.ai.input')), 'Hello');
    await tester.tap(find.byKey(const Key('admin.ai.send')));
    await tester.pumpAndSettle();

    expect(
      find.text('AI features are turned off by your administrator.'),
      findsOneWidget,
    );
    expect(find.text('Fleet AI'), findsNothing);

    repo.aiError = null;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(repo.aiConversations, hasLength(2));
    expect(find.text('Rotate steer tyres every 20,000 km.'), findsOneWidget);
    // The retried question was not duplicated in the transcript.
    expect(find.text('Hello'), findsOneWidget);
  });
}
