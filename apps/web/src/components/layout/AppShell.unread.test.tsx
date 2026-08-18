import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsPage } from '../../features/notifications/NotificationsPage';
import { publishUnreadCountChanged } from '../../lib/unread-notifications';
import { notificationService } from '../../services/report.service';
import { makeNotification, makePage } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { AppShell } from './AppShell';

/**
 * The bell and the notification page keep separate state and issue separate requests.
 * Nothing joined them, so clearing the inbox left the badge showing its old number until
 * the next sixty-second poll — beside a list that visibly had nothing unread.
 *
 * These pin the join, not the poll. A test that waited for the interval would pass on the
 * broken code too.
 */
describe('unread badge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the server count on the bell', async () => {
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 4 });

    renderWithAuth(
      <AppShell>
        <div />
      </AppShell>,
      { permissions: [PERMISSIONS.NOTIFICATION_VIEW] },
    );

    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('refetches the moment something announces a change', async () => {
    const count = vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 4 });

    renderWithAuth(
      <AppShell>
        <div />
      </AppShell>,
      { permissions: [PERMISSIONS.NOTIFICATION_VIEW] },
    );
    await screen.findByText('4');
    expect(count).toHaveBeenCalledTimes(1);

    count.mockResolvedValue({ unread: 0 });
    publishUnreadCountChanged();

    // No timers advanced: this must not wait for the sixty-second poll.
    await waitFor(() => {
      expect(count).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText('4')).not.toBeInTheDocument();
    });
  });

  it('stops listening once unmounted', async () => {
    const count = vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 2 });

    const { unmount } = renderWithAuth(
      <AppShell>
        <div />
      </AppShell>,
      { permissions: [PERMISSIONS.NOTIFICATION_VIEW] },
    );
    await screen.findByText('2');
    unmount();

    publishUnreadCountChanged();
    // A listener surviving unmount would refetch and set state on a dead component.
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('announces when the page marks everything read', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(makePage([makeNotification()]));
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 1 });
    vi.spyOn(notificationService, 'markAllRead').mockResolvedValue({ updated: 1 });
    const user = userEvent.setup();

    let announced = 0;
    const { onUnreadCountChanged } = await import('../../lib/unread-notifications');
    const stop = onUnreadCountChanged(() => {
      announced += 1;
    });

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });
    await user.click(await screen.findByRole('button', { name: 'Бүгдийг уншсан болгох' }));

    await waitFor(() => {
      expect(announced).toBeGreaterThan(0);
    });
    stop();
  });
});
