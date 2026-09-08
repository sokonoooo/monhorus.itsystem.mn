import { PERMISSIONS, type PaginatedData } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { auditService, type AuditEntryDto } from '../../services/audit.service';
import { renderWithAuth } from '../../test/render';
import { AuditLogPage } from './AuditLogPage';
import {
  ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  ENTITY_LABELS,
  actionLabel,
} from './audit-vocabulary';

function makeEntry(overrides: Partial<AuditEntryDto> = {}): AuditEntryDto {
  return {
    id: 'a1',
    entityType: 'Employee',
    entityId: '507f1f77bcf86cd799439011',
    action: 'StatusChanged',
    actorId: 'u1',
    actorName: 'Ерөнхий админ',
    actorRole: 'head_admin',
    channel: null,
    ip: '::1',
    userAgent: 'vitest',
    oldValue: { status: 'DRAFT' },
    newValue: { status: 'ACTIVE' },
    changedFields: ['status'],
    reason: 'Гэрээ баталгаажсан',
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePage(items: AuditEntryDto[]): PaginatedData<AuditEntryDto> {
  return { items, page: 1, limit: 25, total: items.length, totalPages: 1 };
}

describe('AuditLogPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(auditService, 'facets').mockResolvedValue({
      entityTypes: ['Employee', 'Customer'],
      actions: ['Created', 'StatusChanged'],
    });
  });

  it('shows a loading state before data arrives', () => {
    vi.spyOn(auditService, 'list').mockReturnValue(new Promise(() => undefined));

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    expect(screen.getByRole('status', { name: 'Ачааллаж байна' })).toBeInTheDocument();
  });

  it('renders entries with translated action and entity labels', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(makePage([makeEntry()]));

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    expect(await screen.findByText('Ерөнхий админ')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Төлөв өөрчилсөн')).toBeInTheDocument();
    expect(within(table).getByText('Ажилтан')).toBeInTheDocument();
    expect(within(table).getByText('Гэрээ баталгаажсан')).toBeInTheDocument();
  });

  /**
   * Row numbers only mean something if they are continuous: asked to "check entry 26",
   * a reader must find it as row 26 on page two, not as row 1 all over again.
   */
  it('numbers page two from 26 rather than restarting at 1', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue({
      ...makePage([makeEntry()]),
      page: 2,
      total: 26,
      totalPages: 2,
    });

    renderWithAuth(<AuditLogPage />, {
      permissions: [PERMISSIONS.AUDIT_VIEW],
      route: '/audit?page=2',
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    const firstRow = within(table).getAllByRole('row')[1]!;
    expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent(/^26$/);
  });

  it('shows an empty state when there is nothing logged', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    expect(await screen.findByText('Бүртгэл олдсонгүй')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    vi.spyOn(auditService, 'list').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
  });

  it('offers no delete action anywhere, since the log is append-only', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(makePage([makeEntry()]));
    const user = userEvent.setup();

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    await screen.findByText('Ерөнхий админ');
    expect(screen.queryByRole('button', { name: /Устгах/ })).not.toBeInTheDocument();

    // The row menu holds every action the log offers, and deletion is not among them.
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    expect(screen.queryByRole('menuitem', { name: /Устгах/ })).not.toBeInTheDocument();
  });

  /**
   * The withheld-rows notice moved to the Help panel. The log itself now says nothing about
   * it either way, which is the point of the change: the page carries records, not caveats.
   */
  it('carries no salary notice on the page, with or without the permission', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(makePage([makeEntry()]));

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    await screen.findByRole('table');
    expect(
      screen.queryByText(/Цалинтай холбоотой бүртгэлийг харахын тулд/),
    ).not.toBeInTheDocument();
  });

  it('omits the salary notice when the permission is held', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(makePage([makeEntry()]));

    renderWithAuth(<AuditLogPage />, {
      permissions: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.EMPLOYEE_VIEW_SALARY],
    });

    await screen.findByText('Ерөнхий админ');
    expect(
      screen.queryByText(/Цалинтай холбоотой бүртгэлийг харахын тулд/),
    ).not.toBeInTheDocument();
  });

  /**
   * THE RANGE IS AN ULAANBAATAR DAY, NOT A UTC ONE.
   *
   * `<input type="date">` holds a bare `yyyy-mm-dd`, and this page sent it through
   * untouched. The backend reads it with `new Date(...)`, which is UTC midnight — 08:00 in
   * Ulaanbaatar. So `Эхлэх = Дуусах = the same day` collapsed `$gte` and `$lte` onto one
   * instant and a day full of activity rendered «Шүүлтүүрт тохирох бүртгэл алга»: the screen
   * stating there was no activity when there was. `businessDayStart`/`businessDayEnd` are
   * what the reports and inspections screens already use for exactly this.
   */
  it('frames a single-day filter on the whole Ulaanbaatar day', async () => {
    const list = vi.spyOn(auditService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<AuditLogPage />, {
      permissions: [PERMISSIONS.AUDIT_VIEW],
      route: '/audit?from=2026-09-07&to=2026-09-07',
    });

    await waitFor(() => expect(list).toHaveBeenCalled());
    const query = list.mock.calls[0]![0]!;
    expect(query.from).toBe('2026-09-06T16:00:00.000Z');
    expect(query.to).toBe('2026-09-07T15:59:59.999Z');

    // A window, not an instant: the two ends of one chosen day must not coincide.
    expect(query.from).not.toBe(query.to);
  });

  /**
   * The two records the old range dropped: the ones nearest each edge of the chosen days.
   */
  it('includes records at both edges of the chosen days', async () => {
    const list = vi.spyOn(auditService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<AuditLogPage />, {
      permissions: [PERMISSIONS.AUDIT_VIEW],
      route: '/audit?from=2026-09-01&to=2026-09-07',
    });

    await waitFor(() => expect(list).toHaveBeenCalled());
    const query = list.mock.calls[0]![0]!;

    // 00:30 on 1 September in Ulaanbaatar, and 23:30 on the 7th.
    const firstMorning = Date.parse('2026-08-31T16:30:00.000Z');
    const lastEvening = Date.parse('2026-09-07T15:30:00.000Z');

    expect(Date.parse(query.from!)).toBeLessThanOrEqual(firstMorning);
    expect(Date.parse(query.to!)).toBeGreaterThanOrEqual(lastEvening);

    // And nothing from the day either side.
    expect(Date.parse(query.from!)).toBeGreaterThan(Date.parse('2026-08-31T15:30:00.000Z'));
    expect(Date.parse(query.to!)).toBeLessThan(Date.parse('2026-09-07T16:30:00.000Z'));
  });

  /** The inputs still hold the calendar date the reader picked, not the instant sent. */
  it('keeps the date inputs showing the plain calendar dates', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<AuditLogPage />, {
      permissions: [PERMISSIONS.AUDIT_VIEW],
      route: '/audit?from=2026-09-07&to=2026-09-07',
    });

    expect(await screen.findByLabelText('Эхлэх')).toHaveValue('2026-09-07');
    expect(screen.getByLabelText('Дуусах')).toHaveValue('2026-09-07');
  });

  it('shows before and after values in the detail drawer', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(makePage([makeEntry()]));
    const user = userEvent.setup();

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Дэлгэрэнгүй' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Өмнөх утга')).toBeInTheDocument();
    expect(within(dialog).getByText('Шинэ утга')).toBeInTheDocument();
    expect(within(dialog).getByText(/DRAFT/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ACTIVE/)).toBeInTheDocument();
  });
});

/**
 * NOTHING ON THIS SCREEN IS PRINTED IN ENGLISH.
 *
 * The two label maps covered 24 of the backend's 34 actions and 9 of its 20 entity types,
 * with `?? row.action` behind them — so ten actions and eleven entity types reached a
 * Mongolian screen as raw wire tokens, and the whole `INSPECTION_REPORT_*` chain was among
 * them. An auditor read `INSPECTION_REPORT_FINALISED` in the same column as «Тайлан
 * баталсан» with nothing to say the two concerned different documents.
 */
describe('AuditLogPage - the vocabulary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(auditService, 'facets').mockResolvedValue({ entityTypes: [], actions: [] });
  });

  /** The two the audit named by name. */
  it('names the inspection report approval chain in Mongolian', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(
      makePage([
        makeEntry({
          action: 'INSPECTION_REPORT_FINALISED',
          entityType: 'InspectionReport',
        }),
      ]),
    );

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).queryByText('INSPECTION_REPORT_FINALISED')).not.toBeInTheDocument();
    expect(within(table).queryByText('InspectionReport')).not.toBeInTheDocument();
    expect(within(table).getByText('Үзлэгийн тайлан эцэслэсэн')).toBeInTheDocument();
    expect(within(table).getByText('Үзлэгийн тайлан')).toBeInTheDocument();
  });

  /** The rows anybody investigating a compromised account comes here to read. */
  it('names both password reset actions, and names them apart', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(
      makePage([
        makeEntry({ id: 'a1', action: 'PasswordResetRequested', entityType: 'User' }),
        makeEntry({ id: 'a2', action: 'PasswordResetCompleted', entityType: 'User' }),
      ]),
    );

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    const table = await screen.findByRole('table');
    const requested = within(table).getByText(actionLabel('PasswordResetRequested'));
    const completed = within(table).getByText(actionLabel('PasswordResetCompleted'));
    // A request that was never completed is the signal worth spotting; two rows reading the
    // same words would hide it.
    expect(requested.textContent).not.toBe(completed.textContent);
  });

  /**
   * Every action and every entity type, not just the ones somebody thought to add. A
   * Latin letter in a label is the exact shape of the original defect.
   */
  it('has a Mongolian label for every action and entity type it knows about', () => {
    const latin = /[A-Za-z]/;

    for (const action of AUDIT_ACTIONS) {
      const label = ACTION_LABELS[action];
      expect(label, `no label for ${action}`).toBeTruthy();
      // «Token дахин ашиглалт» keeps the English word because that is what the concept is
      // called in this product; nothing else may.
      if (action !== 'TokenReuseDetected') {
        expect(latin.test(label), `${action} still reads as English: ${label}`).toBe(false);
      }
    }

    for (const entityType of AUDIT_ENTITY_TYPES) {
      const label = ENTITY_LABELS[entityType];
      expect(label, `no label for ${entityType}`).toBeTruthy();
      // «Role/Permission» is likewise the product's own word for it.
      if (entityType !== 'Permission') {
        expect(latin.test(label), `${entityType} still reads as English: ${label}`).toBe(false);
      }
    }
  });

  /**
   * THE GUARD THE TYPE SYSTEM CANNOT PROVIDE HERE.
   *
   * `AUDIT_ACTIONS` is declared in the backend and again in `audit-vocabulary.ts`, because
   * the catalogue is not in `packages/shared` and this change did not own that package. The
   * compiler can see a label missing from the web tuple; nothing can see the web tuple
   * falling behind the backend's — which is how ten actions went unlabelled in the first
   * place. So the two lists are compared here, by reading the backend's own file.
   *
   * READING ANOTHER PACKAGE'S SOURCE IN A TEST IS NOT A PATTERN TO COPY. It is a stopgap
   * with a specific expiry: move `AUDIT_ACTIONS` into `packages/shared`, import it in
   * `audit-vocabulary.ts`, and delete both this test and the tuple it guards.
   */
  it('carries the same action catalogue the backend writes', async () => {
    const { default: source } = await import(
      '../../../../backend/src/modules/audit/audit-log.model.ts?raw'
    );

    const block = /export const AUDIT_ACTIONS = \[([\s\S]*?)\] as const;/.exec(source);
    expect(block, 'AUDIT_ACTIONS not found in the backend model').not.toBeNull();
    const fromBackend = [...block![1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]);

    expect([...AUDIT_ACTIONS]).toEqual(fromBackend);
  });
});
