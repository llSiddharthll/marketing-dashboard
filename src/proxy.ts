/**
 * Optimistic route protection.
 *
 * In Next.js 16 the `middleware` convention is renamed to `proxy`. It runs on the
 * Node runtime and executes before routes render.
 *
 * This performs an **optimistic** check only: it reads the session cookie and
 * redirects a visitor with no usable session to `/login`. It deliberately does
 * not talk to the spreadsheet, because proxy runs on every request (including
 * prefetches) and a Sheets round trip here would slow the whole app down.
 *
 * The authoritative check lives in the route handlers, where `requireUser()`
 * verifies the signature *and* resolves the current role from the `Users` tab.
 * A forged cookie gets past this file and is rejected there — so this is a
 * redirect for user experience, not the security boundary.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/server/session';

/** Paths reachable without a session. */
const PUBLIC_PATHS = new Set(['/login']);

/** API prefixes that must stay reachable while signed out. */
const PUBLIC_API_PREFIXES = [
  '/api/auth/', // login, logout, session
  '/api/health', // needed to diagnose a deployment before sign-in exists
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  // Presence check only. Validity is proven server-side in the route handler;
  // verifying the HMAC here as well would duplicate work on every asset request.
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  // API calls get a 401 they can act on rather than an HTML redirect, which a
  // fetch() would otherwise follow and then fail to parse as JSON.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'You must sign in to do that.', detail: 'missing' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const loginUrl = new URL('/login', request.nextUrl.origin);
  // Preserve where they were heading so sign-in can return them there.
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * Skip Next internals and static assets. Without this, auth logic would run
   * for every CSS, JS and image request and could block them from loading.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
