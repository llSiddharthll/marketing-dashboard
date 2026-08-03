'use client';

/**
 * Error boundary.
 *
 * The app is one client tree, so before this a single render throw anywhere blanked
 * the entire screen with no explanation and no way back. This confines a failure
 * to the view that caused it and offers a recovery that does not require the user
 * to know what a hard refresh is.
 *
 * Class component because `componentDidCatch` has no hook equivalent.
 */

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Names the area that failed, e.g. "Reports". */
  area?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Logged rather than swallowed, so the stack is still available in the
    // console and in any monitoring that hooks console.error.
    console.error(
      `[ErrorBoundary]${this.props.area ? ` ${this.props.area}:` : ''}`,
      error,
      info.componentStack
    );
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const area = this.props.area;

    return (
      <div
        role="alert"
        className="card-padded max-w-lg mx-auto my-8 space-y-4 text-center"
      >
        <span
          className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center mx-auto"
          aria-hidden="true"
        >
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
        </span>

        <div className="space-y-1.5">
          <h2 className="text-section-title">
            {area ? `${area} could not be displayed` : 'Something went wrong'}
          </h2>
          <p className="text-body text-fg-muted">
            Your data is safe — this is a display problem, not a saving problem.
            Try again, and if it keeps happening reload the page.
          </p>
        </div>

        {/* The message can be genuinely useful when reporting the problem, so it
            is available without needing devtools — but folded away by default. */}
        <details className="text-left">
          <summary className="text-meta cursor-pointer hover:text-fg select-none">
            Technical details
          </summary>
          <pre className="mt-2 p-3 bg-surface-sunken border border-line rounded-lg text-[12px] font-mono text-fg-muted overflow-x-auto whitespace-pre-wrap wrap-break-word">
            {error.message}
          </pre>
        </details>

        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-accent text-accent-fg hover:bg-accent-hover rounded-lg text-sm font-medium transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3.5 py-2 bg-surface border border-line-strong hover:bg-surface-sunken rounded-lg text-sm font-medium transition-colors"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
