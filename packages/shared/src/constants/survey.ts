/**
 * The customer satisfaction survey.
 *
 * A survey is answered PER TECHNICIAN, not per job. That is the whole shape of this
 * feature: the point is employee-specific performance, and a single score for a job two
 * people attended cannot be attributed to either of them.
 *
 * It follows that a customer may be asked about somebody they never met. They can skip
 * that technician — recording no response rather than a guessed one — because a rating
 * invented out of politeness is indistinguishable from an observation once it is in the
 * average, and it is the average that will be used to judge somebody's work.
 *
 * Every symbol here is prefixed. `packages/shared/src/index.ts` re-exports flat, so a bare
 * `QUESTION_TYPES` or `AnswerDto` would collide with, or be ambiguous against, half a dozen
 * other domains.
 */

/** What a question asks for. The catalogue is admin-defined; these are the shapes. */
export const SURVEY_QUESTION_TYPES = ['RATING_1_5', 'YES_NO', 'SINGLE_CHOICE', 'TEXT'] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const SURVEY_QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  RATING_1_5: '1-5 үнэлгээ',
  YES_NO: 'Тийм / Үгүй',
  SINGLE_CHOICE: 'Нэгийг сонгох',
  TEXT: 'Чөлөөт бичвэр',
};

/** Shown under the type picker so an admin knows what they are choosing. */
export const SURVEY_QUESTION_TYPE_HINTS: Record<SurveyQuestionType, string> = {
  RATING_1_5: 'Одоор үнэлүүлнэ. Зөвхөн энэ төрөл дундаж оноонд тооцогдоно.',
  YES_NO: 'Хоёр сонголт. Хэдэн хувь нь "Тийм" гэж хариулсныг харуулна.',
  SINGLE_CHOICE: 'Таны бичсэн сонголтуудаас нэгийг сонгоно.',
  TEXT: 'Сэтгэгдлээ бичнэ. Дундажид ороогүй, тусад нь уншина.',
};

export const SURVEY_RATING_MIN = 1;
export const SURVEY_RATING_MAX = 5;

/**
 * The words a star stands for, shared so the phone, the results table and any chart axis
 * cannot describe the same number differently.
 */
export const SURVEY_RATING_LABELS: Record<number, string> = {
  1: 'Маш муу',
  2: 'Муу',
  3: 'Дунд',
  4: 'Сайн',
  5: 'Маш сайн',
};

export const MAX_SURVEY_QUESTIONS = 20;
export const MAX_SURVEY_CHOICE_OPTIONS = 10;
export const MAX_SURVEY_QUESTION_TEXT = 300;
export const MAX_SURVEY_TEXT_ANSWER = 2000;

/**
 * Why a technician on the job carries no response.
 *
 * Recorded rather than left absent, because "the customer never met this person" and "the
 * customer has not answered yet" are different facts and only one of them is a reason to
 * stop asking.
 */
export const SURVEY_SKIP_REASON = 'NOT_ENCOUNTERED' as const;
