'use client';

/**
 * A titled card with an optional action and a built-in empty state.
 *
 * The dashboard panels all repeated the same header markup with slightly
 * different padding and heading weights. This makes them consistent and gives
 * every one of them a real empty state — previously an empty panel rendered a
 * bare card with a heading and nothing else.
 */

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface PanelProps {
  title: string;
  /** Count shown next to the title, when a total is meaningful. */
  count?: number;
  /** "View all" style link. */
  action?: { label: string; href: string };
  children: React.ReactNode;
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({
  title,
  count,
  action,
  children,
  className = '',
}) => (
  <section className={`card flex flex-col ${className}`}>
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
      <h2 className="text-card-title flex items-center gap-2">
        {title}
        {count !== undefined && count > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-surface-sunken text-[11px] font-semibold text-fg-muted tabular">
            {count}
          </span>
        )}
      </h2>

      {action && (
        <Link
          href={action.href}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-fg-muted hover:text-fg transition-colors shrink-0"
        >
          {action.label}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>

    <div className="flex-1">{children}</div>
  </section>
);

interface EmptyStateProps {
  /** What is absent, phrased as an outcome rather than an error. */
  message: string;
  /** Optional next step, because an empty screen should invite an action. */
  hint?: string;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  hint,
  icon,
}) => (
  <div className="px-4 py-10 text-center">
    {icon && (
      <div className="flex justify-center mb-2 text-fg-subtle" aria-hidden="true">
        {icon}
      </div>
    )}
    <p className="text-body text-fg-muted">{message}</p>
    {hint && <p className="text-meta mt-1">{hint}</p>}
  </div>
);
