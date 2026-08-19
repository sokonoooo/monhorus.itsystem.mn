import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/network/paginated_data.dart';
import 'package:monhorus_mobile/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/notification_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/object_master_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/project_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/service_request_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/customer_scope.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/object_master_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/risk_level.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/service_request_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/format.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/providers/customer_portal_providers.dart';

import 'fakes.dart';

void main() {
  /// Builds a container holding one signed-in account and nothing else, so the scope
  /// under test can only have come from that account.
  ProviderContainer containerFor(AppUser? user) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[currentUserProvider.overrideWithValue(user)],
    );
    addTearDown(container.dispose);
    return container;
  }

  group('customerScopeProvider', () {
    test('resolves from the customerId the session reported', () {
      final CustomerScope scope =
          containerFor(testCustomer).read(customerScopeProvider);

      expect(scope, isA<ResolvedCustomerScope>());
      final ResolvedCustomerScope resolved = scope as ResolvedCustomerScope;
      expect(resolved.customerId, testCustomerId);
      expect(resolved.customerName, testCustomerName);
    });

    test('an account with no customerId stays unavailable, not empty', () {
      final CustomerScope scope =
          containerFor(unlinkedCustomer).read(customerScopeProvider);

      expect(scope, same(UnavailableCustomerScope.accountNotLinked));
      // The explanation must name the fix, since only an administrator can apply it.
      expect(
        UnavailableCustomerScope.accountNotLinked.detail,
        contains('Админд хандана уу'),
      );
    });

    test('staff carry no customer and therefore no scope', () {
      const AppUser admin = AppUser(
        id: '5f1b0c2a11b34f68bfc40003',
        fullName: 'А. Админ',
        email: 'admin@monhorus.mn',
        role: UserRole.admin,
        status: AccountStatus.active,
      );

      expect(
        containerFor(admin).read(customerScopeProvider),
        same(UnavailableCustomerScope.accountNotLinked),
      );
    });

    test('no signed-in user resolves to no session rather than to a customer', () {
      expect(
        containerFor(null).read(customerScopeProvider),
        same(UnavailableCustomerScope.noSession),
      );
    });

    test('two sessions never share a scope', () {
      const AppUser other = AppUser(
        id: '5f1b0c2a11b34f68bfc40004',
        fullName: 'Ц. Ганбат',
        email: 'ganbat@other.mn',
        role: UserRole.customer,
        status: AccountStatus.active,
        customerId: '6a67013e11b34f68bfc40999',
        customerName: 'Өөр ХХК',
      );

      final ResolvedCustomerScope mine =
          containerFor(testCustomer).read(customerScopeProvider)
              as ResolvedCustomerScope;
      final ResolvedCustomerScope theirs =
          containerFor(other).read(customerScopeProvider) as ResolvedCustomerScope;

      expect(mine.customerId, isNot(theirs.customerId));
      expect(theirs.customerId, '6a67013e11b34f68bfc40999');
    });
  });

  group('canCreateServiceRequestProvider', () {
    test('reads the portal permission the customer role grants by default', () {
      expect(
        containerFor(customerWithCreateRight())
            .read(canCreateServiceRequestProvider),
        isTrue,
      );
    });

    test('also accepts the staff key, and nothing else', () {
      final AppUser staffKeyHolder = AppUser(
        id: testCustomer.id,
        fullName: testCustomer.fullName,
        email: testCustomer.email,
        role: testCustomer.role,
        status: testCustomer.status,
        customerId: testCustomer.customerId,
        permissions: const <String>{PermissionKeys.serviceRequestCreate},
      );
      final AppUser viewerOnly = AppUser(
        id: testCustomer.id,
        fullName: testCustomer.fullName,
        email: testCustomer.email,
        role: testCustomer.role,
        status: testCustomer.status,
        customerId: testCustomer.customerId,
        permissions: const <String>{PermissionKeys.portalServiceRequestView},
      );

      expect(
        containerFor(staffKeyHolder).read(canCreateServiceRequestProvider),
        isTrue,
      );
      expect(
        containerFor(viewerOnly).read(canCreateServiceRequestProvider),
        isFalse,
      );
      // The role alone licenses nothing: an empty set is "not known yet".
      expect(
        containerFor(testCustomer).read(canCreateServiceRequestProvider),
        isFalse,
      );
    });

    test('is not gated on the scope, so it never hardcodes a customer', () {
      final AppUser unlinkedButPermitted = AppUser(
        id: unlinkedCustomer.id,
        fullName: unlinkedCustomer.fullName,
        email: unlinkedCustomer.email,
        role: unlinkedCustomer.role,
        status: unlinkedCustomer.status,
        permissions: const <String>{PermissionKeys.portalServiceRequestCreate},
      );

      // The permission answers "may you", the scope answers "for whom". The screens
      // require both; this provider answers only the first.
      expect(
        containerFor(unlinkedButPermitted).read(canCreateServiceRequestProvider),
        isTrue,
      );
    });
  });

  group('the customer id cannot be chosen locally', () {
    /// Every Dart source under lib/, so the invariants below are checked against the
    /// whole app rather than against the handful of files a test happens to import.
    List<File> libSources() {
      final Directory lib = Directory('lib');
      expect(lib.existsSync(), isTrue, reason: 'run from the package root');
      return lib
          .listSync(recursive: true)
          .whereType<File>()
          .where((File file) => file.path.endsWith('.dart'))
          .toList(growable: false);
    }

    test('the session is the only place a scope is built', () {
      final List<String> builders = <String>[];
      for (final File file in libSources()) {
        // The entity declares the constructor; that is not a construction site.
        if (file.path.endsWith('domain/entities/customer_scope.dart')) continue;
        if (file.readAsStringSync().contains('ResolvedCustomerScope(')) {
          builders.add(file.path);
        }
      }

      // Exactly one, and it is the provider that derives it from /auth/me. Any second
      // one would be a customer id that came from somewhere other than the session -
      // a screen argument, a picker, a saved preference.
      expect(builders, hasLength(1));
      expect(
        builders.single,
        endsWith('presentation/providers/customer_portal_providers.dart'),
      );
    });

    test('that one construction reads the id straight off the signed-in user', () {
      final String source =
          File('lib/features/customer_portal/presentation/providers/'
                  'customer_portal_providers.dart')
              .readAsStringSync();
      final int at = source.indexOf('ResolvedCustomerScope(');

      expect(at, isNot(-1));
      // No literal, no fallback, no default: the id is the one the session reported.
      expect(source.substring(at, at + 160), contains('customerId: customerId'));
      expect(
        source.substring(at, at + 160),
        contains('customerName: user.customerName'),
      );
    });

    test('nothing in the app overrides or writes the scope provider', () {
      final List<String> offenders = <String>[];
      for (final File file in libSources()) {
        final String source = file.readAsStringSync();
        if (source.contains('customerScopeProvider.overrideWith') ||
            source.contains('customerScopeProvider.notifier')) {
          offenders.add(file.path);
        }
      }

      expect(offenders, isEmpty);
    });

    test('the scope provider is read-only by construction', () {
      final String source =
          File('lib/features/customer_portal/presentation/providers/'
                  'customer_portal_providers.dart')
              .readAsStringSync();

      // A plain Provider has no setter. A StateProvider or a NotifierProvider would
      // hand any screen a way to move the boundary.
      expect(source, contains('Provider<CustomerScope> customerScopeProvider'));
      expect(source.contains('StateProvider<CustomerScope>'), isFalse);
      expect(source.contains('NotifierProvider<CustomerScope'), isFalse);
    });

    test('every customer-owned read still demands a resolved scope', () {
      final String source =
          File('lib/features/customer_portal/domain/repositories/'
                  'customer_portal_repository.dart')
              .readAsStringSync();

      // Named so a new overload without a scope would have to delete one of these.
      for (final String method in <String>[
        'listProjects',
        'listBuildings',
        'listObjects',
        'listServiceRequests',
      ]) {
        final int at = source.indexOf(method);
        expect(at, isNot(-1), reason: '$method is missing from the interface');
        expect(
          source.substring(at, at + 120),
          contains('ResolvedCustomerScope scope'),
          reason: '$method must not be callable without a scope',
        );
      }
    });
  });

  group('risk bands', () {
    test('mirror the shared RISK_BANDS boundaries', () {
      expect(RiskLevel.fromScore(100), RiskLevel.normal);
      expect(RiskLevel.fromScore(81), RiskLevel.normal);
      expect(RiskLevel.fromScore(80), RiskLevel.attention);
      expect(RiskLevel.fromScore(61), RiskLevel.attention);
      expect(RiskLevel.fromScore(60), RiskLevel.scheduleRepair);
      expect(RiskLevel.fromScore(41), RiskLevel.scheduleRepair);
      expect(RiskLevel.fromScore(40), RiskLevel.critical);
      expect(RiskLevel.fromScore(21), RiskLevel.critical);
      expect(RiskLevel.fromScore(20), RiskLevel.outOfService);
      expect(RiskLevel.fromScore(0), RiskLevel.outOfService);
    });

    test('an absent level stays absent rather than defaulting to a band', () {
      expect(RiskLevel.fromWire(null), isNull);
      expect(RiskLevel.fromWire('SOMETHING_NEW'), isNull);
      expect(RiskLevel.fromWire('OUT_OF_SERVICE'), RiskLevel.outOfService);
    });
  });

  group('service request enums', () {
    test('carry every status the shared constant declares', () {
      expect(ServiceRequestStatus.values.length, 14);
      expect(ServiceRequestType.values.length, 6);
      expect(SlaState.values.length, 6);
      expect(NotificationEvent.values.length, 17);
    });

    test('terminal statuses are the two with no outgoing transition', () {
      expect(ServiceRequestStatus.completed.isTerminal, isTrue);
      expect(ServiceRequestStatus.cancelled.isTerminal, isTrue);
      for (final ServiceRequestStatus status in ServiceRequestStatus.values) {
        if (status == ServiceRequestStatus.completed ||
            status == ServiceRequestStatus.cancelled) {
          continue;
        }
        expect(status.isActive, isTrue, reason: '${status.wireValue} is in flight');
      }
    });

    test('an unknown status parses to null instead of a wrong one', () {
      expect(ServiceRequestStatus.fromWire('EN_ROUTE'), isNull);
      expect(ServiceRequestStatus.fromWire('ON_THE_WAY'),
          ServiceRequestStatus.onTheWay);
    });
  });

  group('BuildingModel and FloorModel', () {
    test('normalise the empty-string relation ids the API emits', () {
      final BuildingModel building = BuildingModel.fromJson(<String, dynamic>{
        'id': 'b1',
        'code': 'MAIN',
        'name': 'Төв цамхаг',
        'projectId': '',
        'projectName': null,
        'customerId': 'c1',
        'address': null,
        'gpsLatitude': null,
        'gpsLongitude': null,
        'description': null,
        'isActive': true,
        'floorCount': 0,
        'objectCount': 0,
        'riskSummary': riskSummaryJson(normal: 0, attention: 0, unassessed: 0),
        'createdAt': '2026-01-04T00:00:00.000Z',
        'updatedAt': '2026-01-04T00:00:00.000Z',
        'deleteBlockers': <String>[],
      });

      expect(building.projectId, isNull);
      expect(building.name, 'Төв цамхаг');
    });

    test('keep a basement floor number signed', () {
      final FloorModel basement = floorFixture(name: 'Подвал', floorNumber: -1);
      expect(basement.floorNumber, -1);
      expect(basement.shortLabel, '-1');
      expect(basement.name, 'Подвал');
    });

    test('risk summary reports the worst band present', () {
      final BuildingModel building = buildingFixture(hasCritical: true, critical: 2);
      expect(building.riskSummary.worstLevel, RiskLevel.critical);
      expect(building.riskSummary.criticalCount, 2);
      expect(building.riskSummary.attentionCount, 3);
      expect(building.riskSummary.countOf(RiskLevel.normal), 40);
    });
  });

  group('ObjectDetailModel', () {
    test('parses the үнэлгээ and the category attribute block', () {
      final ObjectDetailModel object = objectFixture();

      expect(object.score, 38);
      expect(object.riskLevel, RiskLevel.critical);
      expect(object.category, ObjectCategory.panel);
      expect(object.panel?.capacityKw, 60.0);
      expect(object.circuit, isNull);
      expect(object.equipment, isNull);
      expect(object.icon, ObjectIcon.panel);
      expect(object.titleLine, 'LDB-2F-02 · Дэд самбар');
    });

    test('an unassessed object reports no score rather than a zero', () {
      final ObjectDetailModel object =
          objectFixture(score: null, riskLevel: null);

      expect(object.latestAssessment, isNull);
      expect(object.score, isNull);
      expect(object.riskLevel, isNull);
    });

    test('an incomplete load keeps its null value and its reasons', () {
      final ObjectDetailModel object = objectFixture();

      expect(object.reserveKw.complete, isFalse);
      expect(object.reserveKw.valueKw, isNull);
      expect(object.reserveKw.hasValue, isFalse);
      expect(object.reserveKw.reasons.single,
          LoadIncompleteReason.missingCapacity);
      expect(object.calculatedLoad.hasValue, isTrue);
      expect(object.calculatedLoad.valueKw, 52.4);
    });
  });

  /// Multiple load units: the assessment now carries a `measurements` array.
  ///
  /// This app does not show the readings — a customer is told what the equipment is
  /// worth, not what a clamp meter said on the day — but it reads the same
  /// `ObjectAssessmentDto`, so the field must pass through it without a word. The
  /// summable figure a customer does see, `measuredLoadKw`, must be untouched by it.
  group('ObjectAssessmentModel with load measurements', () {
    Map<String, dynamic> assessment({Object? measurements}) => <String, dynamic>{
          'id': '760000000000000000000001',
          'objectId': '750000000000000000000001',
          'previousScore': 62,
          'newScore': 38,
          'riskLevel': 'CRITICAL',
          'assessedByName': 'Б. Энхтөр',
          'assessedAt': '2026-07-20T04:12:00.000Z',
          'photos': <Map<String, dynamic>>[],
          'conclusion': 'Гурван фазын ачаалал жигд бус.',
          'recommendation': 'Ачааллыг тэнцвэржүүлнэ.',
          'actionTaken': null,
          'measuredLoadKw': 55.1,
          if (measurements != null) 'measurements': measurements,
          'repairRequired': true,
          'revisitRequired': false,
          'revisitDate': null,
          'revisitOwnerName': null,
          'sourceLabel': null,
        };

    test('an assessment carrying readings still parses, unchanged', () {
      final ObjectAssessmentModel parsed = ObjectAssessmentModel.fromJson(
        assessment(measurements: <Map<String, dynamic>>[
          <String, dynamic>{
            'kind': 'CURRENT',
            'value': 41.2,
            'unit': 'AMPERE',
            'phase': 'L1',
          },
          <String, dynamic>{
            'kind': 'VOLTAGE',
            'value': 231,
            'unit': 'VOLT',
            'phase': null,
          },
        ]),
      );

      expect(parsed.newScore, 38);
      expect(parsed.riskLevel, RiskLevel.critical);
      // The amps did not leak into the one figure this app does render.
      expect(parsed.measuredLoadKw, 55.1);
      expect(parsed.repairRequired, isTrue);
    });

    test('an assessment without the field parses exactly as before', () {
      final ObjectAssessmentModel parsed =
          ObjectAssessmentModel.fromJson(assessment());

      expect(parsed.newScore, 38);
      expect(parsed.measuredLoadKw, 55.1);
    });
  });

  group('ServiceRequestDetailModel', () {
    test('parses location refs, employees and status history', () {
      final ServiceRequestDetailModel request = serviceRequestFixture();

      expect(request.requestNumber, 'SR-202607-0012');
      expect(request.status, ServiceRequestStatus.assigned);
      expect(request.requestType, ServiceRequestType.urgentCall);
      expect(request.isUrgent, isTrue);
      expect(request.building?.name, 'Төв цамхаг');
      expect(request.room, isNull);
      expect(request.locationLine, 'Төв цамхаг · 2-р давхар');
      expect(request.assignedEmployees.single.displayName, 'Б. Энхтөр');
      expect(request.statusHistory.first.fromStatus, ServiceRequestStatus.newRequest);
      expect(request.statusHistory.last.fromStatus, isNull);
      expect(request.locationPath.first.kind, ObjectNodeKind.building);
      expect(request.slaState, SlaState.nearBreach);
      expect(request.slaRemainingMinutes, 95);
      expect(request.slaExtendedMinutes, 0);
    });

    test('create request body carries every required field', () {
      const CreateServiceRequestRequestModel request =
          CreateServiceRequestRequestModel(
        customerId: 'c1',
        buildingId: 'b1',
        objectTypeId: 'ot1',
        floorId: 'f1',
        requestType: ServiceRequestType.repair,
        description: 'Гэрэл асахгүй байна.',
        contactName: 'Д. Оюунчимэг',
        contactPhone: '9911-2233',
        isUrgent: true,
      );

      final Map<String, dynamic> json = request.toJson();
      expect(json['customerId'], 'c1');
      expect(json['buildingId'], 'b1');
      // The server takes the SLA window from this, so it must always be on the wire.
      expect(json['objectTypeId'], 'ot1');
      expect(json['floorId'], 'f1');
      expect(json['requestType'], 'REPAIR');
      expect(json['isUrgent'], isTrue);
      expect(json['attachmentIds'], isEmpty);
      // Optional keys are omitted rather than sent as null, which the strict
      // branches of the Zod schema would reject.
      expect(json.containsKey('roomId'), isFalse);
      expect(json.containsKey('branch'), isFalse);
    });

    test('phone pattern matches the shared phoneSchema', () {
      final RegExp pattern = CreateServiceRequestRequestModel.phonePattern;
      expect(pattern.hasMatch('9911-2233'), isTrue);
      expect(pattern.hasMatch('99112233'), isTrue);
      expect(pattern.hasMatch('+976 9911 2233'), isTrue);
      expect(pattern.hasMatch('991122'), isFalse);
      expect(pattern.hasMatch('abcd-efgh'), isFalse);
    });
  });

  group('NotificationModel', () {
    test('treats a null readAt as unread and links a work entity', () {
      final NotificationModel unread = notificationFixture();
      expect(unread.isUnread, isTrue);
      expect(unread.severity, NotificationSeverity.critical);
      expect(unread.event, NotificationEvent.riskAssessmentRaised);
      expect(unread.serviceRequestId, '710000000000000000000006');

      expect(notificationFixture(unread: false).isUnread, isFalse);
    });
  });

  group('PaginatedData', () {
    test('parses the shared envelope and survives a missing items key', () {
      final PaginatedData<NotificationModel> page =
          PaginatedData<NotificationModel>.fromJson(
        <String, dynamic>{
          'items': <Map<String, dynamic>>[],
          'page': 2,
          'limit': 25,
          'total': 30,
          'totalPages': 2,
        },
        NotificationModel.fromJson,
      );

      expect(page.page, 2);
      expect(page.total, 30);
      expect(page.hasMore, isFalse);
      expect(page.isEmpty, isTrue);

      final PaginatedData<NotificationModel> broken =
          PaginatedData<NotificationModel>.fromJson(
        <String, dynamic>{},
        NotificationModel.fromJson,
      );
      expect(broken.items, isEmpty);
      expect(broken.page, 1);
    });
  });

  group('planPosition', () {
    Map<String, dynamic> objectWith(Object? position, {Object? showOnPlan = true}) =>
        <String, dynamic>{
          'id': 'o1',
          'code': 'LDB-1',
          'name': 'Самбар',
          'category': 'PANEL',
          'objectType': <String, dynamic>{
            'id': 'ot1',
            'code': 'DB',
            'name': 'Хуваарилах самбар',
            'icon': 'PANEL',
            'showOnPlan': showOnPlan,
          },
          'customerId': testCustomerId,
          'floorId': 'f1',
          'planPosition': position,
          'status': 'ACTIVE',
          'latestAssessment': null,
          'calculatedLoad': <String, dynamic>{
            'valueKw': null,
            'complete': false,
            'reasons': <dynamic>[],
          },
          'measuredLoadKw': null,
          'loadVariance': <String, dynamic>{
            'valueKw': null,
            'complete': false,
            'reasons': <dynamic>[],
          },
          'createdAt': '2026-01-04T00:00:00.000Z',
        };

    test('parses the normalised fraction the plan editor stored', () {
      final ObjectListItemModel object = ObjectListItemModel.fromJson(
        objectWith(<String, dynamic>{'x': 0.25, 'y': 0.75}),
      );

      expect(object.planPosition, const PlanPositionModel(x: 0.25, y: 0.75));
      expect(object.objectType!.showOnPlan, isTrue);
    });

    test('accepts the exact corners, which are legal positions', () {
      expect(
        PlanPositionModel.fromJson(<String, dynamic>{'x': 0, 'y': 1}),
        const PlanPositionModel(x: 0, y: 1),
      );
    });

    test('rejects a malformed or out-of-range coordinate instead of crashing', () {
      // Each of these is a value the app must survive: it costs one unplaced marker.
      const List<Object?> refused = <Object?>[
        null,
        'nowhere',
        <String, dynamic>{'x': 0.5},
        <String, dynamic>{'x': '0.5', 'y': '0.5'},
        <String, dynamic>{'x': 1.4, 'y': 0.5},
        <String, dynamic>{'x': -0.01, 'y': 0.5},
        <String, dynamic>{'x': double.nan, 'y': 0.5},
        <String, dynamic>{'x': double.infinity, 'y': 0.5},
      ];

      for (final Object? value in refused) {
        expect(
          ObjectListItemModel.fromJson(objectWith(value)).planPosition,
          isNull,
          reason: 'expected \$value to be refused',
        );
      }
    });

    test('showOnPlan reads false when the server did not send it', () {
      final ObjectListItemModel object = ObjectListItemModel.fromJson(
        objectWith(<String, dynamic>{'x': 0.5, 'y': 0.5}, showOnPlan: null),
      );

      // An older server means "not on the plan", never "draw it anyway".
      expect(object.objectType!.showOnPlan, isFalse);
    });
  });

  group('formatting', () {
    test('renders dates in local time without an intl dependency', () {
      final DateTime moment = DateTime(2026, 7, 27, 9, 5);
      expect(formatDate(moment), '2026.07.27');
      expect(formatDateTime(moment), '2026.07.27 09:05');
      expect(formatTime(moment), '09:05');
      expect(formatDate(null), '-');
    });

    test('uses relative words only for today and yesterday', () {
      final DateTime now = DateTime(2026, 7, 27, 12);
      expect(formatEventStamp(DateTime(2026, 7, 27, 9, 12), now: now),
          'Өнөөдөр 09:12');
      expect(formatEventStamp(DateTime(2026, 7, 26, 18, 44), now: now),
          'Өчигдөр 18:44');
      expect(formatEventStamp(DateTime(2026, 7, 20, 8), now: now),
          '2026.07.20 08:00');
    });

    test('trims a trailing zero from a whole kW figure', () {
      expect(formatDecimal(12.0), '12');
      expect(formatDecimal(12.5), '12.50');
      expect(formatDecimal(null), '-');
    });
  });
}
