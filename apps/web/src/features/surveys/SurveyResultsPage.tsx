import {
  SURVEY_QUESTION_TYPE_LABELS,
  SURVEY_RATING_LABELS,
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
  type EmployeeListItemDto,
  type SurveyEmployeeScoreDto,
  type SurveyQuestionBreakdownDto,
  type SurveyResultsDto,
  type SurveyResultsQuery,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  BarChart,
  CHART_COLOURS,
  GroupedBarChart,
  StatTile,
  WidgetCard,
  type ChartDatum,
  type GroupedBarRow,
} from '../../components/charts/Charts';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import {
  FILTER_BAR,
  FILTER_INPUT,
  FILTER_LABEL,
  FILTER_SELECT,
} from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { employeeService } from '../../services/employee.service';
import { surveyService } from '../../services/survey.service';

/**
 * An average, or nothing at all.
 *
 * NEVER 0. A technician nobody has scored has no average, and printing 0 would rank them
 * below somebody genuinely rated badly — which is the one thing this screen must not do,
 * because it is what people's work will be judged on. The DTO sends null precisely so the
 * distinction survives to here.
 */
function formatAverage(value: number | null): string {
  if (value === null) return '-';
  return value.toLocaleString('mn-MN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/** The star colours, worst to best, so a distribution reads without consulting a legend. */
const SCORE_COLOURS: Record<number, string> = {
  1: CHART_COLOURS.red,
  2: CHART_COLOURS.orange,
  3: CHART_COLOURS.amber,
  4: CHART_COLOURS.blue,
  5: CHART_COLOURS.green,
};

/** Every star from 1 to 5, whether or not anybody gave it. */
function distributionData(results: SurveyResultsDto): ChartDatum[] {
  const data: ChartDatum[] = [];
  for (let score = SURVEY_RATING_MIN; score <= SURVEY_RATING_MAX; score += 1) {
    const bucket = results.distribution.find((entry) => entry.score === score);
    data.push({
      key: String(score),
      // The shared labels, so a star means the same thing on the phone, in this chart and
      // in the results table.
      label: `${score} — ${SURVEY_RATING_LABELS[score] ?? ''}`.trim(),
      value: bucket?.count ?? 0,
      colour: SCORE_COLOURS[score] ?? CHART_COLOURS.slate,
    });
  }
  return data;
}

/** One question's answers, drawn according to what the question asked for. */
function QuestionBreakdown({
  question,
}: {
  question: SurveyQuestionBreakdownDto;
}): ReactElement {
  return (
    <li className="border-b border-slate-100 px-4 py-3 last:border-b-0">
      <p className="text-sm text-slate-900">{question.questionText}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        {SURVEY_QUESTION_TYPE_LABELS[question.questionType]} · {question.responseCount} хариулт
      </p>

      {question.questionType === 'RATING_1_5' && (
        <p className="mt-1.5 text-sm">
          <span className="text-xs text-slate-500">Дундаж: </span>
          <span className="font-semibold tabular-nums text-slate-900">
            {formatAverage(question.averageRating)}
          </span>
        </p>
      )}

      {question.questionType === 'YES_NO' && (
        <p className="mt-1.5 text-sm tabular-nums text-slate-700">
          Тийм {question.yesCount} · Үгүй {question.noCount}
        </p>
      )}

      {question.questionType === 'SINGLE_CHOICE' && (
        <ul className="mt-1.5 space-y-0.5">
          {question.choiceCounts.map((choice) => (
            <li key={choice.value} className="flex justify-between gap-3 text-xs text-slate-700">
              <span className="min-w-0 truncate">{choice.label}</span>
              <span className="shrink-0 tabular-nums font-medium text-slate-900">
                {choice.count}
              </span>
            </li>
          ))}
          {question.choiceCounts.length === 0 && (
            <li className="text-xs text-slate-400">Сонголт хийгдээгүй.</li>
          )}
        </ul>
      )}

      {question.questionType === 'TEXT' && (
        <p className="mt-1.5 text-xs text-slate-500">
          Бичвэр хариулт дундажид ороогүй. Хариулт бүрийг тусад нь уншина.
        </p>
      )}
    </li>
  );
}

/**
 * Customer satisfaction analytics (section 16).
 *
 * Every filter lives in the URL, so a filtered view is a link somebody can send: "look at
 * Дорж's ratings for March" is one address rather than four things to re-select. The whole
 * screen is read-only — the questions being answered are edited at /surveys/questions, and
 * an answer is never edited at all.
 */
export function SurveyResultsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const employeeId = searchParams.get('employeeId') ?? '';
  const serviceRequestId = searchParams.get('serviceRequestId') ?? '';
  const dateFrom = searchParams.get('dateFrom') ?? '';
  const dateTo = searchParams.get('dateTo') ?? '';

  const query = useMemo<SurveyResultsQuery>(
    () => ({
      ...(employeeId ? { employeeId } : {}),
      ...(serviceRequestId ? { serviceRequestId } : {}),
      // Widened to whole days at the query boundary: a date input carries no time, and
      // sending the bare date would silently drop everything answered after midnight on the
      // closing day.
      ...(dateFrom ? { dateFrom: `${dateFrom}T00:00:00.000Z` } : {}),
      ...(dateTo ? { dateTo: `${dateTo}T23:59:59.999Z` } : {}),
    }),
    [employeeId, serviceRequestId, dateFrom, dateTo],
  );

  const [results, setResults] = useState<SurveyResultsDto | null>(null);
  const [employees, setEmployees] = useState<EmployeeListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const answer = await surveyService.results(JSON.parse(queryKey) as SurveyResultsQuery);
      // A filter changed while this was in flight; its answer describes a screen nobody is
      // looking at any more.
      if (requestId !== requestIdRef.current) return;
      setResults(answer);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Үнэлгээ ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void employeeService
      .list({ limit: 200, isActive: true })
      .then((page) => {
        if (cancelled) return;
        setEmployees(page.items as EmployeeListItemDto[]);
      })
      // The picker failing is not a reason to blank the figures beside it; the filter simply
      // stays empty and everything is shown.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const employeeColumns: ReadonlyArray<Column<SurveyEmployeeScoreDto>> = [
    {
      key: 'employee',
      header: 'Ажилтан',
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-slate-900">
            {row.employee.lastName} {row.employee.firstName}
          </span>
          <span className="block text-xs text-slate-500">{row.employee.employeeCode}</span>
        </div>
      ),
    },
    {
      key: 'responseCount',
      header: 'Хариулт',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-slate-700">{row.responseCount}</span>
      ),
    },
    {
      key: 'averageScore',
      header: 'Дундаж оноо',
      align: 'right',
      // A dash, never a zero. See `formatAverage`.
      render: (row) => (
        <span
          className={`tabular-nums font-medium ${
            row.averageScore === null ? 'text-slate-400' : 'text-slate-900'
          }`}
        >
          {formatAverage(row.averageScore)}
        </span>
      ),
    },
    {
      key: 'ratedRequestCount',
      header: 'Дуудлага',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-slate-700">{row.ratedRequestCount}</span>
      ),
    },
    {
      key: 'skippedCount',
      header: 'Алгассан',
      align: 'right',
      render: (row) =>
        row.skippedCount > 0 ? (
          <span className="tabular-nums text-slate-700">{row.skippedCount}</span>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        ),
    },
    {
      key: 'lastSubmittedAt',
      header: 'Сүүлийн үнэлгээ',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">
          {formatDateTime(row.lastSubmittedAt)}
        </span>
      ),
    },
  ];

  const yesNoRows: GroupedBarRow[] = (results?.questions ?? [])
    .filter((question) => question.questionType === 'YES_NO')
    .map((question) => ({
      key: question.questionId,
      label: question.questionText,
      primary: question.yesCount,
      secondary: question.noCount,
    }));

  const hasFilters = Boolean(employeeId || serviceRequestId || dateFrom || dateTo);

  return (
    <>
      <PageHeader
        title="Үйлчилгээний үнэлгээ"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Үйлчилгээний үнэлгээ' }]}
      />

      <div className={FILTER_BAR}>
        <div>
          <label htmlFor="survey-employee" className={FILTER_LABEL}>
            Ажилтан
          </label>
          <select
            id="survey-employee"
            value={employeeId}
            onChange={(event) => updateParam('employeeId', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх ажилтан</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.lastName} {employee.firstName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="survey-from" className={FILTER_LABEL}>
            Эхлэх огноо
          </label>
          <input
            id="survey-from"
            type="date"
            value={dateFrom}
            onChange={(event) => updateParam('dateFrom', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>

        <div>
          <label htmlFor="survey-to" className={FILTER_LABEL}>
            Дуусах огноо
          </label>
          <input
            id="survey-to"
            type="date"
            value={dateTo}
            onChange={(event) => updateParam('dateTo', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>

        {/*
          The request filter is arrived at rather than chosen: a reader gets here from one
          service request, so it is shown as a chip that can be taken off. A dropdown of
          every request ever raised would be unusable and is not what anyone came for.
        */}
        {serviceRequestId && (
          <div>
            <span className={FILTER_LABEL}>Дуудлага</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs text-blue-800 ring-1 ring-inset ring-blue-200">
              Нэг дуудлагаар шүүсэн
              <button
                type="button"
                onClick={() => updateParam('serviceRequestId', '')}
                aria-label="Дуудлагын шүүлт цуцлах"
                className="rounded text-blue-700 hover:text-blue-900"
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setSearchParams(new URLSearchParams())}>
            Шүүлтүүр цэвэрлэх
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : error ? (
        <ErrorState description={error} />
      ) : results ? (
        <>
          <div className="mb-4">
            <WidgetCard
              title="Товчоо"
              hint="Шүүлтэд тохирсон судалгааны хариултын нэгдсэн дүн."
            >
              {/* Named as a group so the five figures are addressable apart from the
                  table below, which repeats two of their words as column headers. */}
              <div
                role="group"
                aria-label="Үнэлгээний товчоо"
                className="grid grid-cols-2 gap-3 lg:grid-cols-5"
              >
                <StatTile label="Нийт хариулт" value={results.totalResponses} />
                <StatTile
                  label="Дундаж оноо"
                  value={formatAverage(results.averageScore)}
                  tone={
                    results.averageScore === null
                      ? 'default'
                      : results.averageScore >= 4
                        ? 'positive'
                        : results.averageScore >= 3
                          ? 'warning'
                          : 'danger'
                  }
                />
                <StatTile label="Үнэлүүлсэн дуудлага" value={results.ratedRequestCount} />
                <StatTile label="Үнэлүүлсэн ажилтан" value={results.ratedEmployeeCount} />
                <StatTile label="Алгассан" value={results.skippedCount} />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Алгассан гэдэг нь харилцагч тухайн ажилтантай харилцаагүй гэж хариулсныг
                хэлнэ. Ийм тохиолдол дундажид огт ороогүй.
              </p>
            </WidgetCard>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <BarChart
              title="Оноогоор хуваарилалт"
              hint="Нийт үнэлгээний асуултад өгсөн одны тоо."
              data={distributionData(results)}
              emptyMessage="Оноо өгсөн хариулт алга."
            />
            <GroupedBarChart
              title="Тийм / Үгүй асуулт"
              hint="Хоёр сонголттой асуулт бүрийн хариултын харьцаа."
              rows={yesNoRows}
              primaryLabel="Тийм"
              secondaryLabel="Үгүй"
              emptyMessage="Тийм / Үгүй асуулт алга."
            />
          </div>

          <div className="mb-4">
            <WidgetCard
              title="Асуулт тус бүрийн дүн"
              hint="Асуултын үг хариулт өгсөн үеийнхээрээ хадгалагдана."
              flush
            >
              {results.questions.length === 0 ? (
                <p className="px-4 pb-4 text-xs text-slate-500">
                  Шүүлтэд тохирох хариулт алга.
                </p>
              ) : (
                <ul>
                  {results.questions.map((question) => (
                    <QuestionBreakdown key={question.questionId} question={question} />
                  ))}
                </ul>
              )}
            </WidgetCard>
          </div>

          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Ажилтны үнэлгээ</h2>
            </div>
            <DataTable
              columns={employeeColumns}
              rows={results.employees}
              rowKey={(row) => row.employee.id}
              numbering
              ariaLabel="Ажилтны үнэлгээ"
              emptyTitle="Үнэлгээ алга"
              emptyDescription="Шүүлтэд тохирох судалгааны хариулт олдсонгүй."
            />
          </div>
        </>
      ) : null}
    </>
  );
}
