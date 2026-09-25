import { z } from 'zod';

import {
  MAX_SURVEY_CHOICE_OPTIONS,
  MAX_SURVEY_QUESTION_TEXT,
  MAX_SURVEY_TEXT_ANSWER,
  SURVEY_QUESTION_TYPES,
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
} from '../constants/survey';
import { isoDateSchema, objectIdSchema, paginationQuerySchema } from './common.schema';

/**
 * The satisfaction survey, validated identically by the API and the admin form.
 *
 * What is NOT here: whether an answer suits its question's type. The catalogue lives in the
 * database, so zod cannot know that question 3 is a rating and not a yes/no. The service
 * checks that and reports it with the same dotted paths this file produces, so a rejection
 * from either side lands on the same input.
 */

export const surveyQuestionOptionSchema = z.object({
  value: z.string().trim().min(1, 'Утга хоосон байж болохгүй.').max(60),
  label: z.string().trim().min(1, 'Нэр хоосон байж болохгүй.').max(120),
});

const surveyQuestionBody = {
  text: z
    .string()
    .trim()
    .min(1, 'Асуулт хоосон байж болохгүй.')
    .max(MAX_SURVEY_QUESTION_TEXT, `Асуулт ${MAX_SURVEY_QUESTION_TEXT} тэмдэгтээс урт байж болохгүй.`),
  helpText: z.string().trim().max(500).nullish(),
  type: z.enum(SURVEY_QUESTION_TYPES, { required_error: 'Төрөл заавал.' }),
  options: z.array(surveyQuestionOptionSchema).max(MAX_SURVEY_CHOICE_OPTIONS).default([]),
  isRequired: z.boolean().default(true),
  isOverallScore: z.boolean().default(false),
  isActive: z.boolean().default(true),
};

/**
 * Options belong to SINGLE_CHOICE and to nothing else, checked in both directions.
 *
 * A choice question with no options cannot be answered, and options on a rating question
 * are a leftover from changing the type that would silently reappear if the type changed
 * back. The duplicate check is on the stored value, not the label: two options may read
 * alike to a customer, but an answer records the value.
 */
function refineQuestion(
  value: {
    type: (typeof SURVEY_QUESTION_TYPES)[number];
    options: { value: string; label: string }[];
    isOverallScore: boolean;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.type === 'SINGLE_CHOICE') {
    if (value.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Дор хаяж хоёр сонголт оруулна.',
      });
    }
    const seen = new Set<string>();
    for (const [index, option] of value.options.entries()) {
      const key = option.value.toLocaleLowerCase('mn');
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options', index, 'value'],
          message: 'Сонголт давхардсан байна.',
        });
      }
      seen.add(key);
    }
  } else if (value.options.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options'],
      message: 'Зөвхөн "Нэгийг сонгох" төрөлд сонголт байна.',
    });
  }

  /*
   * The overall score has to be a rating, because it is the number every employee average
   * is computed from. Flagging a yes/no would leave that average with nothing to average.
   */
  if (value.isOverallScore && value.type !== 'RATING_1_5') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['isOverallScore'],
      message: 'Нийт үнэлгээний асуулт "1-5 үнэлгээ" төрөлтэй байна.',
    });
  }
}

export const createSurveyQuestionSchema = z
  .object(surveyQuestionBody)
  .superRefine((value, ctx) => refineQuestion(value, ctx));

export const updateSurveyQuestionSchema = z
  .object(surveyQuestionBody)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Өөрчлөх талбар заавал илгээнэ.',
  });

export const reorderSurveyQuestionsSchema = z.object({
  questionIds: z.array(objectIdSchema).min(1, 'Дараалал хоосон байж болохгүй.'),
});

/**
 * One technician's answers, or the statement that the customer never met them.
 *
 * `skipped` and `answers` are mutually exclusive: skipping IS the answer, and sending both
 * would leave it ambiguous which one counts. A skip records no rating anywhere, so nothing
 * a customer did not observe reaches that technician's average.
 */
export const submitSurveyResponseSchema = z
  .object({
    employeeId: objectIdSchema,
    skipped: z.boolean().default(false),
    answers: z
      .array(
        z.object({
          questionId: objectIdSchema,
          ratingValue: z.number().int().min(SURVEY_RATING_MIN).max(SURVEY_RATING_MAX).nullish(),
          booleanValue: z.boolean().nullish(),
          choiceValue: z.string().trim().max(60).nullish(),
          textValue: z.string().trim().max(MAX_SURVEY_TEXT_ANSWER).nullish(),
        }),
      )
      .max(50)
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.skipped && value.answers.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['answers'],
        message: 'Харилцаагүй ажилтанд хариулт бүртгэхгүй.',
      });
    }

    // Exactly one value per answer. More than one is a client bug that would otherwise be
    // stored as whichever field the mapper happened to read first.
    for (const [index, answer] of value.answers.entries()) {
      const supplied = [
        answer.ratingValue,
        answer.booleanValue,
        answer.choiceValue,
        answer.textValue,
      ].filter((field) => field !== null && field !== undefined);

      if (supplied.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answers', index],
          message: 'Нэг асуултад нэг л хариулт байна.',
        });
      }
    }
  });

export const surveyResponseListQuerySchema = paginationQuerySchema.extend({
  employeeId: objectIdSchema.optional(),
  serviceRequestId: objectIdSchema.optional(),
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
});

export const surveyResultsQuerySchema = z.object({
  employeeId: objectIdSchema.optional(),
  serviceRequestId: objectIdSchema.optional(),
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
});

export type CreateSurveyQuestionInput = z.infer<typeof createSurveyQuestionSchema>;
export type UpdateSurveyQuestionInput = z.infer<typeof updateSurveyQuestionSchema>;
export type ReorderSurveyQuestionsInput = z.infer<typeof reorderSurveyQuestionsSchema>;
export type SubmitSurveyResponseInput = z.infer<typeof submitSurveyResponseSchema>;
export type SurveyResponseListQueryInput = z.infer<typeof surveyResponseListQuerySchema>;
export type SurveyResultsQueryInput = z.infer<typeof surveyResultsQuerySchema>;
