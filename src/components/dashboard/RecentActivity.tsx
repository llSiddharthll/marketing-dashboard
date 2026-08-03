'use client';

import React from 'react';
import { useData } from '@/context/DataContext';
import { Panel, EmptyState } from '@/components/ui/Panel';
import { History } from 'lucide-react';

/**
 * The most recent audit entries.
 *
 * Reads the same log the Activity page does, which is now written server-side
 * with a verified user attached — so this shows who actually did something
 * rather than the constant "System Admin" the previous build recorded.
 */
export const RecentActivity: React.FC = () => {
  const { activityLogs } = useData();
  const recent = activityLogs.slice(0, 8);

  return (
    <Panel
      title="Recent activity"
      action={{ label: 'Full log', href: '/activity' }}
    >
      {recent.length === 0 ? (
        <EmptyState
          icon={<History className="w-6 h-6" />}
          message="No activity recorded yet."
        />
      ) : (
        <ul className="divide-y divide-line">
          {recent.map((entry) => (
            <li
              key={entry.id}
              className="px-4 py-2.5 flex items-baseline gap-3 text-[13px]"
            >
              <span className="shrink-0 w-16 font-mono text-[12px] text-fg-subtle tabular">
                {entry.time.slice(0, 5)}
              </span>
              <span className="flex-1 min-w-0">
                <span className="font-medium text-fg">{entry.user}</span>
                <span className="text-fg-muted"> · {entry.action}</span>
                {entry.newValue && entry.newValue !== 'None' && (
                  <span className="block text-[12.5px] text-fg-subtle truncate">
                    {entry.newValue}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-[11.5px] text-fg-subtle">
                {entry.target}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};
