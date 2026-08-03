'use client';

import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useData } from '@/context/DataContext';
import type { Task, TaskStatus } from '@/types/dashboard';
import { TaskDrawer } from './TaskDrawer';
import { KanbanBoard } from './KanbanBoard';
import { TaskFilters, type Filters, EMPTY_FILTERS } from './TaskFilters';
import { StatusBadge, PriorityIndicator } from '@/components/ui/StatusBadge';
import { Button, Segmented } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Panel';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { PRIORITY_WEIGHT } from '@/lib/design/statusStyles';
import { exportTasksToCsv } from '@/lib/client/exportCsv';
import {
  Plus,
  Download,
  Trash2,
  Pencil,
  Table as TableIcon,
  Columns3,
  ArrowUp,
  ArrowDown,
  Inbox,
} from 'lucide-react';

type SortField = 'taskName' | 'project' | 'internalPoc' | 'priority' | 'taskProgress' | 'deadline';
type SortDirection = 'asc' | 'desc';

export const TaskList: React.FC = () => {
  const { tasks, deleteTask, currentUserRole, globalSearch } = useData();
  const searchParams = useSearchParams();
  const { confirm, confirmDialog } = useConfirm();

  const [view, setView] = useState<'table' | 'board'>('table');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ field: SortField; direction: SortDirection }>({
    field: 'deadline',
    direction: 'asc',
  });

  const canEdit =
    currentUserRole === 'Admin' || currentUserRole === 'Marketing Team';
  const canDelete = currentUserRole === 'Admin';

  /**
   * Seed filters from the URL, so the dashboard KPI cards and workload bars can
   * link straight to a filtered list — e.g. /tasks?status=Completed.
   *
   * Adjusted during render rather than in an effect: this is "derive state from
   * a changed prop" (the URL query), which React's own guidance says to do by
   * comparing against the previous value inline, not by round-tripping through
   * an effect and a second commit.
   */
  const searchParamsKey = searchParams.toString();
  const [lastSearchParamsKey, setLastSearchParamsKey] = useState(searchParamsKey);
  if (searchParamsKey !== lastSearchParamsKey) {
    setLastSearchParamsKey(searchParamsKey);

    const status = searchParams.get('status');
    const poc = searchParams.get('poc');
    const project = searchParams.get('project');
    const overdue = searchParams.get('overdue');

    if (status || poc || project || overdue) {
      setFilters((previous) => ({
        ...previous,
        status: (status as TaskStatus) ?? previous.status,
        internalPoc: poc ?? previous.internalPoc,
        project: project ?? previous.project,
        overdueOnly: overdue === '1' ? true : previous.overdueOnly,
      }));
    }
  }

  /* ------------------------------ Filtering ----------------------------- */

  const filtered = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();

    return tasks.filter((task) => {
      if (filters.project && task.project !== filters.project) return false;
      if (filters.department && task.department !== filters.department) return false;
      if (filters.internalPoc && task.internalPoc !== filters.internalPoc)
        return false;
      // Vendor and agency filters were missing entirely despite the brief
      // listing both.
      if (filters.vendor && task.vendor !== filters.vendor) return false;
      if (filters.agency && task.agency !== filters.agency) return false;
      if (filters.priority && task.priority !== filters.priority) return false;
      if (filters.status && task.taskProgress !== filters.status) return false;
      if (filters.overdueOnly && !task.isOverdue) return false;

      if (filters.dueFrom && task.deadline < filters.dueFrom) return false;
      if (filters.dueTo && task.deadline > filters.dueTo) return false;

      if (query) {
        const haystack = [
          task.taskName,
          task.project,
          task.department,
          task.internalPoc,
          task.agency,
          task.vendor,
          task.id,
          task.taskBrief,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });
  }, [tasks, filters, globalSearch]);

  /* ------------------------------- Sorting ------------------------------ */

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      if (sort.field === 'priority') {
        // Sorted by urgency, not alphabetically — "High" before "Low" is what
        // someone means when they sort by priority.
        return (PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]) * factor;
      }
      if (sort.field === 'deadline') {
        // Tasks with no deadline sort last regardless of direction; they are not
        // "earliest".
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline) * factor;
      }
      return String(a[sort.field]).localeCompare(String(b[sort.field])) * factor;
    });
  }, [filtered, sort]);

  const toggleSort = (field: SortField) => {
    setSort((previous) =>
      previous.field === field
        ? { field, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' }
    );
  };

  /* ------------------------------- Actions ------------------------------ */

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setDrawerOpen(true);
  };

  const handleDelete = async (task: Task) => {
    const confirmed = await confirm({
      title: `Archive "${task.taskName}"?`,
      message:
        'It will be removed from the dashboard. The row stays in the spreadsheet so the history is kept.',
      confirmLabel: 'Archive task',
    });
    if (confirmed) void deleteTask(task.id);
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.length;
    const confirmed = await confirm({
      title: `Archive ${count} task${count === 1 ? '' : 's'}?`,
      message:
        'They will be removed from the dashboard. The rows stay in the spreadsheet so the history is kept.',
      detail: 'This affects every selected task at once.',
      confirmLabel: `Archive ${count}`,
    });
    if (!confirmed) return;
    selectedIds.forEach((id) => void deleteTask(id));
    setSelectedIds([]);
  };

  const allVisibleSelected =
    sorted.length > 0 && selectedIds.length === sorted.length;

  const columns: { field: SortField; label: string; className: string }[] = [
    { field: 'taskName', label: 'Task', className: 'min-w-[240px]' },
    { field: 'project', label: 'Project', className: 'w-44' },
    { field: 'internalPoc', label: 'Assigned to', className: 'w-36' },
    { field: 'priority', label: 'Priority', className: 'w-28' },
    { field: 'taskProgress', label: 'Status', className: 'w-40' },
    { field: 'deadline', label: 'Deadline', className: 'w-28' },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta">
          {sorted.length === tasks.length
            ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
            : `${sorted.length} of ${tasks.length} tasks`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Task view"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'table',
                label: 'Table',
                icon: <TableIcon className="w-3.5 h-3.5" aria-hidden="true" />,
              },
              {
                value: 'board',
                label: 'Board',
                icon: <Columns3 className="w-3.5 h-3.5" aria-hidden="true" />,
              },
            ]}
          />

          <Button
            size="sm"
            icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
            onClick={() => exportTasksToCsv(sorted)}
            disabled={sorted.length === 0}
          >
            Export
          </Button>

          {canEdit && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" aria-hidden="true" />}
              onClick={openCreate}
            >
              New task
            </Button>
          )}
        </div>
      </div>

      <TaskFilters
        filters={filters}
        onChange={setFilters}
        taskCount={sorted.length}
      />

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex items-center justify-between gap-3 px-4 py-2.5 bg-accent-soft border border-accent/30 rounded-lg"
        >
          <p className="text-[13px] font-medium">
            {selectedIds.length} selected
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
              Clear
            </Button>
            {canDelete && (
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
                onClick={() => void handleBulkDelete()}
              >
                Archive
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {sorted.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Inbox className="w-7 h-7" />}
            message={
              tasks.length === 0
                ? 'No tasks yet.'
                : 'No tasks match these filters.'
            }
            hint={
              tasks.length === 0
                ? canEdit
                  ? 'Create the first one to get started.'
                  : 'Tasks created by the team will appear here.'
                : 'Try clearing a filter or the search box.'
            }
          />
        </div>
      ) : view === 'board' ? (
        <KanbanBoard tasks={sorted} onOpen={openEdit} canEdit={canEdit} />
      ) : (
        <>
          {/* Mobile: cards. The table is 1000px wide at minimum, so on a phone it
              was a horizontal-scroll wall with no alternative. */}
          <ul className="md:hidden space-y-2">
            {sorted.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => openEdit(task)}
                  className={`card w-full text-left p-3.5 space-y-2.5 ${
                    task.isOverdue ? 'border-l-2 border-l-rose-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[14px] font-medium leading-snug">
                      {task.taskName}
                    </span>
                    <StatusBadge
                      status={task.taskProgress}
                      isOverdue={task.isOverdue}
                      size="sm"
                      className="shrink-0"
                    />
                  </div>

                  <p className="text-[12.5px] text-fg-subtle truncate">
                    {task.project} · {task.internalPoc}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-line">
                    <PriorityIndicator priority={task.priority} />
                    <span
                      className={`text-[12.5px] tabular ${
                        task.isOverdue
                          ? 'text-rose-600 dark:text-rose-400 font-medium'
                          : 'text-fg-muted'
                      }`}
                    >
                      {task.deadline || 'No deadline'}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden md:block card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">
                  Tasks, sortable by column. Currently sorted by{' '}
                  {columns.find((c) => c.field === sort.field)?.label} in{' '}
                  {sort.direction === 'asc' ? 'ascending' : 'descending'} order.
                </caption>
                <thead>
                  <tr className="border-b border-line bg-surface-sunken/60">
                    <th scope="col" className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        aria-label="Select all visible tasks"
                        onChange={(event) =>
                          setSelectedIds(
                            event.target.checked ? sorted.map((t) => t.id) : []
                          )
                        }
                        className="rounded border-line-strong"
                      />
                    </th>

                    {columns.map((column) => {
                      const active = sort.field === column.field;
                      return (
                        <th
                          key={column.field}
                          scope="col"
                          aria-sort={
                            active
                              ? sort.direction === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                          className={`px-3 py-2.5 ${column.className}`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(column.field)}
                            className="inline-flex items-center gap-1 text-label hover:text-fg transition-colors"
                          >
                            {column.label}
                            {active ? (
                              sort.direction === 'asc' ? (
                                <ArrowUp className="w-3 h-3" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="w-3 h-3" aria-hidden="true" />
                              )
                            ) : null}
                          </button>
                        </th>
                      );
                    })}

                    <th scope="col" className="w-20 px-3 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-line">
                  {sorted.map((task) => {
                    const isSelected = selectedIds.includes(task.id);
                    return (
                      <tr
                        key={task.id}
                        className={`group transition-colors ${
                          isSelected ? 'bg-accent-soft/50' : 'hover:bg-surface-sunken/60'
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            aria-label={`Select ${task.taskName}`}
                            onChange={() =>
                              setSelectedIds((previous) =>
                                previous.includes(task.id)
                                  ? previous.filter((id) => id !== task.id)
                                  : [...previous, task.id]
                              )
                            }
                            className="rounded border-line-strong"
                          />
                        </td>

                        <td className="px-3 py-2.5">
                          {/* The whole cell is the target, not just the text, so
                              the click area matches what looks clickable. */}
                          <button
                            type="button"
                            onClick={() => openEdit(task)}
                            className="text-left w-full group/link"
                          >
                            <span className="flex items-center gap-1.5">
                              {task.isOverdue && (
                                <span
                                  className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="text-[13.5px] font-medium truncate group-hover/link:text-accent transition-colors">
                                {task.taskName}
                              </span>
                            </span>
                            <span className="block font-mono text-[11px] text-fg-subtle mt-0.5">
                              {task.id}
                            </span>
                          </button>
                        </td>

                        <td className="px-3 py-2.5 text-[13px] text-fg-muted truncate">
                          {task.project}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] truncate">
                          {task.internalPoc}
                        </td>
                        <td className="px-3 py-2.5">
                          <PriorityIndicator priority={task.priority} />
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge
                            status={task.taskProgress}
                            isOverdue={task.isOverdue}
                            size="sm"
                          />
                        </td>
                        <td
                          className={`px-3 py-2.5 text-[13px] tabular ${
                            task.isOverdue
                              ? 'text-rose-600 dark:text-rose-400 font-medium'
                              : 'text-fg-muted'
                          }`}
                        >
                          {task.deadline || '—'}
                        </td>

                        <td className="px-3 py-2.5">
                          {/* Revealed on hover for a calmer table, but always
                              present for keyboard and screen-reader users. */}
                          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => openEdit(task)}
                              aria-label={`Edit ${task.taskName}`}
                              className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => void handleDelete(task)}
                                aria-label={`Archive ${task.taskName}`}
                                className="p-1.5 rounded-md text-fg-subtle hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <TaskDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        taskToEdit={editing}
      />

      {confirmDialog}
    </div>
  );
};
