'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import { Panel, EmptyState } from '@/components/ui/Panel';
import { TaskListRow } from './TaskListRow';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { daysBetween, today } from '@/lib/dates';
import type { Task } from '@/types/dashboard';
import { CalendarCheck } from 'lucide-react';

/** How far ahead counts as "upcoming". A fortnight is a planning horizon. */
const HORIZON_DAYS = 14;

export const UpcomingDeadlines: React.FC = () => {
  const { tasks } = useData();
  const [selected, setSelected] = useState<Task | null>(null);
  const todayDate = today();

  const upcoming = useMemo(() => {
    return tasks
      .filter((task) => {
        if (task.taskProgress === 'Completed' || !task.deadline) return false;
        const days = daysBetween(todayDate, task.deadline);
        // Overdue tasks are included: they are the most urgent deadlines there
        // are, and hiding them here made the panel misleadingly calm.
        return days <= HORIZON_DAYS;
      })
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .slice(0, 8);
  }, [tasks, todayDate]);

  return (
    <>
      <Panel
        title="Upcoming deadlines"
        count={upcoming.length}
        action={{ label: 'Calendar', href: '/calendar' }}
      >
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="w-6 h-6" />}
            message="No deadlines in the next two weeks."
          />
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((task) => (
              <TaskListRow
                key={task.id}
                task={task}
                onOpen={setSelected}
                showDeadline
              />
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
