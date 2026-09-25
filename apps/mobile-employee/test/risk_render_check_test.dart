// The risk contract, asserted rather than assumed.
//
// This file exists because the app shipped with two `RiskLevel` enums whose colour
// mappings disagreed: the Төсөл tab drew SCHEDULE_REPAIR orange while the Ажил tab
// drew it the same yellow as ATTENTION, so one device read as two different bands
// depending on which tab you were standing in. Nothing caught it. These tests are
// what would have.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/employee/presentation/theme/employee_tokens.dart';
import 'package:monhorus_employee/features/employee/presentation/widgets/risk_glyph.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/risk_level.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/project_ui.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/risk_widgets.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/planned_work_enums.dart'
    as work;

Widget _host(Widget child) => MaterialApp(
      home: Scaffold(
        backgroundColor: EmployeeTokens.bg,
        body: SingleChildScrollView(child: child),
      ),
    );

void main() {
  test('there is one RiskLevel enum, and the work feature re-exports it', () {
    // Identical types, not merely identical wire values: `==` on two same-named
    // enums from different libraries would not even compile, which is the point.
    expect(work.RiskLevel.values, same(RiskLevel.values));
    expect(work.RiskLevel.scheduleRepair, RiskLevel.scheduleRepair);
  });

  test('all five bands are visually distinct', () {
    // The five documented bands, not `RiskLevel.values`: the enum also carries the
    // three reserved storage keys, which share a neutral placeholder triad until an
    // administrator colours them and would read here as three "collapsed" bands.
    final Set<Color> foregrounds =
        documentedRiskBands.map((RiskLevel l) => l.tone.foreground).toSet();
    expect(foregrounds.length, 5, reason: 'a collapsed band is the bug this file exists for');

    final Set<Color> backgrounds =
        documentedRiskBands.map((RiskLevel l) => l.tone.background).toSet();
    expect(backgrounds.length, 5);

    // …and the unassessed state is none of them, and specifically is not green.
    expect(foregrounds.contains(Tone.neutral.foreground), isFalse);
    expect(riskTone(null), Tone.neutral);
    expect(riskTone(null).foreground, isNot(RiskLevel.normal.tone.foreground));
  });

  test('no band is labelled by its colour', () {
    const List<String> colourNames = <String>[
      'Ногоон',
      'Шар',
      'Улбар шар',
      'Улаан',
      'Хар',
    ];
    for (final RiskLevel level in RiskLevel.values) {
      expect(colourNames, isNot(contains(level.shortLabel)));
      expect(colourNames, isNot(contains(level.label)));
    }

    expect(RiskLevel.normal.shortLabel, 'Хэвийн');
    expect(RiskLevel.attention.shortLabel, 'Анхаарах');
    expect(RiskLevel.scheduleRepair.shortLabel, 'Засварлах');
    expect(RiskLevel.critical.shortLabel, 'Ноцтой');
    expect(RiskLevel.outOfService.shortLabel, 'Боломжгүй');
    expect(riskShortLabel(null), 'Үнэлгээгүй');
  });

  testWidgets('the legend names every band and prints no score range', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_host(const RiskLegend()));
    await tester.pumpAndSettle();

    for (final RiskLevel level in documentedRiskBands) {
      expect(find.text(level.label), findsOneWidget);
    }
    expect(find.text(unassessedLabel), findsOneWidget);

    // And the reserved keys are NOT named. Nobody has configured a sixth band, so
    // there is no sixth band to put in a legend.
    expect(find.text(RiskLevel.band6.label), findsNothing);

    // Six bands, six glyphs — the silhouette is what survives greyscale.
    expect(find.byType(RiskGlyph), findsNWidgets(6));

    // The thresholds are server-side and this role gets a 403 on /settings, so the
    // scale must not appear anywhere.
    expect(find.textContaining('%'), findsNothing);
    expect(find.textContaining('Стандарт хуваарь'), findsNothing);

    expect(tester.takeException(), isNull);
  });

  testWidgets('a risk pill carries a glyph and announces the full band name', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _host(
        const Row(
          children: <Widget>[
            RiskPill(score: 38, level: RiskLevel.critical),
            RiskPill(score: null, level: null),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('НОЦТОЙ 38'), findsOneWidget);
    expect(find.text('ҮНЭЛГЭЭГҮЙ'), findsOneWidget);
    expect(find.byType(RiskGlyph), findsNWidgets(2));

    // A screen reader hears the meaning, not the colour and not a bare number.
    expect(
      find.bySemanticsLabel('${RiskLevel.critical.label}, оноо 38'),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel(unassessedLabel), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  testWidgets('the score ring keeps the score and drops the scale', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _host(const Center(child: ScoreRing(score: 38, level: RiskLevel.critical))),
    );
    await tester.pumpAndSettle();

    expect(find.text('38'), findsOneWidget);
    expect(find.text('/100'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Оноо 38, ${RiskLevel.critical.label}'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
