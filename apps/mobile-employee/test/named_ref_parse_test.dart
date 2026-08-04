// `NamedRef` parsing, pinned directly rather than through a screen.
//
// The API sends two different reference shapes and only one of them carries a `name`.
// A team reference does. An employee reference does not: `EmployeeRefDto` is
// `{id, employeeCode, firstName, lastName, photoUrl}`
// (`packages/shared/src/types/employee.types.ts:15-21`).
//
// Reading `name` alone therefore parsed every assignee as the empty string, so the
// Хариуцагч row on the service-request detail screen rendered blank - and as a bare
// ", " once a request had two assignees. No screen test caught it, because their
// fixtures were hand-built with a `name` the real API never sends. That is exactly
// why this is asserted against the wire shape here rather than through a widget.
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/util/json_parse.dart';

void main() {
  group('NamedRef.fromJson', () {
    test('uses name when the reference carries one, as a team ref does', () {
      final NamedRef? ref = NamedRef.fromJson(<String, dynamic>{
        'id': 't-1',
        'name': 'Баг 2',
      });

      expect(ref?.name, 'Баг 2');
    });

    test('composes an employee ref surname-first, since it sends no name', () {
      final NamedRef? ref = NamedRef.fromJson(<String, dynamic>{
        'id': 'e-1',
        'employeeCode': 'EMP-0004',
        'firstName': 'Мөнхзул',
        'lastName': 'Чулуун',
        'photoUrl': null,
      });

      expect(ref?.name, 'Чулуун Мөнхзул');
    });

    test('falls back to the employee code rather than rendering nothing', () {
      final NamedRef? ref = NamedRef.fromJson(<String, dynamic>{
        'id': 'e-2',
        'employeeCode': 'EMP-0009',
        'firstName': '',
        'lastName': '',
      });

      expect(ref?.name, 'EMP-0009');
    });

    test('keeps only the half that is present', () {
      final NamedRef? ref = NamedRef.fromJson(<String, dynamic>{
        'id': 'e-3',
        'employeeCode': 'EMP-0010',
        'lastName': 'Батаа',
      });

      expect(ref?.name, 'Батаа');
    });

    test('is still null without an id', () {
      expect(NamedRef.fromJson(<String, dynamic>{'name': 'Баг 2'}), isNull);
    });
  });
}
