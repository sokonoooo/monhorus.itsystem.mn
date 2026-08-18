import {
  NOTIFICATION_CHANNEL_UNAPPROVED_NOTE,
  NOTIFICATION_EVENT_LABELS,
  type NotificationDto,
  type NotificationSeverity,
  type PaginatedData,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Pagination } from '../../components/ui/DataTable';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { publishUnreadCountChanged } from '../../lib/unread-notifications';
import { notificationService } from '../../services/report.service';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

const SEVERITY_STYLES: Record<NotificationSeverity, string> = {
  INFO: 'border-blue-300',
  WARNING: 'border-amber-400',
  CRITICAL: 'border-red-500',
};

const SEVERITY_DOTS: Record<NotificationSeverity, string> = {
  INFO: 'bg-blue-500',
  WARNING: 'bg-amber-500',
  CRITICAL: 'bg-red-600',
};

/**
 * In-app notification centre (requirements 14.3).
 *
 * The event and recipient table in 14.3 is complete, so every event here is transcribed
 * from it. What 14.3 never states is the delivery channel, and section 19.2 leaves it
 * open, so nothing is sent by email, SMS or push and the screen says so rather than
 * implying a delivery that never happens.
 */
/**
 * Notifications per page.
 *
 * Twenty, matching the lists elsewhere. The old fixed fifty was not a page size but a cap:
 * the fifty-first notification simply could not be reached.
 */
const NOTIFICATION_PAGE_SIZE = 20;

export function NotificationsPage(): ReactElement {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [data, setData] = useState<PaginatedData<NotificationDto> | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      /*
       * The count comes from the server, not from the rows on screen.
       *
       * It used to be derived as `data.items.filter(unread).length`, which counts one page.
       * On page 2 of a list whose unread items are all on page 1 that yields 0, and "mark all
       * read" — an action over the whole inbox — disables itself while the inbox is not empty.
       * The same arithmetic also disagreed with the header badge, which has always polled
       * /unread-count, so the two numbers on one screen could differ.
       *
       * Both requests are issued together: the count is part of loading the page, not a
       * follow-up to it.
       */
      const [listed, counted] = await Promise.all([
        notificationService.list({
          page,
          limit: NOTIFICATION_PAGE_SIZE,
          ...(unreadOnly ? { unreadOnly: true } : {}),
        }),
        notificationService.unreadCount(),
      ]);
      setData(listed);
      setUnread(counted.unread);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Мэдэгдэл ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [unreadOnly, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleMarkAll(): Promise<void> {
    setMarking(true);
    try {
      const result = await notificationService.markAllRead();
      notify(`${result.updated} мэдэгдэл уншсан болголоо.`, 'success');
      // Announced after the server confirms, so the bell refetches a count that is real.
      publishUnreadCountChanged();
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Гүйцэтгэж чадсангүй.', 'error');
    } finally {
      setMarking(false);
    }
  }

  async function handleOpen(row: NotificationDto): Promise<void> {
    // Reading is recorded before navigating away, so the badge is right when the user
    // comes back. A failure here must not block the navigation.
    if (row.readAt === null) {
      try {
        await notificationService.markRead(row.id);
        publishUnreadCountChanged();
      } catch {
        // Intentionally ignored: the link still works and the row can be marked later.
      }
    }
    if (row.linkPath) navigate(row.linkPath);
    else await load();
  }

  return (
    <>
      <PageHeader
        title="Мэдэгдэл"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Мэдэгдэл' }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => {
                // Back to the first page: page three of "all" is rarely page three of
                // "unread only", and is usually past its end.
                setPage(1);
                setUnreadOnly((current) => !current);
              }}>
              {unreadOnly ? 'Бүгдийг харах' : 'Зөвхөн уншаагүй'}
            </Button>
            <Button onClick={() => void handleMarkAll()} loading={marking} disabled={unread === 0}>
              Бүгдийг уншсан болгох
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <Alert variant="info">{NOTIFICATION_CHANNEL_UNAPPROVED_NOTE}</Alert>
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : error ? (
        <ErrorState description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Мэдэгдэл алга"
          description={unreadOnly ? 'Уншаагүй мэдэгдэл байхгүй.' : 'Одоогоор мэдэгдэл ирээгүй.'}
        />
      ) : (
        <ul className="space-y-2">
          {data.items.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => void handleOpen(row)}
                className={`flex w-full items-start gap-3 rounded-xl border-l-4 bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 ${
                  SEVERITY_STYLES[row.severity]
                } ${row.readAt === null ? '' : 'opacity-70'}`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    row.readAt === null ? SEVERITY_DOTS[row.severity] : 'bg-slate-300'
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{row.title}</span>
                  {row.body && <span className="mt-0.5 block text-xs text-slate-600">{row.body}</span>}
                  <span className="mt-1 block text-xs text-slate-500">
                    {NOTIFICATION_EVENT_LABELS[row.event]} · {formatDateTime(row.createdAt)}
                    {row.readAt === null ? '' : ' · уншсан'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        A card list rather than a table, so it takes the pager but no № column: a running
        number against a notification is not something a reader ever refers to, where a
        row of a report genuinely is.
      */}
      {!loading && error === null && data !== null && (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          onPageChange={setPage}
        />
      )}
    </>
  );
}
