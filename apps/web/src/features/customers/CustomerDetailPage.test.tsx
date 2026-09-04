import { PERMISSIONS } from '@monhorus/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectService } from '../../services/object.service';
import { serviceRequestService } from '../../services/service-request.service';
import { makeCustomer, makeServiceRequest } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { CustomerDetailPage } from './CustomerDetailPage';

const CUSTOMER_ID = '507f1f77bcf86cd799439011';

function render() {
  return renderWithAuth(<CustomerDetailPage />, {
    permissions: [PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.SERVICE_REQUEST_VIEW],
    route: `/customers/${CUSTOMER_ID}`,
    path: '/customers/:customerId',
  });
}

/** One window of a longer history, shaped as the list endpoint answers. */
function requestPage(page: number, count: number, total: number) {
  return {
    items: Array.from({ length: count }, (_, offset) =>
      makeServiceRequest({
        id: `r-${page}-${offset}`,
        requestNumber: `SR-${page}-${offset}`,
      }),
    ),
    page,
    limit: 20,
    total,
    totalPages: Math.ceil(total / 20),
  };
}

async function openRequestsTab(): Promise<void> {
  render();
  await screen.findByRole('heading', { name: 'Central Tower ХХК' });
  await userEvent.click(screen.getByRole('tab', { name: 'Хүсэлт ба үйлчилгээний түүх' }));
}

/**
 * The history tab asked for twenty and drew them with no pager at all, so a customer with
 * a longer service history had the rest of it unreachable from their own record — and
 * nothing on screen distinguished "twenty requests" from "the twenty most recent".
 */
describe('CustomerDetailPage request history paging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(objectService, 'getCustomer').mockResolvedValue(
      makeCustomer({ id: CUSTOMER_ID, name: 'Central Tower ХХК' }),
    );
  });

  it('asks for the first page and reports the whole history', async () => {
    const list = vi
      .spyOn(serviceRequestService, 'list')
      .mockResolvedValue(requestPage(1, 20, 96) as never);

    await openRequestsTab();

    expect(await screen.findByText('SR-1-0')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ customerId: CUSTOMER_ID, page: 1, limit: 20 });
    // The count is the customer's, not the page's.
    expect(screen.getByText('Нийт 96, хуудас 1/5')).toBeInTheDocument();
  });

  it('reaches the requests the first page does not hold', async () => {
    vi.spyOn(serviceRequestService, 'list').mockImplementation(
      async (query) => requestPage(query?.page ?? 1, 20, 96) as never,
    );

    await openRequestsTab();
    await screen.findByText('SR-1-0');

    await userEvent.click(screen.getByRole('button', { name: 'Дараах' }));

    expect(await screen.findByText('SR-2-0')).toBeInTheDocument();
    expect(screen.queryByText('SR-1-0')).not.toBeInTheDocument();
  });

  it('offers no pager for a history that fits on one page', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue(requestPage(1, 3, 3) as never);

    await openRequestsTab();

    expect(await screen.findByText('SR-1-0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Дараах' })).not.toBeInTheDocument();
  });
});
