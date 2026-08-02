import type { DiagramEdgeDto, DiagramNodeDto } from '@monhorus/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PropertiesSidebar } from './PropertiesSidebar';

function node(overrides: Partial<DiagramNodeDto> = {}): DiagramNodeDto {
  return {
    id: 'n1',
    assetKind: 'PANEL',
    name: 'Үндсэн самбар',
    subtitle: 'MDB-01',
    icon: 'PANEL',
    position: { x: 0, y: 0 },
    size: { width: 200, height: 96 },
    accentColour: '#2563eb',
    status: 'OK',
    metrics: [],
    objectId: null,
    ...overrides,
  };
}

function edge(overrides: Partial<DiagramEdgeDto> = {}): DiagramEdgeDto {
  return {
    id: 'e1',
    source: 'n1',
    sourceHandle: 'bottom',
    target: 'n2',
    targetHandle: 'top',
    direction: 'FORWARD',
    arrowType: 'ARROW_CLOSED',
    lineType: 'SMOOTHSTEP',
    colour: '#64748b',
    thickness: 2,
    dashStyle: 'SOLID',
    animated: false,
    label: null,
    ...overrides,
  };
}

const noop = (): void => undefined;

/**
 * A harness that actually applies the patch it receives.
 *
 * The sidebar's inputs are controlled, so a spy that swallows the change leaves the field
 * showing its old value and the next keystroke is appended to that. Feeding the patch back
 * is also the loop the requirement describes: the property updates as it is edited.
 */
function StatefulNodeSidebar({
  initial,
  onState,
}: {
  initial: DiagramNodeDto;
  onState: (node: DiagramNodeDto) => void;
}) {
  const [current, setCurrent] = useState(initial);

  return (
    <PropertiesSidebar
      node={current}
      edge={null}
      editable
      onNodeChange={(patch) => {
        const next = { ...current, ...patch };
        setCurrent(next);
        onState(next);
      }}
      onEdgeChange={noop}
      onDeleteNode={noop}
      onDeleteEdge={noop}
      onClose={noop}
    />
  );
}

function renderSidebar(
  overrides: Partial<Parameters<typeof PropertiesSidebar>[0]> = {},
): { onNodeChange: ReturnType<typeof vi.fn>; onEdgeChange: ReturnType<typeof vi.fn> } {
  const onNodeChange = vi.fn();
  const onEdgeChange = vi.fn();

  render(
    <PropertiesSidebar
      node={null}
      edge={null}
      editable
      onNodeChange={onNodeChange}
      onEdgeChange={onEdgeChange}
      onDeleteNode={noop}
      onDeleteEdge={noop}
      onClose={noop}
      {...overrides}
    />,
  );

  return { onNodeChange, onEdgeChange };
}

describe('PropertiesSidebar', () => {
  /** Nothing selected means no sidebar; it opens on selection. */
  it('renders nothing when nothing is selected', () => {
    renderSidebar();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('opens on a node with its properties filled in', () => {
    renderSidebar({ node: node() });

    expect(screen.getByRole('complementary', { name: 'Шинж чанар' })).toBeInTheDocument();
    expect(screen.getByLabelText('Нэр')).toHaveValue('Үндсэн самбар');
    expect(screen.getByLabelText('Дэд гарчиг')).toHaveValue('MDB-01');
  });

  /** Real-time: each keystroke reports a change rather than waiting for a save. */
  it('reports a name change as it is typed', async () => {
    const user = userEvent.setup();
    const { onNodeChange } = renderSidebar({ node: node() });

    await user.type(screen.getByLabelText('Нэр'), 'X');

    expect(onNodeChange).toHaveBeenCalledWith({ name: 'Үндсэн самбарX' });
  });

  it('reports a status change', async () => {
    const user = userEvent.setup();
    const { onNodeChange } = renderSidebar({ node: node() });

    await user.selectOptions(screen.getByLabelText('Төлөв'), 'FAULT');

    expect(onNodeChange).toHaveBeenCalledWith({ status: 'FAULT' });
  });

  it('reports a dimension change', async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(<StatefulNodeSidebar initial={node()} onState={onState} />);

    const width = screen.getByLabelText('Өргөн');
    await user.clear(width);
    await user.type(width, '300');

    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ size: { width: 300, height: 96 } }),
    );
  });

  it('reports an accent colour change from the hex field', async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(<StatefulNodeSidebar initial={node()} onState={onState} />);

    const hex = screen.getByLabelText('Өнгө hex');
    await user.clear(hex);
    await user.paste('#ff0000');

    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ accentColour: '#ff0000' }),
    );
  });

  /** The canvas has to see each edit as it happens, not once at the end. */
  it('updates the field as the value is edited, not on a save', async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(<StatefulNodeSidebar initial={node({ name: '' })} onState={onState} />);

    await user.type(screen.getByLabelText('Нэр'), 'ABC');

    expect(onState).toHaveBeenCalledTimes(3);
    expect(screen.getByLabelText('Нэр')).toHaveValue('ABC');
    expect(screen.queryByRole('button', { name: /Хадгал/ })).not.toBeInTheDocument();
  });

  /** Switching kind takes the icon with it, which is what people expect. */
  it('moves the icon with the asset kind when they still match', async () => {
    const user = userEvent.setup();
    const { onNodeChange } = renderSidebar({ node: node() });

    await user.selectOptions(screen.getByLabelText('Төрөл'), 'PUMP');

    expect(onNodeChange).toHaveBeenCalledWith({ assetKind: 'PUMP', icon: 'PUMP' });
  });

  it('leaves a deliberately different icon alone', async () => {
    const user = userEvent.setup();
    const { onNodeChange } = renderSidebar({ node: node({ icon: 'SENSOR' }) });

    await user.selectOptions(screen.getByLabelText('Төрөл'), 'PUMP');

    expect(onNodeChange).toHaveBeenCalledWith({ assetKind: 'PUMP' });
  });

  it('adds a metric row', async () => {
    const user = userEvent.setup();
    const { onNodeChange } = renderSidebar({ node: node() });

    await user.click(screen.getByRole('button', { name: 'Нэмэх' }));

    expect(onNodeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        metrics: [expect.objectContaining({ label: 'Үзүүлэлт', value: '' })],
      }),
    );
  });

  it('removes a metric row', async () => {
    const user = userEvent.setup();
    const { onNodeChange } = renderSidebar({
      node: node({ metrics: [{ id: 'm1', label: 'Ачаалал', value: '6', unit: 'kW' }] }),
    });

    await user.click(screen.getByRole('button', { name: 'Үзүүлэлт 1 устгах' }));

    expect(onNodeChange).toHaveBeenCalledWith({ metrics: [] });
  });

  // -- Edges -------------------------------------------------------------------

  it('opens on an edge with its properties filled in', () => {
    renderSidebar({ edge: edge({ label: 'L1' }) });

    expect(screen.getByRole('complementary', { name: 'Шинж чанар' })).toBeInTheDocument();
    expect(screen.getByLabelText('Шошго')).toHaveValue('L1');
  });

  it('reports every edge property change', async () => {
    const user = userEvent.setup();
    const { onEdgeChange } = renderSidebar({ edge: edge() });

    await user.selectOptions(screen.getByLabelText('Чиглэл'), 'BOTH');
    expect(onEdgeChange).toHaveBeenCalledWith({ direction: 'BOTH' });

    await user.selectOptions(screen.getByLabelText('Шугамын хэлбэр'), 'STRAIGHT');
    expect(onEdgeChange).toHaveBeenCalledWith({ lineType: 'STRAIGHT' });

    await user.selectOptions(screen.getByLabelText('Тасархай хэлбэр'), 'DASHED');
    expect(onEdgeChange).toHaveBeenCalledWith({ dashStyle: 'DASHED' });

    await user.click(screen.getByLabelText('Хөдөлгөөнтэй'));
    expect(onEdgeChange).toHaveBeenCalledWith({ animated: true });
  });

  /** An arrow shape is meaningless with no direction, so the control is disabled. */
  it('disables the arrow shape when the edge has no direction', () => {
    renderSidebar({ edge: edge({ direction: 'NONE' }) });

    expect(screen.getByLabelText('Сумны хэлбэр')).toBeDisabled();
  });

  it('enables the arrow shape once a direction is chosen', () => {
    renderSidebar({ edge: edge({ direction: 'FORWARD' }) });

    expect(screen.getByLabelText('Сумны хэлбэр')).toBeEnabled();
  });

  // -- Read-only ----------------------------------------------------------------

  it('shows a read-only caller the properties but lets them change nothing', () => {
    renderSidebar({ node: node(), editable: false });

    expect(screen.getByLabelText('Нэр')).toBeDisabled();
    expect(screen.getByLabelText('Төлөв')).toBeDisabled();
    expect(screen.getByText(/Зөвхөн харах эрхтэй/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Объект устгах' })).not.toBeInTheDocument();
  });
});
