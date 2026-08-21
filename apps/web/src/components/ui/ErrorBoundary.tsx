import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a render error and shows it, instead of letting React unmount the tree.
 *
 * Without one of these, a single thrown error anywhere in the app replaces the whole
 * page with nothing at all — no message, no stack, no clue which screen was at fault.
 * That is indistinguishable from a routing bug, a failed deploy or a dead API, and it
 * sends whoever is looking at it hunting in the wrong place. A blank page is the one
 * failure that tells you nothing.
 *
 * It deliberately renders the message and the component stack rather than a friendly
 * apology: this is an internal tool, the person reading it can act on a stack, and the
 * alternative is asking them to open the console — which is exactly the step that was
 * missing when a page went blank.
 *
 * `resetKey` lets a caller clear the error when the thing that caused it changes — a
 * route, say — so a broken screen does not poison every screen after it.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  /** Changing this clears a caught error, so navigating away recovers. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, componentStack: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // Kept: the console is still where a developer looks first, and React's own
    // logging of this is suppressed once a boundary handles the error.
    console.error('Render error caught by ErrorBoundary', error, info.componentStack);
  }

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-red-200">
          <h1 className="text-base font-semibold text-red-700">Энэ хэсгийг харуулахад алдаа гарлаа</h1>
          <p className="mt-1 text-sm text-slate-600">
            Хуудсыг дахин ачаална уу. Алдаа давтагдвал доорх мэдээллийг хөгжүүлэгчид дамжуулна уу.
          </p>

          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {error.message}
          </pre>

          {componentStack ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-500">Дэлгэрэнгүй</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-700">
                {componentStack}
              </pre>
            </details>
          ) : null}

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Дахин ачаалах
          </button>
        </div>
      </div>
    );
  }
}
