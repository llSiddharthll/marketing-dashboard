'use client';

import React from 'react';
import type { Priority, TaskStatus } from '@/types/dashboard';
import {
  getPriorityVisual,
  getStatusVisual,
  type StatusKey,
  STATUS_VISUALS,
} from '@/lib/design/statusStyles';

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

interface StatusBadgeProps {
  status: TaskStatus;
  isOverdue?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A status pill. Colour plus a leading dot, so the two lowest-contrast pairs
 * (slate vs stone) are still separable, and so it survives being screenshotted
 * in greyscale.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  isOverdue = false,
  size = 'md',
  className = '',
}) => {
  const visual = getStatusVisual(status, isOverdue);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-[13px]'
      } ${visual.className} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${visual.dot}`}
        aria-hidden="true"
      />
      {visual.label}
    </span>
  );
};

/* -------------------------------------------------------------------------- */
/* Priority                                                                   */
/* -------------------------------------------------------------------------- */

interface PriorityIndicatorProps {
  priority: Priority;
  /** Hides the text label, for dense contexts like a Kanban card footer. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Priority as a three-bar glyph.
 *
 * Filled bars carry the level, so it is legible without colour vision and cannot
 * be mistaken for a status pill. In the previous build priority was a text chip
 * that looked identical for High, Medium and Low, which meant the column
 * conveyed nothing.
 */
export const PriorityIndicator: React.FC<PriorityIndicatorProps> = ({
  priority,
  iconOnly = false,
  className = '',
}) => {
  const visual = getPriorityVisual(priority);

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      // One accessible name for the whole glyph; the bars themselves are
      // decorative once the label is read out.
      title={`${visual.label} priority`}
    >
      <span className="flex items-end gap-[2px] h-3" aria-hidden="true">
        {[0, 1, 2].map((index) => {
          const filled = index < visual.level;
          return (
            <span
              key={index}
              className={`w-[3px] rounded-sm ${
                filled ? visual.barClass : 'bg-slate-200 dark:bg-slate-700'
              }`}
              style={{ height: `${(index + 1) * 33.33}%` }}
            />
          );
        })}
      </span>

      {iconOnly ? (
        <span className="sr-only">{visual.label} priority</span>
      ) : (
        <span className={`text-[13px] ${visual.textClass}`}>{visual.label}</span>
      )}
    </span>
  );
};

/* -------------------------------------------------------------------------- */
/* Legend                                                                     */
/* -------------------------------------------------------------------------- */

interface StatusLegendProps {
  keys: StatusKey[];
  className?: string;
}

/**
 * Shared legend. Reads from the same table the badges do, so a legend swatch can
 * no longer disagree with the thing it describes.
 */
export const StatusLegend: React.FC<StatusLegendProps> = ({
  keys,
  className = '',
}) => (
  <ul className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className}`}>
    {keys.map((key) => {
      const visual = STATUS_VISUALS[key];
      return (
        <li key={key} className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${visual.dot}`}
            aria-hidden="true"
          />
          <span className="text-[13px] text-fg-muted">{visual.label}</span>
        </li>
      );
    })}
  </ul>
);
