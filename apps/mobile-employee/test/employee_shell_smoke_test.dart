import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/theme/app_theme.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/calendar/presentation/screens/calendar_tab_screen.dart';
import 'package:monhorus_employee/features/employee/home/presentation/widgets/notifications_sheet.dart';
import 'package:monhorus_employee/features/employee/presentation/screens/employee_shell_screen.dart';

/// Integration smoke test for the shell.
///
/// The four tabs were written in parallel by separate agents and this is the first
/// thing that mounts all of them in one tree. It deliberately runs with no backend
/// and no platform plugins: every request fails, which is the harshest ordinary
/// condition, and the point is that each tab renders *something* — a loading, empty
/// or error state — rather than throwing, overflowing, or colliding with a sibling.
///
/// It asserts nothing about content, because content depends on a server. It asserts
/// that the app does not fall over, which is what "the four tabs coexist" means.
///
/// It also pins the top bar. `.hdr-actions` is on every tab-level screen in the
/// prototype — calendar first, bell second — and Хуанли is deliberately NOT in the
/// bottom nav, so the calendar button is the only way to the schedule. Both halves of
/// that contract are asserted per tab below.

/// The nav labels, in contract order. Хуанли is absent by design.
const List<String> _tabs = <String>['Нүүр', 'Ажил', 'Төсөл', 'Профайл'];

/// A signed-in account, with no permissions.
///
/// Профайл renders a bare spinner without a session and the schedule renders its
/// signed-out branch, so a session has to exist for the header to be on screen at
/// all. The permission set is left empty on purpose: that is what an account looks
/// like between login and the first `/auth/me`, and the header must not depend on it.
const AppUser _technician = AppUser(
  id: 'u-1',
  fullName: 'Б. Энхтөр',
  email: 'tech@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
);

Future<void> _mountShell(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_technician),
      ],
      child: const MaterialApp(home: EmployeeShellScreen()),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 200));
}

/// Moves the shell to [label] and lets the switch settle.
///
/// `pumpAndSettle` cannot be used: every tab holds an indefinite spinner while its
/// (failing) request is in flight, so the tree never goes still.
Future<void> _openTab(WidgetTester tester, String label) async {
  await tester.tap(find.text(label).last);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 200));
}

/// Pumps in 50ms slices until [done] holds, and fails rather than hanging if it
/// never does.
///
/// Neither of the two obvious alternatives works here. `pumpAndSettle` cannot be used
/// anywhere in this file: every tab holds an indeterminate spinner while its (failing)
/// request is in flight, so the tree never goes still and settling would time out. A
/// fixed number of timed pumps does not work either, which is what made an earlier
/// version of the pop assertion below look like a product bug: the Material page
/// transition's length is a framework detail — measured here at ~450ms, not the 300ms
/// one might assume — and a route leaves the overlay only on the frame AFTER its
/// animation reports dismissed. Pumping to a guessed duration left the push at 89%,
/// so the pop unwound from there and had not finished when the assertion ran.
///
/// Waiting on the tree instead of on the clock is deterministic and stays correct if
/// the framework changes that duration again.
Future<void> _pumpUntil(
  WidgetTester tester,
  bool Function() done, {
  required String reason,
}) async {
  for (int frame = 0; frame < 60; frame++) {
    if (done()) return;
    await tester.pump(const Duration(milliseconds: 50));
  }
  fail('timed out after 3s waiting for $reason');
}

/// The header button carrying [tooltip], scoped to the visible tab.
///
/// IndexedStack keeps every tab mounted, so all four copies of `.hdr-actions` are in
/// the tree at once and a bare tooltip finder would match four widgets. Only the
/// visible one is hit-testable, which is what `hitTestable()` selects.
Finder _headerButton(String tooltip) =>
    find.byTooltip(tooltip).hitTestable();

void main() {
  testWidgets('all four tabs mount and can be switched between', (
    WidgetTester tester,
  ) async {
    await _mountShell(tester);

    // The nav is the shell's own contract: four labels, in this order.
    for (final String label in _tabs) {
      expect(find.text(label), findsWidgets, reason: '$label is missing from the nav');
    }

    // The prototype's nav has no calendar entry (`navItems`, L2113-2119). A Хуанли
    // tab here would be the wrong UI, which is exactly the regression this pins.
    expect(find.text('Хуанли'), findsNothing);

    // Visit each tab. IndexedStack builds every child up front, so a crash in any
    // one of them would already have surfaced; tapping proves the switch works and
    // that a tab still renders once it has been laid out and animated.
    for (final String label in _tabs) {
      await _openTab(tester, label);
      expect(
        tester.takeException(),
        isNull,
        reason: 'tab $label threw while rendering',
      );
    }
  });

  testWidgets('the shell paints inside a themed app without overflowing', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(theme: AppTheme.light, home: const EmployeeShellScreen()),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(tester.takeException(), isNull);
  });

  // -- The top bar, on every tab ---------------------------------------------
  //
  // Parameterised rather than written once for Нүүр: the two buttons used to live on
  // that tab alone, and the whole point of the shared `EmployeeHeaderActions` is that
  // the other three carry them too.
  for (final String label in _tabs) {
    testWidgets('$label carries the calendar and the bell, in that order', (
      WidgetTester tester,
    ) async {
      await _mountShell(tester);
      await _openTab(tester, label);

      final Finder calendar = _headerButton('Миний хуваарь');
      final Finder bell = _headerButton('Мэдэгдэл');
      expect(calendar, findsOneWidget);
      expect(bell, findsOneWidget);

      // Calendar first, bell second — the prototype's order on all five screens.
      expect(
        tester.getCenter(calendar).dx,
        lessThan(tester.getCenter(bell).dx),
        reason: 'the calendar must sit to the left of the bell',
      );
    });

    testWidgets('$label: the calendar button pushes the schedule', (
      WidgetTester tester,
    ) async {
      await _mountShell(tester);
      await _openTab(tester, label);

      expect(find.byType(CalendarTabScreen), findsNothing);

      await tester.tap(_headerButton('Миний хуваарь'));
      // Waiting for the back chip to be tappable also waits out the push transition,
      // so the tap below cannot land on a half-arrived route.
      await _pumpUntil(
        tester,
        () => _headerButton('Буцах').evaluate().length == 1,
        reason: 'the schedule to arrive',
      );

      expect(find.byType(CalendarTabScreen), findsOneWidget);
      expect(tester.takeException(), isNull);

      // Pushed, not swapped: the back chip returns to the tab.
      await tester.tap(_headerButton('Буцах'));
      await _pumpUntil(
        tester,
        () => find.byType(CalendarTabScreen).evaluate().isEmpty,
        reason: 'the schedule to be popped',
      );
      expect(find.text(label), findsWidgets, reason: '$label did not come back');
    });

    testWidgets('$label: the bell opens the notifications sheet', (
      WidgetTester tester,
    ) async {
      await _mountShell(tester);
      await _openTab(tester, label);

      expect(find.byType(NotificationsSheet), findsNothing);

      await tester.tap(_headerButton('Мэдэгдэл'));
      await _pumpUntil(
        tester,
        () => find.byType(NotificationsSheet).evaluate().isNotEmpty,
        reason: 'the notifications sheet to open',
      );

      expect(find.byType(NotificationsSheet), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
