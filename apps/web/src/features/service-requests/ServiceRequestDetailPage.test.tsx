import {
  PERMISSIONS,
  type ServiceRequestAttachmentDto,
  type ServiceRequestDetailDto,
} from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fileUrl from '../../lib/file-url';
import { projectService } from '../../services/project.service';
import { serviceRequestService, workReportService } from '../../services/service-request.service';
import { makeFloorPlan } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { ServiceRequestDetailPage } from './ServiceRequestDetailPage';

const REQUEST_ID = '507f1f77bcf86cd799439401';

function makeAttachment(
  overrides: Partial<ServiceRequestAttachmentDto> = {},
): ServiceRequestAttachmentDto {
  return {
    id: 'a1',
    name: 'panel.jpg',
    downloadUrl: `/api/v1/files/a1`,
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    uploadedByName: 'Б. Энхтөр',
    uploadedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ServiceRequestDetailDto> = {}): ServiceRequestDetailDto {
  return {
    id: REQUEST_ID,
    requestNumber: 'SR-202608-0001',
    customer: { id: 'c1', name: 'Central Tower ХХК' },
    project: null,
    building: { id: 'b1', name: 'Main Tower' },
    floor: null,
    room: null,
    device: null,
    panel: null,
    circuit: null,
    branch: null,
    requestType: 'URGENT_CALL',
    isUrgent: false,
    status: 'UNASSIGNED',
    assignedEmployees: [],
    assignedTeam: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    slaDueAt: null,
    slaState: 'WITHIN_SLA',
    slaRemainingMinutes: null,
    description: 'Самбар оч гаргаж байна.',
    contactName: 'Д. Болор',
    contactPhone: '9911-2233',
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
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function render() {
  return renderWithAuth(<ServiceRequestDetailPage />, {
    permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    route: `/service-requests/${REQUEST_ID}`,
    path: '/service-requests/:requestId',
  });
}

/** The attachment card, scoped so a photo name cannot be matched from elsewhere. */
async function attachmentCard(count: number): Promise<HTMLElement> {
  const heading = await screen.findByText(`Хавсралт (${count})`);
  return heading.closest('section') as HTMLElement;
}

describe('ServiceRequestDetailPage attachments', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The panel is not under test here; its own suite covers it. Failing the load keeps
    // it to a single alert instead of a second data-dependent tree.
    vi.spyOn(workReportService, 'get').mockRejectedValue(new Error('no report'));
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:attachment');
  });

  it('renders an image attachment as a thumbnail from an authorised object URL', async () => {
    vi.spyOn(serviceRequestService, 'getById').mockResolvedValue(
      makeRequest({ attachments: [makeAttachment()] }),
    );

    render();

    const card = await attachmentCard(1);
    const image = await within(card).findByRole('img', { name: 'panel.jpg' });
    expect(image).toHaveAttribute('src', 'blob:attachment');
    // The bearer-token route is never used as a bare src.
    expect(image.getAttribute('src')).not.toContain('/files/');
    expect(fileUrl.authorisedFileUrl).toHaveBeenCalledWith('/api/v1/files/a1');
  });

  it('opens the image at full size', async () => {
    vi.spyOn(serviceRequestService, 'getById').mockResolvedValue(
      makeRequest({ attachments: [makeAttachment()] }),
    );

    render();

    const card = await attachmentCard(1);
    await userEvent.click(
      await within(card).findByRole('button', { name: 'panel.jpg томруулж харах' }),
    );

    const dialog = screen.getByRole('dialog', { name: 'panel.jpg' });
    expect(within(dialog).getByRole('img', { name: 'panel.jpg' })).toHaveAttribute(
      'src',
      'blob:attachment',
    );
  });

  it('lists a non-image attachment by name instead of decoding it as an image', async () => {
    vi.spyOn(serviceRequestService, 'getById').mockResolvedValue(
      makeRequest({
        attachments: [
          makeAttachment({ id: 'a2', name: 'quote.pdf', mimeType: 'application/pdf' }),
        ],
      }),
    );

    render();

    const card = await attachmentCard(1);
    expect(within(card).getByText('quote.pdf')).toBeInTheDocument();
    expect(within(card).queryByRole('img')).not.toBeInTheDocument();
    expect(
      within(card).queryByRole('button', { name: 'quote.pdf томруулж харах' }),
    ).not.toBeInTheDocument();

    const download = await within(card).findByRole('link', { name: 'Татах' });
    expect(download).toHaveAttribute('href', 'blob:attachment');
    expect(download).toHaveAttribute('download', 'quote.pdf');
  });

  it('says so when a request carries no attachments', async () => {
    vi.spyOn(serviceRequestService, 'getById').mockResolvedValue(makeRequest());

    render();

    const card = await attachmentCard(0);
    expect(within(card).getByText('Хавсралт байхгүй байна.')).toBeInTheDocument();
    expect(fileUrl.authorisedFileUrl).not.toHaveBeenCalled();
  });
});

/**
 * Where on the floor. The pin is what a technician reads the request for when the zone
 * cannot be named, so it is drawn on the plan rather than reported as a pair of numbers.
 */
describe('ServiceRequestDetailPage plan position', () => {
  const FLOOR = { id: '507f1f77bcf86cd799439121', name: '2 давхар' };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(workReportService, 'get').mockRejectedValue(new Error('no report'));
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
  });

  it('draws the marker on the floor plan for a request that carries one', async () => {
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(serviceRequestService, 'getById').mockResolvedValue(
      makeRequest({ floor: FLOOR, planPosition: { x: 0.25, y: 0.5 } }),
    );

    render();

    expect(await screen.findByText('План дээрх байрлал')).toBeInTheDocument();
    expect(await screen.findByAltText('2 давхарын төлөвлөгөө')).toHaveAttribute('src', 'blob:plan');
    expect(screen.getByRole('img', { name: 'План дээр тэмдэглэсэн байрлал' })).toHaveStyle({
      left: '25%',
      top: '50%',
    });
  });

  /** Read-only: the request records what was reported and the detail page does not edit it. */
  it('offers no way to move or clear the marker', async () => {
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(serviceRequestService, 'getById').mockResolvedValue(
      makeRequest({ floor: FLOOR, planPosition: { x: 0.25, y: 0.5 } }),
    );

    render();

    await screen.findByRole('img', { name: 'План дээр тэмдэглэсэн байрлал' });
    expect(
      screen.queryByRole('button', { name: 'Тэмдэглэгээ арилгах' }),
    ).not.toBeInTheDocument();
  });

  it('shows no plan section for a request without a pin', async () => {
    const getPlan = vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(serviceRequestService, 'getById').mockResolvedValue(makeRequest({ floor: FLOOR }));

    render();

    await screen.findByText('Байршил');
    expect(screen.queryByText('План дээрх байрлал')).not.toBeInTheDocument();
    // Nothing to draw, so the plan is not fetched either.
    expect(getPlan).not.toHaveBeenCalled();
  });
});
