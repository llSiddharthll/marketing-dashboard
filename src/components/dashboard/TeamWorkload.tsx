'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useData } from '@/context/DataContext';
import { Panel, EmptyState } from '@/components/ui/Panel';
import { Users } from 'lucide-react';

/**
 * Open work per person, so it is obvious who is overloaded.
 *
 * Bars are scaled against the busiest person rather than a fixed maximum, so the
 * comparison stays readable whether the team is carrying five tasks or fifty.
 */
export const TeamWorkload: React.FC = () => {
  const { tasks, getActiveMasterOptions } = useData();

  const workload = useMemo(() => {
    const members = new Set([
      ...getActiveMasterOptions('Team Members'),
      // Include anyone assigned work even if they are no longer in the active
      // list, otherwise their tasks silently vanish from this view.
      ...tasks.map((task) => task.internalPoc).filter(Boolean),
    ]);

    return [...members]
      .map((name) => {
        const assigned = tasks.filter((task) => task.internalPoc === name);
        const open = assigned.filter(
          (task) => task.taskProgress !== 'Completed'
        );
        return {
          name,
          open: open.length,
          overdue: open.filter((task) => task.isOverdue).length,
          total: assigned.length,
        };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [tasks, getActiveMasterOptions]);

  const busiest = Math.max(1, ...workload.map((row) => row.open));

  return (
    <Panel title="Team workload" action={{ label: 'People', href: '/master-data' }}>
      {workload.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          message="No work assigned yet."
        />
      ) : (
        <ul className="px-4 py-3 space-y-3">
          {workload.map((row) => (
            <li key={row.name}>
              <Link
                href={`/tasks?poc=${encodeURIComponent(row.name)}`}
                className="block group"
              >
                <span className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-[13.5px] font-medium text-fg truncate group-hover:text-accent transition-colors">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-[12.5px] text-fg-muted tabular">
                    {row.open} open
                    {row.overdue > 0 && (
                      <span className="text-rose-600 dark:text-rose-400">
                        {' '}
                        · {row.overdue} overdue
                      </span>
                    )}
                  </span>
                </span>

                {/* Two-segment bar: overdue portion sits at the front so it reads
                    first, which is the part that needs action. */}
                <span
                  className="flex h-1.5 rounded-full overflow-hidden bg-surface-sunken"
                  role="img"
                  aria-label={`${row.open} open tasks, ${row.overdue} overdue`}
                >
                  {row.overdue > 0 && (
                    <span
                      className="bg-rose-500"
                      style={{ width: `${(row.overdue / busiest) * 100}%` }}
                    />
                  )}
                  <span
                    className="bg-blue-500"
                    style={{
                      width: `${((row.open - row.overdue) / busiest) * 100}%`,
                    }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};
