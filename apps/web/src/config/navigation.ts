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
  /**
   * Account tiers this entry is withheld from ON THE WEB, whatever permissions they hold.
   *
   * A DENY-LIST, deliberately, where `NavSection.tiers` next door is an ALLOW-LIST. The two
   * answer different questions and so fail in opposite directions on purpose:
   *
   *   - The portal section has a positively defined audience — it exists FOR the customer
   *     tier — so naming that tier is the whole truth about it. An allow-list is right.
   *   - These entries have no such audience. They are ordinary back-office modules whose
   *     audience is "whoever holds the key", minus one tier we are subtracting. Writing
   *     that as `tiers: ['admin', 'head_admin']` would restate the default for every tier
   *     that exists today in order to remove one, and then be wrong the moment a fifth
   *     tier is added: a dispatcher or a finance tier would be silently locked out of
   *     Тайлан by a list written before they existed, and the symptom — a module that is
   *     simply absent — is the hardest kind of bug to report or to find.
   *
   * The failure a deny-list chooses instead is that a future tier keeps SEEING a module it
   * perhaps should not. That is the better failure here for two reasons. It is visible:
   * someone says "why can I see this", which is a bug report, where the other direction
   * produces silence. And it is not a security hole — this is presentation only; the
   * permission filter beside it and the server's RBAC still decide what may actually be
   * read, and none of that is loosened by a menu entry being shown.
   *
   * The rule that `head_admin` sees everything is enforced in `isNavItemHiddenFrom` rather
   * than trusted to every list here, so no entry can withhold anything from the superuser
   * by omission.
   */
  hiddenFromTiers?: readonly UserRole[];
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

/**
 * The web surface a field technician is not given.
 *
 * WHY A TIER AND NOT A PERMISSION. The obvious way to hide Материалын жагсаалт from a
 * technician is to stop granting `material.view`, and it would be wrong: that key is what
 * lets the employee MOBILE app read the catalogue when recording what a sub-task consumed,
 * and `object_master.view` backs the same app's equipment and assessment screens. Both are
 * load-bearing in the field. What is being said here is narrower than "may not read this
 * data" — it is "does not work in the back office", which is a property of the tier, the
 * same question `resolveCustomerScope` asks of the customer tier on the server.
 *
 * So this must never be re-expressed as a permission change. A test in
 * `technician-scope.test.tsx` signs a technician in holding BOTH keys precisely so that
 * anyone who later "simplifies" this by revoking one fails a test instead of breaking the
 * mobile app.
 */
const HIDDEN_FROM_TECHNICIANS: readonly UserRole[] = ['technician'];

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
        key: 'materials',
        label: 'Материалын жагсаалт',
        path: '/materials',
        permissions: [PERMISSIONS.MATERIAL_VIEW],
        // A technician HOLDS `material.view` — the mobile app reads the catalogue with it —
        // so only the tier can withhold the back-office screen. See HIDDEN_FROM_TECHNICIANS.
        hiddenFromTiers: HIDDEN_FROM_TECHNICIANS,
        // CATALOGUE rather than an icon of its own: this is the same kind of thing as the
        // equipment-type list — reference data a form picks from — and a new glyph would
        // mean a new NavIcon member and a new case in NavGlyph for no gain in legibility.
        icon: 'CATALOGUE',
      },
      {
        key: 'inspections',
        label: 'Үзлэг ба дүгнэлт',
        path: '/inspections',
        permissions: [PERMISSIONS.OBJECT_MASTER_VIEW],
        // Same shape as Материалын жагсаалт: `object_master.view` is the key the mobile
        // app's assessment screens run on, so it cannot be taken away to close this page.
        hiddenFromTiers: HIDDEN_FROM_TECHNICIANS,
        icon: 'INSPECTION',
      },
      {
        // The product catalogue. Object instances are not a module: they are created on a
        // floor inside Төсөл, so there is deliberately no top-level entry for them.
        key: 'object-types',
        label: 'Тоноглолын төрөл',
        path: '/object-types',
        permissions: [PERMISSIONS.OBJECT_MASTER_VIEW],
        hiddenFromTiers: HIDDEN_FROM_TECHNICIANS,
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
        /*
          Belt and braces, and worth the line. The shipped TECHNICIAN preset holds no
          `report.*` key, so the permission filter already hides this — but that is a
          default a second role granted from the access screen can widen, and a technician
          who is also a team lead should still not be reading company-wide SLA and revenue
          figures in the back office. The tier says so independently of the grant.
        */
        hiddenFromTiers: HIDDEN_FROM_TECHNICIANS,
        icon: 'REPORT',
      },
      {
        key: 'invoices',
        label: 'Нэхэмжлэл ба төлбөр',
        path: '/invoices',
        permissions: [PERMISSIONS.INVOICE_VIEW],
        icon: 'INVOICE',
      },
      {
        // Customer satisfaction analytics. REPORT rather than a glyph of its own: this is
        // the same kind of thing as Тайлан — figures read, never edited — and a new icon
        // would mean a new NavIcon member and a new case in NavGlyph for no gain.
        key: 'surveys',
        label: 'Үйлчилгээний үнэлгээ',
        path: '/surveys',
        permissions: [PERMISSIONS.SURVEY_VIEW_RESULTS],
        icon: 'REPORT',
      },
    ],
  },
  {
    /*
      The service provider's own structure, which is master data the whole app selects
      from: an employee is filed under a company, a department and a position. It is
      deliberately its own section rather than part of Удирдлага, because it is edited by
      whoever owns the org chart and not by whoever owns access control.
    */
    key: 'org',
    label: 'Байгууллагын бүтэц',
    items: [
      {
        key: 'org-companies',
        label: 'Байгууллага',
        path: '/org/companies',
        permissions: [PERMISSIONS.ORG_VIEW],
        icon: 'CUSTOMER',
      },
      {
        key: 'org-departments',
        label: 'Хэлтэс',
        path: '/org/departments',
        permissions: [PERMISSIONS.ORG_VIEW],
        icon: 'CATALOGUE',
      },
      {
        key: 'org-positions',
        label: 'Албан тушаал',
        path: '/org/positions',
        permissions: [PERMISSIONS.ORG_VIEW],
        icon: 'EMPLOYEE',
      },
    ],
  },
  {
    key: 'administration',
    label: 'Удирдлага',
    items: [
      {
        key: 'access',
        label: 'Хэрэглэгчийн эрх',
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
        /*
          The survey question catalogue. Administration rather than Бизнес, because it is
          reference data an administrator maintains — the same kind of thing as the
          equipment-type registry — while the results it produces are read next door under
          Бизнес by a much wider audience.
        */
        key: 'survey-questions',
        label: 'Судалгааны асуулт',
        path: '/surveys/questions',
        permissions: [PERMISSIONS.SURVEY_MANAGE_QUESTIONS],
        icon: 'CATALOGUE',
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
  /*
   * A TAB, NOT A SIDEBAR ENTRY — for the reason the dispatch board is one.
   *
   * Taking open work is a way of WORKING the service-request queue rather than a separate
   * domain, so it belongs to that module exactly as the board does. A top-level sidebar
   * entry would also read as a second inbox sitting alongside "Үйлчилгээний хүсэлт", when
   * it is the same records under a different question.
   *
   * Reachable for the people it is for: the technician role holds `service_request.view`,
   * so the sidebar's request entry is already visible to them and this tab sits on it. The
   * two keys differ on purpose — a dispatcher who may view but not claim sees the module
   * without this tab, and SubNav hides a lone remaining tab rather than showing one.
   */
  {
    key: 'open',
    label: 'Нээлттэй ажил',
    path: '/service-requests/open',
    permissions: [PERMISSIONS.SERVICE_REQUEST_CLAIM],
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

/**
 * Is this entry withheld from the signed-in tier?
 *
 * The single place `hiddenFromTiers` is read, so the menu and the route gate cannot come to
 * different conclusions about the same entry — the property this whole file exists for.
 *
 * `head_admin` is answered here rather than in the lists: they are an unconditional
 * superuser in `resolveEffectivePermissions`, and the same must hold on the web surface, so
 * no deny-list can reach them however it is written. This does NOT touch `NavSection.tiers`
 * — that allow-list keeps the portal shut to a superuser on purpose, and a blanket bypass
 * would put the customer menu back inside the admin console.
 *
 * An unknown role — the mid-restore state, where `user` is still null — hides nothing. The
 * shell renders during session restore, and refusing on an unread role would flash the
 * forbidden panel at everyone before their own menu appeared.
 */
export function isNavItemHiddenFrom(item: NavItem, role: UserRole | null | undefined): boolean {
  if (!item.hiddenFromTiers || role == null || role === 'head_admin') return false;
  return item.hiddenFromTiers.includes(role);
}

/**
 * The same question for a URL, so a typed address is answered by the entry it belongs to.
 *
 * Prefix-matched through `navItemByPath`, which means a restricted module's child routes
 * are covered by its one declaration rather than needing their own. A path that belongs to
 * no menu entry is not restricted by anything here.
 */
export function isPathHiddenFrom(pathname: string, role: UserRole | null | undefined): boolean {
  const item = navItemByPath(pathname);
  return item ? isNavItemHiddenFrom(item, role) : false;
}
