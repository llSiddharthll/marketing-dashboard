/**
 * GET /api/auth/session — who am I?
 *
 * Returns 200 with `authenticated: false` rather than 401 when nobody is signed
 * in: "not signed in" is the expected answer to this question, and the client
 * uses it to decide whether to show the app or the sign-in screen.
 *
 * The role in the response comes from the spreadsheet, so the UI and the server
 * always agree on what the user may do.
 */

import { SheetRepository } from '@/lib/server/repository';
import { getSessionFromRequest } from '@/lib/server/session';
import { findActiveUser } from '@/lib/server/userService';
import { isAuthConfigured, getMissingAuthVars } from '@/lib/server/env';
import type { SessionResponse } from '@/types/dashboard';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function respond(body: SessionResponse & { authRequired?: boolean; setupRequired?: string[] }) {
  return Response.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) {
    return respond({
      authenticated: false,
      user: null,
      reason:
        'Authentication is not configured on the server. Set SESSION_SECRET to enable sign-in.',
      setupRequired: getMissingAuthVars(),
    });
  }

  const session = getSessionFromRequest(request);
  if (!session.valid) {
    return respond({
      authenticated: false,
      user: null,
      reason:
        session.reason === 'expired'
          ? 'Your session expired.'
          : session.reason === 'missing'
            ? undefined
            : 'Your session was not valid.',
    });
  }

  try {
    const repo = new SheetRepository();
    const user = await findActiveUser(repo, session.identity.email);

    if (!user) {
      return respond({
        authenticated: false,
        user: null,
        reason:
          'Your access to this dashboard has been removed or suspended.',
      });
    }

    return respond({ authenticated: true, user });
  } catch (err) {
    // The session is valid but the spreadsheet is unreachable. Report it as
    // unauthenticated-with-a-reason so the UI can explain rather than showing an
    // empty dashboard.
    return respond({
      authenticated: false,
      user: null,
      reason:
        err instanceof Error
          ? `Could not verify your access: ${err.message}`
          : 'Could not verify your access.',
    });
  }
}
