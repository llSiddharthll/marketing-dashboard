'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import { EmptyState } from '@/components/ui/Panel';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import type { UserRole } from '@/types/dashboard';
import { History, Search, X } from 'lucide-react';

const ROLES: UserRole[] = ['Admin', 'Marketing Team', 'Management', 'Viewer'];

/**
 * The audit trail: who changed what, and when.
 *
 * Entries are written server-side and attributed to the verified signed-in user,
 * so since Phase 2 the User column shows a real person rather than a constant.
 */
export const ActivityLogView: React.FC = () => {
  const { activityLogs } = useData();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activityLogs.filter((entry) => {
      if (roleFilter && entry.role !== roleFilter) return false;
      if (!q) return true;
      return [entry.user, entry.action, entry.target, entry.oldValue, entry.newValue]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [activityLogs, query, roleFilter]);

  return (
    <div className="space-y-4">
      {/* Filter row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none"
            aria-hidden="true"
          />
          <label htmlFor="activity-search" className="sr-only">
            Search the activity log
          </label>
          <input
            id="activity-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by person, action or task…"
            className="field pl-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-fg-subtle hover:text-fg transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="sm:w-48">
          <label htmlFor="activity-role" className="sr-only">
            Filter by role
          </label>
          <select
            id="activity-role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as UserRole | '')}
            className="field"
          >
            <option value="">All roles</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-meta">
        {filtered.length === activityLogs.length
          ? `${activityLogs.length} entr${activityLogs.length === 1 ? 'y' : 'ies'}`
          : `${filtered.length} of ${activityLogs.length} entries`}
      </p>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<History className="w-7 h-7" />}
            message={
              activityLogs.length === 0
                ? 'Nothing has been recorded yet.'
                : 'No entries match this search.'
            }
            hint={
              activityLogs.length === 0
                ? 'Every change to a task, master list or user is logged here.'
                : 'Try a different term, or clear the role filter.'
            }
          />
        </div>
      ) : (
        <>
          {/* Mobile: a readable feed rather than a squeezed seven-column table */}
          <ul className="md:hidden space-y-2">
            {filtered.map((entry) => (
              <li key={entry.id} className="card p-3.5 space-y-1.5">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-medium">{entry.user}</span>
                  <span className="shrink-0 font-mono text-[11px] text-fg-subtle tabular">
                    {entry.date} {entry.time.slice(0, 5)}
                  </span>
                </p>
                <p className="text-[13px] text-fg-muted">
                  {entry.action}
                  {entry.target && (
                    <span className="font-mono text-[12px] text-fg-subtle">
                      {' '}
                      · {entry.target}
                    </span>
                  )}
                </p>
                {entry.newValue && entry.newValue !== 'None' && (
                  <p className="text-[12.5px] text-fg-subtle wrap-break-word">
                    {entry.oldValue && entry.oldValue !== 'None'
                      ? `${entry.oldValue} → ${entry.newValue}`
                      : entry.newValue}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden md:block card overflow-hidden">
            <Table minWidth={880}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-36">When</TableHead>
                  <TableHead className="w-36">Who</TableHead>
                  <TableHead className="w-32">Role</TableHead>
                  <TableHead className="w-36">Action</TableHead>
                  <TableHead className="w-32">Target</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-surface-sunken/60">
                    <TableCell className="font-mono text-[12px] text-fg-subtle whitespace-nowrap tabular">
                      {entry.date} {entry.time.slice(0, 5)}
                    </TableCell>
                    <TableCell className="font-medium wrap-break-word">
                      {entry.user}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {entry.role}
                    </TableCell>
                    <TableCell className="wrap-break-word">
                      {entry.action}
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-fg-muted wrap-break-word">
                      {entry.target || '—'}
                    </TableCell>
                    <TableCell className="text-fg-muted wrap-break-word leading-relaxed">
                      {entry.newValue && entry.newValue !== 'None'
                        ? entry.oldValue && entry.oldValue !== 'None'
                          ? `${entry.oldValue} → ${entry.newValue}`
                          : entry.newValue
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
};
