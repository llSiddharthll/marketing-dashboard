'use client';

/**
 * Accessible modal dialog.
 *
 * The previous build had four hand-rolled modals, none of which had a dialog
 * role, a focus trap, or an Escape handler — a keyboard user could open the task
 * drawer and have no way out, and a screen reader was never told a dialog had
 * opened. Every modal now goes through this one component, so those properties
 * cannot be forgotten per-instance.
 *
 * What it handles:
 *  - `role="dialog"` + `aria-modal` + a labelled title.
 *  - Escape to close.
 *  - Focus moved in on open and restored to the trigger on close.
 *  - Tab cycling confined to the dialog.
 *  - Background scroll lock, without the layout shift that hiding the scrollbar
 *    normally causes.
 *  - Click on the backdrop to dismiss, but not on a drag that started inside.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
} from 'react';
import { X } from 'lucide-react';

/** Elements that can hold focus, for the trap and the initial-focus search. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional supporting line under the title. */
  description?: string;
  children: React.ReactNode;
  /** Footer actions; rendered pinned below the scrollable body. */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Set for a form with unsaved input, so a stray backdrop click cannot discard
   * what the user typed. Escape still works.
   */
  disableBackdropClose?: boolean;
  /** Hides the header close button when the footer already offers a cancel. */
  hideCloseButton?: boolean;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  disableBackdropClose = false,
  hideCloseButton = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  /** Tracks where a mousedown began, so a text selection drag cannot close. */
  const pointerDownOnBackdrop = useRef(false);

  const titleId = useId();
  const descriptionId = useId();

  /* --------------------------- Focus management ------------------------- */

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Defer so the panel is mounted and measurable.
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      // Prefer the first field so a form is immediately usable; fall back to the
      // panel itself, which is focusable via tabIndex below.
      const target =
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>(FOCUSABLE) ??
        panel;
      target.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      // Returning focus to the trigger is what makes repeated open/close usable
      // from the keyboard.
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  /* ----------------------------- Scroll lock ---------------------------- */

  useEffect(() => {
    if (!open) return;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;

    // Compensate for the removed scrollbar so the page behind does not jump.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  /* ------------------------- Keyboard behaviour ------------------------- */

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Wrap at both ends so focus can never escape to the page behind.
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/70 backdrop-blur-[2px]"
        aria-hidden="true"
        onMouseDown={() => {
          pointerDownOnBackdrop.current = true;
        }}
        onMouseUp={() => {
          if (pointerDownOnBackdrop.current && !disableBackdropClose) onClose();
          pointerDownOnBackdrop.current = false;
        }}
      />

      {/* Panel. On phones it becomes a bottom sheet, which puts the controls
          within thumb reach instead of centring a tall form off-screen. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={`relative w-full ${SIZES[size]} bg-surface border border-line shadow-2xl
          rounded-t-2xl sm:rounded-2xl
          max-h-[92vh] sm:max-h-[85vh] flex flex-col
          animate-slide-up focus:outline-none`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-section-title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-meta mt-1">
                {description}
              </p>
            )}
          </div>

          {!hideCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="shrink-0 p-1.5 -m-1 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-sunken transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 overscroll-contain">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="shrink-0 px-5 py-4 border-t border-line bg-surface-sunken/50 rounded-b-none sm:rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
