import {
  PERMISSIONS,
  type ServiceRequestDetailDto,
  type SubmitSurveyResponseInput,
  type SurveyFormDto,
  type SurveyPendingEmployeeDto,
  type SurveyPendingItemDto,
  type SurveyQuestionDto,
} from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { makeServiceRequest } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { PortalHomePage } from './PortalHomePage';
import { PortalRequestDetailPage } from './PortalRequestDetailPage';
import { PortalSurveyPage } from './PortalSurveyPage';

const REQUEST_ID = '507f1f77bcf86cd799439061';
const ALTAN_ID = '507f1f77bcf86cd799439071';
const BAT_ID = '507f1f77bcf86cd799439072';
const RATING_Q = '507f1f77bcf86cd799439081';
const TEXT_Q = '507f1f77bcf86cd799439082';
const YES_NO_Q = '507f1f77bcf86cd799439083';
const CHOICE_Q = '507f1f77bcf86cd799439084';

const PORTAL_PERMISSIONS = [
  PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
  PERMISSIONS.PORTAL_SURVEY_SUBMIT,
] as const;

const CUSTOMER_IDENTITY = {
  customerId: '507f1f77bcf86cd799439011',
  customerName: 'Central Tower ХХК',
  fullName: 'Д. Болор',
  phone: '99112233',
};

function makeQuestion(overrides: Partial<SurveyQuestionDto> = {}): SurveyQuestionDto {
  return {
    id: RATING_Q,
    text: 'Ажилтны ажлыг үнэлнэ үү',
    helpText: null,
    type: 'RATING_1_5',
    options: [],
    isRequired: true,
    isOverallScore: true,
    isActive: true,
    sortOrder: 1,
    hasAnswers: false,
    ...overrides,
  };
}

function makePendingEmployee(
  id: string,
  firstName: string,
  overrides: Partial<SurveyPendingEmployeeDto> = {},
): SurveyPendingEmployeeDto {
  return {
    employee: {
      id,
      employeeCode: `EMP-${id.slice(-3)}`,
      firstName,
      lastName: 'Дорж',
      photoUrl: null,
    },
    isRated: false,
    isSkipped: false,
    ...overrides,
  };
}

function makeForm(overrides: Partial<SurveyFormDto> = {}): SurveyFormDto {
  return {
    serviceRequestId: REQUEST_ID,
    requestNumber: 'SR-2026-0042',
    questions: [makeQuestion()],
    employees: [makePendingEmployee(ALTAN_ID, 'Алтан')],
    ...overrides,
  };
}

/**
 * The detail DTO, which the shared `makeServiceRequest` fixture does not produce.
 *
 * That fixture builds a LIST item; the detail adds fifteen fields, and `getRequest`
 * answers with the wider one. Built here on top of it rather than widened in `fixtures.ts`,
 * because only the two entry-point tests below need it.
 */
function makeRequestDetail(
  overrides: Partial<ServiceRequestDetailDto> = {},
): ServiceRequestDetailDto {
  return {
    ...makeServiceRequest({ id: REQUEST_ID, requestNumber: 'SR-2026-0042' }),
    panel: null,
    circuit: null,
    branch: null,
    description: 'Гэрэлтүүлэг ажиллахгүй байна.',
    contactName: 'Д. Болор',
    contactPhone: '99112233',
    attachments: [],
    statusHistory: [],
    locationPath: [],
    teamLeaderEmployeeId: null,
    slaStartedAt: null,
    slaExtendedMinutes: 0,
    slaExtensionReason: null,
    revisitReason: null,
    revisitDueAt: null,
    parentRequestId: null,
    createdByName: 'Д. Болор',
    hasApprovedReport: false,
    updatedAt: '2026-08-18T04:00:00.000Z',
    ...overrides,
  };
}

function makePendingItem(overrides: Partial<SurveyPendingItemDto> = {}): SurveyPendingItemDto {
  return {
    serviceRequestId: REQUEST_ID,
    requestNumber: 'SR-2026-0042',
    buildingName: 'Төв цамхаг',
    completedAt: '2026-08-18T04:00:00.000Z',
    employees: [makePendingEmployee(ALTAN_ID, 'Алтан')],
    ...overrides,
  };
}

function renderSurvey() {
  return renderWithAuth(<PortalSurveyPage />, {
    permissions: PORTAL_PERMISSIONS,
    role: 'customer',
    user: CUSTOMER_IDENTITY,
    route: `/portal/requests/${REQUEST_ID}/survey`,
    path: '/portal/requests/:requestId/survey',
  });
}

/** The payload of the nth submit, typed, so a test asserts on fields rather than on `any`. */
function submittedPayload(call: number): SubmitSurveyResponseInput {
  const spy = vi.mocked(portalService.submitSurveyResponse);
  const args = spy.mock.calls[call];
  if (!args) throw new Error(`submitSurveyResponse was not called ${call + 1} time(s)`);
  return args[1];
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PortalSurveyPage', () => {
  it('submits a rating for the technician on screen, with one field per answer', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(makeForm());
    const submit = vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    const user = userEvent.setup();
    renderSurvey();

    expect(await screen.findByText('Дорж Алтан')).toBeInTheDocument();

    // The Mongolian word, not just the number - that is what SURVEY_RATING_LABELS is for.
    await user.click(screen.getByRole('button', { name: /Сайн$/ }));
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    expect(submit).toHaveBeenCalledWith(REQUEST_ID, expect.anything());
    const payload = submittedPayload(0);
    expect(payload.employeeId).toBe(ALTAN_ID);
    expect(payload.skipped).toBe(false);
    expect(payload.answers).toEqual([{ questionId: RATING_Q, ratingValue: 4 }]);
  });

  /**
   * The point of the skip, asserted rather than described.
   *
   * The question below is REQUIRED and is left unanswered on purpose: a required question is
   * required of somebody who met the technician, and if the skip ran the validators the
   * customer would have no way through except to invent a score.
   */
  it('skips with an empty answers array, without demanding the required question', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(makeForm());
    const submit = vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    const user = userEvent.setup();
    renderSurvey();

    await screen.findByText('Дорж Алтан');
    await user.click(screen.getByRole('button', { name: 'Би энэ ажилтантай харилцаагүй' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    const payload = submittedPayload(0);
    expect(payload.employeeId).toBe(ALTAN_ID);
    expect(payload.skipped).toBe(true);
    // Both together is what `submitSurveyResponseSchema` refuses.
    expect(payload.answers).toEqual([]);
    expect(screen.queryByText('Энэ асуултад заавал хариулна.')).not.toBeInTheDocument();
  });

  it('blocks an ordinary submit while a required question is unanswered', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(makeForm());
    const submit = vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    const user = userEvent.setup();
    renderSurvey();

    await screen.findByText('Дорж Алтан');
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    expect(await screen.findByText('Энэ асуултад заавал хариулна.')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('lets an optional question through unanswered, sending nothing for it', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(
      makeForm({
        questions: [
          makeQuestion(),
          makeQuestion({
            id: TEXT_Q,
            text: 'Нэмэлт сэтгэгдэл',
            type: 'TEXT',
            isRequired: false,
            isOverallScore: false,
            sortOrder: 2,
          }),
        ],
      }),
    );
    const submit = vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    const user = userEvent.setup();
    renderSurvey();

    await screen.findByText('Дорж Алтан');
    await user.click(screen.getByRole('button', { name: /Маш сайн$/ }));
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    // No empty entry for the blank text box: the schema wants exactly one value per answer.
    expect(submittedPayload(0).answers).toEqual([{ questionId: RATING_Q, ratingValue: 5 }]);
  });

  it('renders every question shape and sends the right field for each', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(
      makeForm({
        questions: [
          makeQuestion({ helpText: 'Ажлын чанарыг бодолцоно уу.' }),
          makeQuestion({
            id: YES_NO_Q,
            text: 'Ажилтан эелдэг байсан уу?',
            type: 'YES_NO',
            isOverallScore: false,
            sortOrder: 2,
          }),
          makeQuestion({
            id: CHOICE_Q,
            text: 'Хэрхэн мэдсэн бэ?',
            type: 'SINGLE_CHOICE',
            options: [
              { value: 'PHONE', label: 'Утсаар' },
              { value: 'APP', label: 'Аппаар' },
            ],
            isOverallScore: false,
            sortOrder: 3,
          }),
          makeQuestion({
            id: TEXT_Q,
            text: 'Нэмэлт сэтгэгдэл',
            type: 'TEXT',
            isOverallScore: false,
            sortOrder: 4,
          }),
        ],
      }),
    );
    const submit = vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    const user = userEvent.setup();
    renderSurvey();

    await screen.findByText('Дорж Алтан');
    expect(screen.getByText('Ажлын чанарыг бодолцоно уу.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Дунд$/ }));
    await user.click(screen.getByRole('button', { name: 'Тийм' }));
    await user.click(screen.getByRole('button', { name: 'Аппаар' }));
    await user.type(screen.getByLabelText(/Нэмэлт сэтгэгдэл/), '  Сайн ажиллалаа  ');

    await user.click(screen.getByRole('button', { name: 'Илгээх' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    expect(submittedPayload(0).answers).toEqual([
      { questionId: RATING_Q, ratingValue: 3 },
      { questionId: YES_NO_Q, booleanValue: true },
      { questionId: CHOICE_Q, choiceValue: 'APP' },
      { questionId: TEXT_Q, textValue: 'Сайн ажиллалаа' },
    ]);
  });

  it('walks the technicians one at a time, then thanks the customer', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(
      makeForm({
        employees: [
          makePendingEmployee(ALTAN_ID, 'Алтан'),
          makePendingEmployee(BAT_ID, 'Бат'),
        ],
      }),
    );
    const submit = vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    const user = userEvent.setup();
    renderSurvey();

    await screen.findByText('Дорж Алтан');
    expect(screen.getByText('1 / 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Маш сайн$/ }));
    await user.click(screen.getByRole('button', { name: 'Дараагийн ажилтан' }));

    expect(await screen.findByText('Дорж Бат')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    // The next technician starts blank rather than carrying the previous answer over.
    expect(screen.getByRole('button', { name: /Маш сайн$/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(screen.getByRole('button', { name: /Муу$/ }));
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    expect(await screen.findByText('Үнэлгээ хүлээн авлаа')).toBeInTheDocument();

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submittedPayload(0).employeeId).toBe(ALTAN_ID);
    expect(submittedPayload(1).employeeId).toBe(BAT_ID);
  });

  it('only queues the technicians still outstanding', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(
      makeForm({
        employees: [
          makePendingEmployee(ALTAN_ID, 'Алтан', { isRated: true }),
          makePendingEmployee(BAT_ID, 'Бат'),
        ],
      }),
    );
    vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    renderSurvey();

    expect(await screen.findByText('Дорж Бат')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.queryByText('Дорж Алтан')).not.toBeInTheDocument();
  });

  it('keeps the form and the typed answers up when the server refuses', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(
      makeForm({
        questions: [
          makeQuestion(),
          makeQuestion({
            id: TEXT_Q,
            text: 'Нэмэлт сэтгэгдэл',
            type: 'TEXT',
            isRequired: false,
            isOverallScore: false,
            sortOrder: 2,
          }),
        ],
      }),
    );
    const submit = vi
      .spyOn(portalService, 'submitSurveyResponse')
      .mockRejectedValue(new ApiError('Энэ ажилтан аль хэдийн үнэлэгдсэн.', 'CONFLICT', 409));

    const user = userEvent.setup();
    renderSurvey();

    await screen.findByText('Дорж Алтан');
    await user.click(screen.getByRole('button', { name: /Маш сайн$/ }));
    await user.type(screen.getByLabelText(/Нэмэлт сэтгэгдэл/), 'Баярлалаа');
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    expect(await screen.findByText('Энэ ажилтан аль хэдийн үнэлэгдсэн.')).toBeInTheDocument();

    // Still on the same technician, with everything the customer typed.
    expect(screen.getByText('Дорж Алтан')).toBeInTheDocument();
    expect(screen.getByLabelText(/Нэмэлт сэтгэгдэл/)).toHaveValue('Баярлалаа');
    expect(screen.getByRole('button', { name: /Маш сайн$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // And a retry is a retry of the submit, not of the survey.
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submittedPayload(1).answers).toEqual([
      { questionId: RATING_Q, ratingValue: 5 },
      { questionId: TEXT_Q, textValue: 'Баярлалаа' },
    ]);
  });

  /**
   * The claim `portal.service.ts` makes about itself, held to on this screen.
   *
   * The server resolves the tenant from the session and discards anything the request
   * carries, so a `customerId` here would be ignored - and sending one would imply it
   * might not be.
   */
  it('never sends a customerId', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(makeForm());
    const submit = vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    const user = userEvent.setup();
    renderSurvey();

    await screen.findByText('Дорж Алтан');
    await user.click(screen.getByRole('button', { name: /Маш сайн$/ }));
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(submit.mock.calls)).not.toContain('customerId');
    expect(JSON.stringify(submit.mock.calls)).not.toContain(CUSTOMER_IDENTITY.customerId);
  });

  /** A 404 is the endpoint's normal answer for a request with no open survey. */
  it('says there is nobody to rate when the form comes back null', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(null);

    renderSurvey();

    expect(await screen.findByText('Үнэлэх ажилтан алга')).toBeInTheDocument();
  });

  it('drops a retired question instead of requiring an answer nobody can give', async () => {
    vi.spyOn(portalService, 'surveyForm').mockResolvedValue(
      makeForm({
        questions: [
          makeQuestion({
            id: YES_NO_Q,
            text: 'Хуучирсан асуулт',
            type: 'YES_NO',
            isActive: false,
            isOverallScore: false,
          }),
          makeQuestion({ sortOrder: 2 }),
        ],
      }),
    );
    const submit = vi.spyOn(portalService, 'submitSurveyResponse').mockResolvedValue();

    const user = userEvent.setup();
    renderSurvey();

    await screen.findByText('Дорж Алтан');
    expect(screen.queryByText('Хуучирсан асуулт')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Маш сайн$/ }));
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });
});

describe('the survey entry points', () => {
  it('offers the survey on a request detail the pending list names', async () => {
    vi.spyOn(portalService, 'getRequest').mockResolvedValue(makeRequestDetail());
    const pending = vi
      .spyOn(portalService, 'pendingSurveys')
      .mockResolvedValue([makePendingItem()]);
    const form = vi.spyOn(portalService, 'surveyForm');

    renderWithAuth(<PortalRequestDetailPage />, {
      permissions: PORTAL_PERMISSIONS,
      role: 'customer',
      user: CUSTOMER_IDENTITY,
      route: `/portal/requests/${REQUEST_ID}`,
      path: '/portal/requests/:requestId',
    });

    expect(await screen.findByRole('button', { name: 'Үнэлгээ өгөх' })).toBeInTheDocument();
    expect(pending).toHaveBeenCalled();
    // Decided from the pending list, never by asking for a form that would 404.
    expect(form).not.toHaveBeenCalled();
  });

  it('stays quiet on a request whose technicians have all been answered', async () => {
    vi.spyOn(portalService, 'getRequest').mockResolvedValue(makeRequestDetail());
    vi.spyOn(portalService, 'pendingSurveys').mockResolvedValue([
      makePendingItem({
        employees: [makePendingEmployee(ALTAN_ID, 'Алтан', { isRated: true })],
      }),
    ]);

    renderWithAuth(<PortalRequestDetailPage />, {
      permissions: PORTAL_PERMISSIONS,
      role: 'customer',
      user: CUSTOMER_IDENTITY,
      route: `/portal/requests/${REQUEST_ID}`,
      path: '/portal/requests/:requestId',
    });

    // The page itself has finished loading, so an absent card is a decision rather than
    // a screen that has not caught up.
    expect(await screen.findByText('Дүгнэлт')).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(portalService.pendingSurveys)).toHaveBeenCalled(),
    );
    expect(screen.queryByRole('button', { name: 'Үнэлгээ өгөх' })).not.toBeInTheDocument();
  });

  it('prompts on the home page while a survey is outstanding', async () => {
    vi.spyOn(portalService, 'listRequests').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
    vi.spyOn(portalService, 'pendingSurveys').mockResolvedValue([makePendingItem()]);

    renderWithAuth(<PortalHomePage />, {
      permissions: PORTAL_PERMISSIONS,
      role: 'customer',
      user: CUSTOMER_IDENTITY,
      route: '/portal',
    });

    expect(await screen.findByText('Үйлчилгээгээ үнэлнэ үү')).toBeInTheDocument();
    expect(screen.getByText(/Төв цамхаг дэх ажил дууслаа/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Үнэлгээ өгөх' })).toBeInTheDocument();
  });

  it('shows no home prompt when nothing is outstanding', async () => {
    vi.spyOn(portalService, 'listRequests').mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
    vi.spyOn(portalService, 'pendingSurveys').mockResolvedValue([
      makePendingItem({
        employees: [makePendingEmployee(ALTAN_ID, 'Алтан', { isSkipped: true })],
      }),
    ]);

    renderWithAuth(<PortalHomePage />, {
      permissions: PORTAL_PERMISSIONS,
      role: 'customer',
      user: CUSTOMER_IDENTITY,
      route: '/portal',
    });

    await waitFor(() =>
      expect(vi.mocked(portalService.pendingSurveys)).toHaveBeenCalled(),
    );
    expect(screen.queryByText('Үйлчилгээгээ үнэлнэ үү')).not.toBeInTheDocument();
  });
});
