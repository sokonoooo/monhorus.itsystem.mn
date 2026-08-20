import {
  MAX_SURVEY_QUESTION_TEXT,
  MAX_SURVEY_TEXT_ANSWER,
  SURVEY_QUESTION_TYPES,
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
  type SurveyQuestionType,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * The customer satisfaction survey, in three collections.
 *
 * The split is not bookkeeping. The catalogue is admin-owned and long-lived; the invitation
 * is the fact that ONE customer was asked about ONE finished job; the response is the fact
 * that they answered about ONE technician on it. Folding the last two together would make
 * "asked but not answered" indistinguishable from "never asked", which is exactly the
 * distinction the reminder sweep runs on.
 */

/* ------------------------------------------------------------------ questions */

export interface ISurveyQuestionOption {
  value: string;
  label: string;
}

export interface ISurveyQuestion {
  text: string;
  helpText: string | null;
  type: SurveyQuestionType;
  options: ISurveyQuestionOption[];
  isRequired: boolean;
  /**
   * The ONE question whose rating drives every employee average.
   *
   * At most one question may carry it, and that is enforced by the partial unique index
   * below rather than by a service check — a check would be a read followed by a write with
   * a window between them, and this flag is the input to somebody's performance number.
   */
  isOverallScore: boolean;
  isActive: boolean;
  sortOrder: number;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const questionOptionSchema = new Schema<ISurveyQuestionOption>(
  {
    value: { type: String, required: true, trim: true, maxlength: 60 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false },
);

const surveyQuestionSchema = new Schema<ISurveyQuestion>(
  {
    text: { type: String, required: true, trim: true, maxlength: MAX_SURVEY_QUESTION_TEXT },
    helpText: { type: String, default: null, trim: true, maxlength: 500 },
    type: { type: String, enum: SURVEY_QUESTION_TYPES, required: true },
    options: { type: [questionOptionSchema], default: [] },
    isRequired: { type: Boolean, required: true, default: true },
    isOverallScore: { type: Boolean, required: true, default: false },
    isActive: { type: Boolean, required: true, default: true },
    sortOrder: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

/** The form's own query: the active questions, in the order the admin arranged them. */
surveyQuestionSchema.index({ isActive: 1, sortOrder: 1 });
/** The admin catalogue, which includes the inactive ones. */
surveyQuestionSchema.index({ sortOrder: 1 });
/**
 * At most one overall-score question, enforced by the database.
 *
 * Partial, so the index constrains only the holders: without the filter every question with
 * `isOverallScore: false` would collide with every other one. A service moving the flag must
 * therefore CLEAR the previous holder before setting the new one — setting first trips this
 * index, which is the point.
 */
surveyQuestionSchema.index(
  { isOverallScore: 1 },
  { unique: true, partialFilterExpression: { isOverallScore: true } },
);

export const SurveyQuestion: Model<ISurveyQuestion> = model<ISurveyQuestion>(
  'SurveyQuestion',
  surveyQuestionSchema,
);

/* ---------------------------------------------------------------- invitations */

export interface ISurveyInvitation {
  serviceRequest: Types.ObjectId;
  /**
   * Denormalised from the request so `customerScopeFilter` applies here directly.
   *
   * The tenant boundary is a predicate on this collection, not a join through the request:
   * a join is a second query that a future caller can forget, and forgetting it returns
   * another organisation's invitations.
   */
  customer: Types.ObjectId;
  /** Frozen for display, so the pending list needs no populate to be readable. */
  requestNumber: string;
  buildingName: string | null;
  /**
   * The roster AS IT STOOD at completion.
   *
   * Snapshotted rather than read live from the request, because a customer is being asked
   * about the people who actually attended. Re-reading `assignedEmployees` later would ask
   * them about whoever the request names today, which after a reassignment is somebody
   * they never met.
   */
  employees: Types.ObjectId[];
  issuedAt: Date;
  completedAt: Date;
  /** The `issuedAt` the single reminder has been sent for. Null means not yet sent. */
  reminderSentFor: Date | null;
  /** Set once every employee on the roster carries a response, skipped or answered. */
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const surveyInvitationSchema = new Schema<ISurveyInvitation>(
  {
    serviceRequest: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
      unique: true,
    },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    requestNumber: { type: String, required: true, trim: true },
    buildingName: { type: String, default: null, trim: true },
    employees: { type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }], default: [] },
    issuedAt: { type: Date, required: true, default: () => new Date() },
    completedAt: { type: Date, required: true, default: () => new Date() },
    reminderSentFor: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** The pending list: one organisation's open invitations, newest job first. */
surveyInvitationSchema.index({ customer: 1, closedAt: 1, completedAt: -1 });
/** The reminder sweep's candidate scan. */
surveyInvitationSchema.index({ closedAt: 1, reminderSentFor: 1, issuedAt: 1 });

export const SurveyInvitation: Model<ISurveyInvitation> = model<ISurveyInvitation>(
  'SurveyInvitation',
  surveyInvitationSchema,
);

/* ------------------------------------------------------------------ responses */

export interface ISurveyAnswer {
  questionId: Types.ObjectId;
  /**
   * The wording, the shape and the flag AS ASKED.
   *
   * Frozen copies, not a reference to be re-read. Editing a question must never rewrite
   * what somebody was asked, and re-interpreting an old answer through today's catalogue is
   * how an average silently changes meaning.
   */
  questionText: string;
  questionType: SurveyQuestionType;
  isOverallScore: boolean;
  ratingValue: number | null;
  booleanValue: boolean | null;
  choiceValue: string | null;
  choiceLabel: string | null;
  textValue: string | null;
}

export interface ISurveyResponse {
  serviceRequest: Types.ObjectId;
  invitation: Types.ObjectId;
  customer: Types.ObjectId;
  /** WHO IS BEING JUDGED. Never "who may read this" — see the results endpoints. */
  employee: Types.ObjectId;
  /** The customer states they never dealt with this technician. */
  skipped: boolean;
  /**
   * The overall rating, denormalised at submit time from the flagged answer.
   *
   * Null for a skip, and null when the flagged question was not answered or was not a
   * rating. Analytics reads THIS and never re-reads the catalogue flag, so moving the flag
   * changes future responses only — the same freezing rule the answers themselves follow —
   * and per-employee analytics stays a `$match` plus a `$group` with no `$unwind`.
   */
  overallScore: number | null;
  answers: ISurveyAnswer[];
  submittedBy: Types.ObjectId | null;
  submittedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const surveyAnswerSchema = new Schema<ISurveyAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: 'SurveyQuestion', required: true },
    questionText: { type: String, required: true, maxlength: MAX_SURVEY_QUESTION_TEXT },
    questionType: { type: String, enum: SURVEY_QUESTION_TYPES, required: true },
    isOverallScore: { type: Boolean, required: true, default: false },
    ratingValue: {
      type: Number,
      default: null,
      min: SURVEY_RATING_MIN,
      max: SURVEY_RATING_MAX,
    },
    booleanValue: { type: Boolean, default: null },
    choiceValue: { type: String, default: null, maxlength: 60 },
    choiceLabel: { type: String, default: null, maxlength: 120 },
    textValue: { type: String, default: null, maxlength: MAX_SURVEY_TEXT_ANSWER },
  },
  { _id: false },
);

const surveyResponseSchema = new Schema<ISurveyResponse>(
  {
    serviceRequest: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
      index: true,
    },
    invitation: { type: Schema.Types.ObjectId, ref: 'SurveyInvitation', required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    skipped: { type: Boolean, required: true, default: false },
    overallScore: {
      type: Number,
      default: null,
      min: SURVEY_RATING_MIN,
      max: SURVEY_RATING_MAX,
    },
    answers: { type: [surveyAnswerSchema], default: [] },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    submittedByName: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * One rating per technician per job, enforced by the database.
 *
 * "You cannot rate the same person twice" is this index and nothing else. A read-then-write
 * check would leave a window in which a double-tapped submit button writes two responses,
 * and two responses are two votes in the same average.
 */
surveyResponseSchema.index({ serviceRequest: 1, employee: 1 }, { unique: true });
/** Per-employee analytics and the employee filter on the response list. */
surveyResponseSchema.index({ employee: 1, createdAt: -1 });
/** The results view, unfiltered or scoped to one organisation. */
surveyResponseSchema.index({ customer: 1, createdAt: -1 });

export const SurveyResponse: Model<ISurveyResponse> = model<ISurveyResponse>(
  'SurveyResponse',
  surveyResponseSchema,
);
