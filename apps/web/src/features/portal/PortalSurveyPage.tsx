import {
  SURVEY_RATING_LABELS,
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
  type EmployeeRefDto,
  type SubmitSurveyResponseInput,
  type SurveyFormDto,
  type SurveyPendingEmployeeDto,
  type SurveyQuestionDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { Field, TextInput } from '../employees/FormControls';

/** The one thing a customer can have said about a question, whatever its shape. */
type AnswerValue = number | boolean | string;

const REQUIRED_MESSAGE = 'Энэ асуултад заавал хариулна.';

/** The five stars, once, rather than re-derived at every call site. */
const RATING_SCALE: readonly number[] = Array.from(
  { length: SURVEY_RATING_MAX - SURVEY_RATING_MIN + 1 },
  (_, index) => SURVEY_RATING_MIN + index,
);

function displayName(employee: EmployeeRefDto): string {
  return [employee.lastName, employee.firstName].filter(Boolean).join(' ').trim();
}

/** Whether this technician is still waiting on an answer of either kind. */
function isOutstanding(entry: SurveyPendingEmployeeDto): boolean {
  return !entry.isRated && !entry.isSkipped;
}

/**
 * The questions this page can actually draw, in the order the administrator put them.
 *
 * A retired question is dropped rather than greyed out, and — the part that matters — a
 * dropped question cannot be required of anybody: leaving an unanswerable question in the
 * validator would make the survey unsubmittable with no control on screen to fix it.
 */
export function answerableQuestions(form: SurveyFormDto): SurveyQuestionDto[] {
  return form.questions
    .filter((question) => question.isActive)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

/**
 * Whether the answer given satisfies a question that demands one.
 *
 * An optional question is always satisfied, including when it is blank — that is what
 * optional means, and the collector below simply sends nothing for it.
 */
function isAnswered(question: SurveyQuestionDto, value: AnswerValue | undefined): boolean {
  if (!question.isRequired) return true;
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * The answers for the technician on screen, one field per answer.
 *
 * An unanswered optional question sends NOTHING rather than a null: the schema wants
 * exactly one value per entry, so an empty entry would be a malformed one. The question's
 * own type decides which field travels, so no entry can ever carry two.
 */
export function collectAnswers(
  questions: readonly SurveyQuestionDto[],
  answers: Readonly<Record<string, AnswerValue>>,
): SubmitSurveyResponseInput['answers'] {
  const collected: SubmitSurveyResponseInput['answers'] = [];

  for (const question of questions) {
    const value = answers[question.id];
    if (value === undefined) continue;

    switch (question.type) {
      case 'RATING_1_5':
        if (typeof value === 'number') {
          collected.push({ questionId: question.id, ratingValue: value });
        }
        break;
      case 'YES_NO':
        if (typeof value === 'boolean') {
          collected.push({ questionId: question.id, booleanValue: value });
        }
        break;
      case 'SINGLE_CHOICE':
        if (typeof value === 'string' && value.length > 0) {
          collected.push({ questionId: question.id, choiceValue: value });
        }
        break;
      case 'TEXT': {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text.length > 0) collected.push({ questionId: question.id, textValue: text });
        break;
      }
      default:
        break;
    }
  }

  return collected;
}

/** The question's own wording, whether it is compulsory, and the admin's note under it. */
function QuestionHeader({ question }: { question: SurveyQuestionDto }): ReactElement {
  return (
    <>
      <p className="text-sm font-medium text-slate-900">
        {question.text}
        {question.isRequired && <span className="ml-0.5 text-red-600">*</span>}
      </p>
      {question.helpText && <p className="mt-1 text-xs text-slate-500">{question.helpText}</p>}
    </>
  );
}

/** A row of choice buttons, which is what three of the four question shapes come down to. */
function ChoiceRow({
  options,
  selected,
  onSelect,
  disabled,
}: {
  options: readonly { key: string; label: string; value: AnswerValue }[];
  selected: AnswerValue | undefined;
  onSelect: (value: AnswerValue) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <Button
            key={option.key}
            type="button"
            size="sm"
            variant={active ? 'primary' : 'secondary'}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * The customer satisfaction survey, answered one technician at a time.
 *
 * THE STEPPER IS NOT A PRESENTATION CHOICE. `POST /surveys/requests/:id/responses` takes
 * ONE `employeeId` per call, because the survey exists to say something about a person
 * rather than about a job: a single score for work two people attended cannot be
 * attributed to either of them. So this page walks the technicians, posting once each, and
 * the "N / M" counter is the screen saying out loud what the API requires.
 *
 * THE SKIP is the other half of that shape and is a product requirement rather than an
 * escape hatch. A customer may be asked about somebody they never met, and a rating
 * invented out of politeness is indistinguishable from an observation once it is inside the
 * average that will be used to judge that person's work. So it is offered as an equal,
 * framed choice, it posts `skipped: true` with an EMPTY answers array — the schema refuses
 * the two together — and it does NOT run the required-question validators: a required
 * question is required of somebody who met the technician, and blocking the skip behind one
 * would leave the customer no way through except to invent a score.
 *
 * NOTHING HERE MENTIONS a promised window, a deadline or an elapsed duration. The customer
 * surfaces carry no SLA at all, and asking somebody to score timeliness against a window
 * they were never shown would be inventing a promise on the company's behalf.
 *
 * The form is read ONCE, on mount, and the queue it produces is this page's own. A refusal
 * leaves the queue, the index and every typed answer exactly where they were, so the
 * customer retries the submit rather than the survey.
 */
export function PortalSurveyPage(): ReactElement {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<SurveyFormDto | null>(null);
  const [queue, setQueue] = useState<readonly SurveyPendingEmployeeDto[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!requestId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await portalService.surveyForm(requestId);
      setForm(loaded);
      setQueue(loaded ? loaded.employees.filter(isOutstanding) : []);
      setIndex(0);
      setFinished(false);
      setAnswers({});
      setFieldErrors({});
      setSubmitError(null);
    } catch (caught) {
      setLoadError(
        caught instanceof ApiError ? caught.message : 'Үнэлгээний асуулга ачаалж чадсангүй.',
      );
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const questions = useMemo(() => (form ? answerableQuestions(form) : []), [form]);
  const current = index < queue.length ? queue[index] : undefined;
  const backTo = `/portal/requests/${requestId ?? ''}`;

  const setAnswer = useCallback((questionId: string, value: AnswerValue): void => {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
    // A refusal that was about a missing answer is now stale.
    setFieldErrors((previous) => {
      if (!(questionId in previous)) return previous;
      const next = { ...previous };
      delete next[questionId];
      return next;
    });
    setSubmitError(null);
  }, []);

  /**
   * Moves on to the next technician, or to the thank-you when there is none left.
   *
   * The next index is computed here rather than inside a `setIndex` updater, because
   * marking the run finished is a second piece of state: doing that from inside an updater
   * makes it a side effect React is free to run twice.
   */
  const advance = useCallback((): void => {
    setAnswers({});
    setFieldErrors({});
    setSubmitError(null);
    if (index + 1 >= queue.length) {
      setFinished(true);
    } else {
      setIndex(index + 1);
    }
  }, [index, queue.length]);

  const submit = useCallback(
    async (options: { skip: boolean }): Promise<void> => {
      if (!requestId || !current || submitting) return;

      /*
       * A skip does NOT validate. See the note on the component: a required question is
       * required of somebody who met this technician, and the customer is saying they did
       * not.
       */
      if (!options.skip) {
        const invalid: Record<string, string> = {};
        for (const question of questions) {
          if (!isAnswered(question, answers[question.id])) {
            invalid[question.id] = REQUIRED_MESSAGE;
          }
        }
        if (Object.keys(invalid).length > 0) {
          setFieldErrors(invalid);
          setSubmitError('Заавал хариулах асуултууд үлдсэн байна.');
          return;
        }
      }

      const payload: SubmitSurveyResponseInput = options.skip
        ? { employeeId: current.employee.id, skipped: true, answers: [] }
        : {
            employeeId: current.employee.id,
            skipped: false,
            answers: collectAnswers(questions, answers),
          };

      setSubmitting(true);
      setSubmitError(null);
      try {
        await portalService.submitSurveyResponse(requestId, payload);
        advance();
      } catch (caught) {
        // The typed answers stay exactly as they were — the customer retries the submit,
        // not the survey.
        setSubmitError(
          caught instanceof ApiError ? caught.message : 'Үнэлгээ илгээж чадсангүй.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [advance, answers, current, questions, requestId, submitting],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        description={loadError}
        action={<Button onClick={() => void load()}>Дахин оролдох</Button>}
      />
    );
  }

  const header = (
    <PageHeader
      title="Үйлчилгээний үнэлгээ"
      description={
        form
          ? `${form.requestNumber} дуудлагад ажилласан ажилтан бүрийг тусад нь үнэлнэ.`
          : undefined
      }
      backTo={{ to: backTo, label: 'Хүсэлт рүү буцах' }}
      breadcrumbs={[
        { label: 'Нүүр', to: '/portal' },
        { label: 'Миний хүсэлт', to: '/portal/requests' },
        ...(form ? [{ label: form.requestNumber, to: backTo }] : []),
        { label: 'Үнэлгээ' },
      ]}
    />
  );

  if (finished) {
    return (
      <>
        {header}
        <EmptyState
          title="Үнэлгээ хүлээн авлаа"
          description="Таны өгсөн үнэлгээ ажилтан бүрээр бүртгэгдлээ. Үйлчилгээгээ сайжруулахад тань туслах болно."
          action={<Button onClick={() => navigate(backTo)}>Хүсэлт рүү буцах</Button>}
        />
      </>
    );
  }

  /*
   * Null form and empty queue are the same answer to the customer — there is nobody left
   * to rate — and are deliberately not told apart on screen. `surveyForm` answers 404
   * identically for a request that was never surveyed, one already answered and one
   * belonging to somebody else, so distinguishing them here would state more than the
   * server was willing to.
   */
  if (!form || !current) {
    return (
      <>
        {header}
        <EmptyState
          title="Үнэлэх ажилтан алга"
          description="Энэ хүсэлтэд үнэлэх ажилтан үлдээгүй байна."
          action={<Button onClick={() => navigate(backTo)}>Хүсэлт рүү буцах</Button>}
        />
      </>
    );
  }

  const employeeName = displayName(current.employee);
  const isLast = index === queue.length - 1;

  return (
    <>
      {header}

      <div className="space-y-4">
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          {/*
            The counter says what the API requires: one response per technician, so the
            customer knows how many times they will be asked before they start.
          */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Ажилтан</p>
            <p className="text-xs font-medium text-slate-500">
              {index + 1} / {queue.length}
            </p>
          </div>
          <p className="mt-1 text-base font-semibold text-slate-900">{employeeName}</p>
          {current.employee.employeeCode && (
            <p className="text-xs text-slate-500">{current.employee.employeeCode}</p>
          )}
        </div>

        <div className="space-y-5 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          {questions.length === 0 && (
            <p className="text-sm text-slate-600">
              Энэ асуулгад одоогоор асуулт тохируулаагүй байна.
            </p>
          )}

          {questions.map((question) => {
            const value = answers[question.id];
            const error = fieldErrors[question.id];

            return (
              /*
                Keyed by technician as well as by question, so moving on to the next person
                gives every control a fresh state rather than the previous answer's.
              */
              <div key={`${current.employee.id}:${question.id}`}>
                {question.type === 'TEXT' ? (
                  <Field
                    label={question.text}
                    required={question.isRequired}
                    error={error}
                    hint={question.helpText ?? undefined}
                  >
                    <TextInput
                      value={typeof value === 'string' ? value : ''}
                      onChange={(next) => setAnswer(question.id, next)}
                      placeholder="Сэтгэгдлээ бичнэ үү"
                      disabled={submitting}
                    />
                  </Field>
                ) : (
                  <>
                    <QuestionHeader question={question} />

                    {question.type === 'RATING_1_5' && (
                      <ChoiceRow
                        options={RATING_SCALE.map((score) => ({
                          key: String(score),
                          label: `${score} · ${SURVEY_RATING_LABELS[score] ?? ''}`.trim(),
                          value: score,
                        }))}
                        selected={value}
                        onSelect={(next) => setAnswer(question.id, next)}
                        disabled={submitting}
                      />
                    )}

                    {question.type === 'YES_NO' && (
                      <ChoiceRow
                        options={[
                          { key: 'yes', label: 'Тийм', value: true },
                          { key: 'no', label: 'Үгүй', value: false },
                        ]}
                        selected={value}
                        onSelect={(next) => setAnswer(question.id, next)}
                        disabled={submitting}
                      />
                    )}

                    {question.type === 'SINGLE_CHOICE' && (
                      <ChoiceRow
                        options={question.options.map((option) => ({
                          key: option.value,
                          label: option.label,
                          value: option.value,
                        }))}
                        selected={value}
                        onSelect={(next) => setAnswer(question.id, next)}
                        disabled={submitting}
                      />
                    )}

                    {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/*
          The skip, in its own framed panel with its own sentence.

          Drawn as an equal choice rather than as a way out of the form, and deliberately
          not a link beside the submit: it is a statement of fact about who the customer
          dealt with, and it should be as easy to make honestly as it is hard to hit by
          accident.
        */}
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-medium text-slate-500">Эсвэл</p>
          <p className="mt-1 text-sm text-slate-700">
            {employeeName} гэдэг хүнтэй биечлэн харилцаагүй бол үнэлгээ өгөх шаардлагагүй.
            Танил бус хүнд оноо өгөхгүй байх нь зөв хариулт юм.
          </p>
          <Button
            className="mt-3"
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => void submit({ skip: true })}
          >
            Би энэ ажилтантай харилцаагүй
          </Button>
        </div>

        {submitError && <Alert variant="error">{submitError}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button loading={submitting} onClick={() => void submit({ skip: false })}>
            {isLast ? 'Илгээх' : 'Дараагийн ажилтан'}
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={() => navigate(backTo)}>
            Болих
          </Button>
        </div>
      </div>
    </>
  );
}
