export type Priority = 'Urgent' | 'High' | 'Medium' | 'Low';

export type TaskStatus = 
  | 'Not Started' 
  | 'In Progress' 
  | 'Waiting' 
  | 'On Hold' 
  | 'To Be Approved by Management' 
  | 'Completed';

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskComment {
  id: string;
  author: string;
  role: UserRole;
  text: string;
  timestamp: string;
}

/**
 * A link to supporting material — a vendor proposal, a BOQ, a Google Drive
 * folder. The app is Sheets-backed with no file storage of its own, so this
 * is a URL plus a label, not an uploaded file.
 */
export interface TaskAttachment {
  id: string;
  label: string;
  url: string;
  addedBy: string;
  addedAt: string;
}

export interface Task {
  id: string;
  project: string;
  taskName: string;
  taskBrief: string;
  department: string;
  internalPoc: string;
  agency: string;
  vendor: string;
  priority: Priority;
  taskProgress: TaskStatus;
  deadline: string; // YYYY-MM-DD
  executionStarted: boolean;
  executionStartDate: string | null; // YYYY-MM-DD
  actualFinishedDate: string | null; // YYYY-MM-DD
  toBeApprovedByManagement: boolean;
  /** ISO timestamp of when the task was sent for approval (Rule 3). */
  submittedForApprovalAt: string | null;
  approvalDate: string | null; // YYYY-MM-DD
  rejectionReason?: string | null;
  remarks: string;
  budget?: number;
  actualSpend?: number;
  /** Link to the Bill of Quantities for this task's cost approval, if any. */
  boqLink?: string | null;
  /**
   * Who this task's management approval should be routed to. Free text (a
   * name), not a role — the app has one shared "Management" role, but a
   * specific task's cost/BOQ approval may need a specific person's sign-off.
   */
  approver?: string;
  subtasks?: Subtask[];
  comments?: TaskComment[];
  attachments?: TaskAttachment[];
  isOverdue: boolean;
  createdAt: string;
  /**
   * ISO timestamp of the last write. Doubles as the optimistic-concurrency
   * token: a write is rejected if the stored value has moved on.
   */
  updatedAt: string;
  /**
   * Tombstone. Set instead of removing the sheet row, so row indices stay
   * stable and the record remains auditable. Deleted records are filtered out
   * before they reach the UI.
   */
  deletedAt?: string | null;
}

export type MasterCategory = 'Projects' | 'Vendors' | 'Agencies' | 'Team Members' | 'Departments';

export interface MasterItem {
  id: string;
  name: string;
  category: MasterCategory;
  status: 'Active' | 'Inactive';
  description?: string;
  createdAt: string;
  /** ISO timestamp of the last write; used for optimistic concurrency. */
  updatedAt?: string;
  /** Tombstone; see the note on {@link Task.deletedAt}. */
  deletedAt?: string | null;
}

export interface ActivityLog {
  id: string;
  user: string;
  role: UserRole;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  action: string;
  target: string;
  oldValue: string;
  newValue: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'assignment' | 'deadline' | 'overdue' | 'approval_request' | 'approval_granted' | 'approval_rejected' | 'completed';
  timestamp: string;
  read: boolean;
  taskId?: string;
}

export type UserRole = 'Admin' | 'Marketing Team' | 'Management' | 'Viewer';

/**
 * A person authorised to use the dashboard, as recorded in the `Users` tab.
 *
 * The spreadsheet is the access-control list: only emails listed here (and not
 * suspended) can sign in, and the `role` stored here is the only thing that
 * grants permission. The client can no longer assert its own role.
 */
export interface AppUser {
  /** Google account email, lowercased. The identity key. */
  email: string;
  name: string;
  role: UserRole;
  /** Suspended users keep their history but cannot sign in. */
  status: 'Active' | 'Suspended';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

/**
 * The authenticated identity, as carried by the signed session cookie.
 *
 * Deliberately holds identity only — never the role. The role is resolved from
 * the `Users` tab on each request, so revoking or demoting someone takes effect
 * without waiting for their cookie to expire.
 */
export interface SessionIdentity {
  email: string;
  name: string;
  picture?: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

/** What `/api/auth/session` returns to the browser. */
export interface SessionResponse {
  authenticated: boolean;
  user: AppUser | null;
  /** Set when sign-in was refused, explaining why. */
  reason?: string;
}

export type NavTab = 'dashboard' | 'tasks' | 'approvals' | 'calendar' | 'reports' | 'master' | 'logs' | 'settings';

/**
 * Connection state, reported honestly.
 *
 * `unconfigured` and `error` are distinct on purpose: the previous
 * implementation collapsed every failure into a success message, which made a
 * broken deployment look connected.
 */
export type ConnectionState =
  | 'checking'
  | 'connected'
  | 'unconfigured'
  | 'error';

export interface SyncStatus {
  state: ConnectionState;
  /** ISO timestamp of the last successful read from the sheet. */
  lastSyncedAt: string | null;
  /** True while a read or write is in flight. */
  busy: boolean;
  /** Human-readable failure detail. Null when there is no failure. */
  error: string | null;
  /** Number of mutations waiting to be retried. */
  pendingWrites: number;
  /** Spreadsheet id the server is bound to, for display only. */
  spreadsheetId: string | null;
  /** Set when the server reports a schema/setup problem the user must fix. */
  setupRequired: string[] | null;
}

/** Full snapshot returned by GET /api/snapshot. */
export interface Snapshot {
  tasks: Task[];
  masterItems: MasterItem[];
  activityLogs: ActivityLog[];
  /** Changes whenever any sheet content changes; used to skip no-op renders. */
  revision: string;
  fetchedAt: string;
}

/** Shape of every API error body. */
export interface ApiErrorBody {
  error: string;
  detail?: string;
  /** Present on 409 conflicts: the server's current copy of the record. */
  current?: unknown;
  /** Present when the sheet is not set up correctly. */
  setupRequired?: string[];
}
