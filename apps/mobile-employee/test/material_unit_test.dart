// A unit is not decoration on a quantity: it is half of what the quantity means.
//
// `MaterialUnit.fromWire` used to fold every value it did not recognise onto PIECE,
// so a unit added to `MATERIAL_UNITS` after this build shipped came out of the phone
// as «ширхэг» — 40 metres of cable read back to the technician as 40 pieces of it.
// These checks pin the honest behaviour: an unknown value stays unknown, and what is
// printed beside the number is either the unit the server actually sent or nothing.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/planned_work_enums.dart';
import 'package:monhorus_employee/features/employee/work/presentation/format.dart';
import 'package:monhorus_employee/features/employee/work/presentation/widgets/task_card.dart';

Map<String, dynamic> _task(String unit) => <String, dynamic>{
      'id': 't1',
      'plannedWorkId': 'w1',
      'title': 'Кабель татах',
      'unit': unit,
      'totalQuantity': 40,
      'completedQuantity': 10,
      'remainingQuantity': 30,
      'progressPercent': 25,
      'status': 'IN_PROGRESS',
      'materialUsage': <dynamic>[
        <String, dynamic>{
          'id': 'u1',
          'taskId': 't1',
          'materialItemId': 'm1',
          'materialName': 'Кабель 3x2.5',
          'quantity': 40,
          'unit': unit,
        },
      ],
    };

Widget _card(PlannedWorkTaskModel task) => MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: TaskCard(
            task: task,
            progressBlockedReason: null,
            onRecordProgress: () {},
            onRecordMaterials: null,
          ),
        ),
      ),
    );

void main() {
  test('a unit this build does not know stays unknown', () {
    expect(MaterialUnit.fromWire('TONNE'), isNull);
    expect(MaterialUnit.fromWire(''), isNull);
    expect(MaterialUnit.fromWire(null), isNull);
    expect(MaterialUnit.fromWire('METRE'), MaterialUnit.metre);
  });

  test('an unknown unit is carried through as the string the server sent', () {
    const MaterialUnitValue unknown = MaterialUnitValue(null, 'TONNE');
    expect(MaterialUnitValue.fromWire('TONNE'), unknown);
    expect(unknown.isKnown, isFalse);
    expect(unknown.label, 'TONNE');

    final MaterialUnitValue known = MaterialUnitValue.fromWire('METRE');
    expect(known.isKnown, isTrue);
    expect(known.label, 'метр');

    // No unit at all names none, rather than borrowing one.
    expect(MaterialUnitValue.fromWire(null).label, isEmpty);
    expect(MaterialUnitValue.fromWire('  ').label, isEmpty);
  });

  test('a quantity prints with the unit that was recorded, or with none', () {
    expect(formatQuantityWithUnit(40, MaterialUnitValue.fromWire('METRE')), '40 метр');
    expect(formatQuantityWithUnit(40, MaterialUnitValue.fromWire('TONNE')), '40 TONNE');
    expect(formatQuantityWithUnit(2.5, MaterialUnitValue.fromWire(null)), '2.5');
  });

  testWidgets('a task carrying an unknown unit is never drawn as ширхэг',
      (WidgetTester tester) async {
    await tester.pumpWidget(_card(PlannedWorkTaskModel.fromJson(_task('TONNE'))));

    expect(find.textContaining('ширхэг'), findsNothing);
    expect(find.textContaining('TONNE'), findsWidgets);
  });

  testWidgets('a known unit still reads as its Mongolian name',
      (WidgetTester tester) async {
    await tester.pumpWidget(_card(PlannedWorkTaskModel.fromJson(_task('METRE'))));

    expect(find.textContaining('метр'), findsWidgets);
    expect(find.textContaining('METRE'), findsNothing);
  });
}
