import {
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
  type EmployeeRefDto,
  type SurveyEmployeeScoreDto,
  type SurveyQuestionBreakdownDto,
  type SurveyQuestionType,
  type SurveyResultsDto,
  type SurveyResultsQueryInput,
  type SurveyScoreBucketDto,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import type { ResolvedCustomerScope } from '../../common/security/customer-scope';
import { Employee, type IEmployee } from '../employee/employee.model';
import { toEmployeeRefDto } from '../employee/employee.mapper';
import { SurveyQuestion, SurveyResponse } from './survey.models';
import { surveyResponseFilter } from './survey.service';

/**
 * The results view: what the survey adds up to.
 *
 * ITS OWN MODULE ON PURPOSE. These numbers are the ones that will be used to judge somebody's
 * work, and the rules that keep them honest — that a skip never reaches an average, that an
 * average is never printed as zero, that no caller-supplied string ever becomes a field path
 * — are worth reviewing as one small file rather than hunting for inside a CRUD service.
 *
 * WHO MAY READ THIS. Only ADMIN, MANAGEMENT and SYSTEM_ADMIN hold `survey.view_results`, and
 * `resolveAssignedWorkFilter` is deliberately NOT applied here. That filter narrows a staff
 * caller to the work they are assigned to, and it would be actively wrong on this collection:
 * the `employee` field means "who is being judged", not "who may read this". Applying it
 * would hand every technician the ability to read their own scorecard — and, worse, would
 * silently narrow a manager's totals to their own jobs, producing a company-wide average
 * computed from one person's work.
 *
 * NO CALLER STRING BECOMES A FIELD PATH. Every filter is assembled from the four typed query
 * fields in `surveyResponseFilter`, whose keys are literals; the pipelines below name their
 * own group keys. Same rule, and the same reason, as `dashboard-insight.service.ts` and its
 * `DIMENSION_SOURCES` table.
 */

type WithId<T> = T & { _id: Types.ObjectId };

/** A results page nobody reads past. Ordered by volume, so the busiest people are on it. */
const EMPLOYEE_ROW_LIMIT = 50;

/** Averages are shown to one decimal on the screen; two keeps rounding out of the API. */
function round2(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * An average, or nothing.
 *
 * NEVER 0. A technician nobody has scored has no average, and printing zero for that would
 * rank them below somebody genuinely rated one out of five. `$avg` already returns null over
 * an empty set; this guards the divide-by-hand cases and states the rule in one place.
 */
function averageOf(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return round2(sum / count);
}

async function refsFor(ids: readonly Types.ObjectId[]): Promise<Map<string, EmployeeRefDto>> {
  if (ids.length === 0) return new Map();
  // A second `find` plus a `Map`, not a `$lookup` — the house style, see
  // `dashboard.service.ts` `workloadBlock`.
  const employees = await Employee.find({ _id: { $in: [...ids] } })
    .select('employeeCode firstName lastName photoDocument')
    .lean();
  return new Map(
    employees.map((employee) => [
      String(employee._id),
      toEmployeeRefDto(employee as unknown as WithId<IEmployee>),
    ]),
  );
}

interface EmployeeGroupRow {
  _id: Types.ObjectId;
  responseCount: number;
  averageScore: number | null;
  scoredCount: number;
  skippedCount: number;
  ratedRequestCount: number;
  lastSubmittedAt: Date | null;
}

/**
 * One row per technician.
 *
 * A `$match` and a `$group` with no `$unwind`, because `overallScore` is denormalised onto
 * the response at submit time. That is the whole reason it is denormalised: unwinding the
 * answers to find the flagged one would multiply every response by its answer count before
 * the average was taken.
 *
 * `$avg` ignores nulls, so a skipped response — which carries no score by construction —
 * cannot reach the average even though it is counted in `responseCount`.
 */
async function employeeRows(
  filter: Record<string, unknown>,
): Promise<SurveyEmployeeScoreDto[]> {
  const grouped = await SurveyResponse.aggregate<EmployeeGroupRow>([
    { $match: filter },
    {
      $group: {
        _id: '$employee',
        responseCount: { $sum: 1 },
        scoreSum: { $sum: { $ifNull: ['$overallScore', 0] } },
        scoredCount: {
          $sum: { $cond: [{ $ne: [{ $ifNull: ['$overallScore', null] }, null] }, 1, 0] },
        },
        skippedCount: { $sum: { $cond: ['$skipped', 1, 0] } },
        // Null placeholders for the unscored, filtered out below rather than pushed through
        // `$$REMOVE`, whose behaviour inside an accumulator is not worth relying on.
        ratedRequests: {
          $addToSet: {
            $cond: [{ $ne: [{ $ifNull: ['$overallScore', null] }, null] }, '$serviceRequest', null],
          },
        },
        lastSubmittedAt: { $max: '$createdAt' },
      },
    },
    {
      $project: {
        responseCount: 1,
        scoredCount: 1,
        skippedCount: 1,
        lastSubmittedAt: 1,
        averageScore: {
          $cond: [{ $gt: ['$scoredCount', 0] }, { $divide: ['$scoreSum', '$scoredCount'] }, null],
        },
        ratedRequestCount: {
          $size: {
            $filter: { input: '$ratedRequests', cond: { $ne: ['$$this', null] } },
          },
        },
      },
    },
    { $sort: { responseCount: -1, _id: 1 } },
    { $limit: EMPLOYEE_ROW_LIMIT },
  ]);

  const refs = await refsFor(grouped.map((row) => row._id));

  return grouped.map((row) => ({
    employee: refs.get(String(row._id)) ?? {
      id: String(row._id),
      employeeCode: '-',
      firstName: '-',
      lastName: '',
      photoUrl: null,
    },
    responseCount: row.responseCount,
    scoredCount: row.scoredCount,
    averageScore: round2(row.averageScore),
    ratedRequestCount: row.ratedRequestCount,
    skippedCount: row.skippedCount,
    lastSubmittedAt: row.lastSubmittedAt ? row.lastSubmittedAt.toISOString() : null,
  }));
}

interface TotalsRow {
  totalResponses: number;
  scoreSum: number;
  scoredCount: number;
  skippedCount: number;
  ratedRequestCount: number;
  ratedEmployeeCount: number;
}

async function totals(filter: Record<string, unknown>): Promise<TotalsRow> {
  const [row] = await SurveyResponse.aggregate<TotalsRow>([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalResponses: { $sum: 1 },
        scoreSum: { $sum: { $ifNull: ['$overallScore', 0] } },
        scoredCount: {
          $sum: { $cond: [{ $ne: [{ $ifNull: ['$overallScore', null] }, null] }, 1, 0] },
        },
        skippedCount: { $sum: { $cond: ['$skipped', 1, 0] } },
        ratedRequests: {
          $addToSet: {
            $cond: [{ $ne: [{ $ifNull: ['$overallScore', null] }, null] }, '$serviceRequest', null],
          },
        },
        ratedEmployees: {
          $addToSet: {
            $cond: [{ $ne: [{ $ifNull: ['$overallScore', null] }, null] }, '$employee', null],
          },
        },
      },
    },
    {
      $project: {
        totalResponses: 1,
        scoreSum: 1,
        scoredCount: 1,
        skippedCount: 1,
        ratedRequestCount: {
          $size: { $filter: { input: '$ratedRequests', cond: { $ne: ['$$this', null] } } },
        },
        ratedEmployeeCount: {
          $size: { $filter: { input: '$ratedEmployees', cond: { $ne: ['$$this', null] } } },
        },
      },
    },
  ]);

  return (
    row ?? {
      totalResponses: 0,
      scoreSum: 0,
      scoredCount: 0,
      skippedCount: 0,
      ratedRequestCount: 0,
      ratedEmployeeCount: 0,
    }
  );
}

/**
 * The 1..5 histogram, filled with zeros in TypeScript.
 *
 * The pipeline reports only the scores somebody actually gave; a chart with three bars on
 * Monday and five on Tuesday is unreadable, and "nobody gave a 2" is itself a finding. So the
 * missing buckets are added here rather than left to whichever client draws it.
 */
async function distribution(filter: Record<string, unknown>): Promise<SurveyScoreBucketDto[]> {
  const grouped = await SurveyResponse.aggregate<{ _id: number; count: number }>([
    { $match: { ...filter, overallScore: { $ne: null } } },
    { $group: { _id: '$overallScore', count: { $sum: 1 } } },
  ]);

  const counts = new Map(grouped.map((row) => [row._id, row.count]));
  const buckets: SurveyScoreBucketDto[] = [];
  for (let score = SURVEY_RATING_MIN; score <= SURVEY_RATING_MAX; score += 1) {
    buckets.push({ score, count: counts.get(score) ?? 0 });
  }
  return buckets;
}

interface QuestionGroupRow {
  _id: Types.ObjectId;
  questionText: string;
  questionType: SurveyQuestionType;
  responseCount: number;
  ratingSum: number;
  ratingCount: number;
  yesCount: number;
  noCount: number;
  choices: { value: string | null; label: string | null; count: number }[];
}

/**
 * How each question was answered.
 *
 * The ONLY pipeline here that unwinds the answers, and it is why the overall score is
 * denormalised — everything else avoids this shape entirely.
 *
 * Skipped responses carry no answers, so `$unwind` drops them without a predicate: they are
 * excluded from every count below by construction rather than by a filter somebody could
 * later delete.
 *
 * Grouped twice so the choice tallies stay bounded. Pushing every answer into an array and
 * counting in TypeScript would grow with the number of RESPONSES; grouping by
 * (question, choice) first bounds the array by the number of distinct choices on a question.
 */
async function questionRows(
  filter: Record<string, unknown>,
): Promise<SurveyQuestionBreakdownDto[]> {
  const grouped = await SurveyResponse.aggregate<QuestionGroupRow>([
    { $match: filter },
    { $unwind: '$answers' },
    {
      $group: {
        _id: { question: '$answers.questionId', choice: '$answers.choiceValue' },
        questionText: { $first: '$answers.questionText' },
        questionType: { $first: '$answers.questionType' },
        choiceLabel: { $first: '$answers.choiceLabel' },
        count: { $sum: 1 },
        ratingSum: { $sum: { $ifNull: ['$answers.ratingValue', 0] } },
        ratingCount: {
          $sum: { $cond: [{ $ne: [{ $ifNull: ['$answers.ratingValue', null] }, null] }, 1, 0] },
        },
        yesCount: { $sum: { $cond: [{ $eq: ['$answers.booleanValue', true] }, 1, 0] } },
        noCount: { $sum: { $cond: [{ $eq: ['$answers.booleanValue', false] }, 1, 0] } },
      },
    },
    {
      $group: {
        _id: '$_id.question',
        questionText: { $first: '$questionText' },
        questionType: { $first: '$questionType' },
        responseCount: { $sum: '$count' },
        ratingSum: { $sum: '$ratingSum' },
        ratingCount: { $sum: '$ratingCount' },
        yesCount: { $sum: '$yesCount' },
        noCount: { $sum: '$noCount' },
        choices: {
          $push: { value: '$_id.choice', label: '$choiceLabel', count: '$count' },
        },
      },
    },
  ]);

  if (grouped.length === 0) return [];

  /*
   * The heading uses the LIVE wording; the frozen copy is the fallback.
   *
   * A results table headed with wording an administrator has since corrected reads as a
   * stale report, so the current text wins here. A question that has been deleted has no
   * current text, and the frozen copy is then the only truthful thing to print. Individual
   * ANSWERS always show their own frozen text — see `toAnswerDto` — because what somebody
   * was asked is not editable after the fact.
   */
  const live = await SurveyQuestion.find({ _id: { $in: grouped.map((row) => row._id) } })
    .select('text sortOrder')
    .lean();
  const byId = new Map(live.map((question) => [String(question._id), question]));

  return grouped
    .map((row) => {
      const current = byId.get(String(row._id));
      return {
        sortOrder: current?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        breakdown: {
          questionId: String(row._id),
          questionText: current?.text ?? row.questionText,
          questionType: row.questionType,
          responseCount: row.responseCount,
          averageRating: averageOf(row.ratingSum, row.ratingCount),
          yesCount: row.yesCount,
          noCount: row.noCount,
          choiceCounts: row.choices
            .filter(
              (choice): choice is { value: string; label: string | null; count: number } =>
                typeof choice.value === 'string' && choice.value.length > 0,
            )
            .map((choice) => ({
              value: choice.value,
              label: choice.label ?? choice.value,
              count: choice.count,
            }))
            .sort((a, b) => b.count - a.count),
        } satisfies SurveyQuestionBreakdownDto,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry) => entry.breakdown);
}

/**
 * The whole results view for one filter.
 *
 * The blocks run together rather than in sequence: they are four independent reads on one
 * indexed collection behind a single request, and a manager waiting on a dashboard is not a
 * background sweep.
 */
export async function getSurveyResults(
  query: SurveyResultsQueryInput,
  scope: ResolvedCustomerScope,
): Promise<SurveyResultsDto> {
  const filter = surveyResponseFilter(query, scope) as Record<string, unknown>;

  const [totalsRow, employees, questions, buckets] = await Promise.all([
    totals(filter),
    employeeRows(filter),
    questionRows(filter),
    distribution(filter),
  ]);

  return {
    totalResponses: totalsRow.totalResponses,
    averageScore: averageOf(totalsRow.scoreSum, totalsRow.scoredCount),
    ratedRequestCount: totalsRow.ratedRequestCount,
    ratedEmployeeCount: totalsRow.ratedEmployeeCount,
    skippedCount: totalsRow.skippedCount,
    employees,
    questions,
    distribution: buckets,
  };
}
