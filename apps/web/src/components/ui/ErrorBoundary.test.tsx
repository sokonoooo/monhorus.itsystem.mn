import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

/**
 * The boundary exists because a thrown render error used to blank the entire app —
 * no message, no stack, nothing naming the screen at fault. These assert the thing
 * that matters: something is on screen, and it says what broke.
 */
function Boom({ explode }: { explode: boolean }): ReactElement {
  if (explode) throw new Error('planPosition is not defined');
  return <p>сайн байна</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs a caught error itself; silence it so a passing run is readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('сайн байна')).toBeInTheDocument();
  });

  it('shows the error message instead of a blank page', () => {
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );

    // The failure this replaces: an empty document body.
    expect(screen.getByRole('heading', { name: /алдаа гарлаа/i })).toBeInTheDocument();
    expect(screen.getByText('planPosition is not defined')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /дахин ачаалах/i })).toBeInTheDocument();
  });

  it('clears the error when the reset key changes, so navigating away recovers', () => {
    function Harness(): ReactElement {
      const [route, setRoute] = useState('/floors/1');
      return (
        <>
          <button type="button" onClick={() => setRoute('/floors/2')}>
            navigate
          </button>
          <ErrorBoundary resetKey={route}>
            <Boom explode={route === '/floors/1'} />
          </ErrorBoundary>
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByText('planPosition is not defined')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'navigate' }));

    expect(screen.queryByText('planPosition is not defined')).not.toBeInTheDocument();
    expect(screen.getByText('сайн байна')).toBeInTheDocument();
  });
});
