import { PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithAuth } from '../../test/render';
import { AppShell } from './AppShell';

describe('AppShell navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('puts calendar and notifications in the header, not the sidebar', async () => {
    renderWithAuth(<AppShell>content</AppShell>, {
      permissions: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.PLANNED_WORK_VIEW,
        PERMISSIONS.SERVICE_REQUEST_VIEW,
        PERMISSIONS.NOTIFICATION_VIEW,
      ],
    });

    const shortcuts = await screen.findByRole('navigation', { name: 'Түргэн холбоос' });
    expect(within(shortcuts).getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    expect(within(shortcuts).getByRole('button', { name: 'Мэдэгдэл' })).toBeInTheDocument();

    const sidebar = screen.getByRole('navigation', { name: 'Үндсэн цэс' });
    expect(within(sidebar).queryByText('Calendar')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Мэдэгдэл')).not.toBeInTheDocument();
  });

  it('hides the calendar shortcut from a caller who can read neither source', async () => {
    renderWithAuth(<AppShell>content</AppShell>, {
      permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.NOTIFICATION_VIEW],
    });

    const shortcuts = await screen.findByRole('navigation', { name: 'Түргэн холбоос' });
    expect(within(shortcuts).queryByRole('button', { name: 'Calendar' })).not.toBeInTheDocument();
    // Notifications is gated on its own permission, which this caller holds.
    expect(within(shortcuts).getByRole('button', { name: 'Мэдэгдэл' })).toBeInTheDocument();
  });

  /** Notifications are personal, so the shortcut is gated like any other entry. */
  it('hides the notification shortcut without notification.view', async () => {
    renderWithAuth(<AppShell>content</AppShell>, {
      permissions: [PERMISSIONS.DASHBOARD_VIEW],
    });

    const shortcuts = await screen.findByRole('navigation', { name: 'Түргэн холбоос' });
    expect(within(shortcuts).queryByRole('button', { name: 'Мэдэгдэл' })).not.toBeInTheDocument();
  });

  it('no longer lists the dispatch board as its own sidebar entry', async () => {
    renderWithAuth(<AppShell>content</AppShell>, {
      permissions: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.SERVICE_REQUEST_VIEW,
        PERMISSIONS.DISPATCH_VIEW,
      ],
    });

    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
    expect(within(sidebar).getByText('Үйлчилгээний хүсэлт')).toBeInTheDocument();
    expect(within(sidebar).queryByText('Dispatch board')).not.toBeInTheDocument();
  });

  it('no longer lists the superseded hierarchy browser or the plan module', async () => {
    renderWithAuth(<AppShell>content</AppShell>, {
      permissions: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.OBJECT_VIEW,
        PERMISSIONS.OBJECT_MASTER_VIEW,
      ],
    });

    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
    expect(within(sidebar).queryByText('Төсөл ба объект')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Объектын шатлал')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('План зураг')).not.toBeInTheDocument();

    // Object instances are not a module either: they are created on a floor inside Төсөл.
    expect(within(sidebar).queryByText('Объектын бүртгэл')).not.toBeInTheDocument();

    // The modules that replaced them are present.
    expect(within(sidebar).getByText('Төсөл')).toBeInTheDocument();
    expect(within(sidebar).getByText('Тоноглолын төрөл')).toBeInTheDocument();
  });

  /**
   * Every module is built, so a green and grey dot distinguished nothing. The icon is
   * what tells the modules apart now.
   */
  it('marks modules with icons rather than status dots', async () => {
    renderWithAuth(<AppShell>content</AppShell>, {
      permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.OBJECT_VIEW],
    });

    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });

    expect(within(sidebar).queryByText('Төлөвлөсөн')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Ажиллаж байгаа модуль')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Хөгжүүлэлт төлөвлөгдсөн')).not.toBeInTheDocument();

    // One glyph per visible entry.
    const links = within(sidebar).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.querySelector('svg')).not.toBeNull();
    }
  });
});
