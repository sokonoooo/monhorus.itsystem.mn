import {
  PERMISSIONS,
  SURVEY_RATING_MAX,
  SURVEY_RATING_MIN,
  employeeListQuerySchema,
  type EmployeeListItemDto,
  type PaginatedData,
  type SurveyEmployeeScoreDto,
  type SurveyResultsDto,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { employeeService } from '../../services/employee.service';
import { surveyService } from '../../services/survey.service';
import { renderWithAuth } from '../../test/render';
import { SurveyResultsPage, distributionData, scoreColour } from './SurveyResultsPage';

/** Reads back the address bar, which is where every filter on this screen lives. */
function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

function makeEmployee(overrides: Partial<EmployeeListItemDto> = {}): EmployeeListItemDto {
  return {
    id: 'e1',
    employeeCode: 'EMP-0001',
    firstName: 'Бат',
    lastName: 'Дорж',
    registrationNumber: null,
    email: null,
    phone: null,
    photoUrl: null,
    company: null,
    department: null,
    position: null,
    team: null,
    employeeType: null,
    status: 'active',
    employmentStartDate: null,
    hasSystemAccess: false,
    isActive: true,
    createdByName: null,
    ...overrides,
  } as EmployeeListItemDto;
}

function makeScore(overrides: Partial<SurveyEmployeeScoreDto> = {}): SurveyEmployeeScoreDto {
  return {
    employee: {
      id: 'e1',
      employeeCode: 'EMP-0001',
      firstName: 'Бат',
      lastName: 'Дорж',
      photoUrl: null,
    },
    responseCount: 8,
    scoredCount: 8,
    averageScore: 4.5,
    ratedRequestCount: 6,
    skippedCount: 1,
    lastSubmittedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeResults(overrides: Partial<SurveyResultsDto> = {}): SurveyResultsDto {
  return {
    totalResponses: 12,
    averageScore: 4.2,
    ratedRequestCount: 9,
    ratedEmployeeCount: 3,
    skippedCount: 2,
    employees: [makeScore()],
    questions: [
      {
        questionId: 'q1',
        questionText: 'Ажилтны ур чадвар',
        questionType: 'RATING_1_5',
        responseCount: 12,
        averageRating: 4.2,
        yesCount: 0,
        noCount: 0,
        choiceCounts: [],
      },
    ],
    distribution: [
      { score: 4, count: 5 },
      { score: 5, count: 7 },
    ],
    ...overrides,
  };
}

function makePage<T>(items: T[]): PaginatedData<T> {
  return { items, page: 1, limit: 200, total: items.length, totalPages: 1 };
}

const READER = [PERMISSIONS.SURVEY_VIEW_RESULTS];

describe('SurveyResultsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(employeeService, 'list').mockResolvedValue(makePage([makeEmployee()]));
  });

  it('renders the headline figures', async () => {
    vi.spyOn(surveyService, 'results').mockResolvedValue(makeResults());

    renderWithAuth(<SurveyResultsPage />, { permissions: READER });

    const tiles = await screen.findByRole('group', { name: 'Үнэлгээний товчоо' });
    const figure = (label: string): string =>
      within(tiles).getByText(label).nextElementSibling?.textContent ?? '';

    expect(figure('Нийт хариулт')).toBe('12');
    expect(figure('Дундаж оноо')).toBe('4.2');
    expect(figure('Үнэлүүлсэн ажилтан')).toBe('3');
  });

  /**
   * A technician nobody scored has NO average. Printing 0 would rank them below somebody
   * genuinely rated badly, which is the one thing this screen must not do.
   */
  it('shows a null average as a dash rather than as zero', async () => {
    vi.spyOn(surveyService, 'results').mockResolvedValue(
      makeResults({
        averageScore: null,
        employees: [makeScore({ averageScore: null, scoredCount: 0, skippedCount: 0 })],
      }),
    );

    renderWithAuth(<SurveyResultsPage />, { permissions: READER });

    const table = await screen.findByRole('table', { name: 'Ажилтны үнэлгээ' });
    const row = within(table).getByText('Дорж Бат').closest('tr')!;
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
    expect(within(row).getAllByText('-').length).toBeGreaterThan(0);
  });

  it('re-queries and writes the employee filter to the url', async () => {
    const results = vi.spyOn(surveyService, 'results').mockResolvedValue(makeResults());
    const user = userEvent.setup();

    renderWithAuth(
      <>
        <SurveyResultsPage />
        <LocationProbe />
      </>,
      { permissions: READER, route: '/surveys' },
    );

    await screen.findByText('Нийт хариулт');
    await screen.findByRole('option', { name: 'Дорж Бат' });

    await user.selectOptions(screen.getByLabelText('Ажилтан'), 'e1');

    await waitFor(() =>
      expect(results).toHaveBeenLastCalledWith(expect.objectContaining({ employeeId: 'e1' })),
    );
    expect(screen.getByTestId('search').textContent).toContain('employeeId=e1');
  });

  /** A date input carries no time; the whole closing day has to be included explicitly. */
  it('widens the date range to whole days at the query boundary', async () => {
    const results = vi.spyOn(surveyService, 'results').mockResolvedValue(makeResults());

    renderWithAuth(<SurveyResultsPage />, {
      permissions: READER,
      route: '/surveys?dateFrom=2026-08-01&dateTo=2026-08-31',
    });

    await waitFor(() =>
      expect(results).toHaveBeenLastCalledWith({
        dateFrom: '2026-08-01T00:00:00.000Z',
        dateTo: '2026-08-31T23:59:59.999Z',
      }),
    );
  });

  /** Arrived at from one request, so it is a chip that can be taken off, not a dropdown. */
  it('reads the service request filter from the url and shows it as a chip', async () => {
    const results = vi.spyOn(surveyService, 'results').mockResolvedValue(makeResults());
    const user = userEvent.setup();

    renderWithAuth(
      <>
        <SurveyResultsPage />
        <LocationProbe />
      </>,
      { permissions: READER, route: '/surveys?serviceRequestId=sr1' },
    );

    await waitFor(() =>
      expect(results).toHaveBeenLastCalledWith({ serviceRequestId: 'sr1' }),
    );
    expect(screen.getByText('Нэг дуудлагаар шүүсэн')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Дуудлагын шүүлт цуцлах' }));
    await waitFor(() => expect(results).toHaveBeenLastCalledWith({}));
    expect(screen.getByTestId('search').textContent).not.toContain('serviceRequestId');
  });
});

/**
 * THE «АЖИЛТАН» FILTER.
 *
 * It asked the server for two hundred employees. `employeeListQuerySchema` caps `limit` at
 * a hundred and REJECTS rather than clamping, and the effect swallowed the resulting 400,
 * so the dropdown held nothing but «Бүх ажилтан» on every installation — and an empty
 * dropdown does not read as a broken one, it reads as "there are no employees".
 */
describe('SurveyResultsPage - the employee filter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(surveyService, 'results').mockResolvedValue(makeResults());
  });

  /**
   * Asserted against the schema itself rather than against the number 100. The number is
   * the server's to choose; what this screen must never do is ask for a page the server
   * will refuse, and only the schema can answer whether it would.
   */
  it('asks for a page the server will actually serve', async () => {
    const list = vi.spyOn(employeeService, 'list').mockResolvedValue(makePage([makeEmployee()]));

    renderWithAuth(<SurveyResultsPage />, { permissions: READER });

    await waitFor(() => expect(list).toHaveBeenCalled());
    const asked = list.mock.calls[0]![0];
    expect(employeeListQuerySchema.safeParse(asked).success).toBe(true);
  });

  it('populates the filter with the employees it was sent', async () => {
    vi.spyOn(employeeService, 'list').mockResolvedValue(
      makePage([
        makeEmployee({ id: 'e1', firstName: 'Бат', lastName: 'Дорж' }),
        makeEmployee({ id: 'e2', firstName: 'Сараа', lastName: 'Ганбат' }),
      ]),
    );

    renderWithAuth(<SurveyResultsPage />, { permissions: READER });

    expect(await screen.findByRole('option', { name: 'Дорж Бат' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ганбат Сараа' })).toBeInTheDocument();
  });

  /**
   * A refusal has to be visible. Silence here is indistinguishable from an empty payroll,
   * and a reader who believes the filter is complete draws conclusions from a list that
   * simply failed to load.
   */
  it('says the list failed rather than showing an empty picker', async () => {
    vi.spyOn(employeeService, 'list').mockRejectedValue(new Error('boom'));

    renderWithAuth(<SurveyResultsPage />, { permissions: READER });

    expect(
      await screen.findByText('Ажилтны жагсаалт ачаалагдсангүй. Бүх ажилтнаар харуулж байна.'),
    ).toBeInTheDocument();
    // And it must not be left offering a choice it cannot honour.
    expect(screen.getByLabelText('Ажилтан')).toBeDisabled();
  });

  /** The figures beside it are the screen's job; a broken picker does not blank them. */
  it('keeps the figures standing when the picker fails', async () => {
    vi.spyOn(employeeService, 'list').mockRejectedValue(new Error('boom'));

    renderWithAuth(<SurveyResultsPage />, { permissions: READER });

    const tiles = await screen.findByRole('group', { name: 'Үнэлгээний товчоо' });
    expect(within(tiles).getByText('Нийт хариулт')).toBeInTheDocument();
  });
});

/**
 * THE STAR RAMP.
 *
 * The colours were a `Record<number, string>` written out for 1 to 5 while the loop that
 * reads it is driven by the SHARED `SURVEY_RATING_MIN`/`MAX`. The two are only accidentally
 * the same length: widen the scale in `packages/shared` and every new star gets
 * `undefined` for a fill, which paints as the browser's default rather than as a colour
 * anybody chose — and the chart it lands on is the one showing how customers rated the
 * work.
 */
describe('SurveyResultsPage - the score ramp', () => {
  it('gives every score on the shared scale a colour', () => {
    const data = distributionData({ ...makeResults(), distribution: [] });

    expect(data).toHaveLength(SURVEY_RATING_MAX - SURVEY_RATING_MIN + 1);
    expect(data.every((entry) => typeof entry.colour === 'string' && entry.colour !== '')).toBe(
      true,
    );
  });

  /** The case the hardcoded record could not answer: a scale somebody widened. */
  it('still spans a widened scale, worst to best', () => {
    const wide = Array.from({ length: 7 }, (_, index) => scoreColour(index + 1, 1, 7));

    expect(wide.every((colour) => typeof colour === 'string' && colour !== '')).toBe(true);
    // The ends of the ramp are fixed whatever the scale: worst is red, best is green.
    expect(wide.at(0)).toBe(scoreColour(SURVEY_RATING_MIN));
    expect(wide.at(-1)).toBe(scoreColour(SURVEY_RATING_MAX));
  });
});
