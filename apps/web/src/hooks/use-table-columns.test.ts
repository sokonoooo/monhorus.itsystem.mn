import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Column } from '../components/ui/DataTable';
import { reconcileColumns, useTableColumns } from './use-table-columns';

interface Row {
  id: string;
}

const COLUMNS: ReadonlyArray<Column<Row>> = [
  { key: 'name', header: 'Нэр', render: () => null },
  { key: 'code', header: 'Код', render: () => null },
  { key: 'status', header: 'Төлөв', render: () => null },
];

describe('reconcileColumns', () => {
  it('shows every column when nothing was stored', () => {
    expect(reconcileColumns(COLUMNS, null)).toEqual([
      { key: 'name', visible: true },
      { key: 'code', visible: true },
      { key: 'status', visible: true },
    ]);
  });

  it('keeps the stored order and visibility', () => {
    const result = reconcileColumns(COLUMNS, [
      { key: 'status', visible: true },
      { key: 'name', visible: false },
      { key: 'code', visible: true },
    ]);

    expect(result.map((entry) => entry.key)).toEqual(['status', 'name', 'code']);
    expect(result[1]?.visible).toBe(false);
  });

  /** A column the screen has since dropped must not linger in a saved preference. */
  it('drops a stored column the table no longer declares', () => {
    const result = reconcileColumns(COLUMNS, [
      { key: 'name', visible: true },
      { key: 'removed', visible: true },
    ]);

    expect(result.map((entry) => entry.key)).not.toContain('removed');
  });

  /** A column added since the preference was saved must appear, not stay hidden forever. */
  it('appends a column the table has gained', () => {
    const result = reconcileColumns(COLUMNS, [{ key: 'name', visible: true }]);

    expect(result.map((entry) => entry.key)).toEqual(['name', 'code', 'status']);
    expect(result.every((entry) => entry.visible)).toBe(true);
  });
});

describe('useTableColumns', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with every column visible', () => {
    const { result } = renderHook(() => useTableColumns('t1', COLUMNS));

    expect(result.current.visibleColumns.map((column) => column.key)).toEqual([
      'name',
      'code',
      'status',
    ]);
    expect(result.current.isCustomised).toBe(false);
  });

  it('hides a column and remembers it', () => {
    const { result } = renderHook(() => useTableColumns('t1', COLUMNS));

    act(() => result.current.toggle('code'));

    expect(result.current.visibleColumns.map((column) => column.key)).toEqual(['name', 'status']);
    expect(result.current.isCustomised).toBe(true);

    // A fresh mount reads the same preference back.
    const second = renderHook(() => useTableColumns('t1', COLUMNS));
    expect(second.result.current.visibleColumns.map((column) => column.key)).toEqual([
      'name',
      'status',
    ]);
  });

  it('keeps preferences of two tables apart', () => {
    const first = renderHook(() => useTableColumns('t1', COLUMNS));
    act(() => first.result.current.toggle('code'));

    const second = renderHook(() => useTableColumns('t2', COLUMNS));
    expect(second.result.current.visibleColumns).toHaveLength(3);
  });

  it('reorders a column', () => {
    const { result } = renderHook(() => useTableColumns('t1', COLUMNS));

    act(() => result.current.move('status', -1));

    expect(result.current.visibleColumns.map((column) => column.key)).toEqual([
      'name',
      'status',
      'code',
    ]);
  });

  it('will not move a column past either end', () => {
    const { result } = renderHook(() => useTableColumns('t1', COLUMNS));

    act(() => result.current.move('name', -1));
    expect(result.current.visibleColumns.map((column) => column.key)).toEqual([
      'name',
      'code',
      'status',
    ]);
  });

  /** An empty table cannot be recovered from through the picker, so it is refused. */
  it('refuses to hide the last visible column', () => {
    const { result } = renderHook(() => useTableColumns('t1', COLUMNS));

    act(() => result.current.toggle('code'));
    act(() => result.current.toggle('status'));
    act(() => result.current.toggle('name'));

    expect(result.current.visibleColumns.map((column) => column.key)).toEqual(['name']);
  });

  it('resets back to the declared order', () => {
    const { result } = renderHook(() => useTableColumns('t1', COLUMNS));

    act(() => result.current.toggle('code'));
    act(() => result.current.move('status', -1));
    act(() => result.current.reset());

    expect(result.current.visibleColumns.map((column) => column.key)).toEqual([
      'name',
      'code',
      'status',
    ]);
    expect(result.current.isCustomised).toBe(false);
    expect(localStorage.getItem('monhorus.table.t1')).toBeNull();
  });

  /** A corrupt preference must not take the screen down with it. */
  it('falls back to the declared order when the stored value is unreadable', () => {
    localStorage.setItem('monhorus.table.t1', 'not json');

    const { result } = renderHook(() => useTableColumns('t1', COLUMNS));
    expect(result.current.visibleColumns).toHaveLength(3);
  });

  it('exposes the header text for the picker', () => {
    const { result } = renderHook(() => useTableColumns('t1', COLUMNS));
    expect(result.current.labelOf('code')).toBe('Код');
  });
});
