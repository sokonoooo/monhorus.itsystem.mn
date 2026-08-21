import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/survey_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/survey_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/customer_home_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/service_request_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/survey_sheet.dart';

import 'fakes.dart';

/// The satisfaction survey: the parsers, the sheet and the tab that offers it.
///
/// Every fixture in `fakes.dart` is built from the wire JSON, so these cases exercise
/// the hand-written parsers rather than objects assembled in Dart that could drift away
/// from what the API actually sends.
void main() {
  Future<void> pumpPhone(WidgetTester tester, Widget widget) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(widget);
    await tester.pumpAndSettle();
  }

  Future<void> tapAt(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  group('survey models', () {
    test('the wire shapes parse into the form the sheet draws', () {
      final SurveyFormModel form = surveyFormFixture();

      expect(form.serviceRequestId, '710000000000000000000006');
      expect(form.requestNumber, 'SR-202607-0012');
      expect(form.answerableQuestions, hasLength(2));
      expect(form.answerableQuestions.first.type, SurveyQuestionType.rating1To5);
      expect(form.answerableQuestions.first.isRequired, isTrue);
      expect(form.answerableQuestions.last.type, SurveyQuestionType.text);
      expect(form.outstandingEmployees, hasLength(1));
      expect(form.outstandingEmployees.single.employee.displayName, 'Б. Энхтөр');
    });

    /// A zero is a position — the top of the form — and "no position was sent" is not
    /// that. A question with no order sinks below the ones that have one.
    test('a missing sortOrder stays null rather than becoming zero', () {
      final SurveyFormModel form = surveyFormFixture(
        questions: <Map<String, dynamic>>[
          surveyQuestionJson(
            id: surveyTextQuestionId,
            text: 'Байрлалгүй асуулт',
            type: 'TEXT',
            isOverallScore: false,
            sortOrder: null,
          ),
          surveyQuestionJson(sortOrder: 3),
        ],
      );

      final SurveyQuestionModel unordered = form.questions.first;
      expect(unordered.sortOrder, isNull);
      expect(form.answerableQuestions.first.id, surveyRatingQuestionId);
      expect(form.answerableQuestions.last.id, surveyTextQuestionId);
    });

    /// A shape this build has never heard of cannot be drawn, and guessing a control
    /// for it would collect the wrong kind of answer. It is dropped instead — including
    /// when it claims to be required, which would otherwise make the survey
    /// unsubmittable on an older phone.
    test('an unknown question type is skipped instead of crashing', () {
      expect(SurveyQuestionType.fromWire('EMOJI_SCALE'), isNull);

      final SurveyFormModel form = surveyFormFixture(
        questions: <Map<String, dynamic>>[
          surveyQuestionJson(
            id: surveyChoiceQuestionId,
            text: 'Шинэ төрлийн асуулт',
            type: 'EMOJI_SCALE',
            isOverallScore: false,
          ),
          surveyQuestionJson(),
        ],
      );

      expect(form.questions, hasLength(2));
      expect(form.answerableQuestions, hasLength(1));
      expect(form.answerableQuestions.single.id, surveyRatingQuestionId);
    });

    /// The schema refuses `skipped` and `answers` together, so the client is built so
    /// it cannot produce the pair: the skip constructor takes no answers at all.
    test('a skip serialises with an empty answers array', () {
      const SubmitSurveyResponseRequest request =
          SubmitSurveyResponseRequest.skip(employeeId: surveyEmployeeId);

      expect(request.toJson(), <String, dynamic>{
        'employeeId': surveyEmployeeId,
        'skipped': true,
        'answers': <Map<String, dynamic>>[],
      });
    });

    /// Exactly one value field per answer; the others are absent rather than null,
    /// because a null still counts as supplied to the schema's own check.
    test('an answer carries one value field and no other', () {
      const SubmitSurveyResponseRequest request =
          SubmitSurveyResponseRequest.rated(
        employeeId: surveyEmployeeId,
        answers: <SubmitSurveyAnswer>[
          SubmitSurveyAnswer.rating(questionId: surveyRatingQuestionId, value: 4),
          SubmitSurveyAnswer.text(questionId: surveyTextQuestionId, value: 'Сайн'),
        ],
      );

      expect(request.toJson(), <String, dynamic>{
        'employeeId': surveyEmployeeId,
        'skipped': false,
        'answers': <Map<String, dynamic>>[
          <String, dynamic>{
            'questionId': surveyRatingQuestionId,
            'ratingValue': 4,
          },
          <String, dynamic>{
            'questionId': surveyTextQuestionId,
            'textValue': 'Сайн',
          },
        ],
      });
    });
  });

  group('survey sheet', () {
    testWidgets('a required question blocks the submit',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(surveyForm: surveyFormFixture());

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const Scaffold(
            body: SurveySheet(requestId: '710000000000000000000006'),
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      expect(find.text('Үйлчилгээний үнэлгээ'), findsOneWidget);

      await tapAt(tester, find.widgetWithText(FilledButton, 'Илгээх'));

      expect(find.text('Энэ асуултад заавал хариулна.'), findsOneWidget);
      expect(repository.submittedSurveys, isEmpty);
    });

    testWidgets('a completed rating posts one technician and its answer shape',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(surveyForm: surveyFormFixture());

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const Scaffold(
            body: SurveySheet(requestId: '710000000000000000000006'),
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      // The word the shared constant gives a five, not the digit.
      await tapAt(tester, find.text('Маш сайн'));
      await tapAt(tester, find.widgetWithText(FilledButton, 'Илгээх'));

      expect(repository.submittedSurveys, hasLength(1));
      final RecordedSurveyResponse recorded = repository.submittedSurveys.single;
      expect(recorded.requestId, '710000000000000000000006');
      expect(recorded.request.employeeId, surveyEmployeeId);
      expect(recorded.request.skipped, isFalse);
      // The optional free-text question was left empty, so it sends nothing at all
      // rather than an entry with no value on it.
      expect(recorded.request.toJson(), <String, dynamic>{
        'employeeId': surveyEmployeeId,
        'skipped': false,
        'answers': <Map<String, dynamic>>[
          <String, dynamic>{
            'questionId': surveyRatingQuestionId,
            'ratingValue': 5,
          },
        ],
      });
    });

    /// The whole point of the skip: a customer who never met somebody records that,
    /// rather than inventing a score that would land in that person's average.
    testWidgets('the skip posts skipped: true with no answers',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(surveyForm: surveyFormFixture());

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const Scaffold(
            body: SurveySheet(requestId: '710000000000000000000006'),
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      await tapAt(
        tester,
        find.widgetWithText(OutlinedButton, 'Би энэ ажилтантай харилцаагүй'),
      );

      expect(repository.submittedSurveys, hasLength(1));
      final SubmitSurveyResponseRequest request =
          repository.submittedSurveys.single.request;
      expect(request.employeeId, surveyEmployeeId);
      expect(request.skipped, isTrue);
      expect(request.answers, isEmpty);
      expect(request.toJson()['answers'], isEmpty);
    });

    /// The API takes one technician per call, so two technicians are two calls and the
    /// sheet says which one it is on.
    testWidgets('two technicians are asked about one at a time',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(
        surveyForm: surveyFormFixture(
          employees: <Map<String, dynamic>>[
            surveyEmployeeJson(),
            surveyEmployeeJson(
              id: surveySecondEmployeeId,
              employeeCode: 'EMP-021',
              firstName: 'Ганзориг',
              lastName: 'Сүхбат',
            ),
          ],
        ),
      );

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const Scaffold(
            body: SurveySheet(requestId: '710000000000000000000006'),
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      expect(find.text('1 / 2'), findsOneWidget);
      expect(find.text('Б. Энхтөр'), findsOneWidget);
      expect(find.text('С. Ганзориг'), findsNothing);

      await tapAt(tester, find.text('Маш сайн'));
      await tapAt(
        tester,
        find.widgetWithText(FilledButton, 'Дараагийн ажилтан'),
      );

      expect(find.text('2 / 2'), findsOneWidget);
      expect(find.text('С. Ганзориг'), findsOneWidget);
      // The second technician starts unanswered: the first one's five is not carried
      // over onto somebody the customer has said nothing about.
      expect(repository.submittedSurveys, hasLength(1));

      await tapAt(
        tester,
        find.widgetWithText(FilledButton, 'Илгээх'),
      );
      expect(find.text('Энэ асуултад заавал хариулна.'), findsOneWidget);
      expect(repository.submittedSurveys, hasLength(1));
    });

    testWidgets('a server refusal keeps the sheet open and shows the message',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(
        surveyForm: surveyFormFixture(),
        surveySubmitFailure: const ServerFailure(
          'Энэ ажилтныг аль хэдийн үнэлсэн байна.',
          code: 'ALREADY_SUBMITTED',
        ),
      );

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const Scaffold(
            body: SurveySheet(requestId: '710000000000000000000006'),
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      await tapAt(tester, find.text('Маш сайн'));
      await tapAt(tester, find.widgetWithText(FilledButton, 'Илгээх'));

      expect(find.text('Энэ ажилтныг аль хэдийн үнэлсэн байна.'), findsOneWidget);
      // Still the form, not the thank-you: nothing was recorded server-side.
      expect(find.text('Үйлчилгээний үнэлгээ'), findsOneWidget);
      expect(find.text('Үнэлгээ хүлээн авлаа'), findsNothing);
    });

    /// SLA windows were deliberately removed from every customer surface, and a
    /// satisfaction survey is not the place to reintroduce one: the customer is never
    /// shown the promised window, so asking them to score against it would be inventing
    /// a promise. The same assertion guards the call sheet.
    testWidgets('nothing on the sheet mentions a window or a duration',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(surveyForm: surveyFormFixture());

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const Scaffold(
            body: SurveySheet(requestId: '710000000000000000000006'),
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      expect(find.textContaining('цаг'), findsNothing);
      expect(find.textContaining('SLA'), findsNothing);
    });

    /// The sheet is reached from a notification as well as from the screens, so it has
    /// to survive the request having been answered in between.
    testWidgets('a request with nobody left to rate says so instead of asking',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(
        surveyForm: surveyFormFixture(
          employees: <Map<String, dynamic>>[surveyEmployeeJson(isRated: true)],
        ),
      );

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const Scaffold(
            body: SurveySheet(requestId: '710000000000000000000006'),
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      expect(find.text('Энэ хүсэлтэд үнэлэх ажилтан үлдээгүй байна.'),
          findsOneWidget);
      expect(repository.submittedSurveys, isEmpty);
    });
  });

  group('the home prompt', () {
    testWidgets('appears only while something is waiting to be rated',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository quiet = FakeCustomerPortalRepository();

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (int _) {}),
          repository: quiet,
          user: customerWithSurveyRight(),
        ),
      );

      expect(find.text('Үйлчилгээгээ үнэлнэ үү'), findsNothing);

      final FakeCustomerPortalRepository waiting = FakeCustomerPortalRepository(
        pendingSurveys: <SurveyPendingItemModel>[surveyPendingFixture()],
        surveyForm: surveyFormFixture(),
      );

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (int _) {}),
          repository: waiting,
          user: customerWithSurveyRight(),
        ),
      );

      expect(find.text('Үйлчилгээгээ үнэлнэ үү'), findsOneWidget);

      await tapAt(tester, find.text('Үйлчилгээгээ үнэлнэ үү'));

      // The card opens the survey itself rather than a list of forms.
      expect(find.text('Үйлчилгээний үнэлгээ'), findsOneWidget);
      expect(find.text('Б. Энхтөр'), findsOneWidget);
    });
  });

  group('survey tab on the request screen', () {
    /// Absent, and — the part that matters — no form request goes out for it. The
    /// endpoint 404s for a request with nothing to rate, which is most of them, so the
    /// tab reads the pending list first exactly as the report tab reads
    /// `hasApprovedReport`.
    testWidgets('the tab is absent when there is nothing to answer',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository();

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const ServiceRequestDetailScreen(
            requestId: '710000000000000000000006',
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      expect(find.text('ХҮСЭЛТИЙН ЯВЦ'), findsOneWidget);
      expect(find.text('ТАЙЛАН'), findsOneWidget);
      expect(find.text('ҮНЭЛГЭЭ'), findsNothing);
      expect(repository.surveyFormRequestedFor, isEmpty);
    });

    testWidgets('the tab appears while a technician is still to be rated',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(
        pendingSurveys: <SurveyPendingItemModel>[surveyPendingFixture()],
        surveyForm: surveyFormFixture(),
      );

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const ServiceRequestDetailScreen(
            requestId: '710000000000000000000006',
          ),
          repository: repository,
          user: customerWithSurveyRight(),
        ),
      );

      expect(find.text('ҮНЭЛГЭЭ'), findsOneWidget);

      // Selecting the third tab must land on the survey. Indexing
      // `_RequestTab.values` would work only while every tab is unconditional.
      await tapAt(tester, find.text('ҮНЭЛГЭЭ'));

      expect(find.widgetWithText(FilledButton, 'Үнэлгээ өгөх'), findsOneWidget);
      expect(find.text('Б. Энхтөр'), findsOneWidget);
      // The request's own description belongs to the progress tab and is gone with it.
      expect(
        find.text('Хэт ачаалал илэрсэн, таслуур солих шаардлагатай.'),
        findsNothing,
      );
      expect(find.textContaining('цаг'), findsNothing);
    });

    /// The tab is a portal-permission question, not a status one: an account the API
    /// would answer 403 is shown nothing rather than an error where there is no
    /// problem.
    testWidgets('an account without the submit right sees no survey tab',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository(
        pendingSurveys: <SurveyPendingItemModel>[surveyPendingFixture()],
        surveyForm: surveyFormFixture(),
      );

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const ServiceRequestDetailScreen(
            requestId: '710000000000000000000006',
          ),
          repository: repository,
          user: customerWithCreateRight(),
        ),
      );

      expect(find.text('ҮНЭЛГЭЭ'), findsNothing);
      expect(repository.surveyFormRequestedFor, isEmpty);
    });
  });
}
