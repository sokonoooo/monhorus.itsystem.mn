import {
  MAX_SURVEY_QUESTIONS,
  SURVEY_QUESTION_TYPE_LABELS,
  createSurveyQuestionSchema,
  type CreateSurveyQuestionInput,
  type EmployeeRefDto,
  type FieldIssue,
  type PaginatedData,
  type ReorderSurveyQuestionsInput,
  type SubmitSurveyResponseInput,
  type SurveyAnswerDto,
  type SurveyFormDto,
  type SurveyPendingEmployeeDto,
  type SurveyPendingItemDto,
  type SurveyQuestionDto,
  type SurveyResponseDto,
  type SurveyResponseListQueryInput,
  type UpdateSurveyQuestionInput,
} from '@monhorus/shared';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  assertInCustomerScope,
  customerScopeFilter,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { zodIssuesToFieldIssues } from '../../middlewares/validate.middleware';
import { recordAudit } from '../audit/audit.service';
import { Employee, type IEmployee } from '../employee/employee.model';
import { toEmployeeRefDto } from '../employee/employee.mapper';
import {
  SurveyInvitation,
  SurveyQuestion,
  SurveyResponse,
  type ISurveyAnswer,
  type ISurveyInvitation,
  type ISurveyQuestion,
  type ISurveyResponse,
} from './survey.models';

/**
 * The satisfaction survey: the catalogue an administrator writes, and the answers a customer
 * gives against it.
 *
 * THE CATALOGUE LIVES IN THE DATABASE, which is why answer validation is here and not in the
 * shared zod schema. Zod cannot know that question three is a rating rather than a yes/no,
 * nor which choices are legal on it. The rules below therefore report with the same dotted
 * paths the schema produces (`answers.0.ratingValue`), so a rejection from either side lands
 * on the same input in the same form.
 */

type WithId<T> = T & { _id: Types.ObjectId };

const ENTITY = 'SurveyQuestion';
const RESPONSE_ENTITY = 'SurveyResponse';

/** A customer's pending list is a to-do, not an archive; nobody scrolls past this. */
const PENDING_LIMIT = 50;

function actorOf(actor: AuthContext): { id: string; role: AuthContext['role']; label: string } {
  return { id: actor.userId, role: actor.role, label: actor.fullName };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000
  );
}

/* ------------------------------------------------------------- employee names */

/**
 * Employee references, resolved with a second `find` and a `Map` rather than a `$lookup`.
 *
 * The house style — see `dashboard.service.ts` `workloadBlock`. A `$lookup` would drag the
 * whole employee document through the pipeline and would still need mapping afterwards; two
 * indexed queries and a map are cheaper and, more to the point, readable.
 */
async function employeeRefs(
  ids: readonly Types.ObjectId[],
): Promise<Map<string, EmployeeRefDto>> {
  const unique = [...new Map(ids.map((id) => [String(id), id])).values()];
  if (unique.length === 0) return new Map();

  const employees = await Employee.find({ _id: { $in: unique } })
    .select('employeeCode firstName lastName photoDocument')
    .lean();

  return new Map(
    employees.map((employee) => [
      String(employee._id),
      toEmployeeRefDto(employee as unknown as WithId<IEmployee>),
    ]),
  );
}

/**
 * A reference for an employee the directory no longer holds.
 *
 * A response outlives the employee record — somebody may leave — and dropping the row would
 * silently shrink a total the customer did submit.
 */
function refOf(refs: Map<string, EmployeeRefDto>, id: Types.ObjectId): EmployeeRefDto {
  return (
    refs.get(String(id)) ?? {
      id: String(id),
      employeeCode: '-',
      firstName: '-',
      lastName: '',
      photoUrl: null,
    }
  );
}

/* ------------------------------------------------------------------ questions */

function toQuestionDto(
  question: WithId<ISurveyQuestion>,
  answered: ReadonlySet<string>,
): SurveyQuestionDto {
  return {
    id: String(question._id),
    text: question.text,
    helpText: question.helpText,
    type: question.type,
    options: question.options.map((option) => ({ value: option.value, label: option.label })),
    isRequired: question.isRequired,
    isOverallScore: question.isOverallScore,
    isActive: question.isActive,
    sortOrder: question.sortOrder,
    hasAnswers: answered.has(String(question._id)),
  };
}

/** Which questions any response has already referenced, and may therefore not be deleted. */
async function answeredQuestionIds(): Promise<Set<string>> {
  const ids = (await SurveyResponse.distinct('answers.questionId')) as Types.ObjectId[];
  return new Set(ids.map(String));
}

async function findQuestionOrThrow(
  questionId: string,
): Promise<HydratedDocument<ISurveyQuestion>> {
  const question = await SurveyQuestion.findById(questionId);
  if (!question) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Асуулт олдсонгүй.');
  return question;
}

/**
 * Re-validates a question as a WHOLE after a partial patch.
 *
 * `updateSurveyQuestionSchema` is `.partial()`, so it cannot enforce the cross-field rules —
 * a PATCH of `{ type: 'YES_NO' }` alone passes it while turning the stored overall-score
 * question into one with nothing to average, and a PATCH to `SINGLE_CHOICE` alone leaves a
 * choice question with no choices. Merging the patch onto the stored document and running
 * the CREATE schema over the result reuses those refinements verbatim, so the two paths
 * cannot drift apart.
 */
function assertQuestionShape(candidate: unknown): CreateSurveyQuestionInput {
  const parsed = createSurveyQuestionSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  throw AppError.badRequest(
    ERROR_CODES.VALIDATION_ERROR,
    'Асуултын мэдээлэл шаардлага хангахгүй байна.',
    zodIssuesToFieldIssues(parsed.error),
  );
}

/**
 * Releases the overall-score flag from whoever currently holds it.
 *
 * MUST RUN BEFORE the new holder is written. The partial unique index permits exactly one
 * document with `isOverallScore: true`, so setting the new one first trips it and the move
 * fails — which is the index doing its job, and the reason this clearing step exists rather
 * than a "there can be only one" check in application code.
 */
async function releaseOverallScore(except: Types.ObjectId | null): Promise<void> {
  await SurveyQuestion.updateMany(
    { isOverallScore: true, ...(except ? { _id: { $ne: except } } : {}) },
    { $set: { isOverallScore: false } },
  );
}

async function assertActiveQuestionRoom(excluding: Types.ObjectId | null): Promise<void> {
  const active = await SurveyQuestion.countDocuments({
    isActive: true,
    ...(excluding ? { _id: { $ne: excluding } } : {}),
  });
  if (active < MAX_SURVEY_QUESTIONS) return;
  throw AppError.badRequest(
    ERROR_CODES.VALIDATION_ERROR,
    `Идэвхтэй асуулт хамгийн ихдээ ${MAX_SURVEY_QUESTIONS} байна. Хэрэглэхгүй асуултаа идэвхгүй болгоно уу.`,
    [{ field: 'isActive', message: 'Идэвхтэй асуултын тоо хэтэрлээ.' }],
  );
}

/** The whole catalogue, inactive questions included — this is the admin's editing view. */
export async function listSurveyQuestions(): Promise<SurveyQuestionDto[]> {
  const [questions, answered] = await Promise.all([
    SurveyQuestion.find({}).sort({ sortOrder: 1, createdAt: 1 }),
    answeredQuestionIds(),
  ]);
  return questions.map((question) => toQuestionDto(question, answered));
}

export async function createSurveyQuestion(
  input: CreateSurveyQuestionInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<SurveyQuestionDto> {
  if (input.isActive) await assertActiveQuestionRoom(null);

  if (input.isOverallScore) await releaseOverallScore(null);

  const last = await SurveyQuestion.findOne({}).sort({ sortOrder: -1 }).select('sortOrder');
  const question = await SurveyQuestion.create({
    text: input.text,
    helpText: input.helpText ?? null,
    type: input.type,
    options: input.options,
    isRequired: input.isRequired,
    isOverallScore: input.isOverallScore,
    isActive: input.isActive,
    sortOrder: (last?.sortOrder ?? 0) + 1,
    createdBy: new Types.ObjectId(actor.userId),
  });

  await recordAudit({
    entityType: ENTITY,
    entityId: question._id,
    action: 'Created',
    actor: actorOf(actor),
    meta,
    newValue: { text: question.text, type: question.type },
  });

  return toQuestionDto(question, new Set());
}

export async function updateSurveyQuestion(
  questionId: string,
  input: UpdateSurveyQuestionInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<SurveyQuestionDto> {
  const question = await findQuestionOrThrow(questionId);

  const merged = assertQuestionShape({
    text: input.text ?? question.text,
    helpText: input.helpText === undefined ? question.helpText : input.helpText,
    type: input.type ?? question.type,
    options: input.options ?? question.options.map((o) => ({ value: o.value, label: o.label })),
    isRequired: input.isRequired ?? question.isRequired,
    isOverallScore: input.isOverallScore ?? question.isOverallScore,
    isActive: input.isActive ?? question.isActive,
  });

  if (merged.isActive && !question.isActive) await assertActiveQuestionRoom(question._id);

  // Clear the old holder first; see `releaseOverallScore`.
  if (merged.isOverallScore) await releaseOverallScore(question._id);

  const before = { text: question.text, type: question.type, isActive: question.isActive };

  question.text = merged.text;
  question.helpText = merged.helpText ?? null;
  question.type = merged.type;
  question.options = merged.options;
  question.isRequired = merged.isRequired;
  question.isOverallScore = merged.isOverallScore;
  question.isActive = merged.isActive;
  await question.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: question._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: before,
    newValue: { text: question.text, type: question.type, isActive: question.isActive },
  });

  return toQuestionDto(question, await answeredQuestionIds());
}

/**
 * Removes a question, but only one nobody has answered.
 *
 * An answered question is refused rather than cascaded. The answers carry their own frozen
 * wording and would survive the delete perfectly well, but the results screen groups by
 * question and deleting one silently drops a column somebody's average was computed from.
 * Deactivating retires it from every future form while leaving the history intact, which is
 * what the caller almost always meant, so the message says so.
 */
export async function deleteSurveyQuestion(
  questionId: string,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const question = await findQuestionOrThrow(questionId);

  const answered = await SurveyResponse.countDocuments({ 'answers.questionId': question._id });
  if (answered > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Хариулт бүртгэгдсэн асуултыг устгах боломжгүй. Идэвхгүй болгоно уу.',
      [{ field: 'questionId', message: 'Хариулттай асуулт устгагдахгүй.' }],
    );
  }

  await SurveyQuestion.deleteOne({ _id: question._id });

  await recordAudit({
    entityType: ENTITY,
    entityId: question._id,
    // The audit vocabulary has no 'Deleted'; 'Cancelled' is what every other removal path
    // writes, `rbac.routes.ts` included.
    action: 'Cancelled',
    actor: actorOf(actor),
    meta,
    oldValue: { text: question.text, type: question.type },
  });
}

/**
 * Rewrites `sortOrder` from an ordered list of ids, in one `bulkWrite`.
 *
 * The list is authoritative over the ids it names and silent about the rest: a question the
 * client did not send keeps the order it had. Sending a stale list therefore reorders what
 * it knows about instead of pushing everything it has not heard of to the front.
 */
export async function reorderSurveyQuestions(
  input: ReorderSurveyQuestionsInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<SurveyQuestionDto[]> {
  const ids = input.questionIds.map((id) => new Types.ObjectId(id));

  const found = await SurveyQuestion.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Байхгүй асуулт дурдагдсан байна.', [
      { field: 'questionIds', message: 'Байхгүй асуулт дурдагдсан байна.' },
    ]);
  }

  await SurveyQuestion.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sortOrder: index + 1 } } },
    })),
  );

  await recordAudit({
    entityType: ENTITY,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    newValue: { order: input.questionIds },
  });

  return listSurveyQuestions();
}

/* ---------------------------------------------------------------- invitations */

/**
 * The invitation for a request, or a 404.
 *
 * Fetched WITHOUT the tenant predicate and then asserted, so another organisation's request
 * answers 404 rather than 403. A 403 would confirm the id is real, turning this endpoint
 * into an oracle for probing other organisations' request identifiers — see
 * `assertInCustomerScope`.
 */
async function loadInvitationInScope(
  requestId: string,
  scope: ResolvedCustomerScope,
): Promise<WithId<ISurveyInvitation>> {
  const invitation = await SurveyInvitation.findOne({
    serviceRequest: new Types.ObjectId(requestId),
  });
  if (!invitation) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Үнэлгээ хүлээгдэж буй хүсэлт олдсонгүй.');
  }
  assertInCustomerScope(scope, invitation.customer, 'Үнэлгээ хүлээгдэж буй хүсэлт олдсонгүй.');
  return invitation;
}

/** The roster for one invitation, with what has been said about each person so far. */
function rosterOf(
  invitation: WithId<ISurveyInvitation>,
  responses: readonly WithId<ISurveyResponse>[],
  refs: Map<string, EmployeeRefDto>,
): SurveyPendingEmployeeDto[] {
  const byEmployee = new Map(responses.map((response) => [String(response.employee), response]));
  return invitation.employees.map((employeeId) => {
    const response = byEmployee.get(String(employeeId));
    return {
      employee: refOf(refs, employeeId),
      isRated: response !== undefined,
      isSkipped: response?.skipped ?? false,
    };
  });
}

export async function listPendingSurveys(
  scope: ResolvedCustomerScope,
): Promise<SurveyPendingItemDto[]> {
  const invitations = await SurveyInvitation.find({
    ...customerScopeFilter(scope),
    closedAt: null,
  })
    .sort({ completedAt: -1 })
    .limit(PENDING_LIMIT);

  if (invitations.length === 0) return [];

  const [responses, refs] = await Promise.all([
    SurveyResponse.find({ invitation: { $in: invitations.map((item) => item._id) } }).select(
      'invitation employee skipped',
    ),
    employeeRefs(invitations.flatMap((invitation) => invitation.employees)),
  ]);

  const byInvitation = new Map<string, WithId<ISurveyResponse>[]>();
  for (const response of responses) {
    const key = String(response.invitation);
    const bucket = byInvitation.get(key);
    if (bucket) bucket.push(response);
    else byInvitation.set(key, [response]);
  }

  return invitations.map((invitation) => ({
    serviceRequestId: String(invitation.serviceRequest),
    requestNumber: invitation.requestNumber,
    buildingName: invitation.buildingName,
    completedAt: invitation.completedAt.toISOString(),
    employees: rosterOf(invitation, byInvitation.get(String(invitation._id)) ?? [], refs),
  }));
}

export async function getSurveyForm(
  requestId: string,
  scope: ResolvedCustomerScope,
): Promise<SurveyFormDto> {
  const invitation = await loadInvitationInScope(requestId, scope);

  const [questions, answered, responses, refs] = await Promise.all([
    SurveyQuestion.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }),
    answeredQuestionIds(),
    SurveyResponse.find({ invitation: invitation._id }).select('invitation employee skipped'),
    employeeRefs(invitation.employees),
  ]);

  return {
    serviceRequestId: String(invitation.serviceRequest),
    requestNumber: invitation.requestNumber,
    questions: questions.map((question) => toQuestionDto(question, answered)),
    employees: rosterOf(invitation, responses, refs),
  };
}

/* ------------------------------------------------------------------- answering */

function frozenFrom(question: WithId<ISurveyQuestion>): ISurveyAnswer {
  return {
    questionId: question._id,
    questionText: question.text,
    questionType: question.type,
    isOverallScore: question.isOverallScore,
    ratingValue: null,
    booleanValue: null,
    choiceValue: null,
    choiceLabel: null,
    textValue: null,
  };
}

/**
 * One answer, checked against the catalogue entry it claims to answer.
 *
 * Returns null for "nothing was said here", which is legal for an optional question and is
 * caught below for a required one. A value of the wrong SHAPE is an issue rather than a
 * silent drop: a client sending `booleanValue` for a rating question has a bug, and quietly
 * storing an empty answer would hide it while corrupting the average that question feeds.
 */
function buildAnswer(
  question: WithId<ISurveyQuestion>,
  answer: SubmitSurveyResponseInput['answers'][number],
  index: number,
  issues: FieldIssue[],
): ISurveyAnswer | null {
  const rating = answer.ratingValue ?? null;
  const boolean = answer.booleanValue ?? null;
  const choice = answer.choiceValue && answer.choiceValue.length > 0 ? answer.choiceValue : null;
  const text = answer.textValue && answer.textValue.length > 0 ? answer.textValue : null;

  const mismatch = (field: string): null => {
    issues.push({
      field: `answers.${index}.${field}`,
      message: `Энэ асуулт "${SURVEY_QUESTION_TYPE_LABELS[question.type]}" төрөлтэй байна.`,
    });
    return null;
  };

  const frozen = frozenFrom(question);

  switch (question.type) {
    case 'RATING_1_5':
      if (boolean !== null || choice !== null || text !== null) return mismatch('ratingValue');
      if (rating === null) return null;
      return { ...frozen, ratingValue: rating };

    case 'YES_NO':
      if (rating !== null || choice !== null || text !== null) return mismatch('booleanValue');
      if (boolean === null) return null;
      return { ...frozen, booleanValue: boolean };

    case 'SINGLE_CHOICE': {
      if (rating !== null || boolean !== null || text !== null) return mismatch('choiceValue');
      if (choice === null) return null;
      const option = question.options.find((entry) => entry.value === choice);
      if (!option) {
        issues.push({
          field: `answers.${index}.choiceValue`,
          message: 'Сонголт жагсаалтад алга.',
        });
        return null;
      }
      return { ...frozen, choiceValue: option.value, choiceLabel: option.label };
    }

    case 'TEXT':
      if (rating !== null || boolean !== null || choice !== null) return mismatch('textValue');
      if (text === null) return null;
      return { ...frozen, textValue: text };

    default:
      return null;
  }
}

function buildAnswers(
  supplied: SubmitSurveyResponseInput['answers'],
  questions: readonly WithId<ISurveyQuestion>[],
): ISurveyAnswer[] {
  const issues: FieldIssue[] = [];
  const byId = new Map(questions.map((question) => [String(question._id), question]));
  const attempted = new Set<string>();
  const answers: ISurveyAnswer[] = [];

  supplied.forEach((answer, index) => {
    const question = byId.get(answer.questionId);
    if (!question) {
      issues.push({
        field: `answers.${index}.questionId`,
        message: 'Ийм идэвхтэй асуулт байхгүй байна.',
      });
      return;
    }
    if (attempted.has(answer.questionId)) {
      issues.push({
        field: `answers.${index}.questionId`,
        message: 'Нэг асуултад хоёр хариулт илгээгдсэн байна.',
      });
      return;
    }
    attempted.add(answer.questionId);

    const built = buildAnswer(question, answer, index, issues);
    if (built) answers.push(built);
  });

  for (const question of questions) {
    if (!question.isRequired) continue;
    if (attempted.has(String(question._id))) continue;
    issues.push({
      field: 'answers',
      message: `"${question.text}" асуултад заавал хариулна.`,
    });
  }

  if (issues.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Хариулт шаардлага хангахгүй байна.',
      issues,
    );
  }

  return answers;
}

/**
 * Closes the invitation once every technician on the roster has been dealt with.
 *
 * A SKIP COUNTS AS DEALT WITH. "I never met this person" is an answer — the only honest one
 * available — and an invitation held open waiting for a rating that will never come would
 * collect a reminder and sit in the pending list forever.
 */
async function closeInvitationIfComplete(invitation: WithId<ISurveyInvitation>): Promise<void> {
  const answered = await SurveyResponse.countDocuments({ invitation: invitation._id });
  if (answered < invitation.employees.length) return;
  await SurveyInvitation.updateOne(
    { _id: invitation._id, closedAt: null },
    { $set: { closedAt: new Date() } },
  );
}

function toAnswerDto(answer: ISurveyAnswer): SurveyAnswerDto {
  return {
    questionId: String(answer.questionId),
    // The frozen wording, always. An answer shows what the person was actually asked.
    questionText: answer.questionText,
    questionType: answer.questionType,
    ratingValue: answer.ratingValue,
    booleanValue: answer.booleanValue,
    choiceValue: answer.choiceValue,
    choiceLabel: answer.choiceLabel,
    textValue: answer.textValue,
  };
}

function toResponseDto(
  response: WithId<ISurveyResponse>,
  requestNumber: string,
  employee: EmployeeRefDto,
): SurveyResponseDto {
  return {
    id: String(response._id),
    serviceRequestId: String(response.serviceRequest),
    requestNumber,
    employee,
    overallScore: response.overallScore,
    answers: response.answers.map(toAnswerDto),
    submittedAt: response.createdAt.toISOString(),
  };
}

/**
 * Records one technician's rating, or the statement that the customer never met them.
 *
 * ONE TECHNICIAN PER CALL, and clients loop. A batch endpoint would have to decide what to
 * do when the third of five rows is invalid; this way each row succeeds or fails on its own
 * and a retry re-sends only what failed.
 */
export async function submitSurveyResponse(
  requestId: string,
  input: SubmitSurveyResponseInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<SurveyResponseDto> {
  const invitation = await loadInvitationInScope(requestId, scope);

  if (invitation.closedAt) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ хүсэлтийн үнэлгээ аль хэдийн хаагдсан байна.',
    );
  }

  const employeeId = new Types.ObjectId(input.employeeId);
  if (!invitation.employees.some((id) => id.equals(employeeId))) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ хүсэлт дээр ажиллаагүй ажилтныг үнэлэх боломжгүй.',
      [{ field: 'employeeId', message: 'Энэ хүсэлт дээр ажиллаагүй ажилтан байна.' }],
    );
  }

  const questions = await SurveyQuestion.find({ isActive: true }).sort({
    sortOrder: 1,
    createdAt: 1,
  });

  /*
   * A skip records NO answers and NO score, which is the entire point of offering it: a
   * rating invented out of politeness is indistinguishable from an observation once it is in
   * the average, and it is the average that will be used to judge somebody's work.
   */
  const answers = input.skipped ? [] : buildAnswers(input.answers, questions);

  /*
   * The overall score, denormalised here and never re-derived.
   *
   * Read from the FROZEN flag on the answer rather than from the catalogue, so an
   * administrator moving the flag tomorrow changes tomorrow's responses and leaves every
   * stored one saying what it said. Only a rating can supply it — a flagged question of any
   * other type leaves this null rather than coercing something into a number.
   */
  const scored = answers.find(
    (answer) =>
      answer.isOverallScore && answer.questionType === 'RATING_1_5' && answer.ratingValue !== null,
  );

  let response: WithId<ISurveyResponse>;
  try {
    response = await SurveyResponse.create({
      serviceRequest: invitation.serviceRequest,
      invitation: invitation._id,
      customer: invitation.customer,
      employee: employeeId,
      skipped: input.skipped,
      overallScore: scored?.ratingValue ?? null,
      answers,
      submittedBy: new Types.ObjectId(actor.userId),
      submittedByName: actor.fullName,
    });
  } catch (error) {
    // The unique index on (serviceRequest, employee) IS the "rate each person once" rule.
    // It reaches here as a duplicate key, which is a client mistake rather than a fault.
    if (isDuplicateKey(error)) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Энэ ажилтныг аль хэдийн үнэлсэн байна.',
        [{ field: 'employeeId', message: 'Энэ ажилтныг аль хэдийн үнэлсэн байна.' }],
      );
    }
    throw error;
  }

  await closeInvitationIfComplete(invitation);

  await recordAudit({
    entityType: RESPONSE_ENTITY,
    entityId: response._id,
    action: 'Created',
    actor: actorOf(actor),
    meta,
    newValue: {
      serviceRequest: String(invitation.serviceRequest),
      employee: String(employeeId),
      skipped: input.skipped,
      overallScore: response.overallScore,
    },
  });

  const refs = await employeeRefs([employeeId]);
  return toResponseDto(response, invitation.requestNumber, refOf(refs, employeeId));
}

/* ------------------------------------------------------------- response list */

/**
 * The response filter, assembled from TYPED fields only.
 *
 * Every key below is written here as a literal; nothing a caller sends becomes a field path
 * or an operator. The values are parsed into `ObjectId`s and `Date`s before they touch the
 * query, so a string cannot arrive somewhere a document was expected. This is the same rule
 * `dashboard-insight.service.ts` follows with its `DIMENSION_SOURCES` table.
 */
export function surveyResponseFilter(
  query: {
    employeeId?: string;
    serviceRequestId?: string;
    dateFrom?: string;
    dateTo?: string;
  },
  scope: ResolvedCustomerScope,
): FilterQuery<ISurveyResponse> {
  const filter: FilterQuery<ISurveyResponse> = { ...customerScopeFilter(scope) };

  if (query.employeeId) filter.employee = new Types.ObjectId(query.employeeId);
  if (query.serviceRequestId) {
    filter.serviceRequest = new Types.ObjectId(query.serviceRequestId);
  }

  const createdAt: { $gte?: Date; $lte?: Date } = {};
  if (query.dateFrom) createdAt.$gte = new Date(query.dateFrom);
  if (query.dateTo) createdAt.$lte = endOfRange(query.dateTo);
  if (createdAt.$gte || createdAt.$lte) filter.createdAt = createdAt;

  return filter;
}

/**
 * The upper bound of `dateTo`.
 *
 * A date-only bound means the WHOLE of that day. Parsing `2026-08-19` alone yields midnight,
 * which would exclude every response submitted on the day the user asked for — a filter that
 * silently drops its own last day is worse than no filter.
 */
function endOfRange(value: string): Date {
  const parsed = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return parsed;
  return new Date(parsed.getTime() + 86_400_000 - 1);
}

export async function listSurveyResponses(
  query: SurveyResponseListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<PaginatedData<SurveyResponseDto>> {
  const filter = surveyResponseFilter(query, scope);
  const { page, limit } = query;

  const [total, responses] = await Promise.all([
    SurveyResponse.countDocuments(filter),
    SurveyResponse.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
  ]);

  const [refs, invitations] = await Promise.all([
    employeeRefs(responses.map((response) => response.employee)),
    SurveyInvitation.find({
      serviceRequest: { $in: responses.map((response) => response.serviceRequest) },
    }).select('serviceRequest requestNumber'),
  ]);
  const numbers = new Map(
    invitations.map((invitation) => [
      String(invitation.serviceRequest),
      invitation.requestNumber,
    ]),
  );

  return {
    items: responses.map((response) =>
      toResponseDto(
        response,
        numbers.get(String(response.serviceRequest)) ?? '-',
        refOf(refs, response.employee),
      ),
    ),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
