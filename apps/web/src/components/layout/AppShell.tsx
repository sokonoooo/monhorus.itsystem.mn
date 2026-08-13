import { PERMISSIONS, USER_ROLE_LABELS } from '@monhorus/shared';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import { NAVIGATION, TOP_NAV_ITEMS } from '../../config/navigation';
import { useAuth } from '../../contexts/auth-context';
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
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const { user, logout, canAny } = useAuth();
  const unread = useUnreadNotifications(canAny(PERMISSIONS.NOTIFICATION_VIEW));
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_STATE_KEY) === 'true',
  );
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const visibleSections = NAVIGATION
    // Tier first, then permissions. A section may be restricted to particular account
    // tiers — the portal is, because a superuser holds every portal key and would
    // otherwise be shown the customer menu inside the admin console.
    .filter((section) => !section.tiers || (user ? section.tiers.includes(user.role) : false))
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => item.permissions.length === 0 || canAny(...item.permissions),
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
              {TOP_NAV_ITEMS.filter((item) => canSee(item.permissions)).map((item) => {
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
      </div>
    </div>
  );
}
