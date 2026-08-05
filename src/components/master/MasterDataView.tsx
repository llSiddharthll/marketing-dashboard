'use client';

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import type { MasterCategory, MasterItem, Task } from '@/types/dashboard';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  Plus,
  Pencil,
  Ban,
  RotateCcw,
  Trash2,
  Lock,
  AlertTriangle,
  FolderKanban,
  Layers,
  Users,
  Building2,
  Briefcase,
} from 'lucide-react';

const CATEGORY_ICONS: Record<MasterCategory, React.ElementType> = {
  Projects: FolderKanban,
  Departments: Layers,
  'Team Members': Users,
  Agencies: Building2,
  Vendors: Briefcase,
};

const CATEGORIES: MasterCategory[] = [
  'Projects',
  'Departments',
  'Team Members',
  'Agencies',
  'Vendors',
];

function singular(category: MasterCategory): string {
  return category === 'Team Members'
    ? 'team member'
    : category.replace(/s$/, '').toLowerCase();
}

/**
 * The shared lists behind every dropdown.
 *
 * Renaming cascades server-side to every task that referenced the old name, and
 * removing an in-use item deactivates it instead of deleting it — the
 * confirmation dialog asks the server for the reference count first, so the
 * person always knows which of the two is about to happen.
 */
export const MasterDataView: React.FC = () => {
  const {
    masterItems,
    tasks,
    addMasterItem,
    updateMasterItem,
    removeMasterItem,
    inspectMasterItem,
    currentUserRole,
  } = useData();

  const [category, setCategory] = useState<MasterCategory>('Projects');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MasterItem | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const [removal, setRemoval] = useState<{
    item: MasterItem;
    referenceCount: number | null;
    loading: boolean;
  } | null>(null);

  const canManage =
    currentUserRole === 'Admin' || currentUserRole === 'Marketing Team';

  const items = useMemo(
    () => masterItems.filter((item) => item.category === category),
    [masterItems, category]
  );

  const usageField = {
    Projects: 'project',
    Departments: 'department',
    'Team Members': 'internalPoc',
    Agencies: 'agency',
    Vendors: 'vendor',
  }[category] as 'project' | 'department' | 'internalPoc' | 'agency' | 'vendor';

  /** Live usage per item name, shown in the table so "can I remove this?" is
   *  answerable at a glance rather than only inside the removal dialog. */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const value = task[usageField];
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }, [tasks, usageField]);

  /** The tasks a given item's name is actually used by, for the listing dialog. */
  const tasksFor = (item: MasterItem): Task[] =>
    tasks.filter((task) => task[usageField] === item.name);

  const [taskListItem, setTaskListItem] = useState<MasterItem | null>(null);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setNameError(null);
    setEditorOpen(true);
  };

  const openEdit = (item: MasterItem) => {
    setEditing(item);
    setName(item.name);
    setDescription(item.description ?? '');
    setNameError(null);
    setEditorOpen(true);
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('A name is required.');
      return;
    }

    if (editing) {
      await updateMasterItem(editing, {
        name: trimmed,
        description: description.trim(),
      });
    } else {
      await addMasterItem(category, trimmed, description.trim());
    }
    setEditorOpen(false);
  };

  const openRemove = async (item: MasterItem) => {
    setRemoval({ item, referenceCount: null, loading: true });
    const info = await inspectMasterItem(item);
    setRemoval({
      item,
      referenceCount: info?.referenceCount ?? null,
      loading: false,
    });
  };

  const confirmRemove = async () => {
    if (!removal) return;
    await removeMasterItem(removal.item);
    setRemoval(null);
  };

  const renameAffects = editing ? (usage.get(editing.name) ?? 0) : 0;

  return (
    <div className="space-y-4">
      {!canManage && (
        <div
          role="status"
          className="flex items-start gap-2 p-3.5 rounded-lg bg-surface-sunken border border-line text-[13px] text-fg-muted"
        >
          <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            You are signed in as {currentUserRole}, which has read-only access to
            these lists.
          </span>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Master data category"
          className="flex items-center gap-1 overflow-x-auto"
        >
          {CATEGORIES.map((option) => {
            const Icon = CATEGORY_ICONS[option];
            const count = masterItems.filter(
              (item) => item.category === option
            ).length;
            const active = category === option;
            return (
              <button
                key={option}
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(option)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-surface border border-line-strong text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg hover:bg-surface-sunken border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {option}
                <span className="text-[11.5px] text-fg-subtle tabular">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {canManage && (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" aria-hidden="true" />}
            onClick={openAdd}
          >
            Add {singular(category)}
          </Button>
        )}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="card">
          <EmptyState
            message={`No ${category.toLowerCase()} yet.`}
            hint={
              canManage
                ? `Add the first ${singular(category)} to make it available in every dropdown.`
                : undefined
            }
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line bg-surface-sunken/60">
                  <th scope="col" className="px-4 py-2.5 min-w-44">
                    <span className="text-label">Name</span>
                  </th>
                  <th scope="col" className="px-4 py-2.5 hidden sm:table-cell">
                    <span className="text-label">Notes</span>
                  </th>
                  <th scope="col" className="px-4 py-2.5 w-28">
                    <span className="text-label">Used by</span>
                  </th>
                  <th scope="col" className="px-4 py-2.5 w-28">
                    <span className="text-label">Status</span>
                  </th>
                  {canManage && (
                    <th scope="col" className="px-4 py-2.5 w-28 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((item) => {
                  const references = usage.get(item.name) ?? 0;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-surface-sunken/60 transition-colors"
                    >
                      <td className="px-4 py-3 text-[13.5px] font-medium">
                        {item.name}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-fg-muted hidden sm:table-cell">
                        <span className="block truncate max-w-72">
                          {item.description || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] tabular">
                        {references === 0 ? (
                          <span className="text-fg-muted">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setTaskListItem(item)}
                            className="text-accent hover:underline"
                          >
                            {references} task{references === 1 ? '' : 's'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[12px] font-medium ${
                            item.status === 'Active'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900'
                              : 'bg-surface-sunken text-fg-subtle border-line'
                          }`}
                        >
                          {item.status === 'Active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={() => openEdit(item)}
                              aria-label={`Edit ${item.name}`}
                              className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void updateMasterItem(item, {
                                  status:
                                    item.status === 'Active'
                                      ? 'Inactive'
                                      : 'Active',
                                })
                              }
                              aria-label={
                                item.status === 'Active'
                                  ? `Deactivate ${item.name}`
                                  : `Reactivate ${item.name}`
                              }
                              title={
                                item.status === 'Active'
                                  ? 'Hide from new dropdowns'
                                  : 'Offer in dropdowns again'
                              }
                              className="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-surface transition-colors"
                            >
                              {item.status === 'Active' ? (
                                <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                              ) : (
                                <RotateCcw
                                  className="w-3.5 h-3.5"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void openRemove(item)}
                              aria-label={`Remove ${item.name}`}
                              className="p-1.5 rounded-md text-fg-subtle hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[12.5px] text-fg-subtle">
        Inactive items stop appearing in dropdowns for new tasks but stay visible
        on the tasks that already use them. Renaming updates every task that
        references the old name.
      </p>

      {/* Add / edit */}
      <Dialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={
          editing ? `Edit ${editing.name}` : `Add a ${singular(category)}`
        }
        size="md"
        disableBackdropClose
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleSubmit()}>
              {editing ? 'Save changes' : `Add ${singular(category)}`}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="master-name" className="field-label">
              Name
              <span className="text-rose-500 ml-0.5" aria-hidden="true">
                *
              </span>
              <span className="sr-only">(required)</span>
            </label>
            <input
              id="master-name"
              data-autofocus
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
              aria-invalid={nameError ? true : undefined}
              className={`field ${nameError ? 'border-rose-400 dark:border-rose-700' : ''}`}
            />
            {nameError && (
              <p className="mt-1 text-[12.5px] text-rose-600 dark:text-rose-400">
                {nameError}
              </p>
            )}
            {editing && renameAffects > 0 && name.trim() !== editing.name && (
              <p className="mt-1.5 text-[12.5px] text-amber-700 dark:text-amber-300">
                Renaming updates the {renameAffects} task
                {renameAffects === 1 ? '' : 's'} that currently use &quot;
                {editing.name}&quot;.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="master-description" className="field-label">
              Notes
            </label>
            <textarea
              id="master-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional context for the rest of the team."
              className="field resize-y"
            />
          </div>
        </div>
      </Dialog>

      {/* Remove — states which of the two outcomes will happen, before it does */}
      <Dialog
        open={removal !== null}
        onClose={() => setRemoval(null)}
        title={removal ? `Remove ${removal.item.name}?` : ''}
        size="sm"
        hideCloseButton
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoval(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={removal?.loading}
              onClick={() => void confirmRemove()}
            >
              {removal && (removal.referenceCount ?? 0) > 0
                ? 'Mark inactive'
                : 'Remove'}
            </Button>
          </div>
        }
      >
        {removal && (
          <div className="flex items-start gap-3">
            <span
              className="shrink-0 w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center"
              aria-hidden="true"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </span>
            <div className="text-[13.5px] text-fg-muted space-y-2 leading-relaxed">
              {removal.loading ? (
                <p>Checking how many tasks use it…</p>
              ) : removal.referenceCount === null ? (
                <p>
                  Could not check usage right now. If any task references it, it
                  will be marked inactive instead of removed.
                </p>
              ) : removal.referenceCount > 0 ? (
                <p>
                  <strong className="text-fg">
                    {removal.referenceCount} task
                    {removal.referenceCount === 1 ? '' : 's'}
                  </strong>{' '}
                  reference this {singular(removal.item.category)}, so it will be
                  marked <strong className="text-fg">inactive</strong> — hidden
                  from new dropdowns, but those tasks keep their value.
                </p>
              ) : (
                <p>
                  Nothing references it, so it will be removed from all
                  dropdowns. The row stays in the spreadsheet for the audit
                  trail.
                </p>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* Tasks under a project/department/agency/vendor/team member — brief +
          status, so "what's happening under CP67?" doesn't need the full task
          list filtered by hand. */}
      <Dialog
        open={taskListItem !== null}
        onClose={() => setTaskListItem(null)}
        title={taskListItem ? `Tasks under ${taskListItem.name}` : ''}
        size="lg"
      >
        {taskListItem && (
          <ul className="space-y-2">
            {tasksFor(taskListItem).map((task) => (
              <li
                key={task.id}
                className="p-3 rounded-lg border border-line space-y-1.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[13.5px] font-medium leading-snug">
                    {task.taskName}
                  </span>
                  <StatusBadge
                    status={task.taskProgress}
                    isOverdue={task.isOverdue}
                    size="sm"
                    className="shrink-0"
                  />
                </div>
                {task.taskBrief && (
                  <p className="text-[12.5px] text-fg-muted leading-relaxed">
                    {task.taskBrief}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-subtle">
                  <span>{task.internalPoc}</span>
                  {task.deadline && <span>Due {task.deadline}</span>}
                  {task.budget ? (
                    <span>₹{task.budget.toLocaleString('en-IN')}</span>
                  ) : null}
                  {task.taskProgress === 'To Be Approved by Management' &&
                    !task.boqLink && (
                      <span className="text-amber-700 dark:text-amber-300">
                        BOQ not attached yet
                      </span>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
};
