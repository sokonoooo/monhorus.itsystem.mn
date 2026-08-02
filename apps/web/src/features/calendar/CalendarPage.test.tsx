import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { calendarService } from '../../services/calendar.service';
import { dispatchService } from '../../services/service-request.service';
import { makeCalendarEvent, makeCalendarResult } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { CalendarPage } from './CalendarPage';

/** Anchored so the month grid is deterministic regardless of the current date. */
const JULY = '/calendar?date=2026-07-15';

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([]);
  });

  it('shows a loading state before data arrives', () => {
    vi.spyOn(calendarService, 'range').mockReturnValue(new Promise(() => undefined));

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: JULY,
    });

    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
  });

  it('renders an event on every day it spans', async () => {
    vi.spyOn(calendarService, 'range').mockResolvedValue(
      makeCalendarResult([makeCalendarEvent()]),
    );

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: JULY,
    });

    // The fixture spans 6 to 8 July, so the chip appears on three days.
    const chips = await screen.findAllByRole('button', {
      name: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
    });
    expect(chips).toHaveLength(3);
  });

  it('reports the server timezone rather than the browser one', async () => {
    vi.spyOn(calendarService, 'range').mockResolvedValue(
      makeCalendarResult([makeCalendarEvent()]),
    );

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: JULY,
    });

    expect(await screen.findByText(/Цагийн бүс: Asia\/Ulaanbaatar/)).toBeInTheDocument();
  });

  it('shows the backend supplied status label in the agenda view', async () => {
    vi.spyOn(calendarService, 'range').mockResolvedValue(
      makeCalendarResult([
        makeCalendarEvent({ status: 'OVERDUE', statusLabel: 'Хугацаа хэтэрсэн', isOverdue: true }),
      ]),
    );

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: `${JULY}&view=agenda`,
    });

    expect(await screen.findByText('Хугацаа хэтэрсэн')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('omits a progress figure for a source that has none', async () => {
    vi.spyOn(calendarService, 'range').mockResolvedValue(
      makeCalendarResult([
        makeCalendarEvent({
          id: 'SERVICE_REQUEST:r1',
          source: 'SERVICE_REQUEST',
          sourceId: 'r1',
          reference: 'SR-202607-0001',
          title: 'Гэрэлтүүлэг ажиллахгүй',
          status: 'UNASSIGNED',
          statusLabel: 'Хуваарилагдаагүй',
          isUrgent: true,
          progressPercent: null,
          detailPath: '/service-requests/r1',
        }),
      ]),
    );

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
      route: `${JULY}&view=agenda`,
    });

    expect(await screen.findByText('Гэрэлтүүлэг ажиллахгүй')).toBeInTheDocument();
    expect(screen.queryByText('45%')).not.toBeInTheDocument();
  });

  it('shows an empty agenda state', async () => {
    vi.spyOn(calendarService, 'range').mockResolvedValue(makeCalendarResult([]));

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: `${JULY}&view=agenda`,
    });

    expect(await screen.findByText('Хуваарь хоосон')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    vi.spyOn(calendarService, 'range').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: JULY,
    });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
  });

  it('requests a whole-week padded window for the month view', async () => {
    const range = vi
      .spyOn(calendarService, 'range')
      .mockResolvedValue(makeCalendarResult([]));

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: JULY,
    });

    await waitFor(() => {
      expect(range).toHaveBeenCalled();
    });
    const query = range.mock.calls[0]![0];
    const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;

    // The month grid always shows whole weeks, so the window is a multiple of seven days
    // and covers the whole month. Asserted in day counts rather than absolute dates,
    // because the grid is built in local time and the query is sent as UTC.
    expect(days % 7).toBe(0);
    expect(days).toBeGreaterThanOrEqual(28);
    expect(Date.parse(query.from)).toBeLessThanOrEqual(Date.parse('2026-07-01T00:00:00.000Z'));
    expect(Date.parse(query.to)).toBeGreaterThanOrEqual(Date.parse('2026-07-31T00:00:00.000Z'));
  });

  it('narrows the window when the view switches to week', async () => {
    const range = vi
      .spyOn(calendarService, 'range')
      .mockResolvedValue(makeCalendarResult([]));
    const user = userEvent.setup();

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: JULY,
    });

    await waitFor(() => expect(range).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText('Харагдац'), 'week');

    await waitFor(() => {
      const last = range.mock.calls[range.mock.calls.length - 1]![0];
      const days = (Date.parse(last.to) - Date.parse(last.from)) / 86_400_000;
      expect(days).toBe(7);
    });
  });

  it('sends only the checked sources', async () => {
    const range = vi
      .spyOn(calendarService, 'range')
      .mockResolvedValue(makeCalendarResult([]));
    const user = userEvent.setup();

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.SERVICE_REQUEST_VIEW],
      route: JULY,
    });

    await waitFor(() => expect(range).toHaveBeenCalled());
    await user.click(screen.getByLabelText('Үйлчилгээний хүсэлт'));

    await waitFor(() => {
      const last = range.mock.calls[range.mock.calls.length - 1]![0];
      expect(last.sources).toEqual(['PLANNED_WORK']);
    });
  });

  it('sends the employee filter to the backend', async () => {
    const range = vi
      .spyOn(calendarService, 'range')
      .mockResolvedValue(makeCalendarResult([]));
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([
      {
        id: 'e1',
        employeeCode: 'EMP-0001',
        firstName: 'Дорж',
        lastName: 'Бат',
        photoUrl: null,
        team: null,
        workLocation: null,
        skills: [],
        qualificationLevel: 'SENIOR',
        safetyGrade: 'III',
        permittedJobTypes: [],
        activeAssignments: 0,
        isAvailable: true,
      },
    ]);
    const user = userEvent.setup();

    renderWithAuth(<CalendarPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: JULY,
    });

    await waitFor(() => expect(range).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Бат Дорж' })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText('Ажилтан'), 'e1');

    await waitFor(() => {
      const last = range.mock.calls[range.mock.calls.length - 1]![0];
      expect(last.employeeId).toBe('e1');
    });
  });
});
