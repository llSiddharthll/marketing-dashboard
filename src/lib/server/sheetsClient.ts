/**
 * Thin, typed wrapper over the Google Sheets v4 REST API.
 *
 * Exposes only the operations the repository needs, behind a
 * {@link SheetsTransport} interface so tests can substitute an in-memory
 * spreadsheet and run without credentials.
 *
 * All calls retry on the failures Google actually returns transiently
 * (429 rate limit, 500/502/503 backend errors) with exponential backoff and
 * jitter. Client errors (400/403/404) fail fast — retrying a permissions
 * problem just delays a clear message.
 */

import { getAccessToken } from './googleAuth';
import { getServerConfig, setDynamicSpreadsheetId } from './env';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function createNewSpreadsheet(title = 'Marketing Task Dashboard'): Promise<string> {
  const token = await getAccessToken();
  const response = await fetch(SHEETS_API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new SheetsApiError(`Could not auto-create Google Spreadsheet: ${text}`, response.status);
  }

  const data = (await response.json()) as { spreadsheetId?: string };
  if (!data.spreadsheetId) {
    throw new SheetsApiError('Google Sheets API did not return a spreadsheetId.', 500);
  }
  return data.spreadsheetId;
}

let attemptedAutoCreate = false;

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 300;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class SheetsApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SheetsApiError';
    this.status = status;
    this.retryable = RETRYABLE_STATUSES.has(status);
  }
}

/** A value range as returned/accepted by the Sheets API. */
export interface ValueRange {
  range: string;
  values: (string | number | boolean)[][];
}

export interface SheetMeta {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

/**
 * The operations the repository depends on. Implemented by
 * {@link GoogleSheetsTransport} in production and by a fake in tests.
 */
export interface SheetsTransport {
  /** Lists the tabs present in the spreadsheet. */
  getSheets(): Promise<SheetMeta[]>;

  /** Reads several ranges in one round trip. Order matches the input. */
  batchGet(ranges: string[]): Promise<ValueRange[]>;

  /** Overwrites the given ranges. */
  batchUpdate(data: ValueRange[]): Promise<void>;

  /**
   * Appends rows after the last populated row of the range's table.
   * Google serialises appends server-side, which is what makes concurrent task
   * creation safe without a distributed lock.
   * Returns the A1 range the new rows landed in.
   */
  append(range: string, values: (string | number | boolean)[][]): Promise<string>;

  /** Deletes a single row (1-based, as displayed in the UI). */
  deleteRow(sheetId: number, rowNumber: number): Promise<void>;

  /** Creates a tab with the given title. Resolves to its new sheetId. */
  addSheet(title: string, columnCount: number): Promise<number>;

  /** Applies bold + background to a header row and freezes it. */
  formatHeaderRow(sheetId: number, columnCount: number): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full jitter backoff: avoids a thundering herd when several writes retry. */
function backoffDelay(attempt: number): number {
  const ceiling = BASE_BACKOFF_MS * 2 ** attempt;
  return Math.random() * ceiling;
}

export class GoogleSheetsTransport implements SheetsTransport {
  private readonly explicitSpreadsheetId: string | undefined;

  constructor(spreadsheetId?: string) {
    this.explicitSpreadsheetId = spreadsheetId;
  }

  private get spreadsheetId(): string {
    return this.explicitSpreadsheetId ?? getServerConfig().spreadsheetId;
  }

  private async call<T>(
    path: string,
    init: { method: string; body?: unknown; searchParams?: Record<string, string> }
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(backoffDelay(attempt - 1));

      const spreadsheetId = this.spreadsheetId;
      const token = await getAccessToken();
      const url = new URL(`${SHEETS_API_BASE}/${spreadsheetId}${path}`);
      for (const [key, value] of Object.entries(init.searchParams ?? {})) {
        url.searchParams.set(key, value);
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          cache: 'no-store',
        });
      } catch (err) {
        lastError = new SheetsApiError(
          `Could not reach the Google Sheets API: ${
            err instanceof Error ? err.message : String(err)
          }`,
          503
        );
        continue;
      }

      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      }

      const errorText = await response.text();
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText) as {
          error?: { message?: string; status?: string };
        };
        detail = parsed.error?.message ?? errorText;
      } catch {
        /* keep raw body */
      }

      // Auto-create spreadsheet if access denied (403) or sheet not found (404)
      if ((response.status === 403 || response.status === 404) && !attemptedAutoCreate && !this.explicitSpreadsheetId) {
        attemptedAutoCreate = true;
        try {
          console.log('[sheets] Access denied or sheet not found. Auto-creating a new Google Spreadsheet for the workspace...');
          const newId = await createNewSpreadsheet();
          console.log(`[sheets] Successfully created new Google Spreadsheet ID: ${newId}`);
          setDynamicSpreadsheetId(newId);
          continue;
        } catch (createErr) {
          console.error('[sheets] Auto-create spreadsheet failed:', createErr);
        }
      }

      const error = new SheetsApiError(
        this.explain(response.status, detail),
        response.status
      );

      if (!error.retryable) throw error;
      lastError = error;
    }

    throw lastError instanceof Error
      ? lastError
      : new SheetsApiError('Google Sheets API failed after retries.', 503);
  }

  /** Turns Google's terse errors into something the operator can act on. */
  private explain(status: number, detail: string): string {
    if (status === 403) {
      return (
        `Google denied access to the spreadsheet (403). Share the sheet with the ` +
        `service account address as an Editor, and confirm the Google Sheets API ` +
        `is enabled for the project. Google said: ${detail}`
      );
    }
    if (status === 404) {
      return (
        `Spreadsheet not found (404). Check GOOGLE_SHEETS_SPREADSHEET_ID is the id ` +
        `from the sheet URL, not the full URL. Google said: ${detail}`
      );
    }
    if (status === 400) {
      return `Google Sheets rejected the request (400): ${detail}`;
    }
    return `Google Sheets API error ${status}: ${detail}`;
  }

  async getSheets(): Promise<SheetMeta[]> {
    const data = await this.call<{
      sheets?: {
        properties?: {
          sheetId?: number;
          title?: string;
          gridProperties?: { rowCount?: number; columnCount?: number };
        };
      }[];
    }>('', {
      method: 'GET',
      searchParams: { fields: 'sheets.properties' },
    });

    return (data.sheets ?? []).map((s) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? '',
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      columnCount: s.properties?.gridProperties?.columnCount ?? 0,
    }));
  }

  async batchGet(ranges: string[]): Promise<ValueRange[]> {
    if (ranges.length === 0) return [];

    const search = new URLSearchParams();
    for (const range of ranges) search.append('ranges', range);
    search.set('majorDimension', 'ROWS');
    // Read raw strings so a date-formatted cell round-trips as typed rather
        // than as a locale-rendered display value.
    search.set('valueRenderOption', 'UNFORMATTED_VALUE');
    search.set('dateTimeRenderOption', 'FORMATTED_STRING');

    const data = await this.call<{
      valueRanges?: { range?: string; values?: unknown[][] }[];
    }>(`/values:batchGet?${search.toString()}`, { method: 'GET' });

    return (data.valueRanges ?? []).map((vr, i) => ({
      range: vr.range ?? ranges[i],
      values: (vr.values ?? []) as (string | number | boolean)[][],
    }));
  }

  async batchUpdate(data: ValueRange[]): Promise<void> {
    if (data.length === 0) return;
    await this.call('/values:batchUpdate', {
      method: 'POST',
      body: {
        valueInputOption: 'RAW',
        data: data.map((d) => ({
          range: d.range,
          majorDimension: 'ROWS',
          values: d.values,
        })),
      },
    });
  }

  async append(
    range: string,
    values: (string | number | boolean)[][]
  ): Promise<string> {
    const result = await this.call<{ updates?: { updatedRange?: string } }>(
      `/values/${encodeURIComponent(range)}:append`,
      {
        method: 'POST',
        searchParams: {
          valueInputOption: 'RAW',
          // INSERT_ROWS (not OVERWRITE) so a concurrent append can never land
          // on a row another request is about to write.
          insertDataOption: 'INSERT_ROWS',
          includeValuesInResponse: 'false',
        },
        body: { majorDimension: 'ROWS', values },
      }
    );
    return result.updates?.updatedRange ?? '';
  }

  async deleteRow(sheetId: number, rowNumber: number): Promise<void> {
    await this.call(':batchUpdate', {
      method: 'POST',
      body: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                // API is 0-based and end-exclusive; rowNumber is 1-based.
                startIndex: rowNumber - 1,
                endIndex: rowNumber,
              },
            },
          },
        ],
      },
    });
  }

  async addSheet(title: string, columnCount: number): Promise<number> {
    const result = await this.call<{
      replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
    }>(':batchUpdate', {
      method: 'POST',
      body: {
        requests: [
          {
            addSheet: {
              properties: {
                title,
                gridProperties: {
                  rowCount: 1000,
                  columnCount: Math.max(columnCount, 8),
                  frozenRowCount: 1,
                },
              },
            },
          },
        ],
      },
    });
    return result.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
  }

  async formatHeaderRow(sheetId: number, columnCount: number): Promise<void> {
    await this.call(':batchUpdate', {
      method: 'POST',
      body: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: columnCount,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  backgroundColor: { red: 0.945, green: 0.961, blue: 0.976 },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
        ],
      },
    });
  }
}
