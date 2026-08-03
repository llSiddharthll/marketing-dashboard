'use client';

/**
 * Application data context, backed by the server.
 *
 * Architecture (Phase 1):
 *  - The Google Sheet is the single source of truth, reached only through the
 *    `/api/*` routes. localStorage is no longer a database; it holds an offline
 *    cache for first paint and the durable write queue.
 *  - Reads: `/api/snapshot` is polled with the last known revision, so an
 *    unchanged sheet costs a 304. Edits made directly in Sheets appear here.
 *  - Writes: applied optimistically, then enqueued. The queue retries transient
 *    failures and reports permanent ones. A server response replaces the
 *    optimistic record, so server-derived fields (dates, audit entries) win.
 *  - Automation rules and the activity log are the server's job. The previous
 *    client-side implementation lost log entries to a stale-closure bug and
 *    stamped UTC dates.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ActivityLog,
  AppUser,
  MasterCategory,
  MasterItem,
  NotificationItem,
  Snapshot,
  SyncStatus,
  Task,
  UserRole,
} from '@/types/dashboard';
import * as api from '@/lib/client/apiClient';
import {
  ApiError,
  ConflictApiError,
  OfflineError,
} from '@/lib/client/apiClient';
import { WriteQueue, type QueuedOperation } from '@/lib/client/writeQueue';
import { newNotificationId, newRequestId } from '@/lib/ids';
import { refreshDerivedFlags } from '@/lib/automations';
import { today } from '@/lib/dates';
import { ThemeProvider } from './ThemeContext';

/* -------------------------------------------------------------------------- */
/* Toasts                                                                     */
/* -------------------------------------------------------------------------- */

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  message: string;
  /** Optional detail line, used for server error text. */
  detail?: string;
}

/* -------------------------------------------------------------------------- */
/* Context shape                                                              */
/* -------------------------------------------------------------------------- */

interface DataContextValue {
  // Data
  tasks: Task[];
  masterItems: MasterItem[];
  activityLogs: ActivityLog[];
  notifications: NotificationItem[];

  // Session — read-only. The role comes from the server, which resolves it from
  // the Users tab; the client cannot change its own permissions any more.
  currentUser: AppUser | null;
  currentUserRole: UserRole;
  currentUserName: string;
  authState: 'loading' | 'authenticated' | 'unauthenticated';
  authReason: string | null;
  signOut: () => Promise<void>;

  // UI
  globalSearch: string;
  setGlobalSearch: (query: string) => void;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Connection
  syncStatus: SyncStatus;
  /** Forces an immediate read from the sheet. */
  refresh: () => Promise<void>;
  /** Retries queued writes right away. */
  retryPendingWrites: () => void;
  /** Discards queued writes the user no longer wants. */
  discardPendingWrites: () => void;
  /** Creates missing tabs / repairs headers, optionally seeding demo data. */
  runSetup: (seed: boolean) => Promise<void>;
  /** Re-runs the connection diagnostic. */
  checkConnection: () => Promise<void>;
  healthChecks: api.HealthCheck[];

  // Task actions
  addTask: (input: Partial<Task>) => Promise<Task | null>;
  updateTask: (task: Task) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  approveTask: (id: string) => Promise<void>;
  rejectTask: (id: string, comment: string) => Promise<void>;
  toggleSubtask: (taskId: string, subtaskId: string) => Promise<void>;
  addSubtask: (taskId: string, title: string) => Promise<void>;
  addComment: (taskId: string, text: string) => Promise<void>;

  // Master data
  addMasterItem: (
    category: MasterCategory,
    name: string,
    description?: string
  ) => Promise<MasterItem | null>;
  updateMasterItem: (
    item: MasterItem,
    changes: { name?: string; description?: string; status?: 'Active' | 'Inactive' }
  ) => Promise<void>;
  removeMasterItem: (item: MasterItem) => Promise<void>;
  inspectMasterItem: (
    item: MasterItem
  ) => Promise<{ referenceCount: number; removalAction: string } | null>;
  getActiveMasterOptions: (category: MasterCategory) => string[];
  getAllMasterOptions: (category: MasterCategory) => MasterItem[];

  // Notifications
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;

  // Toasts
  toasts: Toast[];
  dismissToast: (id: string) => void;
  showToast: (kind: Toast['kind'], message: string, detail?: string) => void;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

/* -------------------------------------------------------------------------- */
/* Offline cache                                                              */
/* -------------------------------------------------------------------------- */

const CACHE_KEY = 'marketing_dashboard_snapshot_cache_v2';
/** Poll interval. Cheap because an unchanged sheet returns 304. */
const POLL_INTERVAL_MS = 15_000;
/** How often to re-evaluate overdue flags for an idle open tab. */
const DERIVED_REFRESH_MS = 60_000;

function readCache(): Snapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

function writeCache(snapshot: Snapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // A full quota only costs us the offline cache, so this is non-fatal.
  }
}


/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [masterItems, setMasterItems] = useState<MasterItem[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [authState, setAuthState] = useState<
    'loading' | 'authenticated' | 'unauthenticated'
  >('loading');
  const [authReason, setAuthReason] = useState<string | null>(null);

  // Derived, never independently settable: a stale local role must not be able
  // to diverge from what the server will actually permit.
  const currentUserRole: UserRole = currentUser?.role ?? 'Viewer';
  const currentUserName = currentUser?.name ?? 'Not signed in';

  const [globalSearch, setGlobalSearch] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    state: 'checking',
    lastSyncedAt: null,
    busy: false,
    error: null,
    pendingWrites: 0,
    spreadsheetId: null,
    setupRequired: null,
  });
  const [healthChecks, setHealthChecks] = useState<api.HealthCheck[]>([]);

  /** Last revision seen, so polls can short-circuit with a 304. */
  const revisionRef = useRef<string | null>(null);
  /** Guards against overlapping polls. */
  const fetchingRef = useRef(false);

  /* ----------------------------- Toasts ------------------------------- */

  const showToast = useCallback(
    (kind: Toast['kind'], message: string, detail?: string) => {
      const id = newRequestId();
      setToasts((prev) => [...prev, { id, kind, message, detail }]);
      // Errors stay until dismissed; successes fade.
      if (kind !== 'error') {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4000);
      }
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* -------------------------- Notifications ---------------------------- */

  const pushNotifications = useCallback(
    (
      items: { title: string; message: string; type: string }[],
      taskId?: string
    ) => {
      if (items.length === 0) return;
      setNotifications((prev) => [
        ...items.map((n) => ({
          id: newNotificationId(),
          title: n.title,
          message: n.message,
          type: n.type as NotificationItem['type'],
          timestamp: new Date().toISOString(),
          read: false,
          taskId,
        })),
        ...prev,
      ]);
    },
    []
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const clearAllNotifications = useCallback(() => setNotifications([]), []);

  /* ----------------------------- Reads --------------------------------- */

  const applySnapshot = useCallback((snapshot: Snapshot) => {
    revisionRef.current = snapshot.revision;
    setTasks(snapshot.tasks);
    setMasterItems(snapshot.masterItems);
    setActivityLogs(snapshot.activityLogs);
    writeCache(snapshot);
    setSyncStatus((prev) => ({
      ...prev,
      state: 'connected',
      lastSyncedAt: snapshot.fetchedAt,
      error: null,
      setupRequired: null,
    }));
  }, []);

  const loadSnapshot = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setSyncStatus((prev) => ({ ...prev, busy: true }));

      try {
        const since = options.force ? null : revisionRef.current;
        const snapshot = await api.fetchSnapshot(since);
        // null means the revision matched, so there is nothing to apply.
        if (snapshot) applySnapshot(snapshot);
        else {
          setSyncStatus((prev) => ({
            ...prev,
            state: 'connected',
            lastSyncedAt: new Date().toISOString(),
            error: null,
          }));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;

        if (err instanceof ApiError && err.setupRequired) {
          setSyncStatus((prev) => ({
            ...prev,
            state: err.status === 503 ? 'unconfigured' : 'error',
            error: err.message,
            setupRequired: err.setupRequired ?? null,
          }));
        } else {
          const message =
            err instanceof Error ? err.message : 'Could not load data.';
          setSyncStatus((prev) => ({
            ...prev,
            state: err instanceof OfflineError ? prev.state : 'error',
            error: message,
          }));
        }
      } finally {
        fetchingRef.current = false;
        setSyncStatus((prev) => ({ ...prev, busy: false }));
      }
    },
    [applySnapshot]
  );

  const checkConnection = useCallback(async () => {
    try {
      const health = await api.fetchHealth();
      setHealthChecks(health.checks);
      setSyncStatus((prev) => ({
        ...prev,
        state: health.state,
        spreadsheetId: health.spreadsheetId ?? null,
        setupRequired: health.setupRequired ?? null,
        error: health.error ?? null,
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Diagnostic request failed.';
      setHealthChecks([
        { name: 'Diagnostic request', ok: false, detail: message },
      ]);
      setSyncStatus((prev) => ({ ...prev, state: 'error', error: message }));
    }
  }, []);

  /* --------------------------- Write queue ----------------------------- */

  /**
   * Executes a queued operation against the API. Defined as a ref-held callback
   * so the queue instance can be created once while still seeing fresh state.
   */
  const executeOperation = useCallback(
    async (op: QueuedOperation): Promise<void> => {
      const payload = op.payload as Record<string, never>;

      switch (op.kind) {
        case 'create-task': {
          const result = await api.createTask(payload as Partial<Task>);
          // Replace the optimistic row with the server's authoritative copy.
          setTasks((prev) =>
            prev.map((t) => (t.id === op.id ? result.task : t))
          );
          pushNotifications(result.notifications, result.task.id);
          break;
        }
        case 'update-task': {
          const { id, ...body } = payload as unknown as Task & { id: string };
          const result = await api.updateTask(id, body);
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? result.task : t))
          );
          pushNotifications(result.notifications, id);
          break;
        }
        case 'delete-task': {
          await api.deleteTask((payload as unknown as { id: string }).id);
          break;
        }
        case 'decide-task': {
          const { id, decision, comment } = payload as unknown as {
            id: string;
            decision: 'approve' | 'reject';
            comment?: string;
          };
          const result = await api.decideTask(id, decision, comment);
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? result.task : t))
          );
          pushNotifications(result.notifications, id);
          break;
        }
        case 'create-master': {
          const input = payload as unknown as {
            category: MasterCategory;
            name: string;
            description?: string;
          };
          const result = await api.createMasterItem(input);
          setMasterItems((prev) =>
            prev.map((m) => (m.id === op.id ? result.item : m))
          );
          break;
        }
        case 'update-master': {
          const { category, id, ...changes } = payload as unknown as {
            category: MasterCategory;
            id: string;
            name?: string;
            description?: string;
            status?: 'Active' | 'Inactive';
          };
          const result = await api.updateMasterItem(category, id, changes);
          setMasterItems((prev) =>
            prev.map((m) => (m.id === id ? result.item : m))
          );
          if (result.tasksUpdated > 0) {
            // Tasks were rewritten server-side; pull them back in.
            void loadSnapshot({ force: true });
          }
          break;
        }
        case 'remove-master': {
          const { category, id } = payload as unknown as {
            category: MasterCategory;
            id: string;
          };
          const outcome = await api.removeMasterItem(category, id);
          if (outcome.action === 'deactivated' && outcome.item) {
            setMasterItems((prev) =>
              prev.map((m) => (m.id === id ? outcome.item! : m))
            );
            showToast(
              'info',
              `${outcome.item.name} is used by ${outcome.referenceCount} task(s), so it was marked Inactive instead of removed.`
            );
          } else {
            setMasterItems((prev) => prev.filter((m) => m.id !== id));
          }
          break;
        }
      }
    },
    [loadSnapshot, pushNotifications, showToast]
  );

  const executeRef = useRef(executeOperation);
  executeRef.current = executeOperation;

  const queueRef = useRef<WriteQueue | null>(null);
  if (queueRef.current === null && typeof window !== 'undefined') {
    queueRef.current = new WriteQueue(
      (op) => executeRef.current(op),
      {
        onChange: (pending) =>
          setSyncStatus((prev) => ({ ...prev, pendingWrites: pending.length })),
        onSuccess: () => {
          setSyncStatus((prev) => ({ ...prev, error: null }));
        },
        onPermanentFailure: (op, error) => {
          // A permanently failed write means the optimistic UI is now a lie, so
          // re-read the truth and tell the user what happened.
          if (error instanceof ConflictApiError) {
            showToast(
              'error',
              `${op.label} was not saved: someone else changed it first.`,
              'The latest version has been loaded.'
            );
          } else {
            const detail =
              error instanceof ApiError
                ? (error.detail ?? error.message)
                : String(error);
            showToast('error', `${op.label} could not be saved.`, detail);
          }
          void loadSnapshot({ force: true });
        },
      }
    );
  }

  const enqueue = useCallback(
    (
      kind: QueuedOperation['kind'],
      payload: unknown,
      label: string,
      id: string
    ) => {
      queueRef.current?.enqueue(kind, payload, label, id);
    },
    []
  );

  /* ----------------------------- Session ------------------------------- */

  /**
   * Loads the signed-in user from the server. This is the only source of the
   * role: it is resolved server-side from the Users tab on every call.
   */
  const loadSession = useCallback(async (): Promise<boolean> => {
    const payload = await api.fetchSession();
    if (payload.authenticated && payload.user) {
      setCurrentUser(payload.user);
      setAuthState('authenticated');
      setAuthReason(null);
      return true;
    }
    setCurrentUser(null);
    setAuthState('unauthenticated');
    setAuthReason(payload.reason ?? null);
    return false;
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setCurrentUser(null);
    setAuthState('unauthenticated');
    // Drop the cached snapshot so the next person on this machine cannot read
    // the previous user's data from localStorage.
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(CACHE_KEY);
      window.location.href = '/login';
    }
  }, []);

  /* ------------------------------ Boot -------------------------------- */

  useEffect(() => {
    // Any 401 from anywhere drops the app to the sign-in screen, so an expired
    // or revoked session cannot leave a half-working UI on screen.
    api.setUnauthenticatedHandler(() => {
      setCurrentUser(null);
      setAuthState('unauthenticated');
      setAuthReason('Your session ended. Please sign in again.');
    });

    void (async () => {
      const signedIn = await loadSession();
      if (!signedIn) return;

      // Paint from cache immediately so the app is usable before the network
      // round trip completes; the snapshot below replaces it. Only after
      // authentication, so cached data is never shown to a signed-out visitor.
      const cached = readCache();
      if (cached) {
        setTasks(cached.tasks);
        setMasterItems(cached.masterItems);
        setActivityLogs(cached.activityLogs);
        revisionRef.current = cached.revision;
      }

      void checkConnection();
      void loadSnapshot({ force: true });
      // Drain anything left over from a previous session.
      queueRef.current?.retryNow();
    })();

    return () => api.setUnauthenticatedHandler(null);
  }, [checkConnection, loadSession, loadSnapshot]);

  /* ----------------------------- Polling ------------------------------ */

  useEffect(() => {
    if (authState !== 'authenticated') return;

    const interval = setInterval(() => {
      // Skip polling a hidden tab; the visibility handler catches up on return.
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadSnapshot();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [authState, loadSnapshot]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (!document.hidden) void loadSnapshot();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadSnapshot]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => {
      queueRef.current?.retryNow();
      void loadSnapshot();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [loadSnapshot]);

  // Re-evaluate overdue flags on a timer so a long-open tab notices a deadline
  // passing. Previously this only happened on a full reload.
  useEffect(() => {
    const interval = setInterval(() => {
      const todayDate = today();
      setTasks((prev) => {
        let anyChanged = false;
        const next = prev.map((task) => {
          const { task: refreshed, changed } = refreshDerivedFlags(
            task,
            todayDate
          );
          if (changed) anyChanged = true;
          return refreshed;
        });
        return anyChanged ? next : prev;
      });
    }, DERIVED_REFRESH_MS);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const queue = queueRef.current;
    return () => queue?.stop();
  }, []);

  /* --------------------------- Task actions ---------------------------- */

  const addTask = useCallback(
    async (input: Partial<Task>): Promise<Task | null> => {
      // Optimistic row with a temporary id; the server's copy replaces it.
      const tempId = newRequestId();
      const now = new Date().toISOString();
      const optimistic: Task = {
        id: tempId,
        project: input.project ?? '',
        taskName: input.taskName ?? '',
        taskBrief: input.taskBrief ?? '',
        department: input.department ?? '',
        internalPoc: input.internalPoc ?? '',
        agency: input.agency ?? '',
        vendor: input.vendor ?? '',
        priority: input.priority ?? 'Medium',
        taskProgress: input.taskProgress ?? 'Not Started',
        deadline: input.deadline ?? '',
        executionStarted: input.executionStarted ?? false,
        executionStartDate: null,
        actualFinishedDate: null,
        toBeApprovedByManagement: input.toBeApprovedByManagement ?? false,
        submittedForApprovalAt: null,
        approvalDate: null,
        rejectionReason: null,
        remarks: input.remarks ?? '',
        budget: input.budget ?? 0,
        actualSpend: input.actualSpend ?? 0,
        subtasks: input.subtasks ?? [],
        comments: input.comments ?? [],
        isOverdue: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      setTasks((prev) => [optimistic, ...prev]);
      enqueue('create-task', input, `Create "${optimistic.taskName}"`, tempId);
      showToast('success', `"${optimistic.taskName}" created.`);
      return optimistic;
    },
    [enqueue, showToast]
  );

  const updateTask = useCallback(
    async (task: Task) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      enqueue(
        'update-task',
        { ...task, expectedUpdatedAt: task.updatedAt },
        `Save "${task.taskName}"`,
        task.id
      );
    },
    [enqueue]
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const existing = tasks.find((t) => t.id === id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      enqueue(
        'delete-task',
        { id },
        `Delete "${existing?.taskName ?? id}"`,
        `del-${id}`
      );
      showToast('success', `"${existing?.taskName ?? id}" archived.`);
    },
    [enqueue, showToast, tasks]
  );

  const approveTask = useCallback(
    async (id: string) => {
      const existing = tasks.find((t) => t.id === id);
      enqueue(
        'decide-task',
        { id, decision: 'approve' },
        `Approve "${existing?.taskName ?? id}"`,
        `dec-${id}`
      );
    },
    [enqueue, tasks]
  );

  const rejectTask = useCallback(
    async (id: string, comment: string) => {
      const existing = tasks.find((t) => t.id === id);
      enqueue(
        'decide-task',
        { id, decision: 'reject', comment },
        `Reject "${existing?.taskName ?? id}"`,
        `dec-${id}`
      );
    },
    [enqueue, tasks]
  );

  /**
   * Subtasks, comments and their siblings are stored on the task, so each of
   * these is a normal task update — which means they inherit the same
   * concurrency protection and audit trail.
   */
  const mutateTask = useCallback(
    async (taskId: string, mutate: (task: Task) => Task, label: string) => {
      const existing = tasks.find((t) => t.id === taskId);
      if (!existing) return;
      const next = mutate(existing);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? next : t)));
      enqueue(
        'update-task',
        { ...next, expectedUpdatedAt: existing.updatedAt },
        label,
        taskId
      );
    },
    [enqueue, tasks]
  );

  const toggleSubtask = useCallback(
    (taskId: string, subtaskId: string) =>
      mutateTask(
        taskId,
        (task) => ({
          ...task,
          subtasks: (task.subtasks ?? []).map((st) =>
            st.id === subtaskId ? { ...st, completed: !st.completed } : st
          ),
        }),
        'Update checklist'
      ),
    [mutateTask]
  );

  const addSubtask = useCallback(
    (taskId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return Promise.resolve();
      return mutateTask(
        taskId,
        (task) => ({
          ...task,
          subtasks: [
            ...(task.subtasks ?? []),
            { id: newRequestId(), title: trimmed, completed: false },
          ],
        }),
        'Add checklist item'
      );
    },
    [mutateTask]
  );

  const addComment = useCallback(
    (taskId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return Promise.resolve();
      return mutateTask(
        taskId,
        (task) => ({
          ...task,
          comments: [
            ...(task.comments ?? []),
            {
              id: newRequestId(),
              author: currentUserName,
              role: currentUserRole,
              text: trimmed,
              timestamp: new Date().toISOString(),
            },
          ],
        }),
        'Add comment'
      );
    },
    [currentUserName, currentUserRole, mutateTask]
  );

  /* -------------------------- Master actions --------------------------- */

  const addMasterItem = useCallback(
    async (
      category: MasterCategory,
      name: string,
      description?: string
    ): Promise<MasterItem | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      const tempId = newRequestId();
      const now = new Date().toISOString();
      const optimistic: MasterItem = {
        id: tempId,
        name: trimmed,
        category,
        status: 'Active',
        description: description?.trim() ?? '',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      setMasterItems((prev) => [...prev, optimistic]);
      enqueue(
        'create-master',
        { category, name: trimmed, description },
        `Add ${category.replace(/s$/, '')} "${trimmed}"`,
        tempId
      );
      return optimistic;
    },
    [enqueue]
  );

  const updateMasterItem = useCallback(
    async (
      item: MasterItem,
      changes: {
        name?: string;
        description?: string;
        status?: 'Active' | 'Inactive';
      }
    ) => {
      const next: MasterItem = { ...item, ...changes };
      setMasterItems((prev) => prev.map((m) => (m.id === item.id ? next : m)));
      enqueue(
        'update-master',
        {
          category: item.category,
          id: item.id,
          ...changes,
          expectedUpdatedAt: item.updatedAt,
        },
        `Save "${next.name}"`,
        item.id
      );
    },
    [enqueue]
  );

  const removeMasterItem = useCallback(
    async (item: MasterItem) => {
      // Optimistically hide it; if the server deactivates instead of removing,
      // the executor puts it back with Inactive status.
      setMasterItems((prev) => prev.filter((m) => m.id !== item.id));
      enqueue(
        'remove-master',
        { category: item.category, id: item.id },
        `Remove "${item.name}"`,
        `rm-${item.id}`
      );
    },
    [enqueue]
  );

  const inspectMasterItem = useCallback(async (item: MasterItem) => {
    try {
      const result = await api.inspectMasterItem(item.category, item.id);
      return {
        referenceCount: result.referenceCount,
        removalAction: result.removalAction,
      };
    } catch {
      // The confirmation dialog can still proceed without a count.
      return null;
    }
  }, []);

  const getActiveMasterOptions = useCallback(
    (category: MasterCategory) =>
      masterItems
        .filter((m) => m.category === category && m.status === 'Active')
        .map((m) => m.name)
        .sort((a, b) => a.localeCompare(b)),
    [masterItems]
  );

  const getAllMasterOptions = useCallback(
    (category: MasterCategory) =>
      masterItems
        .filter((m) => m.category === category)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [masterItems]
  );

  /* --------------------------- Connection ------------------------------ */

  const refresh = useCallback(() => loadSnapshot({ force: true }), [loadSnapshot]);

  const retryPendingWrites = useCallback(() => {
    queueRef.current?.retryNow();
  }, []);

  const discardPendingWrites = useCallback(() => {
    queueRef.current?.clear();
    void loadSnapshot({ force: true });
    showToast('info', 'Pending changes discarded and data reloaded.');
  }, [loadSnapshot, showToast]);

  const runSetup = useCallback(
    async (seed: boolean) => {
      setSyncStatus((prev) => ({ ...prev, busy: true }));
      try {
        const result = await api.runSetup(seed);
        const parts: string[] = [];
        if (result.created.length > 0) {
          parts.push(`created ${result.created.length} tab(s)`);
        }
        if (result.repairedHeaders.length > 0) {
          parts.push(`repaired ${result.repairedHeaders.length} header row(s)`);
        }
        if (result.seeded) {
          parts.push(
            `seeded ${result.seeded.tasks} task(s) and ${result.seeded.masterItems} master record(s)`
          );
        }
        showToast(
          result.ok ? 'success' : 'error',
          parts.length > 0
            ? `Spreadsheet setup: ${parts.join(', ')}.`
            : 'Spreadsheet was already set up correctly.',
          result.remainingProblems.length > 0
            ? result.remainingProblems.join(' | ')
            : undefined
        );
        await checkConnection();
        await loadSnapshot({ force: true });
      } catch (err) {
        const detail =
          err instanceof ApiError ? (err.detail ?? err.message) : String(err);
        showToast('error', 'Spreadsheet setup failed.', detail);
      } finally {
        setSyncStatus((prev) => ({ ...prev, busy: false }));
      }
    },
    [checkConnection, loadSnapshot, showToast]
  );

  const toggleSidebar = useCallback(
    () => setIsSidebarCollapsed((prev) => !prev),
    []
  );

  /* ------------------------------ Value ------------------------------- */

  // Memoised so consumers do not re-render on every provider render. The
  // previous implementation rebuilt this object each time, re-rendering the
  // whole tree on any state change.
  const value = useMemo<DataContextValue>(
    () => ({
      tasks,
      masterItems,
      activityLogs,
      notifications,
      currentUser,
      currentUserRole,
      currentUserName,
      authState,
      authReason,
      signOut,
      globalSearch,
      setGlobalSearch,
      isSidebarCollapsed,
      toggleSidebar,
      syncStatus,
      refresh,
      retryPendingWrites,
      discardPendingWrites,
      runSetup,
      checkConnection,
      healthChecks,
      addTask,
      updateTask,
      deleteTask,
      approveTask,
      rejectTask,
      toggleSubtask,
      addSubtask,
      addComment,
      addMasterItem,
      updateMasterItem,
      removeMasterItem,
      inspectMasterItem,
      getActiveMasterOptions,
      getAllMasterOptions,
      markNotificationRead,
      clearAllNotifications,
      toasts,
      dismissToast,
      showToast,
    }),
    [
      tasks,
      masterItems,
      activityLogs,
      notifications,
      currentUser,
      currentUserRole,
      currentUserName,
      authState,
      authReason,
      signOut,
      globalSearch,
      isSidebarCollapsed,
      toggleSidebar,
      syncStatus,
      refresh,
      retryPendingWrites,
      discardPendingWrites,
      runSetup,
      checkConnection,
      healthChecks,
      addTask,
      updateTask,
      deleteTask,
      approveTask,
      rejectTask,
      toggleSubtask,
      addSubtask,
      addComment,
      addMasterItem,
      updateMasterItem,
      removeMasterItem,
      inspectMasterItem,
      getActiveMasterOptions,
      getAllMasterOptions,
      markNotificationRead,
      clearAllNotifications,
      toasts,
      dismissToast,
      showToast,
    ]
  );

  return (
    <DataContext.Provider value={value}>
      <ThemeProvider>{children}</ThemeProvider>
    </DataContext.Provider>
  );
};

export const useData = (): DataContextValue => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
