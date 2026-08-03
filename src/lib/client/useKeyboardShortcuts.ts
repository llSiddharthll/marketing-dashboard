'use client';

/**
 * Keyboard navigation.
 *
 * The sidebar has been displaying ⌘1–⌘8 next to every item since the first
 * build, but no handler existed — the shortcuts were decoration. This implements
 * them, plus `/` to focus search, which is the convention in every tool this app
 * is modelled on.
 *
 * Deliberately ignores keystrokes while the user is typing, and while a modal is
 * open, so a shortcut can never fire from inside a task form.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/navigation';

/** True when the event came from a text field or a contenteditable region. */
function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/** True when a dialog is on screen; shortcuts must not act behind it. */
function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

export function useKeyboardShortcuts(): void {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // `/` focuses the global search, unless the user is already typing.
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !isTypingContext(event.target) &&
        !isModalOpen()
      ) {
        const search = document.querySelector<HTMLInputElement>(
          '[data-global-search]'
        );
        if (search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }

      // Section shortcuts need the platform modifier. Requiring it avoids
      // stealing bare digits, which matter in the budget fields.
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey) return;
      if (isModalOpen()) return;

      // event.code rather than event.key so a non-US layout still maps the
      // physical number row correctly.
      const match = /^Digit([1-9])$/.exec(event.code);
      if (!match) return;

      const item = NAV_ITEMS.find(
        (candidate) => candidate.shortcutDigit === Number(match[1])
      );
      if (!item) return;

      event.preventDefault();
      router.push(item.href);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [router]);
}

/**
 * The modifier symbol for the current platform, so the hint shown in the UI
 * matches the key the user actually has to press. Returns the Windows/Linux form
 * during server rendering, then corrects on the client.
 */
export function useModifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent)
    ? '⌘'
    : 'Ctrl';
}
