'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import { Panel, EmptyState } from '@/components/ui/Panel';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import type { Task } from '@/types/dashboard';
import { PriorityIndicator } from '@/components/ui/StatusBadge';
import { CheckCircle2 } from 'lucide-react';

/**
 * Recently completed work.
 *
 * The brief lists this panel explicitly and it was missing from the previous
 * build. It also gives the dashboard something positive to show, rather than
 * only surfacing what is late.
 */
export const RecentlyCompleted: React.FC = () => {
  const { tasks } = useData();
  const [selected, setSelected] = useState<Task | null>(null);

  const completed = useMemo(
    () =>
      tasks
        .filter(
          (task) => task.taskProgress === 'Completed' && task.actualFinishedDate
        )
        // Most recently finished first.
        .sort((a, b) =>
          (b.actualFinishedDate ?? '').localeCompare(a.actualFinishedDate ?? '')
        )
        .slice(0, 6),
    [tasks]
  );

  return (
    <>
      <Panel
        title="Recently completed"
        count={completed.length}
        action={{ label: 'All tasks', href: '/tasks?status=Completed' }}
      >
        {completed.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="w-6 h-6" />}
            message="Nothing completed yet."
            hint="Finished work will appear here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {completed.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => setSelected(task)}
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
                  <span className="shrink-0 text-[12.5px] text-fg-muted tabular">
                    {task.actualFinishedDate}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <TaskDrawer
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        taskToEdit={selected}
      />
    </>
  );
};
