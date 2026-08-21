import {
  PERMISSIONS,
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  type PermissionKey,
  type UserRole,
} from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WithinTier } from '../App';
import { AppShell } from '../components/layout/AppShell';
import { PermissionGuard } from '../components/PermissionGuard';
import { notificationService } from '../services/report.service';
import { renderWithAuth } from '../test/render';

/**
 * The four back-office modules the TECHNICIAN tier is not given on the web.
 *
 * Driven through the real guards — `AppShell` for the menu, `WithinTier` for the route —
 * with the permission set a technician ACTUALLY holds, so the sidebar being empty of these
 * entries and the URLs being refused are two results of one mechanism rather than two
 * assertions about a description of it.
 */

const RESTRICTED: ReadonlyArray<{
  name: string;
  label: string;
  path: string;
  /** The route's own `anyOf`, copied from the `<Page>` that mounts it in App.tsx. */
  anyOf: readonly PermissionKey[];
}> = [
  { name: 'materials', label: 'Материалын жагсаалт', path: '/materials', anyOf: [PERMISSIONS.MATERIAL_VIEW] },
  {
    name: 'inspections',
    label: 'Үзлэг ба дүгнэлт',
    path: '/inspections',
    anyOf: [PERMISSIONS.OBJECT_MASTER_VIEW],
  },
  {
    name: 'object types',
    label: 'Тоноглолын төрөл',
    path: '/object-types',
    anyOf: [PERMISSIONS.OBJECT_MASTER_VIEW],
  },
  { name: 'reports', label: 'Тайлан', path: '/reports', anyOf: [PERMISSIONS.REPORT_VIEW] },
];

/**
 * A technician who holds EVERY key the four routes ask for.
 *
 * The shipped grant plus `report.view` — the one of the four keys the preset does not
 * carry, and which a team lead can be given from the access screen as a second role. The
 * point of granting it here is that no case below can pass for the wrong reason: if the
 * tier gate were removed, every one of these would let the technician straight through on
 * permissions alone.
 */
const TECHNICIAN_PERMISSIONS: readonly PermissionKey[] = [
  ...SYSTEM_ROLE_DEFAULT_PERMISSIONS.TECHNICIAN,
  PERMISSIONS.REPORT_VIEW,
];

/** Everything the four routes ask for, for the tiers that are meant to reach them. */
const BACK_OFFICE_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.MATERIAL_VIEW,
  PERMISSIONS.OBJECT_MASTER_VIEW,
  PERMISSIONS.REPORT_VIEW,
];

function sidebarLinks(sidebar: HTMLElement): string[] {
  return within(sidebar)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '');
}

async function renderSidebar(role: UserRole, permissions: readonly PermissionKey[]) {
  renderWithAuth(<AppShell>агуулга</AppShell>, { permissions, role, route: '/dashboard' });
  return screen.findByRole('navigation', { name: 'Үндсэн цэс' });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 0 });
});

/**
 * THE TEST THAT MUST NOT BE "FIXED" BY REVOKING A PERMISSION.
 *
 * `material.view` is how the employee mobile app reads the catalogue to record what a
 * sub-task consumed, and `object_master.view` backs its equipment and assessment screens.
 * Withdrawing either to empty the web sidebar would take the field app down with it, so
 * these two cases pin the grant in place from the web side.
 */
describe('what a TECHNICIAN still holds', () => {
  it('keeps the two keys the mobile app runs on', () => {
    expect(SYSTEM_ROLE_DEFAULT_PERMISSIONS.TECHNICIAN).toContain(PERMISSIONS.MATERIAL_VIEW);
    expect(SYSTEM_ROLE_DEFAULT_PERMISSIONS.TECHNICIAN).toContain(PERMISSIONS.OBJECT_MASTER_VIEW);
  });

  it('passes the permission gate on the very screens the tier closes', async () => {
    renderWithAuth(
      <PermissionGuard anyOf={[PERMISSIONS.MATERIAL_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]}>
        <p>Каталогийн агуулга</p>
      </PermissionGuard>,
      { permissions: TECHNICIAN_PERMISSIONS, role: 'technician', route: '/materials' },
    );

    // The permission filter is satisfied. Everything below is therefore the tier talking.
    expect(await screen.findByText('Каталогийн агуулга')).toBeInTheDocument();
  });
});

describe('the sidebar a TECHNICIAN is given', () => {
  it('lists none of the four, holding every key they ask for', async () => {
    const sidebar = await renderSidebar('technician', TECHNICIAN_PERMISSIONS);
    const destinations = sidebarLinks(sidebar);

    for (const module of RESTRICTED) {
      expect(destinations).not.toContain(module.path);
      expect(within(sidebar).queryByText(module.label)).not.toBeInTheDocument();
    }
  });

  /** All three of its entries are withheld, so the heading must go with them. */
  it('drops the Техникийн бүртгэл section rather than leaving an empty heading', async () => {
    const sidebar = await renderSidebar('technician', TECHNICIAN_PERMISSIONS);

    expect(within(sidebar).queryByText('Техникийн бүртгэл')).not.toBeInTheDocument();
  });

  /** This hides four modules, not the technician's own menu. */
  it('still shows the modules a technician works in', async () => {
    const sidebar = await renderSidebar('technician', TECHNICIAN_PERMISSIONS);

    expect(within(sidebar).getByRole('link', { name: 'Хяналтын самбар' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Үйлчилгээний хүсэлт' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Төсөл' })).toBeInTheDocument();
  });
});

describe('the routes themselves against a TECHNICIAN', () => {
  /**
   * Hiding a menu entry is not access control — a typed URL or a pasted link has to meet
   * the same answer. `WithinTier` is what `Page` wraps every in-shell route in, so this is
   * the code path the router takes.
   */
  for (const module of RESTRICTED) {
    it(`refuses ${module.name}`, async () => {
      renderWithAuth(
        <WithinTier>
          <PermissionGuard anyOf={module.anyOf}>
            <p>Модулийн агуулга</p>
          </PermissionGuard>
        </WithinTier>,
        { permissions: TECHNICIAN_PERMISSIONS, role: 'technician', route: module.path },
      );

      expect(await screen.findByText('Хандах эрхгүй')).toBeInTheDocument();
      expect(screen.queryByText('Модулийн агуулга')).not.toBeInTheDocument();
    });

    /** A child route of a restricted module is covered by the module's own declaration. */
    it(`refuses a path beneath ${module.name}`, async () => {
      renderWithAuth(
        <WithinTier>
          <p>Модулийн агуулга</p>
        </WithinTier>,
        {
          permissions: TECHNICIAN_PERMISSIONS,
          role: 'technician',
          route: `${module.path}/abc`,
        },
      );

      expect(await screen.findByText('Хандах эрхгүй')).toBeInTheDocument();
    });
  }

  /** The gate answers the path it is on, so an unrestricted route is untouched by it. */
  it('lets a technician through to a route that is not restricted', async () => {
    renderWithAuth(
      <WithinTier>
        <PermissionGuard anyOf={[PERMISSIONS.SERVICE_REQUEST_VIEW]}>
          <p>Хүсэлтийн жагсаалт</p>
        </PermissionGuard>
      </WithinTier>,
      { permissions: TECHNICIAN_PERMISSIONS, role: 'technician', route: '/service-requests' },
    );

    expect(await screen.findByText('Хүсэлтийн жагсаалт')).toBeInTheDocument();
  });
});

/**
 * The other half of the rule. A restriction that also caught the tiers the modules belong
 * to would be a far worse bug than the one it fixes, and `head_admin` in particular is an
 * unconditional superuser everywhere else in the system.
 */
describe.each(['admin', 'head_admin'] as const)('a %s is unaffected', (role) => {
  it('still sees all four in the sidebar', async () => {
    const sidebar = await renderSidebar(role, BACK_OFFICE_PERMISSIONS);
    const destinations = sidebarLinks(sidebar);

    for (const module of RESTRICTED) {
      expect(destinations).toContain(module.path);
    }
    expect(within(sidebar).getByText('Техникийн бүртгэл')).toBeInTheDocument();
  });

  for (const module of RESTRICTED) {
    it(`still reaches ${module.name}`, async () => {
      renderWithAuth(
        <WithinTier>
          <PermissionGuard anyOf={module.anyOf}>
            <p>Модулийн агуулга</p>
          </PermissionGuard>
        </WithinTier>,
        { permissions: BACK_OFFICE_PERMISSIONS, role, route: module.path },
      );

      expect(await screen.findByText('Модулийн агуулга')).toBeInTheDocument();
      expect(screen.queryByText('Хандах эрхгүй')).not.toBeInTheDocument();
    });
  }
});
