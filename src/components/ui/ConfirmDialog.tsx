'use client';

/**
 * Confirmation dialog, replacing the native `confirm()`.
 *
 * There were eight `confirm()` and `alert()` calls, including one guarding a
 * bulk delete. Native dialogs block the main thread, cannot be styled, cannot
 * carry a warning about knock-on effects ("this also removes 12 comments"), and
 * look nothing like the rest of the app.
 *
 * Exposed as a promise-returning hook so a call site reads almost the same as
 * the `confirm()` it replaces:
 *
 *     if (await confirm({ title: 'Delete 3 tasks?', tone: 'danger' })) …
 */

import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface ConfirmOptions {
  title: string;
  /** The consequence, in plain terms. Shown as the dialog body. */
  message?: string;
  /** Extra emphasis for something irreversible. */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'neutral';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/**
 * Returns `confirm(options)` plus the element to render.
 *
 * The element must be rendered by the component that owns the hook; keeping it
 * local rather than in a global provider means the dialog participates in that
 * component's own focus context.
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: React.ReactNode;
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Held in a ref so a resolve is never dropped by a re-render mid-flight.
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const tone = pending?.tone ?? 'danger';

  const confirmDialog = pending ? (
    <Dialog
      open
      // Escape and the backdrop both mean "no", which matches what a native
      // confirm does and is the safe default for a destructive action.
      onClose={() => settle(false)}
      title={pending.title}
      size="sm"
      hideCloseButton
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => settle(false)}>
            {pending.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => settle(true)}
            // Focused on open so Enter confirms, matching the native behaviour.
            data-autofocus
            icon={
              tone === 'danger' ? (
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              ) : undefined
            }
          >
            {pending.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        {tone === 'danger' && (
          <span
            className="shrink-0 w-8 h-8 rounded-full bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center"
            aria-hidden="true"
          >
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          </span>
        )}
        <div className="space-y-2 min-w-0">
          {pending.message && (
            <p className="text-body text-fg-muted">{pending.message}</p>
          )}
          {pending.detail && (
            <p className="text-meta text-fg-subtle">{pending.detail}</p>
          )}
        </div>
      </div>
    </Dialog>
  ) : null;

  return { confirm, confirmDialog };
}
