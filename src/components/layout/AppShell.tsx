'use client';

/**
 * The application shell: auth gate, responsive chrome, keyboard shortcuts.
 *
 * Responsive behaviour is the headline change. Previously the sidebar was a fixed
 * 256px column with no responsive rules at all, so on a 375px phone it consumed
 * two thirds of the screen and there was no way to dismiss it. Now:
 *
 *  - `lg` and up: a persistent column, collapsible to a 64px icon rail.
 *  - Below `lg`: an off-canvas drawer over a scrim, opened from a hamburger,
 *    closed by Escape, the scrim, or following a link.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useData } from '@/context/DataContext';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ToastStack } from '@/components/ui/ToastStack';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { navItemFromPath } from '@/lib/navigation';
import { useKeyboardShortcuts } from '@/lib/client/useKeyboardShortcuts';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { authState, authReason } = useData();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Navigating closes the drawer; otherwise a tap on a link leaves it covering
  // the page it just opened. Adjusted during render rather than in an effect —
  // the React-recommended way to reset state in response to a prop/route
  // change without an extra committed render.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setDrawerOpen(false);
  }

  // Escape closes the drawer wherever focus happens to be.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // Lock background scroll while the drawer covers the page.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  useKeyboardShortcuts();

  const active = navItemFromPath(pathname);

  /* ----------------------------- Auth gate ------------------------------ */

  if (authState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3" role="status">
          <span
            className="w-6 h-6 border-2 border-line-strong border-t-accent rounded-full animate-spin"
            aria-hidden="true"
          />
          <p className="text-meta">Checking your access…</p>
        </div>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-padded max-w-md w-full space-y-4 text-center">
          <h1 className="text-section-title">Please sign in</h1>
          <p className="text-body text-fg-muted">
            {authReason ??
              'You need to sign in to use the dashboard.'}
          </p>
          <a
            href="/login"
            className="inline-flex items-center justify-center px-4 py-2.5 bg-accent text-accent-fg hover:bg-accent-hover font-medium text-sm rounded-lg transition-colors"
          >
            Go to sign in
          </a>
        </div>
      </div>
    );
  }

  /* ------------------------------- Shell -------------------------------- */

  return (
    <div className="min-h-screen lg:flex">
      {/* Lets a keyboard or screen-reader user jump past the nav on every page. */}
      <a
        href="#main-content"
        className="sr-only-focusable fixed top-3 left-3 z-[60] px-3 py-2 bg-accent text-accent-fg rounded-lg text-sm font-medium shadow-lg"
      >
        Skip to main content
      </a>

      {/* Desktop: persistent column */}
      <div className="hidden lg:block shrink-0">
        <Sidebar variant="persistent" />
      </div>

      {/* Mobile: off-canvas drawer */}
      {drawerOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 dark:bg-slate-950/70 animate-fade-in"
            aria-hidden="true"
            onClick={closeDrawer}
          />
          <div className="lg:hidden fixed inset-y-0 left-0 z-50 w-[min(17rem,85vw)] animate-slide-up">
            <Sidebar variant="drawer" onNavigate={closeDrawer} />
          </div>
        </>
      )}

      {/* Content column. min-w-0 stops a wide table forcing the whole page to
          scroll horizontally instead of scrolling within its own container. */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Header onOpenDrawer={() => setDrawerOpen(true)} />

        <main
          id="main-content"
          // `relative` makes this the containing block for any absolutely
          // positioned descendant (e.g. an sr-only label) whose own ancestor
          // chain has no positioned element. Without it such a descendant is
          // positioned against the viewport instead, escaping every
          // overflow-x-hidden/auto below it and reintroducing exactly the
          // page-level horizontal scroll this element exists to prevent.
          className="relative flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 overflow-x-hidden"
        >
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Page heading, from the nav model, so every section is titled
                consistently and the description explains what the screen is for. */}
            <header className="space-y-1">
              <h1 className="text-page-title">{active.title}</h1>
              <p className="text-meta max-w-2xl">{active.description}</p>
            </header>

            {/* Scoped per route: a failure in Reports must not blank the nav. */}
            <ErrorBoundary key={pathname} area={active.title}>
              {children}
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <ToastStack />
    </div>
  );
};
