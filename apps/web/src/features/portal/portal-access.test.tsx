import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('is shown none of the staff modules', async () => {
    renderAsCustomer(<AppShell>aguulga</AppShell>);

    const sidebar = await screen.findByRole('navigation', { name: 'Үндсэн цэс' });
    for (const label of [
      'Хяналтын самбар',
      'Ажилтан',
      'Харилцагч',
      'Төлөвлөгөөт ажил',
      'Үйлчилгээний хүсэлт',
      'Нэхэмжлэл ба төлбөр',
      'Audit log',
      'Тохиргоо',
      'Хэрэглэгч, role, permission',
    ]) {
      expect(within(sidebar).queryByText(label)).not.toBeInTheDocument();
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
