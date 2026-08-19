import { PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithAuth } from '../../test/render';
import { AppShell } from './AppShell';

/**
 * The Help button lives in the shell rather than in each page, which is what makes
 * "every page has help" a property of the layout instead of a promise each new page has
 * to remember to keep. These tests hold that placement.
 */
describe('AppShell help', () => {
  it('opens the panel for the current route', async () => {
    renderWithAuth(<AppShell>content</AppShell>, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
      route: '/service-requests',
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Тусламж' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Энэ хуудсын зорилго' })).toBeInTheDocument();
  });

  /**
   * The panel explains a page the reader already reached, so gating it would only hide
   * instructions from the people looking at the screen they describe.
   */
  it('shows the button to a caller holding no permissions at all', async () => {
    renderWithAuth(<AppShell>content</AppShell>, { permissions: [], route: '/dashboard' });

    expect(await screen.findByRole('button', { name: 'Тусламж' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderWithAuth(<AppShell>content</AppShell>, {
      permissions: [PERMISSIONS.DASHBOARD_VIEW],
      route: '/dashboard',
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Тусламж' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /** An unknown URL lands on the not-found page, which is a page like any other. */
  it('still offers help on an unrouted path', async () => {
    renderWithAuth(<AppShell>content</AppShell>, { permissions: [], route: '/no-such-page' });

    await userEvent.click(await screen.findByRole('button', { name: 'Тусламж' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/тусламж хараахан бэлдээгүй/i)).not.toBeInTheDocument();
  });
});
