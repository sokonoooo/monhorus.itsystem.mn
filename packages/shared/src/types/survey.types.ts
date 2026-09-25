import type { EmployeeRefDto } from './employee.types';
import type { SurveyQuestionType } from '../constants/survey';

/** One choice on a SINGLE_CHOICE question. */
export interface SurveyQuestionOptionDto {
  value: string;
  label: string;
}

/**
 * A question in the admin catalogue.
 *
 * `isOverallScore` marks the ONE question whose rating drives employee analytics. At most
 * one may carry it, enforced by a partial unique index rather than by a service check.
 */
export interface SurveyQuestionDto {
  id: string;
  text: string;
  helpText: string | null;
  type: SurveyQuestionType;
  options: readonly SurveyQuestionOptionDto[];
  isRequired: boolean;
  isOverallScore: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Whether any response references it — the UI offers deletion only when none does. */
  hasAnswers: boolean;
}

/**
 * One answer, carrying its own question wording.
 *
 * FROZEN ON PURPOSE. Editing a question must never rewrite what somebody was asked, so the
 * text, the type and the overall-score flag are copied here at submit time. Analytics reads
 * these copies; nothing walks back through the reference to re-interpret an old answer.
 *
 * The value fields are typed rather than polymorphic so `$avg` on `ratingValue` skips every
 * non-rating answer structurally, with no type predicate in the pipeline to get wrong.
 */
export interface SurveyAnswerDto {
  questionId: string;
  questionText: string;
  questionType: SurveyQuestionType;
  ratingValue: number | null;
  booleanValue: boolean | null;
  choiceValue: string | null;
  choiceLabel: string | null;
  textValue: string | null;
}

/** One technician's rating for one request. */
export interface SurveyResponseDto {
  id: string;
  serviceRequestId: string;
  requestNumber: string;
  employee: EmployeeRefDto;
  /** Null when the flagged question was not a rating, or was left unanswered. */
  overallScore: number | null;
  answers: readonly SurveyAnswerDto[];
  submittedAt: string;
}

/** A technician the customer is being asked about, and what they have said so far. */
export interface SurveyPendingEmployeeDto {
  employee: EmployeeRefDto;
  isRated: boolean;
  /** True when the customer said they never dealt with this person. */
  isSkipped: boolean;
}

/** An outstanding survey, as the phone lists it. */
export interface SurveyPendingItemDto {
  serviceRequestId: string;
  requestNumber: string;
  buildingName: string | null;
  completedAt: string;
  employees: readonly SurveyPendingEmployeeDto[];
}

/** Everything the phone needs to draw the form for one request. */
export interface SurveyFormDto {
  serviceRequestId: string;
  requestNumber: string;
  questions: readonly SurveyQuestionDto[];
  employees: readonly SurveyPendingEmployeeDto[];
}

/**
 * One employee's standing.
 *
 * Every average is `number | null` and never 0. A technician nobody has scored has no
 * average, and printing 0 for that would rank them below somebody genuinely rated badly.
 */
export interface SurveyEmployeeScoreDto {
  employee: EmployeeRefDto;
  responseCount: number;
  /** Responses that actually carried a rating, which is what `averageScore` is over. */
  scoredCount: number;
  averageScore: number | null;
  ratedRequestCount: number;
  skippedCount: number;
  lastSubmittedAt: string | null;
}

/** How one question was answered across the filtered set. */
export interface SurveyQuestionBreakdownDto {
  questionId: string;
  /** The CURRENT wording where the question still exists, the frozen copy where it does not. */
  questionText: string;
  questionType: SurveyQuestionType;
  responseCount: number;
  averageRating: number | null;
  yesCount: number;
  noCount: number;
  choiceCounts: readonly { value: string; label: string; count: number }[];
}

export interface SurveyScoreBucketDto {
  score: number;
  count: number;
}

export interface SurveyResultsDto {
  totalResponses: number;
  averageScore: number | null;
  ratedRequestCount: number;
  ratedEmployeeCount: number;
  skippedCount: number;
  employees: readonly SurveyEmployeeScoreDto[];
  questions: readonly SurveyQuestionBreakdownDto[];
  distribution: readonly SurveyScoreBucketDto[];
}

export interface SurveyResponseListQuery {
  page?: number;
  limit?: number;
  employeeId?: string;
  serviceRequestId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SurveyResultsQuery {
  employeeId?: string;
  serviceRequestId?: string;
  dateFrom?: string;
  dateTo?: string;
}
