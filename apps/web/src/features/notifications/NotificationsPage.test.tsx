import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationService } from '../../services/report.service';
import { makeNotification, makePage } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { NotificationsPage } from './NotificationsPage';

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    /*
     * The page loads the list and the server-side unread count together, so every case needs
     * the count stubbed even when it is not what the case is about. Tests that assert on the
     * number re-stub this with their own value.
     */
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 0 });
  });

  it('asks for one page rather than a fixed fifty', async () => {
    const list = vi.spyOn(notificationService, 'list');

    renderWithAuth(<NotificationsPage />, { permissions: [] });
    await waitFor(() =>
      // The old call was a cap, not a window: the fifty-first notification was unreachable.
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 })),
    );
  });

  it('lists notifications with their event and time', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(makePage([makeNotification()]));

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    expect(await screen.findByText('INV-202607-0001 нэхэмжлэл илгээгдлээ')).toBeInTheDocument();
    expect(screen.getByText(/Нэхэмжлэл илгээгдсэн/)).toBeInTheDocument();
  });

  /**
   * The delivery limits are stated on screen rather than left for a user to discover.
   *
   * The claim changed when Android push was approved: promising "in-app only" to somebody
   * whose phone is buzzing is worse than saying nothing. What still needs saying is the two
   * real limits — an iPhone gets no push, and nothing is emailed.
   */
  it('states which channels do and do not deliver', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    expect(await screen.findByText(/Android/)).toBeInTheDocument();
    expect(screen.getByText(/iPhone/)).toBeInTheDocument();
  });

  it('marks a notification read when it is opened', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(
      makePage([makeNotification({ linkPath: null })]),
    );
    const markRead = vi
      .spyOn(notificationService, 'markRead')
      .mockResolvedValue(makeNotification({ readAt: '2026-07-29T01:00:00.000Z' }));
    const user = userEvent.setup();

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    await user.click(await screen.findByText('INV-202607-0001 нэхэмжлэл илгээгдлээ'));

    await waitFor(() => {
      expect(markRead).toHaveBeenCalledWith('507f1f77bcf86cd799439221');
    });
  });

  it('does not re-mark a notification that was already read', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(
      makePage([makeNotification({ readAt: '2026-07-29T01:00:00.000Z', linkPath: null })]),
    );
    const markRead = vi.spyOn(notificationService, 'markRead');
    const user = userEvent.setup();

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    await user.click(await screen.findByText('INV-202607-0001 нэхэмжлэл илгээгдлээ'));
    expect(markRead).not.toHaveBeenCalled();
  });

  it('marks everything read', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(makePage([makeNotification()]));
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 1 });
    const markAll = vi.spyOn(notificationService, 'markAllRead').mockResolvedValue({ updated: 1 });
    const user = userEvent.setup();

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    await user.click(await screen.findByRole('button', { name: 'Бүгдийг уншсан болгох' }));
    await waitFor(() => {
      expect(markAll).toHaveBeenCalled();
    });
  });

  it('disables the mark-all action when nothing is unread', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(
      makePage([makeNotification({ readAt: '2026-07-29T01:00:00.000Z' })]),
    );

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    expect(await screen.findByRole('button', { name: 'Бүгдийг уншсан болгох' })).toBeDisabled();
  });

  /*
   * The regression this page shipped with: the count was `items.filter(unread).length` over
   * the rows on screen. Page 2 of an inbox whose unread items sit on page 1 shows no unread
   * rows, so the whole-inbox action disabled itself while the inbox still had unread items.
   */
  it('counts unread across the inbox, not just the page on screen', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(
      makePage([makeNotification({ readAt: '2026-07-29T01:00:00.000Z' })]),
    );
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 7 });

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    // Every row on this page is read, yet the inbox is not.
    expect(await screen.findByRole('button', { name: 'Бүгдийг уншсан болгох' })).toBeEnabled();
  });

  it('asks the server for the unread count rather than deriving it', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(makePage([makeNotification()]));
    const count = vi
      .spyOn(notificationService, 'unreadCount')
      .mockResolvedValue({ unread: 3 });

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    await waitFor(() => {
      expect(count).toHaveBeenCalled();
    });
  });

  it('filters to unread only', async () => {
    const list = vi
      .spyOn(notificationService, 'list')
      .mockResolvedValue(makePage([makeNotification()]));
    const user = userEvent.setup();

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    await user.click(await screen.findByRole('button', { name: 'Зөвхөн уншаагүй' }));
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ unreadOnly: true }));
    });
  });
});
