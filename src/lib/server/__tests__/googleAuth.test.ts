/**
 * Service-account token acquisition tests.
 *
 * Covers both auth modes end to end against a mocked `fetch`:
 *  - `key`: sign a JWT, exchange it at Google's token endpoint.
 *  - `metadata`: ask the GCP metadata server, used on Cloud Run/GCE — the mode
 *    forced on this project by an org policy that blocks service-account key
 *    creation entirely, so it is exercised here with the same rigour as the
 *    key flow rather than left as a hopeful fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  GoogleAuthError,
  getAccessToken,
  getAmbientServiceAccountEmail,
  resetTokenCache,
} from '../googleAuth';
import { getServerConfig, resetServerConfigCache } from '../env';

/** A real (throwaway) RSA key pair, since the code signs with it for real. */
const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function configureKeyMode(): void {
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-123';
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sa@example.iam.gserviceaccount.com';
  process.env.GOOGLE_PRIVATE_KEY = TEST_PRIVATE_KEY;
  resetServerConfigCache();
}

function configureMetadataMode(): void {
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-123';
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
  resetServerConfigCache();
}

beforeEach(() => {
  resetTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetServerConfigCache();
  resetTokenCache();
  delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
});

describe('key mode', () => {
  it('signs a JWT and exchanges it for an access token', async () => {
    configureKeyMode();

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(init?.method).toBe('POST');

      const body = new URLSearchParams(init!.body as string);
      expect(body.get('grant_type')).toBe(
        'urn:ietf:params:oauth:grant-type:jwt-bearer'
      );
      const assertion = body.get('assertion')!;
      const [encodedHeader, encodedClaims] = assertion.split('.');
      const claims = JSON.parse(
        Buffer.from(encodedClaims, 'base64url').toString('utf8')
      );
      expect(claims.iss).toBe('sa@example.iam.gserviceaccount.com');
      expect(claims.scope).toBe('https://www.googleapis.com/auth/spreadsheets');
      expect(JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')).alg).toBe(
        'RS256'
      );

      return new Response(
        JSON.stringify({ access_token: 'key-mode-token', expires_in: 3600 }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await getAccessToken();
    expect(token).toBe('key-mode-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches the token and does not re-fetch before expiry', async () => {
    configureKeyMode();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'cached-token', expires_in: 3600 }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    await getAccessToken();
    await getAccessToken();
    await getAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent fetches on a cold cache', async () => {
    configureKeyMode();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return new Response(
          JSON.stringify({ access_token: 'race-token', expires_in: 3600 }),
          { status: 200 }
        );
      })
    );

    const [a, b, c] = await Promise.all([
      getAccessToken(),
      getAccessToken(),
      getAccessToken(),
    ]);

    expect([a, b, c]).toEqual(['race-token', 'race-token', 'race-token']);
    expect(calls).toBe(1);
  });

  it('surfaces Google error_description on rejection', async () => {
    configureKeyMode();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'invalid_grant',
              error_description: 'Invalid JWT Signature.',
            }),
            { status: 400 }
          )
      )
    );

    await expect(getAccessToken()).rejects.toThrow(/Invalid JWT Signature/);
  });

  it('wraps a malformed private key in a clear GoogleAuthError', async () => {
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-123';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sa@example.iam.gserviceaccount.com';
    // Well-formed PEM armour but garbage inside, so it passes env.ts's shape
    // check and fails at the actual signing step this test targets.
    process.env.GOOGLE_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\nbm90YXJlYWxrZXk=\n-----END PRIVATE KEY-----\n';
    resetServerConfigCache();

    await expect(getAccessToken()).rejects.toThrow(GoogleAuthError);
    await expect(getAccessToken()).rejects.toThrow(/GOOGLE_PRIVATE_KEY/);
  });
});

describe('metadata mode', () => {
  it('is selected automatically when no private key is configured', async () => {
    configureMetadataMode();

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
      );
      expect((init?.headers as Record<string, string>)['Metadata-Flavor']).toBe(
        'Google'
      );
      return new Response(
        JSON.stringify({ access_token: 'metadata-token', expires_in: 3600 }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await getAccessToken();
    expect(token).toBe('metadata-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires no service-account email or key to be configured', () => {
    // Regression: env.ts must not demand GOOGLE_SERVICE_ACCOUNT_EMAIL when
    // there is no GOOGLE_PRIVATE_KEY — that pairing only makes sense together.
    // A project whose org policy blocks key creation entirely (this one) must
    // be able to configure nothing beyond the spreadsheet id and still work.
    configureMetadataMode();
    const config = getServerConfig();
    expect(config.authMode).toBe('metadata');
    expect(config.clientEmail).toBeNull();
    expect(config.privateKey).toBeNull();
    expect(config.spreadsheetId).toBe('sheet-123');
  });

  it('selects key mode and requires the email once a private key is set', () => {
    configureKeyMode();
    const config = getServerConfig();
    expect(config.authMode).toBe('key');
    expect(config.clientEmail).toBe('sa@example.iam.gserviceaccount.com');
    expect(config.privateKey).toContain('BEGIN PRIVATE KEY');
  });

  it('caches independently of key-mode tokens', async () => {
    configureMetadataMode();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: 'metadata-cached', expires_in: 3600 }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    await getAccessToken();
    await getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives an actionable error when the metadata server is unreachable', async () => {
    configureMetadataMode();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );

    await expect(getAccessToken()).rejects.toThrow(GoogleAuthError);
    await expect(getAccessToken()).rejects.toThrow(/not running on GCP|metadata server/i);
  });

  it('explains a 403 from the metadata server as a scope/attachment problem', async () => {
    configureMetadataMode();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('Forbidden', { status: 403 })
      )
    );

    await expect(getAccessToken()).rejects.toThrow(/service account/i);
  });

  describe('getAmbientServiceAccountEmail', () => {
    it('returns the email the metadata server reports', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          expect(url).toContain('/service-accounts/default/email');
          return new Response('marketing-dashboard@project.iam.gserviceaccount.com', {
            status: 200,
          });
        })
      );

      expect(await getAmbientServiceAccountEmail()).toBe(
        'marketing-dashboard@project.iam.gserviceaccount.com'
      );
    });

    it('returns null rather than throwing when unreachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        })
      );

      expect(await getAmbientServiceAccountEmail()).toBeNull();
    });
  });
});

describe('config edge cases', () => {
  it('treats an email with no key as metadata mode, not an error', () => {
    // GOOGLE_SERVICE_ACCOUNT_EMAIL with no GOOGLE_PRIVATE_KEY is not a valid
    // "key mode" configuration, but it must not be treated as one either —
    // the presence of the key alone selects the mode. A stray email left over
    // from an old .env is harmless, not a startup failure.
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-123';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'leftover@example.com';
    delete process.env.GOOGLE_PRIVATE_KEY;
    resetServerConfigCache();

    const config = getServerConfig();
    expect(config.authMode).toBe('metadata');
    expect(config.clientEmail).toBeNull();
  });

  it('still requires the spreadsheet id in metadata mode', () => {
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    delete process.env.GOOGLE_PRIVATE_KEY;
    resetServerConfigCache();

    expect(() => getServerConfig()).toThrow(/GOOGLE_SHEETS_SPREADSHEET_ID/);
  });
});

describe('mode switching', () => {
  it('does not reuse a key-mode token after switching to metadata mode', async () => {
    configureKeyMode();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ access_token: 'stale-key-token', expires_in: 3600 }),
            { status: 200 }
          )
      )
    );
    await getAccessToken();

    configureMetadataMode();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ access_token: 'fresh-metadata-token', expires_in: 3600 }),
            { status: 200 }
          )
      )
    );

    expect(await getAccessToken()).toBe('fresh-metadata-token');
  });
});
