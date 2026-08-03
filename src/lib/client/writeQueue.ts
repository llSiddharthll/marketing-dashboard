/**
 * Durable write queue.
 *
 * Every mutation is enqueued, persisted to localStorage, and executed in order.
 * If a write fails for a retryable reason (offline, 5xx, rate limit) it stays
 * queued and is retried with exponential backoff; if it fails permanently
 * (validation, permission, conflict) it is dropped and reported so the UI can
 * tell the user rather than retrying forever.
 *
 * This is what delivers the brief's "automatic retry for failed syncs" and
 * "offline-friendly where possible". The previous implementation fired a
 * fire-and-forget fetch and lost the change on any failure.
 *
 * Ordering matters: two edits to the same task must apply in the order the user
 * made them, so the queue is strictly serial rather than parallel.
 */

import { ApiError, OfflineError } from './apiClient';

export type QueuedOperationKind =
  | 'create-task'
  | 'update-task'
  | 'delete-task'
  | 'decide-task'
  | 'create-master'
  | 'update-master'
  | 'remove-master';

export interface QueuedOperation {
  id: string;
  kind: QueuedOperationKind;
  /** Opaque payload, interpreted by the executor. */
  payload: unknown;
  /** Human description, shown in the pending-changes UI. */
  label: string;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
}

export type OperationExecutor = (op: QueuedOperation) => Promise<void>;

export interface WriteQueueEvents {
  /** Fired whenever the queue length or state changes. */
  onChange?: (pending: QueuedOperation[]) => void;
  /** Fired when an operation is abandoned as permanently failed. */
  onPermanentFailure?: (op: QueuedOperation, error: unknown) => void;
  /** Fired after an operation succeeds. */
  onSuccess?: (op: QueuedOperation) => void;
}

const STORAGE_KEY = 'marketing_dashboard_write_queue_v1';

/**
 * Retry timing. Overridable so tests can exercise the full attempt ladder
 * without waiting out real backoff delays.
 */
export interface RetryPolicy {
  /** Attempts before an operation is abandoned. */
  maxAttempts: number;
  /** First backoff delay; doubles each attempt. */
  baseDelayMs: number;
  /** Upper bound on any single delay. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 6,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

function loadPersisted(): QueuedOperation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedOperation[]) : [];
  } catch {
    return [];
  }
}

function persist(queue: QueuedOperation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    // Quota exceeded. Surfaced rather than swallowed, because a full quota
    // means pending writes will not survive a reload.
    console.error(
      '[writeQueue] could not persist pending writes; they will be lost on reload',
      err
    );
  }
}

export class WriteQueue {
  private queue: QueuedOperation[];
  private readonly executor: OperationExecutor;
  private readonly events: WriteQueueEvents;
  private readonly policy: RetryPolicy;
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    executor: OperationExecutor,
    events: WriteQueueEvents = {},
    policy: Partial<RetryPolicy> = {}
  ) {
    this.executor = executor;
    this.events = events;
    this.policy = { ...DEFAULT_RETRY_POLICY, ...policy };
    this.queue = loadPersisted();
  }

  /** Pending operations, oldest first. */
  get pending(): QueuedOperation[] {
    return [...this.queue];
  }

  get length(): number {
    return this.queue.length;
  }

  /** Adds an operation and starts draining. */
  enqueue(
    kind: QueuedOperationKind,
    payload: unknown,
    label: string,
    id: string
  ): void {
    this.queue.push({
      id,
      kind,
      payload,
      label,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    });
    this.changed();
    void this.drain();
  }

  /** Begins processing. Safe to call repeatedly. */
  async drain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;

    try {
      while (this.queue.length > 0 && !this.stopped) {
        const op = this.queue[0];

        try {
          await this.executor(op);
          // Success: remove and continue immediately.
          this.queue.shift();
          this.changed();
          this.events.onSuccess?.(op);
        } catch (err) {
          const permanent = !this.isRetryable(err);
          op.attempts += 1;
          op.lastError = err instanceof Error ? err.message : String(err);

          if (permanent || op.attempts >= this.policy.maxAttempts) {
            // Drop it so one bad write cannot block every later change.
            this.queue.shift();
            this.changed();
            this.events.onPermanentFailure?.(op, err);
            continue;
          }

          // Retryable: keep it at the head and schedule another pass.
          this.changed();
          this.scheduleRetry(op.attempts);
          return;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof OfflineError) return true;
    if (err instanceof ApiError) return err.retryable;
    // An unrecognised error is treated as retryable once or twice; the attempt
    // cap stops it looping forever.
    return true;
  }

  private scheduleRetry(attempts: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    // Exponential backoff with jitter, capped.
    const ceiling = Math.min(
      this.policy.baseDelayMs * 2 ** (attempts - 1),
      this.policy.maxDelayMs
    );
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, delay);
  }

  /** Retries immediately, e.g. when the browser reports it is back online. */
  retryNow(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.drain();
  }

  /** Discards everything. Used when the user chooses to abandon local changes. */
  clear(): void {
    this.queue = [];
    this.changed();
  }

  /** Stops processing and cancels any scheduled retry. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private changed(): void {
    persist(this.queue);
    this.events.onChange?.(this.pending);
  }
}
