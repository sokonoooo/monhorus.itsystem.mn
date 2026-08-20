import { PERMISSIONS, USER_ROLE_LABELS } from '@monhorus/shared';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import {
  NAVIGATION,
  TOP_NAV_ITEMS,
  isNavItemHiddenFrom,
  type NavSection,
} from '../../config/navigation';
import { useAuth } from '../../contexts/auth-context';
import { HelpPanel } from '../../features/help/HelpPanel';
import { HELP_CONTENT, resolveHelp } from '../../features/help/help-content';
import { onUnreadCountChanged } from '../../lib/unread-notifications';
import { notificationService } from '../../services/report.service';
import { NavGlyph } from './NavGlyph';
import { Button } from '../ui/Button';

const SIDEBAR_STATE_KEY = 'monhorus.sidebar.collapsed';

/**
 * Unread badge on the notification bell.
 *
 * Polled rather than pushed: section 19.2 leaves the delivery channel unapproved, so there
 * is no socket to subscribe to. The interval is deliberately slow, and the count is simply
 * absent when the caller may not read notifications.
 */
const UNREAD_POLL_MS = 60_000;

function useUnreadNotifications(enabled: boolean): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setUnread(0);
      return undefined;
    }

    let cancelled = false;
    const read = (): void => {
      void notificationService
        .unreadCount()
        .then((result) => {
          if (!cancelled) setUnread(result.unread);
        })
        .catch(() => undefined);
    };

    read();
    const timer = window.setInterval(read, UNREAD_POLL_MS);

    /*
     * The poll is the floor, not the only trigger. Marking notifications read elsewhere in
     * the app announces itself, and the badge re-asks immediately rather than sitting on a
     * stale number for up to a minute while the list beside it shows nothing unread.
     */
    const unsubscribe = onUnreadCountChanged(read);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [enabled]);

  return unread;
}

/**
 * Desktop backoffice shell: collapsible sidebar, top bar, and a content column.
 *
 * The sidebar filters itself by the caller's effective permissions, so a Санхүү user
 * never sees the dispatch entry. This is presentation only; each route is
 * independently guarded and the backend re-checks every request.
 */
/**
 * Nav paths that another nav entry sits underneath.
 *
 * `NavLink` matches nested routes by default, which is what a section entry wants — staff
 * «Төлөвлөгөөт ажил» should stay lit while you are three levels into a work. It is wrong
 * only where one MENU ITEM is a strict prefix of another: `/portal` is the parent of
 * `/portal/requests`, so every portal page lit two entries at once and the sidebar showed
 * two current pages.
 *
 * Derived from the menu rather than hardcoded, so an entry added under an existing one
 * cannot reintroduce this. Deep routes that are not menu entries are unaffected, which is
 * what keeps the staff behaviour intact.
 */
function exactMatchPaths(sections: readonly NavSection[]): Set<string> {
  const paths = sections.flatMap((section) => section.items.map((item) => item.path));
  return new Set(
    paths.filter((path) => paths.some((other) => other !== path && other.startsWith(`${path}/`))),
  );
}

export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const { user, logout, canAny } = useAuth();
  const unread = useUnreadNotifications(canAny(PERMISSIONS.NOTIFICATION_VIEW));
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_STATE_KEY) === 'true',
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  /*
    Help lives in the shell, not in each page, for two reasons: it is then impossible to
    ship a page that forgot its Help button, and it covers screens that render no header of
    their own - the not-found page among them. Resolution is by route, so the panel always
    describes the screen the reader is actually looking at.
  */
  const help = resolveHelp(HELP_CONTENT, location.pathname);

  // Navigating away closes it, otherwise the panel outlives the page it explains.
  useEffect(() => {
    setHelpOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STATE_KEY, String(collapsed));
  }, [collapsed]);

  // Any navigation closes the mobile drawer, otherwise it covers the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  /** Same any-of rule the sidebar uses, shared by the header shortcuts. */
  const canSee = (permissions: readonly string[]): boolean =>
    permissions.length === 0 || canAny(...(permissions as Parameters<typeof canAny>));

  // Computed from the whole menu, not the visible slice: whether an entry is a parent is a
  // property of the menu, and must not change because a permission hid its child.
  const exactPaths = exactMatchPaths(NAVIGATION);

  const visibleSections = NAVIGATION
    // Tier first, then permissions. A section may be restricted to particular account
    // tiers — the portal is, because a superuser holds every portal key and would
    // otherwise be shown the customer menu inside the admin console.
    .filter((section) => !section.tiers || (user ? section.tiers.includes(user.role) : false))
    .map((section) => ({
      ...section,
      // Then the same two questions per entry. An item may be withheld from a tier that
      // legitimately HOLDS its permission — a technician keeps `material.view` for the
      // mobile app and is still not given the back-office catalogue — so the tier check is
      // not something the permission filter could have covered. Sections left empty by it
      // are dropped by the filter below, exactly as an all-unpermitted section already was.
      items: section.items.filter(
        (item) =>
          (item.permissions.length === 0 || canAny(...item.permissions)) &&
          !isNavItemHiddenFrom(item, user?.role),
      ),
    }))
    .filter((section) => section.items.length > 0);

  const sidebarWidth = collapsed ? 'lg:w-16' : 'lg:w-64';

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Mobile scrim */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-slate-200 bg-white transition-transform duration-150 lg:translate-x-0 ${sidebarWidth} ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <span className="text-base font-bold tracking-tight text-slate-900">
            {collapsed ? 'M' : 'Monhorus'}
          </span>
          {!collapsed && (
            <span className="truncate text-xs text-slate-500">
              {/* A customer is not looking at an admin console, and telling them they are
                  is the first thing they read on the page. */}
              {user?.role === 'customer' ? 'Харилцагчийн хэсэг' : 'Админ самбар'}
            </span>
          )}
        </div>

        <nav
          aria-label="Үндсэн цэс"
          className="h-[calc(100vh-3.5rem)] overflow-y-auto px-2 py-3"
        >
          {visibleSections.map((section) => (
            <div key={section.key} className="mb-4">
              {section.label && !collapsed && (
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.key}>
                    <NavLink
                      to={item.path}
                      // Only where another entry is nested beneath this one — see above.
                      end={exactPaths.has(item.path)}
                      title={item.label}
                      className={({ isActive }) =>
                        // The active entry is marked three ways at once: filled
                        // background, a left rule and a tinted icon, so it stays obvious
                        // when the sidebar is collapsed to icons alone.
                        `relative flex items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors ${
                          collapsed ? 'justify-center px-0' : 'px-2'
                        } ${
                          isActive
                            ? 'bg-slate-900 font-medium text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && !collapsed && (
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-blue-400"
                            />
                          )}
                          <NavGlyph
                            icon={item.icon}
                            className={`h-[18px] w-[18px] shrink-0 ${
                              isActive ? 'text-blue-300' : 'text-slate-400'
                            }`}
                          />
                          {/* truncate protects the layout from long Mongolian labels */}
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        </nav>
      </aside>

      <div className={collapsed ? 'lg:pl-16' : 'lg:pl-64'}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Цэс нээх"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="hidden rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:block"
            aria-label={collapsed ? 'Цэс дэлгэх' : 'Цэс хураах'}
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M3 5h14v2H3V5zm0 4h9v2H3V9zm0 4h14v2H3v-2z" />
            </svg>
          </button>

          <div className="ml-auto flex items-center gap-3">
            {/*
              Cross-cutting shortcuts. Each is permission-gated exactly like a sidebar
              entry, so a caller who may not read either source never sees the calendar.
            */}
            <nav aria-label="Түргэн холбоос" className="flex items-center gap-1">
              {TOP_NAV_ITEMS.filter(
                (item) => canSee(item.permissions) && !isNavItemHiddenFrom(item, user?.role),
              ).map((item) => {
                const active = location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate(item.path)}
                    aria-label={item.label}
                    title={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={`relative rounded-md p-1.5 hover:bg-slate-100 ${
                      active ? 'bg-slate-100 text-blue-600' : 'text-slate-600'
                    }`}
                  >
                    <NavGlyph icon={item.icon} className="h-5 w-5" />
                    {item.icon === 'BELL' && unread > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/*
              Not permission-gated, unlike the shortcuts above it: the panel only explains
              the page the reader already reached, so it can reveal nothing their own
              permissions have not already shown them.
            */}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Тусламж"
              title="Тусламж"
              aria-haspopup="dialog"
              aria-expanded={helpOpen}
              className={`rounded-md p-1.5 hover:bg-slate-100 ${
                helpOpen ? 'bg-slate-100 text-blue-600' : 'text-slate-600'
              }`}
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.94 6.94a1.5 1.5 0 012.56 1.06c0 .5-.2.78-.79 1.25-.7.56-1.21 1.14-1.21 2.13v.12a.75.75 0 001.5 0c0-.5.2-.78.79-1.25.7-.56 1.21-1.14 1.21-2.13a3 3 0 00-5.12-2.12.75.75 0 101.06 1.06zM10 14.75a.9.9 0 100-1.8.9.9 0 000 1.8z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {user && (
              <div className="hidden text-right sm:block">
                <p className="max-w-[180px] truncate text-sm font-medium text-slate-900">
                  {user.fullName}
                </p>
                <p className="text-xs text-slate-500">{USER_ROLE_LABELS[user.role]}</p>
              </div>
            )}

            <Button size="sm" variant="secondary" onClick={() => void handleLogout()}>
              Гарах
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">{children}</main>

        <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} help={help} />
      </div>
    </div>
  );
}
