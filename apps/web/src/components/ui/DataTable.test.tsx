import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type Column } from './DataTable';

/**
 * ROW EXPANSION, tested on the table itself rather than through a page.
 *
 * The capability is generic and shared: any caller can hang a detail panel under a row, so
 * its contract belongs here where it cannot be lost when the feature that first used it
 * goes away. What is asserted is the part callers depend on — that expansion is OPT-IN, so
 * a table that never asks for it renders exactly the markup it always did, and that when
 * asked for it is CONTROLLED, so the owner decides which rows are open.
 */

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Эхний мөр' },
  { id: 'b', name: 'Хоёр дахь мөр' },
];

const COLUMNS: ReadonlyArray<Column<Row>> = [
  { key: 'name', header: 'Нэр', render: (row) => <span>{row.name}</span> },
];

describe('DataTable row expansion', () => {
  it('adds no expander column when the caller does not ask for one', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} ariaLabel="Хүснэгт" />);

    const table = screen.getByRole('table', { name: 'Хүснэгт' });
    // One header cell, not two: the opt-in is what adds the expander column, so a table
    // that never asked for expansion is untouched by the feature existing.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(1);
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
  });

  it('names each row expander so a screen reader hears which row it opens', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        ariaLabel="Хүснэгт"
        renderExpanded={(row) => <p>{row.name} дэлгэрэнгүй</p>}
        expandedKeys={[]}
        expandLabel={(row) => `${row.name} дэлгэх`}
      />,
    );

    expect(screen.getByRole('button', { name: 'Эхний мөр дэлгэх' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Хоёр дахь мөр дэлгэх' })).toBeInTheDocument();
  });

  it('renders the panel only for the keys the owner says are open', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        ariaLabel="Хүснэгт"
        renderExpanded={(row) => <p>{row.name} дэлгэрэнгүй</p>}
        expandedKeys={['a']}
        expandLabel={(row) => `${row.name} дэлгэх`}
      />,
    );

    expect(screen.getByText('Эхний мөр дэлгэрэнгүй')).toBeInTheDocument();
    expect(screen.queryByText('Хоёр дахь мөр дэлгэрэнгүй')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Эхний мөр дэлгэх' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  /**
   * Controlled, not internal: clicking reports the key and nothing opens by itself. An
   * owner that ignores the callback sees no change, which is what lets it fetch the detail
   * or remember the open rows before deciding.
   */
  it('reports the toggled key instead of opening the panel on its own', async () => {
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();

    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        ariaLabel="Хүснэгт"
        renderExpanded={(row) => <p>{row.name} дэлгэрэнгүй</p>}
        expandedKeys={[]}
        onToggleExpand={onToggleExpand}
        expandLabel={(row) => `${row.name} дэлгэх`}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Хоёр дахь мөр дэлгэх' }));

    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).toHaveBeenCalledWith('b', ROWS[1]);
    expect(screen.queryByText('Хоёр дахь мөр дэлгэрэнгүй')).not.toBeInTheDocument();
  });

  it('opens and closes the panel once an owner feeds the key back', async () => {
    function Controlled(): ReactElement {
      const [open, setOpen] = useState<readonly string[]>([]);
      return (
        <DataTable
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          ariaLabel="Хүснэгт"
          renderExpanded={(row) => <p>{row.name} дэлгэрэнгүй</p>}
          expandedKeys={open}
          onToggleExpand={(key) =>
            setOpen((current) =>
              current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
            )
          }
          expandLabel={(row) => `${row.name} дэлгэх`}
        />
      );
    }

    const user = userEvent.setup();
    render(<Controlled />);

    const expander = screen.getByRole('button', { name: 'Эхний мөр дэлгэх' });
    await user.click(expander);
    expect(screen.getByText('Эхний мөр дэлгэрэнгүй')).toBeInTheDocument();
    expect(expander).toHaveAttribute('aria-expanded', 'true');

    await user.click(expander);
    expect(screen.queryByText('Эхний мөр дэлгэрэнгүй')).not.toBeInTheDocument();
    expect(expander).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * A clickable row and an expander are two different controls in the same cell area. The
   * expander stops the event, so opening the detail must not also navigate away.
   */
  it('does not fire the row click when the expander is used', async () => {
    const onRowClick = vi.fn();
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();

    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        ariaLabel="Хүснэгт"
        onRowClick={onRowClick}
        renderExpanded={(row) => <p>{row.name} дэлгэрэнгүй</p>}
        expandedKeys={[]}
        onToggleExpand={onToggleExpand}
        expandLabel={(row) => `${row.name} дэлгэх`}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Эхний мөр дэлгэх' }));

    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});


/**
 * ROW NUMBERING, tested on the table rather than through any one page.
 *
 * Thirteen pages now ask for a № column, and the thing that can go wrong is the same in
 * all of them: the number restarting at 1 on every page, which makes "check row 34"
 * meaningless. The arithmetic lives in the component precisely so it can be pinned once,
 * here, instead of thirteen times in thirteen page tests.
 */
describe('DataTable numbering', () => {
  /** The text of the first cell of each body row, which is № when numbering is on. */
  function firstCells(): string[] {
    return screen
      .getAllByRole('row')
      .slice(1) // drop the header row
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent?.trim() ?? '');
  }

  it('adds no column at all when numbering is not asked for', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />);

    // Opt-in: a table that never asked keeps exactly the markup it had.
    expect(screen.queryByRole('columnheader', { name: '№' })).toBeNull();
    expect(firstCells()).toEqual(['Эхний мөр', 'Хоёр дахь мөр']);
  });

  it('numbers from one when asked for plain numbering', () => {
    render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} numbering />,
    );

    expect(screen.getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    expect(firstCells()).toEqual(['1', '2']);
  });

  it('continues the numbering across pages', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        numbering={{ page: 2, limit: 20 }}
      />,
    );

    // THE POINT OF THE WHOLE FEATURE. Page 2 of 20 begins at 21, not at 1.
    expect(firstCells()).toEqual(['21', '22']);
  });

  it('numbers the first page from one, not from the page size', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        numbering={{ page: 1, limit: 20 }}
      />,
    );

    // The off-by-one that a hand-written `page * limit + index` would get wrong.
    expect(firstCells()).toEqual(['1', '2']);
  });

  it('numbers a later page of a different size correctly', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        numbering={{ page: 4, limit: 25 }}
      />,
    );

    expect(firstCells()).toEqual(['76', '77']);
  });

  it('never numbers below one, whatever it is handed', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        numbering={{ page: 0, limit: -20 }}
      />,
    );

    // A page of 0 arrives from a malformed url. Numbering from 1 is wrong but readable;
    // numbering from -19 is neither.
    expect(firstCells()).toEqual(['1', '2']);
  });

  it('puts № after the expander when a table has both', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        numbering={{ page: 2, limit: 20 }}
        renderExpanded={(row) => <p>Дэлгэрэнгүй {row.name}</p>}
        expandedKeys={[]}
        onToggleExpand={() => undefined}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(1);
    const cells = within(bodyRows[0]!).getAllByRole('cell');
    // The expander keeps the first cell; № is second, then the data.
    expect(cells[1]?.textContent?.trim()).toBe('21');
    expect(user).toBeDefined();
  });

  it('spans the detail panel across the number column too', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        numbering
        renderExpanded={(row) => <p>Дэлгэрэнгүй {row.name}</p>}
        expandedKeys={['a']}
        onToggleExpand={() => undefined}
      />,
    );

    const panel = screen.getByText('Дэлгэрэнгүй Эхний мөр').closest('td');
    // Expander + № + one data column. A short colSpan leaves the panel not reaching the
    // table's edge, which looks like a rendering fault.
    expect(panel).toHaveAttribute('colspan', '3');
  });
});
