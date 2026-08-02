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
  });

  it('lists notifications with their event and time', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(makePage([makeNotification()]));

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    expect(await screen.findByText('INV-202607-0001 нэхэмжлэл илгээгдлээ')).toBeInTheDocument();
    expect(screen.getByText(/Нэхэмжлэл илгээгдсэн/)).toBeInTheDocument();
  });

  /** Section 19.2 leaves the delivery channel open, so the limit is stated on screen. */
  it('says nothing is delivered outside the system', async () => {
    vi.spyOn(notificationService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<NotificationsPage />, { permissions: [PERMISSIONS.NOTIFICATION_VIEW] });

    expect(await screen.findByText(/имэйл, SMS, push/)).toBeInTheDocument();
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
