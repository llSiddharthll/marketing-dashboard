'use client';

/**
 * Compact task row, shared by the dashboard panels.
 *
 * Each panel previously inlined its own row markup, which is why the same task
 * looked different depending on which panel you found it in.
 */

import React from 'react';
import type { Task } from '@/types/dashboard';
import { StatusBadge, PriorityIndicator } from '@/components/ui/StatusBadge';
import { daysBetween, today } from '@/lib/dates';

interface TaskListRowProps {
  task: Task;
  onOpen: (task: Task) => void;
  /** Shows a relative deadline instead of the status pill. */
  showDeadline?: boolean;
}

/** "in 3 days", "tomorrow", "2 days ago" — easier to act on than a raw date. */
function relativeDeadline(deadline: string): string {
  if (!deadline) return 'No deadline';
  const days = daysBetween(today(), deadline);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${deadline}`;
}

export const TaskListRow: React.FC<TaskListRowProps> = ({
  task,
  onOpen,
  showDeadline = false,
}) => (
  <li>
    <button
      type="button"
      onClick={() => onOpen(task)}
      className="w-full text-left px-4 py-3 hover:bg-surface-sunken transition-colors flex items-center gap-3"
    >
      <PriorityIndicator priority={task.priority} iconOnly />

      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] font-medium text-fg truncate">
          {task.taskName}
        </span>
        <span className="block text-[12.5px] text-fg-subtle truncate">
          {task.project} · {task.internalPoc}
        </span>
      </span>

      {showDeadline ? (
        <span
          className={`shrink-0 text-[12.5px] font-medium tabular ${
            task.isOverdue ? 'text-rose-600 dark:text-rose-400' : 'text-fg-muted'
          }`}
        >
          {relativeDeadline(task.deadline)}
        </span>
      ) : (
        <StatusBadge
          status={task.taskProgress}
          isOverdue={task.isOverdue}
          size="sm"
          className="shrink-0"
        />
      )}
    </button>
  </li>
);
