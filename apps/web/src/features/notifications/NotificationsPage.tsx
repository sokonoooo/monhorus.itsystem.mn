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
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
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
export function NotificationsPage(): ReactElement {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [data, setData] = useState<PaginatedData<NotificationDto> | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(await notificationService.list({ limit: 50, ...(unreadOnly ? { unreadOnly: true } : {}) }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Мэдэгдэл ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleMarkAll(): Promise<void> {
    setMarking(true);
    try {
      const result = await notificationService.markAllRead();
      notify(`${result.updated} мэдэгдэл уншсан болголоо.`, 'success');
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
      } catch {
        // Intentionally ignored: the link still works and the row can be marked later.
      }
    }
    if (row.linkPath) navigate(row.linkPath);
    else await load();
  }

  const unread = data?.items.filter((row) => row.readAt === null).length ?? 0;

  return (
    <>
      <PageHeader
        title="Мэдэгдэл"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Мэдэгдэл' }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => setUnreadOnly((current) => !current)}>
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
    </>
  );
}
