/**
 * POST /api/auth/logout — clear the session.
 *
 * POST rather than GET so that a link, an image tag or a prefetch cannot sign
 * someone out. `SameSite=Lax` on the session cookie plus the POST requirement
 * makes a drive-by logout impractical.
 */

import { SESSION_COOKIE, serialiseClearedCookie } from '@/lib/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const headers = new Headers();
  headers.append('Set-Cookie', serialiseClearedCookie(SESSION_COOKIE));
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify({ signedOut: true }), {
    status: 200,
    headers,
  });
}
