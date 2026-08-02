import { PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SERVICE_REQUEST_TABS } from '../../config/navigation';
import { renderWithAuth } from '../../test/render';
import { SubNav } from './SubNav';

describe('SubNav', () => {
  it('renders both request tabs for a caller who holds both permissions', async () => {
    renderWithAuth(<SubNav items={SERVICE_REQUEST_TABS} />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.DISPATCH_VIEW],
      route: '/service-requests',
    });

    const nav = await screen.findByRole('navigation', { name: 'Дэд цэс' });
    expect(within(nav).getByRole('link', { name: 'Хүсэлтийн жагсаалт' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Dispatch board' })).toHaveAttribute(
      'href',
      '/service-requests/dispatch',
    );
  });

  /**
   * A caller without dispatch.view should simply not see the tab, rather than discover the
   * restriction by clicking through to a 403.
   */
  it('renders nothing when only one tab is permitted', async () => {
    renderWithAuth(<SubNav items={SERVICE_REQUEST_TABS} />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
      route: '/service-requests',
    });

    expect(screen.queryByRole('navigation', { name: 'Дэд цэс' })).not.toBeInTheDocument();
  });

  it('marks the active tab on a child route', async () => {
    renderWithAuth(<SubNav items={SERVICE_REQUEST_TABS} />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.DISPATCH_VIEW],
      route: '/service-requests/dispatch',
    });

    const dispatch = await screen.findByRole('link', { name: 'Dispatch board' });
    expect(dispatch).toHaveAttribute('aria-current', 'page');

    // The list tab is exact, so a child route must not keep it highlighted.
    expect(screen.getByRole('link', { name: 'Хүсэлтийн жагсаалт' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
