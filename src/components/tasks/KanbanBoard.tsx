'use client';

/**
 * Kanban board.
 *
 * The table/board toggle existed in the previous build but only the table branch
 * was ever rendered, so choosing "Kanban" showed a blank screen. This is the
 * missing view.
 *
 * Drag and drop uses the native HTML drag events rather than a library: the only
 * gesture needed is "move a card to another column", and a dependency for that
 * would cost more than it saves. Because native drag does not work on touch,
 * every card also has a status dropdown — which doubles as the keyboard path, so
 * the board is fully usable without dragging at all.
 */

import React, { useMemo, useState } from 'react';
import type { Task, TaskStatus } from '@/types/dashboard';
import { useData } from '@/context/DataContext';
import { PriorityIndicator } from '@/components/ui/StatusBadge';
import { TaskLinkButton } from '@/components/ui/TaskLinkButton';
import { STATUS_VISUALS } from '@/lib/design/statusStyles';
import { daysBetween, today } from '@/lib/dates';
import { TASK_STATUSES } from '@/lib/sheets/schema';
import { GripVertical, MessageSquare, CheckSquare } from 'lucide-react';

interface KanbanBoardProps {
  tasks: Task[];
  onOpen: (task: Task) => void;
  canEdit: boolean;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  onOpen,
  canEdit,
}) => {
  const { updateTask, showToast } = useData();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [hideEmpty, setHideEmpty] = useState(false);

  const columns = useMemo(() => {
    return TASK_STATUSES.map((status) => ({
      status,
      visual: STATUS_VISUALS[status],
      items: tasks.filter((task) => task.taskProgress === status),
    }));
  }, [tasks]);

  const displayedColumns = useMemo(() => {
    if (!hideEmpty) return columns;
    const active = columns.filter((col) => col.items.length > 0);
    return active.length > 0 ? active : columns;
  }, [columns, hideEmpty]);

  const moveTask = (task: Task, status: TaskStatus) => {
    if (task.taskProgress === status) return;

    if (!canEdit) {
      showToast('error', 'You do not have permission to change task status.');
      return;
    }

    // Approving is a management decision with its own endpoint and audit entry,
    // so it must not be reachable by dropping a card into the Completed column.
    if (
      task.taskProgress === 'To Be Approved by Management' &&
      status === 'Completed'
    ) {
      showToast(
        'error',
        'This task is awaiting management approval.',
        'Approve it from the Pending approvals page so the decision is recorded.'
      );
      return;
    }

    void updateTask({ ...task, taskProgress: status });
  };

  return (
    <div className="card p-4 space-y-3 w-full min-w-0 max-w-full overflow-hidden">
      {/* Board controls bar */}
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-line">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg">Kanban Board</span>
          <span className="text-[12px] font-medium text-fg-subtle tabular">
            {displayedColumns.length} of {columns.length} columns
          </span>
        </div>

        <label className="flex items-center gap-1.5 text-[12.5px] text-fg-muted cursor-pointer hover:text-fg transition-colors">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(event) => setHideEmpty(event.target.checked)}
            className="rounded border-line-strong accent-accent"
          />
          Hide empty columns
        </label>
      </div>

      {/* Scrollable Columns Container */}
      <div className="w-full min-w-0 overflow-x-auto pb-2 pt-1 scrollbar-thin">
        <div className="flex gap-3.5 min-w-max pb-1">
          {displayedColumns.map((column) => {
            const isTarget = dragOverColumn === column.status;

            return (
              <section
                key={column.status}
                aria-label={`${column.visual.label}, ${column.items.length} tasks`}
                onDragOver={(event) => {
                  if (!draggingId) return;
                  // Required for the drop event to fire at all.
                  event.preventDefault();
                  setDragOverColumn(column.status);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOverColumn(null);
                  const task = tasks.find((item) => item.id === draggingId);
                  if (task) moveTask(task, column.status);
                  setDraggingId(null);
                }}
                className={`w-64 sm:w-72 shrink-0 flex flex-col rounded-xl border transition-colors ${
                  isTarget
                    ? 'border-accent bg-accent-soft/40'
                    : 'border-line bg-surface-sunken/60'
                }`}
              >
              {/* Column header */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${column.visual.dot}`}
                  aria-hidden="true"
                />
                <h3 className="text-[13px] font-semibold text-fg flex-1 truncate">
                  {column.visual.label}
                </h3>
                <span className="text-[12px] font-medium text-fg-subtle tabular">
                  {column.items.length}
                </span>
              </div>

              {/* Cards */}
              <ul className="flex-1 p-2 space-y-2 min-h-24">
                {column.items.length === 0 ? (
                  <li className="px-2 py-6 text-center text-[12.5px] text-fg-subtle">
                    {isTarget ? 'Drop here' : 'Nothing here'}
                  </li>
                ) : (
                  column.items.map((task) => (
                    <li key={task.id}>
                      <article
                        draggable={canEdit}
                        onDragStart={(event) => {
                          setDraggingId(task.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragOverColumn(null);
                        }}
                        className={`card p-3 space-y-2.5 ${
                          canEdit ? 'cursor-grab active:cursor-grabbing' : ''
                        } ${draggingId === task.id ? 'opacity-40' : ''} ${
                          task.isOverdue
                            ? 'border-l-2 border-l-rose-500'
                            : ''
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          {canEdit && (
                            <GripVertical
                              className="w-3.5 h-3.5 mt-0.5 shrink-0 text-fg-subtle"
                              aria-hidden="true"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => onOpen(task)}
                            className="flex-1 text-left min-w-0"
                          >
                            <span className="block text-[13.5px] font-medium text-fg leading-snug line-clamp-2">
                              {task.taskName}
                            </span>
                            <span className="block text-[12px] text-fg-subtle truncate mt-0.5">
                              {task.project}
                            </span>
                          </button>
                          <TaskLinkButton task={task} size="sm" />
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <PriorityIndicator priority={task.priority} iconOnly />

                          <div className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
                            {(task.subtasks?.length ?? 0) > 0 && (
                              <span
                                className="flex items-center gap-0.5"
                                title={`${task.subtasks!.filter((s) => s.completed).length} of ${task.subtasks!.length} done`}
                              >
                                <CheckSquare
                                  className="w-3 h-3"
                                  aria-hidden="true"
                                />
                                {task.subtasks!.filter((s) => s.completed).length}/
                                {task.subtasks!.length}
                              </span>
                            )}
                            {(task.comments?.length ?? 0) > 0 && (
                              <span className="flex items-center gap-0.5">
                                <MessageSquare
                                  className="w-3 h-3"
                                  aria-hidden="true"
                                />
                                {task.comments!.length}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-line">
                          <span
                            className={`text-[11.5px] tabular ${
                              task.isOverdue
                                ? 'text-rose-600 dark:text-rose-400 font-medium'
                                : 'text-fg-subtle'
                            }`}
                          >
                            {deadlineLabel(task)}
                          </span>
                          <span className="text-[11.5px] text-fg-subtle truncate max-w-24">
                            {task.internalPoc}
                          </span>
                        </div>

                        {/* Touch and keyboard path. Native drag does not work on
                            phones, so without this the board would be read-only
                            on the devices the brief requires support for. */}
                        {canEdit && (
                          <>
                            <label
                              htmlFor={`move-${task.id}`}
                              className="sr-only"
                            >
                              Move {task.taskName} to another status
                            </label>
                            <select
                              id={`move-${task.id}`}
                              value={task.taskProgress}
                              onChange={(event) =>
                                moveTask(
                                  task,
                                  event.target.value as TaskStatus
                                )
                              }
                              className="w-full text-[12px] px-2 py-1 bg-surface-sunken border border-line rounded-md text-fg-muted"
                            >
                              {TASK_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {STATUS_VISUALS[status].label}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                      </article>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  </div>
);
};

function deadlineLabel(task: Task): string {
  if (!task.deadline) return 'No deadline';
  const days = daysBetween(today(), task.deadline);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days <= 7) return `${days}d left`;
  return task.deadline;
}
