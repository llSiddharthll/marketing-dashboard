/**
 * Write-queue tests.
 *
 * Cover the behaviour the brief asks for — automatic retry, offline tolerance —
 * plus the failure modes a naive retry loop has: retrying a permanently-invalid
 * write forever, and one stuck write blocking every later change.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteQueue, type QueuedOperation } from '../writeQueue';
import { ApiError, ConflictApiError, OfflineError } from '../apiClient';

/** Minimal localStorage stand-in, since the suite runs in the Node env. */
function installLocalStorage(): void {
  const store = new Map<string, string>();
  const mock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal('window', { localStorage: mock });
  vi.stubGlobal('localStorage', mock);
}

beforeEach(() => {
  installLocalStorage();
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Compressed backoff for tests: same attempt ladder, milliseconds instead of
 * seconds, so the retry behaviour is fully exercised in a fast suite.
 */
const FAST_RETRY = { baseDelayMs: 2, maxDelayMs: 10 };

function op(id: string): [Parameters<WriteQueue['enqueue']>[0], unknown, string, string] {
  return ['update-task', { id }, `Save ${id}`, id];
}

describe('WriteQueue', () => {
  it('executes a queued operation', async () => {
    const executed: string[] = [];
    const queue = new WriteQueue(async (o) => {
      executed.push(o.id);
    });

    queue.enqueue(...op('a'));
    await vi.waitFor(() => expect(executed).toEqual(['a']));
    expect(queue.length).toBe(0);
  });

  it('preserves order across several writes', async () => {
    const executed: string[] = [];
    const queue = new WriteQueue(async (o) => {
      // Stagger completion so a parallel implementation would reorder.
      await new Promise((r) => setTimeout(r, o.id === 'a' ? 20 : 1));
      executed.push(o.id);
    });

    queue.enqueue(...op('a'));
    queue.enqueue(...op('b'));
    queue.enqueue(...op('c'));

    await vi.waitFor(() => expect(executed).toEqual(['a', 'b', 'c']), {
      timeout: 2000,
    });
  });

  it('reports progress through onChange', async () => {
    const lengths: number[] = [];
    const queue = new WriteQueue(
      async () => {},
      { onChange: (pending) => lengths.push(pending.length) }
    );

    queue.enqueue(...op('a'));
    await vi.waitFor(() => expect(queue.length).toBe(0));
    // Grew to 1 on enqueue, then back to 0 on success.
    expect(lengths[0]).toBe(1);
    expect(lengths.at(-1)).toBe(0);
  });

  describe('retryable failures', () => {
    it('retries an offline write until it succeeds', async () => {
      let attempts = 0;
      const queue = new WriteQueue(
        async () => {
          attempts += 1;
          if (attempts < 3) throw new OfflineError();
        },
        {},
        FAST_RETRY
      );

      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(queue.length).toBe(0));
      expect(attempts).toBe(3);
    });

    it('retries a 500 response', async () => {
      let attempts = 0;
      const queue = new WriteQueue(
        async () => {
          attempts += 1;
          if (attempts < 2) throw new ApiError(500, { error: 'server blew up' });
        },
        {},
        FAST_RETRY
      );

      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(queue.length).toBe(0));
      expect(attempts).toBe(2);
    });

    it('keeps the operation queued while it is failing', async () => {
      // A deliberately slow backoff here: this test observes the operation
      // *while* it is waiting to retry, so the retry must not have fired yet.
      const queue = new WriteQueue(
        async () => {
          throw new OfflineError();
        },
        {},
        { baseDelayMs: 400, maxDelayMs: 400 }
      );

      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(queue.pending[0]?.attempts).toBeGreaterThan(0));
      expect(queue.length).toBe(1);
      expect(queue.pending[0].lastError).toContain('offline');
      queue.stop();
    });

    it('gives up after the attempt cap and reports it', async () => {
      const failures: QueuedOperation[] = [];
      const queue = new WriteQueue(
        async () => {
          throw new OfflineError();
        },
        { onPermanentFailure: (o) => failures.push(o) },
        FAST_RETRY
      );

      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(failures).toHaveLength(1));
      expect(failures[0].attempts).toBe(6);
      expect(queue.length).toBe(0);
    });
  });

  describe('permanent failures', () => {
    it('does not retry a validation error', async () => {
      let attempts = 0;
      const failures: QueuedOperation[] = [];
      const queue = new WriteQueue(
        async () => {
          attempts += 1;
          throw new ApiError(422, { error: 'Task name is required.' });
        },
        { onPermanentFailure: (o) => failures.push(o) }
      );

      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(failures).toHaveLength(1));
      // Tried exactly once: retrying the same invalid payload can never help.
      expect(attempts).toBe(1);
      expect(queue.length).toBe(0);
    });

    it('does not retry a permission error', async () => {
      let attempts = 0;
      const queue = new WriteQueue(async () => {
        attempts += 1;
        throw new ApiError(403, { error: 'Viewer cannot write.' });
      });

      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(queue.length).toBe(0));
      expect(attempts).toBe(1);
    });

    it('does not retry a conflict, and surfaces the server copy', async () => {
      const failures: { op: QueuedOperation; error: unknown }[] = [];
      const queue = new WriteQueue(
        async () => {
          throw new ConflictApiError(409, {
            error: 'Changed by someone else.',
            current: { id: 'a', taskName: 'Their version' },
          });
        },
        { onPermanentFailure: (o, error) => failures.push({ op: o, error }) }
      );

      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(failures).toHaveLength(1));
      const error = failures[0].error as ConflictApiError;
      expect(error.current).toEqual({ id: 'a', taskName: 'Their version' });
    });

    it('does not let one bad write block the ones behind it', async () => {
      const succeeded: string[] = [];
      const queue = new WriteQueue(async (o) => {
        if (o.id === 'bad') {
          throw new ApiError(422, { error: 'invalid' });
        }
        succeeded.push(o.id);
      });

      queue.enqueue(...op('bad'));
      queue.enqueue(...op('good1'));
      queue.enqueue(...op('good2'));

      await vi.waitFor(() => expect(succeeded).toEqual(['good1', 'good2']));
      expect(queue.length).toBe(0);
    });
  });

  describe('persistence', () => {
    it('restores pending writes after a reload', async () => {
      // First session: a write is stuck offline.
      const first = new WriteQueue(
        async () => {
          throw new OfflineError();
        },
        {},
        FAST_RETRY
      );
      first.enqueue(...op('survivor'));
      await vi.waitFor(() => expect(first.length).toBe(1));
      first.stop();

      // Second session reads the same localStorage.
      const executed: string[] = [];
      const second = new WriteQueue(async (o) => {
        executed.push(o.id);
      });
      expect(second.length).toBe(1);
      expect(second.pending[0].label).toBe('Save survivor');

      second.retryNow();
      await vi.waitFor(() => expect(executed).toEqual(['survivor']));
    });

    it('clear() discards pending writes', async () => {
      const queue = new WriteQueue(
        async () => {
          throw new OfflineError();
        },
        {},
        FAST_RETRY
      );
      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(queue.length).toBe(1));

      queue.clear();
      expect(queue.length).toBe(0);

      queue.stop();
      const reloaded = new WriteQueue(async () => {});
      expect(reloaded.length).toBe(0);
    });
  });

  describe('stop', () => {
    it('halts processing', async () => {
      let attempts = 0;
      const queue = new WriteQueue(
        async () => {
          attempts += 1;
          throw new OfflineError();
        },
        {},
        FAST_RETRY
      );

      queue.enqueue(...op('a'));
      await vi.waitFor(() => expect(attempts).toBeGreaterThan(0));
      queue.stop();

      const seen = attempts;
      await new Promise((r) => setTimeout(r, 200));
      expect(attempts).toBe(seen);
    });
  });
});
