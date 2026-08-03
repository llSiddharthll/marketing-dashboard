/**
 * Browser-side API client.
 *
 * Responsibilities:
 *  - Attach the actor headers used for audit attribution.
 *  - Translate error bodies into typed errors the UI can branch on
 *    (conflict vs. validation vs. offline vs. setup-required).
 *  - Never silently swallow a failure. The previous implementation reported
 *    success from its catch block.
 */

import type {
  ApiErrorBody,
  AppUser,
  MasterCategory,
  MasterItem,
  Snapshot,
  Task,
  UserRole,
} from '@/types/dashboard';

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | undefined;
  readonly setupRequired: string[] | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.name = 'ApiError';
    this.status = status;
    this.detail = body.detail;
    this.setupRequired = body.setupRequired;
  }

  /**
   * True for failures that a later retry could plausibly fix: network loss and
   * upstream/transient server faults. Validation, permission and conflict
   * failures are permanent for the same payload and must not be retried.
   */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** Raised on 409: someone else changed the record first. */
export class ConflictApiError extends ApiError {
  readonly current: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(status, body);
    this.name = 'ConflictApiError';
    this.current = body.current;
  }
}

/** Raised when the browser has no connection at all. */
export class OfflineError extends ApiError {
  constructor(message = 'You appear to be offline.') {
    super(0, { error: message });
    this.name = 'OfflineError';
  }
}

/**
 * Raised on 401. The caller should send the user to sign in again rather than
 * retrying, because no amount of retrying will produce a session.
 */
export class UnauthenticatedApiError extends ApiError {
  constructor(status: number, body: ApiErrorBody) {
    super(status, body);
    this.name = 'UnauthenticatedApiError';
  }
}

/* -------------------------------------------------------------------------- */
/* Core request                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Called when any request comes back 401, so the app can drop to the sign-in
 * screen from anywhere without every call site handling it.
 */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Passed through so callers can cancel a poll on unmount. */
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // Identity travels in the HttpOnly session cookie. There are deliberately
      // no actor headers: the server would ignore them, because a client can no
      // longer declare who it is or what role it holds.
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (err) {
    // AbortError is a deliberate cancellation, not a failure to report.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new OfflineError(
      typeof navigator !== 'undefined' && !navigator.onLine
        ? 'You are offline. Changes will be saved when the connection returns.'
        : 'Could not reach the server.'
    );
  }

  if (response.status === 304) {
    // Caller treats this as "nothing changed".
    return undefined as T;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    let body: ApiErrorBody = { error: `Request failed (${response.status}).` };
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error page; keep the generic message */
    }

    if (response.status === 409) throw new ConflictApiError(409, body);

    if (response.status === 401) {
      // Notify once, centrally, so the app can show the sign-in screen no
      // matter which call triggered it.
      onUnauthenticated?.();
      throw new UnauthenticatedApiError(401, body);
    }

    throw new ApiError(response.status, body);
  }

  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface HealthResponse {
  state: 'connected' | 'unconfigured' | 'error';
  checks: HealthCheck[];
  timezone: string;
  spreadsheetId?: string;
  serviceAccount?: string;
  setupRequired?: string[];
  error?: string;
  counts?: { tasks: number; masterItems: number; activityLogs: number };
  revision?: string;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health', { signal });
}

/**
 * Fetches the snapshot. Returns `null` when `since` matches the server's
 * current revision, meaning nothing changed.
 */
export async function fetchSnapshot(
  since?: string | null,
  signal?: AbortSignal
): Promise<Snapshot | null> {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const result = await request<Snapshot | undefined>(`/api/snapshot${query}`, {
    signal,
  });
  return result ?? null;
}

export interface TaskWriteResponse {
  task: Task;
  notifications: {
    title: string;
    message: string;
    type: string;
  }[];
}

export function createTask(
  input: Partial<Task>,
  signal?: AbortSignal
): Promise<TaskWriteResponse> {
  return request<TaskWriteResponse>('/api/tasks', {
    method: 'POST',
    body: input,
    signal,
  });
}

export function updateTask(
  id: string,
  input: Partial<Task> & { expectedUpdatedAt?: string },
  signal?: AbortSignal
): Promise<TaskWriteResponse> {
  return request<TaskWriteResponse>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
    signal,
  });
}

export function deleteTask(id: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  });
}

export function decideTask(
  id: string,
  decision: 'approve' | 'reject',
  comment?: string,
  signal?: AbortSignal
): Promise<TaskWriteResponse> {
  return request<TaskWriteResponse>(
    `/api/tasks/${encodeURIComponent(id)}/decision`,
    { method: 'POST', body: { decision, comment }, signal }
  );
}

export function createMasterItem(
  input: { category: MasterCategory; name: string; description?: string },
  signal?: AbortSignal
): Promise<{ item: MasterItem }> {
  return request<{ item: MasterItem }>('/api/master', {
    method: 'POST',
    body: input,
    signal,
  });
}

function masterPath(category: MasterCategory, id: string): string {
  return `/api/master/${encodeURIComponent(category)}/${encodeURIComponent(id)}`;
}

export function inspectMasterItem(
  category: MasterCategory,
  id: string,
  signal?: AbortSignal
): Promise<{
  item: MasterItem;
  referenceCount: number;
  removalAction: 'deactivated' | 'archived';
}> {
  return request(masterPath(category, id), { signal });
}

export function updateMasterItem(
  category: MasterCategory,
  id: string,
  input: {
    name?: string;
    description?: string;
    status?: 'Active' | 'Inactive';
    expectedUpdatedAt?: string;
  },
  signal?: AbortSignal
): Promise<{ item: MasterItem; tasksUpdated: number }> {
  return request(masterPath(category, id), {
    method: 'PATCH',
    body: input,
    signal,
  });
}

export function removeMasterItem(
  category: MasterCategory,
  id: string,
  signal?: AbortSignal
): Promise<{
  action: 'archived' | 'deactivated';
  referenceCount: number;
  item: MasterItem | null;
}> {
  return request(masterPath(category, id), { method: 'DELETE', signal });
}

export function runSetup(
  seed: boolean,
  signal?: AbortSignal
): Promise<{
  created: string[];
  repairedHeaders: string[];
  seeded: { tasks: number; masterItems: number } | null;
  remainingProblems: string[];
  ok: boolean;
}> {
  return request('/api/setup', { method: 'POST', body: { seed }, signal });
}

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

export interface SessionPayload {
  authenticated: boolean;
  user: AppUser | null;
  reason?: string;
  setupRequired?: string[];
}

/**
 * Asks the server who is signed in. Answers 200 either way, so this must not go
 * through the 401 handler — being signed out is a normal answer here.
 */
export async function fetchSession(
  signal?: AbortSignal
): Promise<SessionPayload> {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    return {
      authenticated: false,
      user: null,
      reason: 'Could not reach the server to check your session.',
    };
  }
  return (await response.json()) as SessionPayload;
}

export function login(
  credentials: { email: string; password: string },
  signal?: AbortSignal
): Promise<{ success: boolean; user: AppUser }> {
  return request<{ success: boolean; user: AppUser }>('/api/auth/login', {
    method: 'POST',
    body: credentials,
    signal,
  });
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
  });
}

/* -------------------------------------------------------------------------- */
/* User administration                                                        */
/* -------------------------------------------------------------------------- */

export function fetchUsers(signal?: AbortSignal): Promise<{ users: AppUser[] }> {
  return request('/api/users', { signal });
}

export function inviteUser(
  input: { email: string; name?: string; role: UserRole },
  signal?: AbortSignal
): Promise<{ user: AppUser }> {
  return request('/api/users', { method: 'POST', body: input, signal });
}

function userPath(email: string): string {
  return `/api/users/${encodeURIComponent(email)}`;
}

export function changeUserRole(
  email: string,
  role: UserRole,
  signal?: AbortSignal
): Promise<{ user: AppUser }> {
  return request(userPath(email), { method: 'PATCH', body: { role }, signal });
}

export function setUserStatus(
  email: string,
  status: 'Active' | 'Suspended',
  signal?: AbortSignal
): Promise<{ user: AppUser }> {
  return request(userPath(email), { method: 'PATCH', body: { status }, signal });
}

export function removeUser(email: string, signal?: AbortSignal): Promise<void> {
  return request(userPath(email), { method: 'DELETE', signal });
}
