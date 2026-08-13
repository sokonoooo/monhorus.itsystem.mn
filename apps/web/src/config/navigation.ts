import { PERMISSIONS, type PermissionKey, type UserRole } from '@monhorus/shared';

/**
 * Web Admin navigation.
 *
 * Three surfaces, all fed from this file so a route, a breadcrumb and a menu entry can
 * never disagree:
 *
 *   - NAVIGATION           the sidebar, grouped into sections
 *   - TOP_NAV_ITEMS        icon shortcuts in the header, for the cross-cutting views that
 *                          are consulted from everywhere rather than worked in
 *   - SERVICE_REQUEST_TABS tabs inside a module, for a screen that belongs to a parent
 *
 * There is no `implemented` flag. Every module resolves to a real screen, so a green and
 * grey dot per entry distinguished nothing and read as decoration; each entry carries an
 * icon that says what the module is for instead.
 *
 * `permissions` is an any-of list. An item with an empty list is always visible.
 */

/** Sidebar glyphs. One per module, so the icon carries the meaning the colour did not. */
export type NavIcon =
  | 'DASHBOARD'
  | 'EMPLOYEE'
  | 'CUSTOMER'
  | 'PROJECT'
  | 'PLANNED_WORK'
  | 'SERVICE_REQUEST'
  | 'INSPECTION'
  | 'CATALOGUE'
  | 'REPORT'
  | 'INVOICE'
  | 'ACCESS'
  | 'AUDIT'
  | 'SETTINGS'
  | 'CALENDAR'
  | 'BELL';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  permissions: readonly PermissionKey[];
  icon: NavIcon;
}

export interface NavSection {
  key: string;
  label: string | null;
  items: readonly NavItem[];
  /**
   * Restricts a section to particular account tiers, on top of the permission filter.
   *
   * NEEDED BECAUSE THE PERMISSION FILTER IS NOT ENOUGH FOR THE PORTAL. The portal section
   * was written on the assumption that no staff account can hold a `portal.*` key — true
   * of ADMIN, MANAGEMENT, DISPATCH and TECHNICIAN, and false of the two that matter:
   * SYSTEM_ADMIN is resynchronised to the WHOLE catalogue on every boot, and `head_admin`
   * is an unconditional superuser in `resolveEffectivePermissions`. Both therefore hold
   * every portal key and were shown the customer menu inside the admin console.
   *
   * A tier is the right question here rather than a workaround: the portal is the customer
   * tier's surface, and `resolveCustomerScope` decides whose records a request may touch
   * from `auth.role === 'customer'` on the server. Asking the same question in the menu
   * keeps the two consistent.
   */
  tiers?: readonly UserRole[];
}

export const NAVIGATION: readonly NavSection[] = [
  /**
   * The customer portal.
   *
   * Keyed on `portal.*`, which no staff account can hold — the RBAC assignment chokepoint
   * refuses a portal key on a staff tier and a staff key on a customer tier — so this
   * section is structurally invisible to staff and the staff sections structurally
   * invisible here. That is why both live in one list behind one permission filter rather
   * than behind a role branch: the permission set already separates them, and a branch
   * would be a second, weaker copy of a rule the server enforces.
   */
  {
    key: 'portal',
    label: null,
    // Customer accounts only. See `tiers` above for why the permission filter alone showed
    // this to a superuser.
    tiers: ['customer'],
    items: [
      {
        key: 'portal-home',
        label: 'Нүүр',
        path: '/portal',
        // Both keys, because the route is an any-of on the same pair. Listing one would
        // make the page reachable by URL and invisible in the menu to a caller holding the
        // other — the disagreement this file exists to prevent.
        permissions: [PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW, PERMISSIONS.PORTAL_BUILDING_VIEW],
        icon: 'DASHBOARD',
      },
      {
        key: 'portal-requests',
        label: 'Миний хүсэлт',
        path: '/portal/requests',
        permissions: [PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW],
        icon: 'SERVICE_REQUEST',
      },
      {
        key: 'portal-planned-work',
        label: 'Төлөвлөгөөт ажил',
        path: '/portal/planned-work',
        permissions: [PERMISSIONS.PORTAL_PLANNED_WORK_VIEW],
        icon: 'PLANNED_WORK',
      },
      {
        key: 'portal-sites',
        label: 'Миний барилга',
        path: '/portal/sites',
        permissions: [PERMISSIONS.PORTAL_BUILDING_VIEW],
        icon: 'PROJECT',
      },
    ],
  },
  {
    key: 'overview',
    label: null,
    items: [
      {
        key: 'dashboard',
        label: 'Хяналтын самбар',
        path: '/dashboard',
        permissions: [PERMISSIONS.DASHBOARD_VIEW],
        icon: 'DASHBOARD',
      },
    ],
  },
  {
    key: 'operations',
    label: 'Үйл ажиллагаа',
    items: [
      {
        key: 'employees',
        label: 'Ажилтан',
        path: '/employees',
        permissions: [PERMISSIONS.EMPLOYEE_VIEW],
        icon: 'EMPLOYEE',
      },
      {
        key: 'customers',
        label: 'Харилцагч',
        path: '/customers',
        permissions: [PERMISSIONS.CUSTOMER_VIEW],
        icon: 'CUSTOMER',
      },
      {
        key: 'projects',
        label: 'Төсөл',
        path: '/projects',
        permissions: [PERMISSIONS.OBJECT_VIEW],
        icon: 'PROJECT',
      },
      {
        key: 'planned-work',
        label: 'Төлөвлөгөөт ажил',
        path: '/planned-work',
        permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
        icon: 'PLANNED_WORK',
      },
      {
        key: 'service-requests',
        label: 'Үйлчилгээний хүсэлт',
        path: '/service-requests',
        permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
        icon: 'SERVICE_REQUEST',
      },
    ],
  },
  {
    key: 'technical',
    label: 'Техникийн бүртгэл',
    items: [
      {
        key: 'inspections',
        label: 'Үзлэг ба дүгнэлт',
        path: '/inspections',
        permissions: [PERMISSIONS.OBJECT_MASTER_VIEW],
        icon: 'INSPECTION',
      },
      {
        // The product catalogue. Object instances are not a module: they are created on a
        // floor inside Төсөл, so there is deliberately no top-level entry for them.
        key: 'object-types',
        label: 'Тоноглолын төрөл',
        path: '/object-types',
        permissions: [PERMISSIONS.OBJECT_MASTER_VIEW],
        icon: 'CATALOGUE',
      },
    ],
  },
  {
    key: 'business',
    label: 'Бизнес',
    items: [
      {
        key: 'reports',
        label: 'Тайлан',
        path: '/reports',
        permissions: [PERMISSIONS.REPORT_VIEW],
        icon: 'REPORT',
      },
      {
        key: 'invoices',
        label: 'Нэхэмжлэл ба төлбөр',
        path: '/invoices',
        permissions: [PERMISSIONS.INVOICE_VIEW],
        icon: 'INVOICE',
      },
    ],
  },
  {
    key: 'administration',
    label: 'Удирдлага',
    items: [
      {
        key: 'access',
        label: 'Хэрэглэгч, role, permission',
        path: '/access',
        permissions: [PERMISSIONS.RBAC_VIEW],
        icon: 'ACCESS',
      },
      {
        key: 'audit',
        label: 'Audit log',
        path: '/audit',
        permissions: [PERMISSIONS.AUDIT_VIEW],
        icon: 'AUDIT',
      },
      {
        key: 'settings',
        label: 'Тохиргоо',
        path: '/settings',
        permissions: [PERMISSIONS.SETTINGS_VIEW],
        icon: 'SETTINGS',
      },
    ],
  },
];

/**
 * Header icon shortcuts.
 *
 * Calendar and notifications are consulted from every module rather than being places you
 * work in, so they sit in the header instead of competing for sidebar space. They still
 * carry routes and permissions like any other entry.
 */
export type TopNavIcon = 'CALENDAR' | 'BELL';

export interface TopNavItem extends NavItem {
  icon: TopNavIcon;
}

export const TOP_NAV_ITEMS: readonly TopNavItem[] = [
  {
    key: 'calendar',
    label: 'Calendar',
    path: '/calendar',
    permissions: [PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.SERVICE_REQUEST_VIEW],
    icon: 'CALENDAR',
  },
  {
    key: 'notifications',
    label: 'Мэдэгдэл',
    path: '/notifications',
    permissions: [PERMISSIONS.NOTIFICATION_VIEW],
    icon: 'BELL',
  },
];

/**
 * Tabs inside a module.
 *
 * The dispatch board is a way of working the service-request queue rather than a separate
 * domain, so it is a tab of that module instead of its own sidebar entry.
 */
export interface SubNavItem {
  key: string;
  label: string;
  path: string;
  permissions: readonly PermissionKey[];
  /** True matches the exact path only; false keeps the tab active on child routes. */
  exact: boolean;
}

export const SERVICE_REQUEST_TABS: readonly SubNavItem[] = [
  {
    key: 'list',
    label: 'Хүсэлтийн жагсаалт',
    path: '/service-requests',
    permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    exact: true,
  },
  {
    key: 'dispatch',
    label: 'Dispatch board',
    path: '/service-requests/dispatch',
    permissions: [PERMISSIONS.DISPATCH_VIEW],
    exact: false,
  },
];

/**
 * Flat lookup used by the breadcrumb and the route table.
 *
 * Header items are included so their routes are still generated; only the sidebar
 * rendering distinguishes between the two surfaces.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  ...NAVIGATION.flatMap((section) => section.items),
  ...TOP_NAV_ITEMS,
];

export function navItemByPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
}
