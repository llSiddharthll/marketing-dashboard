'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import { Panel, EmptyState } from '@/components/ui/Panel';
import { TaskListRow } from './TaskListRow';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { today } from '@/lib/dates';
import type { Task } from '@/types/dashboard';
import { CheckCircle2 } from 'lucide-react';

export const TodayTasks: React.FC = () => {
  const { tasks } = useData();
  const [selected, setSelected] = useState<Task | null>(null);

  // `today()` is timezone-aware. This panel used
  // `new Date().toISOString().split('T')[0]`, which returns the UTC date — so
  // before 05:30 IST it showed the wrong day's work.
  const todayDate = today();

  const todaysTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.taskProgress !== 'Completed' &&
          (task.deadline === todayDate || task.executionStartDate === todayDate)
      ),
    [tasks, todayDate]
  );

  return (
    <>
      <Panel
        title="Due today"
        count={todaysTasks.length}
        action={{ label: 'All tasks', href: '/tasks' }}
      >
        {todaysTasks.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="w-6 h-6" />}
            message="Nothing due today."
            hint="Check upcoming deadlines to see what is next."
          />
        ) : (
          <ul className="divide-y divide-line">
            {todaysTasks.map((task) => (
              <TaskListRow key={task.id} task={task} onOpen={setSelected} />
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
