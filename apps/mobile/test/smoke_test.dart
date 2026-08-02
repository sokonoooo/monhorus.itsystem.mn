import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/features/auth/data/models/user_model.dart';
import 'package:monhorus_mobile/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_mobile/features/user_management/presentation/providers/user_management_provider.dart';

void main() {
  test('UserModel round-trips JSON', () {
    final UserModel user = UserModel.fromJson(<String, dynamic>{
      'id': '6a67013e11b34f68bfc4037f',
      'fullName': 'Б. Энхтөр',
      'email': 'b.enkhtur@electro.mn',
      'phone': '9911-2233',
      'role': 'technician',
      'status': 'must_change_password',
      'lastLoginAt': '2026-07-27T06:58:01.951Z',
    });

    expect(user.role, UserRole.technician);
    expect(user.status, AccountStatus.mustChangePassword);
    expect(user.mustChangePassword, isTrue);
    // Staff carry no organisation, and an absent key is read the same as an explicit
    // null so a login payload and a cached one agree.
    expect(user.customerId, isNull);
    expect(user.customerName, isNull);
    expect(UserModel.fromJson(user.toJson()), user);
  });

  test('UserModel carries the customer link the API reports', () {
    // Shaped as UserDto sends it: customerId and customerName sit beside the rest of
    // the account, and CurrentUserDto adds the permission list on top.
    final UserModel customer = UserModel.fromJson(<String, dynamic>{
      'id': '5f1b0c2a11b34f68bfc40001',
      'fullName': 'Д. Оюунчимэг',
      'email': 'oyun@centraltower.mn',
      'phone': '9911-2233',
      'role': 'customer',
      'status': 'active',
      'customerId': '6a67013e11b34f68bfc4037f',
      'customerName': 'Central Tower ХХК',
      'lastLoginAt': null,
      'permissions': <String>[PermissionKeys.portalServiceRequestCreate],
    });

    expect(customer.customerId, '6a67013e11b34f68bfc4037f');
    expect(customer.customerName, 'Central Tower ХХК');
    expect(customer.has(PermissionKeys.portalServiceRequestCreate), isTrue);
    // The link must survive the on-device cache, or a restored session would look
    // unlinked until the next /auth/me.
    expect(UserModel.fromJson(customer.toJson()), customer);
  });

  test('a blank customerId is read as absent rather than as an organisation', () {
    final UserModel user = UserModel.fromJson(<String, dynamic>{
      'id': '5f1b0c2a11b34f68bfc40002',
      'fullName': 'С. Батжаргал',
      'email': 'batjargal@nowhere.mn',
      'phone': null,
      'role': 'customer',
      'status': 'active',
      'customerId': '',
      'customerName': '',
      'lastLoginAt': null,
    });

    // An empty string would otherwise resolve to a scope that matches nothing while
    // looking resolved, which reads as an organisation with no buildings.
    expect(user.customerId, isNull);
    expect(user.customerName, isNull);
  });

  test('customerId is part of identity, so a relink is a state change', () {
    const AppUser before = AppUser(
      id: 'u1',
      fullName: 'Д. Оюунчимэг',
      email: 'oyun@centraltower.mn',
      role: UserRole.customer,
      status: AccountStatus.active,
    );
    const AppUser after = AppUser(
      id: 'u1',
      fullName: 'Д. Оюунчимэг',
      email: 'oyun@centraltower.mn',
      role: UserRole.customer,
      status: AccountStatus.active,
      customerId: '6a67013e11b34f68bfc4037f',
    );

    expect(before, isNot(after));
  });

  test('unknown role degrades to least privilege', () {
    expect(UserRole.fromWire('super_root'), UserRole.customer);
    expect(AccountStatus.fromWire(null), AccountStatus.active);
  });

  test('admin cannot manage another administrator', () {
    const AppUser admin = AppUser(id: 'a', fullName: 'A', email: 'a@x.mn',
        role: UserRole.admin, status: AccountStatus.active);
    const AppUser headAdmin = AppUser(id: 'h', fullName: 'H', email: 'h@x.mn',
        role: UserRole.headAdmin, status: AccountStatus.active);
    const AppUser tech = AppUser(id: 't', fullName: 'T', email: 't@x.mn',
        role: UserRole.technician, status: AccountStatus.active);

    expect(admin.canManage(tech), isTrue);
    expect(admin.canManage(headAdmin), isFalse);
    expect(admin.canManage(admin), isFalse);
    expect(headAdmin.canManage(admin), isTrue);
    expect(admin.canCreateRole(UserRole.admin), isFalse);
    expect(headAdmin.canCreateRole(UserRole.admin), isTrue);
  });

  test('generated passcode satisfies backend policy', () {
    for (int i = 0; i < 50; i++) {
      final String code = generatePasscode();
      expect(code.length, greaterThanOrEqualTo(10));
      expect(RegExp(r'[A-Za-z]').hasMatch(code), isTrue);
      expect(RegExp(r'\d').hasMatch(code), isTrue);
      expect(RegExp(r'[0O1lI]').hasMatch(code), isFalse);
    }
  });
}
