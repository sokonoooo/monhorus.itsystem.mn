import '../../domain/entities/survey_enums.dart';
import 'json_utils.dart';
import 'service_request_model.dart';

/// Every model in this file is a hand-written mirror of a TypeScript type in
/// packages/shared/src/types/survey.types.ts. Dart cannot import that package, so the
/// pairing is recorded in a comment above each class and the two must be checked
/// against each other by hand whenever the shared type changes.

/// Mirrors `SurveyQuestionOptionDto`.
class SurveyQuestionOptionModel {
  const SurveyQuestionOptionModel({required this.value, required this.label});

  /// What an answer records. Two options may read alike to a customer; the stored
  /// value is what tells them apart, so it is never derived from [label].
  final String value;
  final String label;

  factory SurveyQuestionOptionModel.fromJson(Map<String, dynamic> json) {
    return SurveyQuestionOptionModel(
      value: json['value'] as String? ?? '',
      label: json['label'] as String? ?? '',
    );
  }
}

/// Mirrors `SurveyQuestionDto`.
///
/// [type] is nullable because [SurveyQuestionType.fromWire] is: a shape this build
/// cannot draw yields null and the sheet leaves the question out, rather than guessing
/// an input and recording an answer of the wrong kind.
class SurveyQuestionModel {
  const SurveyQuestionModel({
    required this.id,
    required this.text,
    required this.helpText,
    required this.type,
    required this.options,
    required this.isRequired,
    required this.isOverallScore,
    required this.isActive,
    required this.sortOrder,
    required this.hasAnswers,
  });

  final String id;
  final String text;
  final String? helpText;
  final SurveyQuestionType? type;
  final List<SurveyQuestionOptionModel> options;
  final bool isRequired;

  /// Marks the ONE question whose rating drives employee analytics. Read only to
  /// explain the question's weight; never used to compute anything on the device.
  final bool isOverallScore;
  final bool isActive;

  /// Where the administrator put this question in the list.
  ///
  /// Null when the server sent none, never 0: position 0 is the top of the form and
  /// "no stated position" is not the top. A question with no order sinks below the
  /// ones that have one.
  final int? sortOrder;

  /// Whether any response references it. Meaningful to the admin console, not here;
  /// parsed so the model is a complete mirror of the DTO.
  final bool hasAnswers;

  factory SurveyQuestionModel.fromJson(Map<String, dynamic> json) {
    return SurveyQuestionModel(
      id: json['id'] as String,
      text: json['text'] as String? ?? '',
      helpText: json['helpText'] as String?,
      type: SurveyQuestionType.fromWire(json['type'] as String?),
      options: parseList(json['options'], SurveyQuestionOptionModel.fromJson),
      isRequired: json['isRequired'] as bool? ?? false,
      isOverallScore: json['isOverallScore'] as bool? ?? false,
      isActive: json['isActive'] as bool? ?? true,
      sortOrder: parseInt(json['sortOrder']),
      hasAnswers: json['hasAnswers'] as bool? ?? false,
    );
  }

  /// True when this build can actually put a control on screen for it.
  ///
  /// An inactive question is one the administrator retired, and an unknown [type] is
  /// one this binary predates. Neither may be shown, and — the part that matters —
  /// neither may block the form: a required question nobody can answer would make the
  /// survey unsubmittable on an older phone.
  bool get isAnswerable => isActive && type != null;
}

/// Mirrors `SurveyPendingEmployeeDto`.
class SurveyPendingEmployeeModel {
  const SurveyPendingEmployeeModel({
    required this.employee,
    required this.isRated,
    required this.isSkipped,
  });

  /// `EmployeeRefDto`, the same reference a service request carries its assignees as,
  /// so it is parsed by the same model rather than by a second copy that could drift.
  final EmployeeRefModel employee;
  final bool isRated;

  /// True when the customer has said they never dealt with this person. Recorded
  /// rather than left absent: "never met them" and "has not answered yet" are
  /// different facts and only one of them is a reason to keep asking.
  final bool isSkipped;

  factory SurveyPendingEmployeeModel.fromJson(Map<String, dynamic> json) {
    return SurveyPendingEmployeeModel(
      employee: EmployeeRefModel.fromJson(
        json['employee'] as Map<String, dynamic>,
      ),
      isRated: json['isRated'] as bool? ?? false,
      isSkipped: json['isSkipped'] as bool? ?? false,
    );
  }

  /// Whether this technician is still waiting on an answer of either kind.
  bool get isOutstanding => !isRated && !isSkipped;
}

/// Mirrors `SurveyPendingItemDto` — one outstanding survey, as `GET /surveys/pending`
/// lists it.
class SurveyPendingItemModel {
  const SurveyPendingItemModel({
    required this.serviceRequestId,
    required this.requestNumber,
    required this.buildingName,
    required this.completedAt,
    required this.employees,
  });

  final String serviceRequestId;
  final String requestNumber;
  final String? buildingName;
  final DateTime? completedAt;
  final List<SurveyPendingEmployeeModel> employees;

  factory SurveyPendingItemModel.fromJson(Map<String, dynamic> json) {
    return SurveyPendingItemModel(
      serviceRequestId: json['serviceRequestId'] as String,
      requestNumber: json['requestNumber'] as String? ?? '',
      buildingName: json['buildingName'] as String?,
      completedAt: parseDate(json['completedAt']),
      employees: parseList(json['employees'], SurveyPendingEmployeeModel.fromJson),
    );
  }

  /// The technicians this request is still waiting on an answer about.
  List<SurveyPendingEmployeeModel> get outstandingEmployees => employees
      .where((SurveyPendingEmployeeModel entry) => entry.isOutstanding)
      .toList(growable: false);

  /// Whether there is anything left for the customer to say.
  ///
  /// A pending item with nobody outstanding is possible — the list is a snapshot and
  /// another device may have answered since — so the screens ask this rather than
  /// treating the item's presence as the question.
  bool get hasOutstanding => outstandingEmployees.isNotEmpty;
}

/// Mirrors `SurveyFormDto` — everything the phone needs to draw the form for one
/// request.
class SurveyFormModel {
  const SurveyFormModel({
    required this.serviceRequestId,
    required this.requestNumber,
    required this.questions,
    required this.employees,
  });

  final String serviceRequestId;
  final String requestNumber;
  final List<SurveyQuestionModel> questions;
  final List<SurveyPendingEmployeeModel> employees;

  factory SurveyFormModel.fromJson(Map<String, dynamic> json) {
    return SurveyFormModel(
      serviceRequestId: json['serviceRequestId'] as String,
      requestNumber: json['requestNumber'] as String? ?? '',
      questions: parseList(json['questions'], SurveyQuestionModel.fromJson),
      employees: parseList(json['employees'], SurveyPendingEmployeeModel.fromJson),
    );
  }

  /// The questions this build can draw, in the order the administrator arranged them.
  ///
  /// Sorted by `sortOrder`, with the ones carrying none left at the end in the order
  /// the server sent them — a question with no stated position is not position zero.
  List<SurveyQuestionModel> get answerableQuestions {
    final List<SurveyQuestionModel> ordered = questions
        .where((SurveyQuestionModel question) => question.isAnswerable)
        .toList();
    ordered.sort((SurveyQuestionModel a, SurveyQuestionModel b) {
      final int? left = a.sortOrder;
      final int? right = b.sortOrder;
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return left.compareTo(right);
    });
    return List<SurveyQuestionModel>.unmodifiable(ordered);
  }

  List<SurveyPendingEmployeeModel> get outstandingEmployees => employees
      .where((SurveyPendingEmployeeModel entry) => entry.isOutstanding)
      .toList(growable: false);
}

/// One answer on the way out, as `submitSurveyResponseSchema` accepts it.
///
/// Constructed only through the four named constructors, because the schema refuses an
/// answer carrying more than one value: the shape of the question decides which field
/// travels, and there is no way through this class to set two.
class SubmitSurveyAnswer {
  const SubmitSurveyAnswer._({
    required this.questionId,
    this.ratingValue,
    this.booleanValue,
    this.choiceValue,
    this.textValue,
  });

  /// A 1-5 score. The caller is responsible for the range; the schema enforces
  /// [surveyRatingMin]..[surveyRatingMax] and the sheet offers no other value.
  const SubmitSurveyAnswer.rating({
    required String questionId,
    required int value,
  }) : this._(questionId: questionId, ratingValue: value);

  const SubmitSurveyAnswer.boolean({
    required String questionId,
    required bool value,
  }) : this._(questionId: questionId, booleanValue: value);

  /// The option's stored `value`, never its label.
  const SubmitSurveyAnswer.choice({
    required String questionId,
    required String value,
  }) : this._(questionId: questionId, choiceValue: value);

  const SubmitSurveyAnswer.text({
    required String questionId,
    required String value,
  }) : this._(questionId: questionId, textValue: value);

  final String questionId;
  final int? ratingValue;
  final bool? booleanValue;
  final String? choiceValue;
  final String? textValue;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'questionId': questionId,
        if (ratingValue != null) 'ratingValue': ratingValue,
        if (booleanValue != null) 'booleanValue': booleanValue,
        if (choiceValue != null) 'choiceValue': choiceValue,
        if (textValue != null) 'textValue': textValue,
      };
}

/// Mirrors `SubmitSurveyResponseInput` in
/// packages/shared/src/schemas/survey.schema.ts.
///
/// ONE technician per call, which is the shape of the whole feature: the point is
/// employee-specific performance, so the client loops rather than posting a form.
///
/// [skipped] and [answers] are mutually exclusive and the server refuses both together
/// — skipping IS the answer. The [SubmitSurveyResponseRequest.skip] constructor is the
/// only way to set the flag, and it takes no answers, so this client cannot build the
/// combination that would be rejected.
class SubmitSurveyResponseRequest {
  const SubmitSurveyResponseRequest.rated({
    required this.employeeId,
    required this.answers,
  }) : skipped = false;

  /// "I never dealt with this technician." No answers travel with it, and none are
  /// accepted: a rating invented out of politeness is indistinguishable from an
  /// observation once it is in somebody's average.
  const SubmitSurveyResponseRequest.skip({required this.employeeId})
      : skipped = true,
        answers = const <SubmitSurveyAnswer>[];

  final String employeeId;
  final bool skipped;
  final List<SubmitSurveyAnswer> answers;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'employeeId': employeeId,
        'skipped': skipped,
        'answers': answers
            .map((SubmitSurveyAnswer answer) => answer.toJson())
            .toList(growable: false),
      };
}
