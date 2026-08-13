import { PERMISSIONS, type PaginatedData } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { auditService, type AuditEntryDto } from '../../services/audit.service';
import { renderWithAuth } from '../../test/render';
import { AuditLogPage } from './AuditLogPage';

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

  it('warns a caller without salary permission that some rows are withheld', async () => {
    vi.spyOn(auditService, 'list').mockResolvedValue(makePage([makeEntry()]));

    renderWithAuth(<AuditLogPage />, { permissions: [PERMISSIONS.AUDIT_VIEW] });

    expect(
      await screen.findByText(/Цалинтай холбоотой бүртгэлийг харахын тулд/),
    ).toBeInTheDocument();
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
