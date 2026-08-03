'use client';

/**
 * Renders the toast queue from DataContext.
 *
 * Phase 1 added the toast state but nothing displayed it, so a failed write
 * reported itself to an empty room. This is that missing surface.
 *
 * Uses `aria-live="polite"` so screen readers announce a save or a failure
 * without interrupting whatever the user is doing.
 */

import React from 'react';
import { useData } from '@/context/DataContext';
import { CheckCircle2, Info, X, AlertCircle } from 'lucide-react';

export const ToastStack: React.FC = () => {
  const { toasts, dismissToast } = useData();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] sm:w-96 pointer-events-none"
    >
      {toasts.map((toast) => {
        const Icon =
          toast.kind === 'success'
            ? CheckCircle2
            : toast.kind === 'error'
              ? AlertCircle
              : Info;

        const tone =
          toast.kind === 'success'
            ? 'bg-white dark:bg-slate-900 border-emerald-300 dark:border-emerald-900'
            : toast.kind === 'error'
              ? 'bg-white dark:bg-slate-900 border-rose-300 dark:border-rose-900'
              : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700';

        const iconTone =
          toast.kind === 'success'
            ? 'text-emerald-600 dark:text-emerald-400'
            : toast.kind === 'error'
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-slate-500';

        return (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg ${tone}`}
          >
            <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconTone}`} aria-hidden="true" />

            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                {toast.message}
              </p>
              {toast.detail && (
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed wrap-break-word">
                  {toast.detail}
                </p>
              )}
            </div>

            <button
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 p-1 -m-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:focus-visible:outline-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
