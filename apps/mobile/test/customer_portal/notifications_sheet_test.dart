import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/notification_model.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/notifications_sheet.dart';

import 'package:monhorus_mobile/core/network/api_result.dart';

import 'fakes.dart';

/// Fails only the mark-all call. The shared fake applies its `failure` to every method, so
/// using that would fail the list too and the button under test would never render - the
/// error branch would be asserted on a screen that never reached it.
class _MarkAllRefusesRepository extends FakeCustomerPortalRepository {
  _MarkAllRefusesRepository({required super.notifications});

  @override
  Future<ApiResult<void>> markAllNotificationsRead() async =>
      const FailureResult<void>(ServerFailure('Сервер хүлээж авсангүй.', code: 'SERVER_ERROR'));
}

/// The notification sheet had no test of its own, and two of its behaviours were wrong in
/// ways a passing suite would never have shown: a refused mark-read looked exactly like a
/// successful one, because the result was awaited and discarded.
void main() {
  Future<void> openSheet(WidgetTester tester, FakeCustomerPortalRepository repo) async {
    await tester.pumpWidget(
      wrapCustomerScreen(
        // A Scaffold is required, not decoration: the sheet reports failures through
        // ScaffoldMessenger, which asserts if no Scaffold is in the tree. Every real
        // screen that opens this sheet has one.
        Scaffold(
          body: Builder(
            builder: (BuildContext context) => TextButton(
              onPressed: () => NotificationsSheet.show(context),
              child: const Text('open'),
            ),
          ),
        ),
        repository: repo,
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('lists the notifications it was given', (WidgetTester tester) async {
    final FakeCustomerPortalRepository repo = FakeCustomerPortalRepository(
      notifications: <NotificationModel>[notificationFixture()],
    );

    await openSheet(tester, repo);

    expect(find.textContaining('LDB-2F-02'), findsOneWidget);
  });

  /// The regression. A server that refuses must not look like one that agreed.
  testWidgets('says so when marking everything read is refused', (WidgetTester tester) async {
    final FakeCustomerPortalRepository repo = _MarkAllRefusesRepository(
      notifications: <NotificationModel>[notificationFixture()],
    );

    await openSheet(tester, repo);
    await tester.tap(find.text('Бүгдийг уншсан'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Сервер хүлээж авсангүй.'), findsOneWidget);
  });

  testWidgets('stays quiet when marking everything read succeeds', (WidgetTester tester) async {
    final FakeCustomerPortalRepository repo = FakeCustomerPortalRepository(
      notifications: <NotificationModel>[notificationFixture()],
    );

    await openSheet(tester, repo);
    await tester.tap(find.text('Бүгдийг уншсан'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // No SnackBar: nothing went wrong, so nothing is said.
    expect(find.byType(SnackBar), findsNothing);
  });
}
