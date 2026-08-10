'use client';

/**
 * Create / edit task dialog.
 *
 * Rebuilt on the shared `Dialog`, so it now has a dialog role, a focus trap,
 * Escape-to-close and focus restoration — none of which the previous drawer had.
 *
 * Form state is one object rather than seventeen `useState` calls, initialised
 * with a key-reset instead of a `useEffect` that fired seventeen setters on open.
 * Validation is the shared validator, so the inline messages are exactly what the
 * server would reject.
 */

import React, { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import type { Priority, Task, TaskStatus } from '@/types/dashboard';
import { InlineMasterSelect } from '@/components/master/InlineMasterSelect';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { STATUS_VISUALS } from '@/lib/design/statusStyles';
import { PRIORITY_ORDER } from '@/lib/design/statusStyles';
import { TASK_STATUSES } from '@/lib/sheets/schema';
import { today } from '@/lib/dates';
import {
  hasErrors,
  isPlausibleUrl,
  validateTaskInput,
  type FieldErrors,
} from '@/lib/validation';
import {
  Lock,
  Trash2,
  Plus,
  Send,
  XCircle,
  Info,
  Paperclip,
  ExternalLink,
} from 'lucide-react';

interface TaskDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  taskToEdit?: Task | null;
}

type TabId = 'details' | 'checklist' | 'comments' | 'attachments' | 'history';

interface FormState {
  project: string;
  taskName: string;
  taskBrief: string;
  department: string;
  internalPoc: string;
  agency: string;
  vendor: string;
  priority: Priority;
  taskProgress: TaskStatus;
  deadline: string;
  executionStarted: boolean;
  toBeApprovedByManagement: boolean;
  remarks: string;
  budget: number;
  actualSpend: number;
  boqLink: string;
  reportLink: string;
  approver: string;
}

function initialState(task: Task | null | undefined): FormState {
  if (!task) {
    return {
      project: '',
      taskName: '',
      taskBrief: '',
      department: '',
      internalPoc: '',
      agency: '',
      vendor: '',
      priority: 'Medium',
      taskProgress: 'Not Started',
      deadline: today(),
      executionStarted: false,
      toBeApprovedByManagement: false,
      remarks: '',
      budget: 0,
      actualSpend: 0,
      boqLink: '',
      reportLink: '',
      approver: '',
    };
  }
  return {
    project: task.project,
    taskName: task.taskName,
    taskBrief: task.taskBrief,
    department: task.department,
    internalPoc: task.internalPoc,
    agency: task.agency,
    vendor: task.vendor,
    priority: task.priority,
    taskProgress: task.taskProgress,
    deadline: task.deadline,
    executionStarted: task.executionStarted,
    toBeApprovedByManagement: task.toBeApprovedByManagement,
    remarks: task.remarks,
    budget: task.budget ?? 0,
    actualSpend: task.actualSpend ?? 0,
    boqLink: task.boqLink ?? '',
    reportLink: task.reportLink ?? '',
    approver: task.approver ?? '',
  };
}

export const TaskDrawer: React.FC<TaskDrawerProps> = (props) => {
  // Remounting on a different task resets all form state without an effect,
  // which is what the `set-state-in-effect` warning was pointing at.
  return props.isOpen ? (
    <TaskDrawerForm key={props.taskToEdit?.id ?? 'new'} {...props} />
  ) : null;
};

const TaskDrawerForm: React.FC<TaskDrawerProps> = ({
  onClose,
  taskToEdit,
}) => {
  const {
    addTask,
    updateTask,
    deleteTask,
    activityLogs,
    currentUserRole,
    currentUserName,
    toggleSubtask,
    addSubtask,
    addComment,
    addAttachment,
    removeAttachment,
  } = useData();

  const { confirm, confirmDialog } = useConfirm();

  const [form, setForm] = useState<FormState>(() => initialState(taskToEdit));
  const [tab, setTab] = useState<TabId>('details');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [newAttachmentLabel, setNewAttachmentLabel] = useState('');
  const [newAttachmentUrl, setNewAttachmentUrl] = useState('');
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const isEdit = Boolean(taskToEdit);
  const isAdmin = currentUserRole === 'Admin';
  const canEdit = isAdmin || currentUserRole === 'Marketing Team';
  const isReadOnly = !canEdit;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    // Clear the message for a field as soon as the user edits it, rather than
    // making them resubmit to find out whether it is fixed.
    if (errors[key]) {
      setErrors((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  };

  /** Completion date is locked once set, unless an Admin reopens the task. */
  const completionLocked =
    Boolean(taskToEdit?.actualFinishedDate) && !isAdmin;

  const history = useMemo(
    () =>
      taskToEdit
        ? activityLogs.filter((entry) => entry.target === taskToEdit.id)
        : [],
    [activityLogs, taskToEdit]
  );

  const handleSubmit = async () => {
    const validationErrors = validateTaskInput(form);
    if (hasErrors(validationErrors)) {
      setErrors(validationErrors);
      // Field errors all live on the details tab, so send the user there.
      setTab('details');
      return;
    }

    setSubmitting(true);
    try {
      if (taskToEdit) await updateTask({ ...taskToEdit, ...form });
      else await addTask(form);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!taskToEdit) return;
    const confirmed = await confirm({
      title: `Archive "${taskToEdit.taskName}"?`,
      message:
        'It will be removed from the dashboard. The row stays in the spreadsheet so the history is kept.',
      confirmLabel: 'Archive task',
    });
    if (!confirmed) return;
    await deleteTask(taskToEdit.id);
    onClose();
  };

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'details', label: 'Details' },
    {
      id: 'checklist',
      label: 'Checklist',
      count: taskToEdit?.subtasks?.length,
    },
    { id: 'comments', label: 'Comments', count: taskToEdit?.comments?.length },
    {
      id: 'attachments',
      label: 'Attachments',
      count: taskToEdit?.attachments?.length,
    },
    { id: 'history', label: 'History', count: history.length },
  ];

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={isEdit ? 'Edit task' : 'New task'}
        description={
          isEdit ? `${taskToEdit!.id} · ${taskToEdit!.project}` : undefined
        }
        size="lg"
        // A half-filled form must not be lost to a stray backdrop click.
        disableBackdropClose
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {isEdit && isAdmin && (
                <Button
                  variant="danger-ghost"
                  size="sm"
                  icon={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
                  onClick={() => void handleDelete()}
                >
                  Archive
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              {!isReadOnly && (
                <Button
                  variant="primary"
                  loading={submitting}
                  onClick={() => void handleSubmit()}
                >
                  {isEdit ? 'Save changes' : 'Create task'}
                </Button>
              )}
            </div>
          </div>
        }
      >
        {isReadOnly && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-surface-sunken border border-line text-[13px] text-fg-muted"
          >
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              You have read-only access as {currentUserRole}. Ask an
              administrator if you need to make changes.
            </span>
          </div>
        )}

        {/* Tabs. Only offered on an existing task: a task that does not exist yet
            has no checklist, comments or history to show. */}
        {isEdit && (
          <div
            role="tablist"
            aria-label="Task sections"
            className="flex items-center gap-1 mb-4 border-b border-line -mx-5 px-5"
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`px-3 py-2 -mb-px border-b-2 text-[13px] font-medium transition-colors ${
                  tab === item.id
                    ? 'border-accent text-fg'
                    : 'border-transparent text-fg-subtle hover:text-fg'
                }`}
              >
                {item.label}
                {item.count !== undefined && item.count > 0 && (
                  <span className="ml-1.5 text-[11px] text-fg-subtle tabular">
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ------------------------------ Details ------------------------- */}
        {tab === 'details' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="task-name" className="field-label">
                Task name
                <span className="text-rose-500 ml-0.5" aria-hidden="true">
                  *
                </span>
                <span className="sr-only">(required)</span>
              </label>
              <input
                id="task-name"
                data-autofocus
                type="text"
                value={form.taskName}
                onChange={(event) => set('taskName', event.target.value)}
                disabled={isReadOnly}
                aria-invalid={errors.taskName ? true : undefined}
                aria-describedby={errors.taskName ? 'task-name-error' : undefined}
                placeholder="What needs to be done?"
                className={`field ${errors.taskName ? 'border-rose-400 dark:border-rose-700' : ''}`}
              />
              {errors.taskName && (
                <p
                  id="task-name-error"
                  className="mt-1 text-[12.5px] text-rose-600 dark:text-rose-400"
                >
                  {errors.taskName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="task-brief" className="field-label">
                Brief
              </label>
              <textarea
                id="task-brief"
                rows={3}
                value={form.taskBrief}
                onChange={(event) => set('taskBrief', event.target.value)}
                disabled={isReadOnly}
                placeholder="Context, deliverables, anything the assignee needs to know."
                className="field resize-y"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InlineMasterSelect
                label="Project"
                category="Projects"
                value={form.project}
                onChange={(value) => set('project', value)}
                required
                error={errors.project}
              />
              <InlineMasterSelect
                label="Department"
                category="Departments"
                value={form.department}
                onChange={(value) => set('department', value)}
                required
                error={errors.department}
              />
              <InlineMasterSelect
                label="Assigned to"
                category="Team Members"
                value={form.internalPoc}
                onChange={(value) => set('internalPoc', value)}
                required
                error={errors.internalPoc}
              />
              <InlineMasterSelect
                label="Agency"
                category="Agencies"
                value={form.agency}
                onChange={(value) => set('agency', value)}
              />
              <InlineMasterSelect
                label="Vendor"
                category="Vendors"
                value={form.vendor}
                onChange={(value) => set('vendor', value)}
              />

              <div>
                <label htmlFor="task-priority" className="field-label">
                  Priority
                </label>
                <select
                  id="task-priority"
                  value={form.priority}
                  onChange={(event) =>
                    set('priority', event.target.value as Priority)
                  }
                  disabled={isReadOnly}
                  className="field"
                >
                  {PRIORITY_ORDER.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="task-status" className="field-label">
                  Status
                </label>
                <select
                  id="task-status"
                  value={form.taskProgress}
                  onChange={(event) =>
                    set('taskProgress', event.target.value as TaskStatus)
                  }
                  disabled={isReadOnly}
                  className="field"
                >
                  {TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_VISUALS[status].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="task-deadline" className="field-label">
                  Deadline
                  <span className="text-rose-500 ml-0.5" aria-hidden="true">
                    *
                  </span>
                  <span className="sr-only">(required)</span>
                </label>
                <input
                  id="task-deadline"
                  type="date"
                  value={form.deadline}
                  onChange={(event) => set('deadline', event.target.value)}
                  disabled={isReadOnly}
                  aria-invalid={errors.deadline ? true : undefined}
                  aria-describedby={
                    errors.deadline ? 'task-deadline-error' : undefined
                  }
                  className={`field ${errors.deadline ? 'border-rose-400 dark:border-rose-700' : ''}`}
                />
                {errors.deadline && (
                  <p
                    id="task-deadline-error"
                    className="mt-1 text-[12.5px] text-rose-600 dark:text-rose-400"
                  >
                    {errors.deadline}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="task-budget" className="field-label">
                  Budget (₹)
                </label>
                <input
                  id="task-budget"
                  type="number"
                  min={0}
                  step={100}
                  value={form.budget || ''}
                  onChange={(event) =>
                    set('budget', Number(event.target.value) || 0)
                  }
                  disabled={isReadOnly}
                  aria-invalid={errors.budget ? true : undefined}
                  className="field tabular"
                />
                {errors.budget && (
                  <p className="mt-1 text-[12.5px] text-rose-600 dark:text-rose-400">
                    {errors.budget}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="task-spend" className="field-label">
                  Actual spend (₹)
                </label>
                <input
                  id="task-spend"
                  type="number"
                  min={0}
                  step={100}
                  value={form.actualSpend || ''}
                  onChange={(event) =>
                    set('actualSpend', Number(event.target.value) || 0)
                  }
                  disabled={isReadOnly}
                  aria-invalid={errors.actualSpend ? true : undefined}
                  className="field tabular"
                />
                {errors.actualSpend && (
                  <p className="mt-1 text-[12.5px] text-rose-600 dark:text-rose-400">
                    {errors.actualSpend}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="task-report-link" className="field-label flex items-center justify-between">
                  <span>Report / Google Link (URL)</span>
                  {form.reportLink && (
                    <a
                      href={form.reportLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11.5px] font-medium text-accent hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Test link
                    </a>
                  )}
                </label>
                <input
                  id="task-report-link"
                  type="url"
                  value={form.reportLink}
                  onChange={(event) => set('reportLink', event.target.value)}
                  disabled={isReadOnly}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="field"
                />
              </div>

              <div>
                <label htmlFor="task-boq-link" className="field-label flex items-center justify-between">
                  <span>BOQ link</span>
                  {form.boqLink && (
                    <a
                      href={form.boqLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11.5px] font-medium text-accent hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Test link
                    </a>
                  )}
                </label>
                <input
                  id="task-boq-link"
                  type="url"
                  value={form.boqLink}
                  onChange={(event) => set('boqLink', event.target.value)}
                  disabled={isReadOnly}
                  placeholder="https://docs.google.com/..."
                  aria-invalid={errors.boqLink ? true : undefined}
                  className={`field ${errors.boqLink ? 'border-rose-400 dark:border-rose-700' : ''}`}
                />
                {errors.boqLink && (
                  <p className="mt-1 text-[12.5px] text-rose-600 dark:text-rose-400">
                    {errors.boqLink}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="task-approver" className="field-label">
                  Approver
                </label>
                <input
                  id="task-approver"
                  type="text"
                  value={form.approver}
                  onChange={(event) => set('approver', event.target.value)}
                  disabled={isReadOnly}
                  placeholder="Who this approval routes to"
                  aria-invalid={errors.approver ? true : undefined}
                  className={`field ${errors.approver ? 'border-rose-400 dark:border-rose-700' : ''}`}
                />
                {errors.approver && (
                  <p className="mt-1 text-[12.5px] text-rose-600 dark:text-rose-400">
                    {errors.approver}
                  </p>
                )}
              </div>
            </div>

            {/* Workflow toggles */}
            <fieldset className="space-y-2.5 pt-2 border-t border-line">
              <legend className="field-label mb-1">Workflow</legend>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.executionStarted}
                  onChange={(event) =>
                    set('executionStarted', event.target.checked)
                  }
                  disabled={isReadOnly}
                  className="mt-0.5 rounded border-line-strong"
                />
                <span>
                  <span className="block text-[13.5px] font-medium">
                    Execution has started
                  </span>
                  <span className="block text-[12.5px] text-fg-subtle">
                    {taskToEdit?.executionStartDate
                      ? `Started ${taskToEdit.executionStartDate}.`
                      : "The start date is recorded when you save, and doesn't change afterwards."}
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.toBeApprovedByManagement}
                  onChange={(event) =>
                    set('toBeApprovedByManagement', event.target.checked)
                  }
                  disabled={isReadOnly}
                  className="mt-0.5 rounded border-line-strong"
                />
                <span>
                  <span className="block text-[13.5px] font-medium">
                    Send for management approval
                  </span>
                  <span className="block text-[12.5px] text-fg-subtle">
                    Moves this task to Pending approvals and notifies management.
                  </span>
                </span>
              </label>
            </fieldset>

            {/* Read-only, server-managed dates */}
            {isEdit && (
              <div className="pt-2 border-t border-line space-y-2">
                <p className="field-label mb-0 flex items-center gap-1.5">
                  <Info className="w-3 h-3" aria-hidden="true" />
                  Recorded automatically
                </p>
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[13px]">
                  {[
                    ['Started', taskToEdit!.executionStartDate],
                    ['Finished', taskToEdit!.actualFinishedDate],
                    ['Approved', taskToEdit!.approvalDate],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[12px] text-fg-subtle">{label}</dt>
                      <dd className="tabular text-fg-muted">
                        {value || 'Not yet'}
                      </dd>
                    </div>
                  ))}
                </dl>
                {completionLocked && (
                  <p className="text-[12.5px] text-fg-subtle flex items-center gap-1.5">
                    <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                    The completion date is locked. An administrator can reopen the
                    task to change it.
                  </p>
                )}
                {taskToEdit!.rejectionReason && (
                  <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
                    <p className="text-[12.5px] font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      Sent back by management
                    </p>
                    <p className="text-[13px] text-rose-800 dark:text-rose-200 mt-1">
                      {taskToEdit!.rejectionReason}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div>
              <label htmlFor="task-remarks" className="field-label">
                Remarks
              </label>
              <textarea
                id="task-remarks"
                rows={2}
                value={form.remarks}
                onChange={(event) => set('remarks', event.target.value)}
                disabled={isReadOnly}
                className="field resize-y"
              />
            </div>
          </div>
        )}

        {/* ----------------------------- Checklist ------------------------ */}
        {tab === 'checklist' && taskToEdit && (
          <div className="space-y-3">
            {(taskToEdit.subtasks?.length ?? 0) === 0 ? (
              <p className="text-body text-fg-muted py-4 text-center">
                No checklist items yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {taskToEdit.subtasks!.map((subtask) => (
                  <li key={subtask.id}>
                    <label className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-sunken cursor-pointer">
                      <input
                        type="checkbox"
                        checked={subtask.completed}
                        onChange={() =>
                          void toggleSubtask(taskToEdit.id, subtask.id)
                        }
                        disabled={isReadOnly}
                        className="rounded border-line-strong"
                      />
                      <span
                        className={`text-[13.5px] ${
                          subtask.completed
                            ? 'line-through text-fg-subtle'
                            : 'text-fg'
                        }`}
                      >
                        {subtask.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {!isReadOnly && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!newSubtask.trim()) return;
                  void addSubtask(taskToEdit.id, newSubtask);
                  setNewSubtask('');
                }}
                className="flex items-center gap-2 pt-2 border-t border-line"
              >
                <label htmlFor="new-subtask" className="sr-only">
                  New checklist item
                </label>
                <input
                  id="new-subtask"
                  type="text"
                  value={newSubtask}
                  onChange={(event) => setNewSubtask(event.target.value)}
                  placeholder="Add a checklist item"
                  className="field flex-1"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  iconOnly
                  aria-label="Add checklist item"
                  disabled={!newSubtask.trim()}
                  icon={<Plus className="w-4 h-4" aria-hidden="true" />}
                />
              </form>
            )}
          </div>
        )}

        {/* ----------------------------- Comments ------------------------- */}
        {tab === 'comments' && taskToEdit && (
          <div className="space-y-3">
            {(taskToEdit.comments?.length ?? 0) === 0 ? (
              <p className="text-body text-fg-muted py-4 text-center">
                No comments yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {taskToEdit.comments!.map((comment) => (
                  <li key={comment.id} className="flex gap-2.5">
                    <span className="shrink-0 w-7 h-7 rounded-lg bg-surface-sunken flex items-center justify-center text-[11px] font-semibold text-fg-muted">
                      {comment.author.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium">
                          {comment.author}
                        </span>
                        <span className="text-[11.5px] text-fg-subtle">
                          {new Date(comment.timestamp).toLocaleString()}
                        </span>
                      </p>
                      <p className="text-[13.5px] text-fg-muted mt-0.5 wrap-break-word">
                        {comment.text}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!newComment.trim()) return;
                void addComment(taskToEdit.id, newComment);
                setNewComment('');
              }}
              className="space-y-2 pt-2 border-t border-line"
            >
              <label htmlFor="new-comment" className="sr-only">
                Add a comment
              </label>
              <textarea
                id="new-comment"
                rows={2}
                value={newComment}
                onChange={(event) => setNewComment(event.target.value)}
                placeholder={`Add a comment as ${currentUserName}`}
                className="field resize-y"
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!newComment.trim()}
                  icon={<Send className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  Comment
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* --------------------------- Attachments ------------------------- */}
        {tab === 'attachments' && taskToEdit && (
          <div className="space-y-3">
            {(taskToEdit.attachments?.length ?? 0) === 0 ? (
              <p className="text-body text-fg-muted py-4 text-center">
                No attachments yet. There is nowhere to upload a file to, so
                this is a link — paste a Google Drive, Sheets or proposal URL.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {taskToEdit.attachments!.map((attachment) => (
                  <li key={attachment.id}>
                    <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-sunken group">
                      <Paperclip
                        className="w-3.5 h-3.5 shrink-0 text-fg-subtle"
                        aria-hidden="true"
                      />
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 text-[13.5px] text-accent hover:underline truncate"
                      >
                        {attachment.label}
                      </a>
                      <span className="text-[11.5px] text-fg-subtle shrink-0">
                        {attachment.addedBy}
                      </span>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            void removeAttachment(taskToEdit.id, attachment.id)
                          }
                          aria-label={`Remove attachment ${attachment.label}`}
                          className="shrink-0 p-1 rounded-md text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {!isReadOnly && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const url = newAttachmentUrl.trim();
                  if (!url) return;
                  if (!isPlausibleUrl(url)) {
                    setAttachmentError(
                      'Must be a link starting with http:// or https://.'
                    );
                    return;
                  }
                  void addAttachment(taskToEdit.id, newAttachmentLabel, url);
                  setNewAttachmentLabel('');
                  setNewAttachmentUrl('');
                  setAttachmentError(null);
                }}
                className="space-y-2 pt-2 border-t border-line"
              >
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-2">
                  <div>
                    <label htmlFor="new-attachment-label" className="sr-only">
                      Attachment label
                    </label>
                    <input
                      id="new-attachment-label"
                      type="text"
                      value={newAttachmentLabel}
                      onChange={(event) =>
                        setNewAttachmentLabel(event.target.value)
                      }
                      placeholder="Label, e.g. Vendor BOQ"
                      className="field"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-attachment-url" className="sr-only">
                      Attachment link
                    </label>
                    <input
                      id="new-attachment-url"
                      type="url"
                      value={newAttachmentUrl}
                      onChange={(event) => {
                        setNewAttachmentUrl(event.target.value);
                        if (attachmentError) setAttachmentError(null);
                      }}
                      placeholder="https://drive.google.com/..."
                      aria-invalid={attachmentError ? true : undefined}
                      className={`field ${attachmentError ? 'border-rose-400 dark:border-rose-700' : ''}`}
                    />
                  </div>
                </div>
                {attachmentError && (
                  <p className="text-[12.5px] text-rose-600 dark:text-rose-400">
                    {attachmentError}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!newAttachmentUrl.trim()}
                    icon={<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    Add attachment
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ------------------------------ History ------------------------- */}
        {tab === 'history' && taskToEdit && (
          <div>
            {history.length === 0 ? (
              <p className="text-body text-fg-muted py-4 text-center">
                No recorded changes yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <span
                      className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-line-strong"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-[13.5px]">
                        <span className="font-medium">{entry.action}</span>
                        <span className="text-fg-subtle">
                          {' '}
                          · {entry.user}
                        </span>
                      </p>
                      <p className="text-[12.5px] text-fg-subtle">
                        {entry.date} at {entry.time}
                      </p>
                      {entry.newValue && entry.newValue !== 'None' && (
                        <p className="text-[12.5px] text-fg-muted mt-0.5">
                          {entry.oldValue && entry.oldValue !== 'None'
                            ? `${entry.oldValue} → ${entry.newValue}`
                            : entry.newValue}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Dialog>

      {confirmDialog}
    </>
  );
};
