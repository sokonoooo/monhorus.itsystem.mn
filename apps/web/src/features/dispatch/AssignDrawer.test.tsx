import {
  PERMISSIONS,
  type DispatchCandidateDto,
  type ServiceRequestListItemDto,
} from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { dispatchService, serviceRequestService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { AssignDrawer } from './AssignDrawer';

const REQUEST: ServiceRequestListItemDto = {
  id: 'r1',
  requestNumber: 'SR-202601-0001',
  customer: { id: 'c1', name: 'Central Tower ХХК' },
  project: null,
  building: { id: 'b1', name: 'Main Tower' },
  floor: null,
  room: null,
  device: null,
  requestType: 'URGENT_CALL',
  isUrgent: true,
  status: 'UNASSIGNED',
  assignedEmployees: [],
  assignedTeam: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  slaDueAt: '2026-01-01T06:00:00.000Z',
  slaState: 'STARTED',
  slaRemainingMinutes: 300,
};

function candidate(overrides: Partial<DispatchCandidateDto> = {}): DispatchCandidateDto {
  return {
    id: 'e1',
    employeeCode: 'EMP-0001',
    firstName: 'Энхтөр',
    lastName: 'Батаа',
    photoUrl: null,
    team: null,
    workLocation: null,
    skills: ['UPS'],
    qualificationLevel: 'SENIOR',
    safetyGrade: 'III',
    permittedJobTypes: [],
    activeAssignments: 0,
    isAvailable: true,
    ...overrides,
  };
}

describe('AssignDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dispatchService, 'teamCandidates').mockResolvedValue([]);
  });

  it('lists candidates with their availability', async () => {
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([
      candidate(),
      candidate({ id: 'e2', employeeCode: 'EMP-0002', lastName: 'Дорж', activeAssignments: 2, isAvailable: false }),
    ]);

    renderWithAuth(
      <AssignDrawer request={REQUEST} onClose={() => undefined} onAssigned={() => undefined} />,
      { permissions: [PERMISSIONS.DISPATCH_ASSIGN] },
    );

    expect(await screen.findByText('Батаа Энхтөр')).toBeInTheDocument();
    expect(screen.getByText('Сул')).toBeInTheDocument();
    expect(screen.getByText('2 ажилтай')).toBeInTheDocument();
  });

  it('keeps the assign action disabled until something is selected', async () => {
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([candidate()]);

    renderWithAuth(
      <AssignDrawer request={REQUEST} onClose={() => undefined} onAssigned={() => undefined} />,
      { permissions: [PERMISSIONS.DISPATCH_ASSIGN] },
    );

    const assign = await screen.findByRole('button', { name: 'Хуваарилах' });
    expect(assign).toBeDisabled();

    await userEvent.setup().click(screen.getByRole('checkbox', { name: /Батаа Энхтөр/ }));
    await waitFor(() => expect(assign).toBeEnabled());
  });

  it('sends the selected employees to the assign endpoint', async () => {
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([candidate()]);
    const assignSpy = vi
      .spyOn(serviceRequestService, 'assign')
      .mockResolvedValue({} as Awaited<ReturnType<typeof serviceRequestService.assign>>);
    const onAssigned = vi.fn();
    const user = userEvent.setup();

    renderWithAuth(
      <AssignDrawer request={REQUEST} onClose={() => undefined} onAssigned={onAssigned} />,
      { permissions: [PERMISSIONS.DISPATCH_ASSIGN] },
    );

    await user.click(await screen.findByRole('checkbox', { name: /Батаа Энхтөр/ }));
    await user.click(screen.getByRole('button', { name: 'Хуваарилах' }));

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('r1', {
        employeeIds: ['e1'],
        teamId: null,
        teamLeaderEmployeeId: null,
      });
    });
    expect(onAssigned).toHaveBeenCalled();
  });

  it('surfaces a backend refusal instead of claiming success', async () => {
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([candidate()]);
    vi.spyOn(serviceRequestService, 'assign').mockRejectedValue(
      new ApiError('Идэвхгүй ажилтанд ажил хуваарилах боломжгүй', 'VALIDATION_ERROR', 400),
    );
    const onAssigned = vi.fn();
    const user = userEvent.setup();

    renderWithAuth(
      <AssignDrawer request={REQUEST} onClose={() => undefined} onAssigned={onAssigned} />,
      { permissions: [PERMISSIONS.DISPATCH_ASSIGN] },
    );

    await user.click(await screen.findByRole('checkbox', { name: /Батаа Энхтөр/ }));
    await user.click(screen.getByRole('button', { name: 'Хуваарилах' }));

    expect(
      await screen.findByText('Идэвхгүй ажилтанд ажил хуваарилах боломжгүй'),
    ).toBeInTheDocument();
    expect(onAssigned).not.toHaveBeenCalled();
  });

  it('explains an empty candidate list rather than showing a blank panel', async () => {
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([]);

    renderWithAuth(
      <AssignDrawer request={REQUEST} onClose={() => undefined} onAssigned={() => undefined} />,
      { permissions: [PERMISSIONS.DISPATCH_ASSIGN] },
    );

    expect(
      await screen.findByText(/Хуваарилах боломжтой ажилтан олдсонгүй/),
    ).toBeInTheDocument();
  });
});
