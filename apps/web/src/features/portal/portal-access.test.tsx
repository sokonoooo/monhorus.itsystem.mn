import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerOnly } from '../../App';
import { AppShell } from '../../components/layout/AppShell';
import { PermissionGuard } from '../../components/PermissionGuard';
import { homePathFor, resolvePostLoginPath } from '../../lib/home-path';
import { portalService } from '../../services/portal.service';
import { notificationService } from '../../services/report.service';
import { makePage } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { PortalHomePage } from './PortalHomePage';

/**
 * The CUSTOMER access flow, driven through the real guards.
 *
 * These mount the SAME components the router mounts — `AppShell`, `PermissionGuard` — with
 * a customer's actual permission set, rather than asserting against a description of the
 * rules. The portal being reachable and the staff area not are then two results of one
 * mechanism.
 */

/** The shipped CUSTOMER grant, `SYSTEM_ROLE_DEFAULT_PERMISSIONS.CUSTOMER`. */
const CUSTOMER_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PORTAL_PROJECT_VIEW,
  PERMISSIONS.PORTAL_BUILDING_VIEW,
  PERMISSIONS.PORTAL_FLOOR_VIEW,
  PERMISSIONS.PORTAL_OBJECT_VIEW,
  PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
  PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE,
  PERMISSIONS.PORTAL_PROFILE_VIEW,
  PERMISSIONS.PORTAL_PLANNED_WORK_VIEW,
  PERMISSIONS.PORTAL_PLANNED_WORK_CREATE,
  PERMISSIONS.NOTIFICATION_VIEW,
];

const CUSTOMER_IDENTITY = {
  customerId: '507f1f77bcf86cd799439011',
  customerName: 'Central Tower ХХК',
};

function renderAsCustomer(ui: Parameters<typeof renderWithAuth>[0], route = '/portal') {
  return renderWithAuth(ui, {
    permissions: CUSTOMER_PERMISSIONS,
    role: 'customer',
    user: CUSTOMER_IDENTITY,
    route,
  });
}

describe('where signing in lands you', () => {
  it('sends a customer to the portal and everyone else to the dashboard', () => {
    expect(homePathFor('customer')).toBe('/portal');
    expect(homePathFor('technician')).toBe('/dashboard');
    expect(homePathFor('admin')).toBe('/dashboard');
    expect(homePathFor('head_admin')).toBe('/dashboard');
  });

  /** Null is the mid-restore state; answering /portal there would bounce every staff member. */
  it('falls back to the dashboard when the role is not yet known', () => {
    expect(homePathFor(null)).toBe('/dashboard');
    expect(homePathFor(undefined)).toBe('/dashboard');
  });

  /**
   * A customer's browser is very often sitting on /dashboard — it is where they land
   * before a portal exists — so honouring `from` blindly would send them straight back to
   * the one screen certain to refuse them.
   */
  it('does not restore a customer to a staff deep link', () => {
    expect(resolvePostLoginPath('customer', '/dashboard')).toBe('/portal');
    expect(resolvePostLoginPath('customer', '/employees')).toBe('/portal');
    expect(resolvePostLoginPath('customer', '/service-requests/abc')).toBe('/portal');
  });

  it('still honours a deep link a customer can reach', () => {
    expect(resolvePostLoginPath('customer', '/portal/requests/abc')).toBe('/portal/requests/abc');
    expect(resolvePostLoginPath('customer', '/notifications')).toBe('/notifications');
  });

  it('keeps staff out of the portal, which no staff account can hold a key for', () => {
    expect(resolvePostLoginPath('admin', '/portal/sites')).toBe('/dashboard');
    expect(resolvePostLoginPath('admin', '/employees')).toBe('/employees');
  });

  /** `from` is a path, never a URL. `//host` is the one that slips past a naive check. */
  it('ignores anything that is not an in-app path', () => {
    expect(resolvePostLoginPath('customer', 'https://evil.example/x')).toBe('/portal');
    expect(resolvePostLoginPath('admin', '//evil.example')).toBe('/dashboard');
    expect(resolvePostLoginPath('admin', '/login')).toBe('/dashboard');
  });
});

describe('a CUSTOMER inside the shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 0 });
    vi.spyOn(portalService, 'listRequests').mockResolvedValue(makePage([]));
  });

  it('gets a sidebar with its own entries instead of an empty one', async () => {
    renderAsCustomer(<AppShell>aguulga</AppShell>);

    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
    expect(within(sidebar).getByText('Нүүр')).toBeInTheDocument();
    expect(within(sidebar).getByText('Миний хүсэлт')).toBeInTheDocument();
    expect(within(sidebar).getByText('Миний барилга')).toBeInTheDocument();
  });

  /**
   * Asserted on destinations rather than labels. «Төлөвлөгөөт ажил» names the staff
   * planned-work module AND the customer's own portal entry, so a label assertion here
   * fails on the legitimate portal entry while still passing if a real staff module leaked
   * in under a different name. The href is what actually distinguishes them.
   */
  it('is shown none of the staff modules', async () => {
    renderAsCustomer(<AppShell>агуулга</AppShell>);

    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
    const destinations = within(sidebar)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '');

    for (const href of destinations) {
      expect(href === '/portal' || href.startsWith('/portal/')).toBe(true);
    }
  });

  it('is not told it is looking at an admin console', async () => {
    renderAsCustomer(<AppShell>aguulga</AppShell>);

    expect(await screen.findByText('Харилцагчийн хэсэг')).toBeInTheDocument();
    expect(screen.queryByText('Админ самбар')).not.toBeInTheDocument();
  });

  it('reaches the portal home through the real permission guard', async () => {
    renderAsCustomer(
      <PermissionGuard
        anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW, PERMISSIONS.PORTAL_BUILDING_VIEW]}
      >
        <PortalHomePage />
      </PermissionGuard>,
    );

    expect(await screen.findByText('Сайн байна уу, Central Tower ХХК')).toBeInTheDocument();
    expect(screen.queryByText('Хандах эрхгүй')).not.toBeInTheDocument();
  });
});

describe('the staff boundary holds against a CUSTOMER', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 0 });
  });

  /**
   * One case per module, driven through `PermissionGuard` with the route's own `anyOf`
   * list. A customer holds no staff key, so each must refuse — and refuse by rendering the
   * forbidden panel, which is this app's established behaviour.
   */
  const STAFF_ROUTES: ReadonlyArray<{ name: string; anyOf: readonly PermissionKey[] }> = [
    { name: 'dashboard', anyOf: [PERMISSIONS.DASHBOARD_VIEW] },
    { name: 'employees', anyOf: [PERMISSIONS.EMPLOYEE_VIEW] },
    { name: 'customers', anyOf: [PERMISSIONS.CUSTOMER_VIEW] },
    { name: 'dispatch board', anyOf: [PERMISSIONS.DISPATCH_VIEW] },
    { name: 'planned work', anyOf: [PERMISSIONS.PLANNED_WORK_VIEW] },
    { name: 'staff service requests', anyOf: [PERMISSIONS.SERVICE_REQUEST_VIEW] },
    { name: 'invoices', anyOf: [PERMISSIONS.INVOICE_VIEW] },
    { name: 'reports', anyOf: [PERMISSIONS.REPORT_VIEW] },
    { name: 'audit log', anyOf: [PERMISSIONS.AUDIT_VIEW] },
    { name: 'settings', anyOf: [PERMISSIONS.SETTINGS_VIEW] },
    { name: 'access administration', anyOf: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.USER_VIEW] },
  ];

  for (const route of STAFF_ROUTES) {
    it(`refuses ${route.name}`, async () => {
      renderAsCustomer(
        <PermissionGuard anyOf={route.anyOf}>
          <p>Staff content</p>
        </PermissionGuard>,
      );

      expect(await screen.findByText('Хандах эрхгүй')).toBeInTheDocument();
      expect(screen.queryByText('Staff content')).not.toBeInTheDocument();
    });
  }

  /**
   * The staff planned-work module in particular: a customer ASKS for scheduled maintenance
   * through a request, and must not reach the module that fulfils it.
   */
  it('does not let the portal key open a staff screen', async () => {
    renderAsCustomer(
      <PermissionGuard anyOf={[PERMISSIONS.PLANNED_WORK_CREATE]}>
        <p>Staff content</p>
      </PermissionGuard>,
    );

    expect(await screen.findByText('Хандах эрхгүй')).toBeInTheDocument();
  });
});

describe('the portal boundary holds against staff', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 0 });
  });

  /**
   * Symmetry, and it costs nothing: the RBAC assignment chokepoint refuses a portal key on
   * a staff tier, so an admin can never hold one and the portal is closed to them by the
   * same guard — with no role branch anywhere.
   */
  it('shows an admin no portal entries', async () => {
    renderWithAuth(<AppShell>aguulga</AppShell>, {
      permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.SERVICE_REQUEST_VIEW],
      role: 'admin',
    });

    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
    expect(within(sidebar).queryByText('Миний хүсэлт')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Миний барилга')).not.toBeInTheDocument();
    expect(within(sidebar).getByText('Хяналтын самбар')).toBeInTheDocument();
  });
});

/** Every sidebar destination under /portal, however it is labelled. */
function portalLinks(sidebar: HTMLElement): string[] {
  return within(sidebar)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => href === '/portal' || href.startsWith('/portal/'));
}

describe('the portal stays out of the admin console', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 0 });
  });

  /**
   * THE CASE THE ORIGINAL DESIGN GOT WRONG. The portal section was gated on `portal.*`
   * permissions alone, on the assumption that no staff account can hold one. It can:
   * SYSTEM_ADMIN is resynchronised to the WHOLE catalogue on every boot and `head_admin` is
   * an unconditional superuser in `resolveEffectivePermissions`. Both therefore hold every
   * portal key, and both were shown the customer menu inside the admin console.
   *
   * This asserts on hrefs rather than labels deliberately — «Төлөвлөгөөт ажил» is the label
   * of the staff planned-work entry AND the portal one, so a text assertion here passes on
   * the staff entry and proves nothing.
   */
  const SUPERUSER_PERMISSIONS: readonly PermissionKey[] = [
    ...CUSTOMER_PERMISSIONS,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.PLANNED_WORK_VIEW,
  ];

  it.each(['head_admin', 'admin', 'technician'] as const)(
    'gives a %s no portal entries even holding every portal key',
    async (role) => {
      renderWithAuth(<AppShell>агуулга</AppShell>, {
        permissions: SUPERUSER_PERMISSIONS,
        role,
        route: '/dashboard',
      });

      const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
      expect(portalLinks(sidebar)).toEqual([]);
      // Their own menu is untouched — this hides the portal, not the staff modules.
      expect(within(sidebar).getByRole('link', { name: 'Төлөвлөгөөт ажил' })).toHaveAttribute(
        'href',
        '/planned-work',
      );
    },
  );

  /**
   * The guard on the routes themselves, so a typed /portal URL is refused too — hiding a
   * menu entry is not access control. `CustomerOnly` is what `PortalPage` wraps every
   * portal route in, so this is the same code path the router takes.
   */
  it.each(['head_admin', 'admin', 'technician'] as const)(
    'refuses a %s the portal routes themselves',
    async (role) => {
      const listRequests = vi
        .spyOn(portalService, 'listRequests')
        .mockResolvedValue(makePage([]));

      renderWithAuth(
        <CustomerOnly>
          <PortalHomePage />
        </CustomerOnly>,
        { permissions: SUPERUSER_PERMISSIONS, role, route: '/portal' },
      );

      expect(await screen.findByText('Хандах эрхгүй')).toBeInTheDocument();
      // Refused before the screen mounts, so no customer data is fetched.
      expect(listRequests).not.toHaveBeenCalled();
    },
  );

  it('still shows a customer their own portal entries', async () => {
    vi.spyOn(portalService, 'listRequests').mockResolvedValue(makePage([]));

    renderAsCustomer(<AppShell>агуулга</AppShell>);

    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
    expect(portalLinks(sidebar)).toEqual([
      '/portal',
      '/portal/requests',
      '/portal/planned-work',
      '/portal/sites',
    ]);
  });
});

describe('which sidebar entry reads as the current page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 0 });
    vi.spyOn(portalService, 'listRequests').mockResolvedValue(makePage([]));
  });

  /** react-router marks the current entry with aria-current. */
  async function currentEntries(route: string): Promise<string[]> {
    renderWithAuth(<AppShell>агуулга</AppShell>, {
      permissions: CUSTOMER_PERMISSIONS,
      role: 'customer',
      user: CUSTOMER_IDENTITY,
      route,
    });
    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
    return within(sidebar)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.getAttribute('href') ?? '');
  }

  /**
   * `/portal` is a strict prefix of every other portal entry, and NavLink matches nested
   * paths by default — so each portal page lit its own entry AND «Нүүр», and the sidebar
   * claimed two current pages at once.
   */
  it.each(['/portal/requests', '/portal/planned-work', '/portal/sites'])(
    'marks only %s, never also the portal home',
    async (route) => {
      expect(await currentEntries(route)).toEqual([route]);
    },
  );

  it('marks the home entry on the portal home itself', async () => {
    expect(await currentEntries('/portal')).toEqual(['/portal']);
  });

  /**
   * The other half of the rule: an entry with no menu item beneath it keeps matching its
   * own deeper routes, so a customer three levels into a building still sees which section
   * they are in. Fixing the duplicate must not cost that.
   */
  it('keeps the section lit on a deeper route beneath it', async () => {
    expect(await currentEntries('/portal/sites/b1/floors/f1')).toEqual(['/portal/sites']);
  });
});
