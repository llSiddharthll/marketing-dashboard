/**
 * Session cookie tests.
 *
 * These are the security boundary: if a forged or tampered token were accepted,
 * anyone could impersonate an Admin. Each test targets a specific way that could
 * happen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  SESSION_COOKIE,
  createSessionToken,
  getSessionFromRequest,
  readCookie,
  serialiseClearedCookie,
  serialiseCookie,
  verifySessionToken,
} from '../session';
import { resetServerConfigCache } from '../env';

const SECRET = 'a-test-secret-that-is-long-enough-to-pass-validation';

/**
 * Returns the rejection reason, asserting the token was rejected.
 * `reason` lives only on the invalid branch of the result union, so this
 * narrows in one place instead of at every call site.
 */
function rejectionReason(token: string | undefined | null): string {
  const result = verifySessionToken(token);
  if (result.valid) {
    throw new Error('expected the token to be rejected, but it was accepted');
  }
  return result.reason;
}

function configure(overrides: Record<string, string> = {}): void {
  process.env.SESSION_SECRET = SECRET;
  process.env.APP_URL = 'https://dashboard.example.com';
  process.env.INITIAL_ADMIN_EMAILS = 'boss@example.com';
  delete process.env.ALLOWED_EMAIL_DOMAIN;
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
  resetServerConfigCache();
}

beforeEach(() => {
  configure();
});

afterEach(() => {
  vi.useRealTimers();
  resetServerConfigCache();
});

describe('createSessionToken / verifySessionToken', () => {
  it('round-trips an identity', () => {
    const token = createSessionToken({
      email: 'aarav@example.com',
      name: 'Aarav Sharma',
    });

    const result = verifySessionToken(token);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.identity.email).toBe('aarav@example.com');
    expect(result.identity.name).toBe('Aarav Sharma');
    expect(result.identity.exp).toBeGreaterThan(result.identity.iat);
  });

  it('lowercases the email so the Users lookup cannot be case-dodged', () => {
    const token = createSessionToken({
      email: 'Aarav@Example.COM',
      name: 'Aarav',
    });
    const result = verifySessionToken(token);
    expect(result.valid && result.identity.email).toBe('aarav@example.com');
  });

  it('never stores the role in the token', () => {
    // The role must be resolved from the Users tab per request; embedding it
    // would let a demoted user keep their old permissions until expiry.
    const token = createSessionToken({ email: 'a@example.com', name: 'A' });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8')
    );
    expect(payload).not.toHaveProperty('role');
    expect(Object.keys(payload).sort()).toEqual(['email', 'exp', 'iat', 'name']);
  });

  describe('rejects', () => {
    it('a missing token', () => {
      expect(verifySessionToken(undefined)).toEqual({
        valid: false,
        reason: 'missing',
      });
      expect(verifySessionToken('')).toEqual({
        valid: false,
        reason: 'missing',
      });
    });

    it('a malformed token', () => {
      expect(rejectionReason('nonsense')).toBe('malformed');
      expect(rejectionReason('only.two.parts.here')).toBe('malformed');
      expect(rejectionReason('.')).toBe('malformed');
    });

    it('a tampered payload', () => {
      // The classic attack: edit the email, keep the old signature.
      const token = createSessionToken({
        email: 'viewer@example.com',
        name: 'Viewer',
      });
      const [, signature] = token.split('.');

      const forgedPayload = Buffer.from(
        JSON.stringify({
          email: 'boss@example.com',
          name: 'Boss',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');

      const result = verifySessionToken(`${forgedPayload}.${signature}`);
      expect(result).toEqual({ valid: false, reason: 'bad-signature' });
    });

    it('a token signed with a different secret', () => {
      const token = createSessionToken({ email: 'a@example.com', name: 'A' });

      // The attacker guessed wrong, or an old key was rotated out.
      configure({ SESSION_SECRET: 'a-completely-different-secret-of-good-length' });

      expect(verifySessionToken(token)).toEqual({
        valid: false,
        reason: 'bad-signature',
      });
    });

    it('a token with no signature at all', () => {
      const payload = Buffer.from(
        JSON.stringify({
          email: 'boss@example.com',
          name: 'Boss',
          iat: 1,
          exp: 9_999_999_999,
        })
      ).toString('base64url');

      expect(rejectionReason(`${payload}.`)).toBe('malformed');
      expect(rejectionReason(payload)).toBe('malformed');
    });

    it('an expired token', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
      const token = createSessionToken(
        { email: 'a@example.com', name: 'A' },
        { ttlSeconds: 60 }
      );

      // Still valid a moment later.
      vi.setSystemTime(new Date('2026-07-01T00:00:30.000Z'));
      expect(verifySessionToken(token).valid).toBe(true);

      // Expired past the TTL.
      vi.setSystemTime(new Date('2026-07-01T00:02:00.000Z'));
      expect(verifySessionToken(token)).toEqual({
        valid: false,
        reason: 'expired',
      });
    });

    it('a payload that is valid JSON but not an identity', () => {
      // Signed with the right key, so it passes the signature check and must be
      // caught by the shape validation.
      const payload = Buffer.from(JSON.stringify({ hello: 'world' })).toString(
        'base64url'
      );
      const signature = createHmac('sha256', SECRET)
        .update(payload)
        .digest('base64url');

      expect(rejectionReason(`${payload}.${signature}`)).toBe('malformed');
    });

    it('a signed payload that is not JSON at all', () => {
      const payload = Buffer.from('not json').toString('base64url');
      const signature = createHmac('sha256', SECRET)
        .update(payload)
        .digest('base64url');

      expect(rejectionReason(`${payload}.${signature}`)).toBe('malformed');
    });
  });
});

describe('cookie serialisation', () => {
  it('sets the flags that protect the session', () => {
    const header = serialiseCookie(SESSION_COOKIE, 'value', {
      maxAgeSeconds: 3600,
    });

    // HttpOnly keeps it away from JavaScript, so XSS cannot exfiltrate it.
    expect(header).toContain('HttpOnly');
    // Lax still allows the top-level redirect back from Google.
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=3600');
    // APP_URL is https, so Secure must be set.
    expect(header).toContain('Secure');
  });

  it('omits Secure on plain http so local development works', () => {
    configure({ APP_URL: 'http://localhost:3000' });
    const header = serialiseCookie(SESSION_COOKIE, 'value', {
      maxAgeSeconds: 60,
    });
    expect(header).not.toContain('Secure');
    // The other protections still apply.
    expect(header).toContain('HttpOnly');
  });

  it('expires the cookie when cleared', () => {
    expect(serialiseClearedCookie(SESSION_COOKIE)).toContain('Max-Age=0');
  });
});

describe('readCookie', () => {
  function requestWithCookies(cookieHeader: string): Request {
    return new Request('https://example.com/', {
      headers: { cookie: cookieHeader },
    });
  }

  it('reads a single cookie', () => {
    expect(
      readCookie(requestWithCookies('mtd_session=abc'), SESSION_COOKIE)
    ).toBe('abc');
  });

  it('picks the right cookie out of several', () => {
    const request = requestWithCookies(
      `other=1; ${SESSION_COOKIE}=target; custom_cookie=state-value`
    );
    expect(readCookie(request, SESSION_COOKIE)).toBe('target');
    expect(readCookie(request, 'custom_cookie')).toBe('state-value');
  });

  it('does not match on a name prefix', () => {
    // `mtd_session_backup` must not satisfy a lookup for `mtd_session`.
    const request = requestWithCookies('mtd_session_backup=wrong');
    expect(readCookie(request, SESSION_COOKIE)).toBeUndefined();
  });

  it('returns undefined when there is no cookie header', () => {
    const request = new Request('https://example.com/');
    expect(readCookie(request, SESSION_COOKIE)).toBeUndefined();
  });

  it('tolerates a value containing an equals sign', () => {
    const request = requestWithCookies(`${SESSION_COOKIE}=a=b=c`);
    expect(readCookie(request, SESSION_COOKIE)).toBe('a=b=c');
  });
});

describe('getSessionFromRequest', () => {
  it('extracts a valid session from a request', () => {
    const token = createSessionToken({
      email: 'aarav@example.com',
      name: 'Aarav',
    });
    const request = new Request('https://example.com/api/snapshot', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });

    const result = getSessionFromRequest(request);
    expect(result.valid && result.identity.email).toBe('aarav@example.com');
  });

  it('reports missing when no cookie is present', () => {
    const request = new Request('https://example.com/api/snapshot');
    expect(getSessionFromRequest(request).valid).toBe(false);
  });
});
