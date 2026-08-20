/// The customer satisfaction survey, as this app has to speak it.
///
/// A survey is answered PER TECHNICIAN rather than per job, which is why nothing here
/// is phrased about the request: the customer is scoring a person they dealt with, and
/// a single score for a job two people attended could not be attributed to either.
library;

/// Mirrors `SurveyQuestionType` / `SURVEY_QUESTION_TYPE_LABELS` in
/// packages/shared/src/constants/survey.ts. All four values, in the order the shared
/// constant declares them.
enum SurveyQuestionType {
  rating1To5('RATING_1_5', '1-5 үнэлгээ'),
  yesNo('YES_NO', 'Тийм / Үгүй'),
  singleChoice('SINGLE_CHOICE', 'Нэгийг сонгох'),
  text('TEXT', 'Чөлөөт бичвэр');

  const SurveyQuestionType(this.wireValue, this.label);

  final String wireValue;
  final String label;

  /// Null for a type this build has never heard of.
  ///
  /// Deliberately nullable rather than falling back to a default. The question
  /// catalogue is administrator-defined and a newer API may add a shape this binary
  /// cannot draw; guessing one would show the customer a control that collects the
  /// wrong kind of answer, and the server would then store it. A null makes the
  /// question un-renderable, and the sheet skips it rather than crashing or inventing
  /// an input.
  static SurveyQuestionType? fromWire(String? value) {
    if (value == null) return null;
    for (final SurveyQuestionType type in SurveyQuestionType.values) {
      if (type.wireValue == value) return type;
    }
    return null;
  }
}

/// Mirrors `SURVEY_RATING_MIN` and `SURVEY_RATING_MAX`.
const int surveyRatingMin = 1;
const int surveyRatingMax = 5;

/// Mirrors `SURVEY_RATING_LABELS`.
///
/// The word a star stands for is shared so the phone, the results table and any chart
/// axis cannot describe the same number differently. Nothing here is about elapsed
/// time — a customer is never asked to score a job against a promised window.
const Map<int, String> surveyRatingLabels = <int, String>{
  1: 'Маш муу',
  2: 'Муу',
  3: 'Дунд',
  4: 'Сайн',
  5: 'Маш сайн',
};

/// Mirrors `MAX_SURVEY_TEXT_ANSWER`, the cap `submitSurveyResponseSchema` enforces on
/// a free-text answer.
const int maxSurveyTextAnswer = 2000;
