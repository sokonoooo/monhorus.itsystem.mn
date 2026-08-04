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
