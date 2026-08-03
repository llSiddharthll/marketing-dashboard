/**
 * In-memory implementation of {@link SheetsTransport}.
 *
 * Models the parts of Sheets' behaviour the repository actually depends on, so
 * the data layer can be tested without credentials or network access:
 *
 *  - A1 range parsing, including open-ended ranges (`A2:Z`) and quoted titles.
 *  - `append` inserting after the last populated row.
 *  - Ragged rows: Sheets omits trailing empty cells, and the readers must cope.
 *  - Call counting, so tests can assert we are not rewriting the whole table.
 */

import type {
  SheetMeta,
  SheetsTransport,
  ValueRange,
} from '../sheetsClient';

type Cell = string | number | boolean;

interface FakeSheet {
  sheetId: number;
  title: string;
  /** Dense grid, row-major, 0-based. Row 0 is the header. */
  rows: Cell[][];
}

interface ParsedRange {
  title: string;
  startRow: number; // 0-based inclusive
  endRow: number | null; // 0-based inclusive; null = open ended
  startCol: number; // 0-based inclusive
  endCol: number | null; // 0-based inclusive; null = open ended
}

function letterToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Parses ranges of the forms used by the repository, e.g. `'Tasks'!A2:AA5`. */
export function parseRange(range: string): ParsedRange {
  const bangIndex = range.lastIndexOf('!');
  let title = range.slice(0, bangIndex);
  const cells = range.slice(bangIndex + 1);

  if (
    (title.startsWith("'") && title.endsWith("'")) ||
    (title.startsWith('"') && title.endsWith('"'))
  ) {
    title = title.slice(1, -1);
  }

  const [startRef, endRef] = cells.split(':');
  const parseRef = (ref: string) => {
    const match = /^([A-Za-z]+)(\d*)$/.exec(ref);
    if (!match) throw new Error(`Unparseable cell reference: ${ref}`);
    return {
      col: letterToIndex(match[1]),
      row: match[2] === '' ? null : Number(match[2]) - 1,
    };
  };

  const start = parseRef(startRef);
  const end = endRef ? parseRef(endRef) : start;

  return {
    title,
    startRow: start.row ?? 0,
    endRow: end.row,
    startCol: start.col,
    endCol: end.col,
  };
}

export class FakeSheetsTransport implements SheetsTransport {
  private sheets: FakeSheet[] = [];
  private nextSheetId = 1;

  /** Per-method call counts, for asserting write efficiency. */
  readonly calls = {
    getSheets: 0,
    batchGet: 0,
    batchUpdate: 0,
    append: 0,
    deleteRow: 0,
    addSheet: 0,
    formatHeaderRow: 0,
  };

  /** Ranges passed to batchUpdate, in order. Lets tests assert what was written. */
  readonly writtenRanges: string[] = [];

  /** When set, the next call to the named method throws this error once. */
  private failures = new Map<string, Error>();

  /** Hook invoked immediately before each batchUpdate, to simulate races. */
  onBeforeBatchUpdate: (() => void) | null = null;

  /** Hook invoked immediately after each batchUpdate. */
  onAfterBatchUpdate: (() => void) | null = null;

  failNextCall(method: keyof FakeSheetsTransport['calls'], error: Error): void {
    this.failures.set(method, error);
  }

  private checkFailure(method: string): void {
    const error = this.failures.get(method);
    if (error) {
      this.failures.delete(method);
      throw error;
    }
  }

  private findSheet(title: string): FakeSheet {
    const sheet = this.sheets.find((s) => s.title === title);
    if (!sheet) throw new Error(`Unable to parse range: ${title}`);
    return sheet;
  }

  /* --------------------------- Test helpers --------------------------- */

  /** Creates a tab pre-populated with a header row. */
  seedSheet(title: string, header: readonly string[], dataRows: Cell[][] = []): void {
    this.sheets.push({
      sheetId: this.nextSheetId++,
      title,
      rows: [[...header], ...dataRows.map((r) => [...r])],
    });
  }

  /** Returns a tab's data rows (header excluded), as stored. */
  getDataRows(title: string): Cell[][] {
    return this.findSheet(title).rows.slice(1);
  }

  /**
   * Directly edits a cell, simulating a person typing in the spreadsheet.
   * Grows the grid as needed, because a real sheet lets you type into any cell
   * below the existing data.
   */
  setCell(title: string, rowNumber: number, colIndex: number, value: Cell): void {
    const sheet = this.findSheet(title);
    while (sheet.rows.length < rowNumber) sheet.rows.push([]);
    const row = sheet.rows[rowNumber - 1];
    while (row.length <= colIndex) row.push('');
    row[colIndex] = value;
  }

  hasSheet(title: string): boolean {
    return this.sheets.some((s) => s.title === title);
  }

  resetCallCounts(): void {
    for (const key of Object.keys(this.calls) as (keyof typeof this.calls)[]) {
      this.calls[key] = 0;
    }
    this.writtenRanges.length = 0;
  }

  /* --------------------------- Transport ------------------------------ */

  async getSheets(): Promise<SheetMeta[]> {
    this.calls.getSheets++;
    this.checkFailure('getSheets');
    return this.sheets.map((s) => ({
      sheetId: s.sheetId,
      title: s.title,
      rowCount: Math.max(s.rows.length, 1000),
      columnCount: Math.max(...s.rows.map((r) => r.length), 8),
    }));
  }

  async batchGet(ranges: string[]): Promise<ValueRange[]> {
    this.calls.batchGet++;
    this.checkFailure('batchGet');

    return ranges.map((range) => {
      const parsed = parseRange(range);
      const sheet = this.sheets.find((s) => s.title === parsed.title);
      if (!sheet) return { range, values: [] };

      const lastRow =
        parsed.endRow === null ? sheet.rows.length - 1 : parsed.endRow;

      const values: Cell[][] = [];
      for (let r = parsed.startRow; r <= lastRow && r < sheet.rows.length; r++) {
        const sourceRow = sheet.rows[r] ?? [];
        const lastCol =
          parsed.endCol === null ? sourceRow.length - 1 : parsed.endCol;

        const slice: Cell[] = [];
        for (let c = parsed.startCol; c <= lastCol; c++) {
          slice.push(sourceRow[c] ?? '');
        }

        // Sheets omits trailing empty cells; mirror that so the readers are
        // exercised against ragged input.
        while (slice.length > 0 && slice[slice.length - 1] === '') slice.pop();
        values.push(slice);
      }

      // Sheets also omits entirely-empty trailing rows.
      while (values.length > 0 && values[values.length - 1].length === 0) {
        values.pop();
      }

      return { range, values };
    });
  }

  async batchUpdate(data: ValueRange[]): Promise<void> {
    this.calls.batchUpdate++;
    this.checkFailure('batchUpdate');
    this.onBeforeBatchUpdate?.();

    for (const entry of data) {
      this.writtenRanges.push(entry.range);
      const parsed = parseRange(entry.range);
      const sheet = this.findSheet(parsed.title);

      entry.values.forEach((row, rowOffset) => {
        const targetRow = parsed.startRow + rowOffset;
        while (sheet.rows.length <= targetRow) sheet.rows.push([]);
        const destination = sheet.rows[targetRow];
        row.forEach((cell, colOffset) => {
          const targetCol = parsed.startCol + colOffset;
          while (destination.length <= targetCol) destination.push('');
          destination[targetCol] = cell;
        });
      });
    }

    this.onAfterBatchUpdate?.();
  }

  async append(range: string, values: Cell[][]): Promise<string> {
    this.calls.append++;
    this.checkFailure('append');

    const parsed = parseRange(range);
    const sheet = this.findSheet(parsed.title);

    // Sheets appends after the last row that has any content.
    let lastPopulated = sheet.rows.length - 1;
    while (
      lastPopulated >= 0 &&
      (sheet.rows[lastPopulated] ?? []).every((c) => c === '' || c === undefined)
    ) {
      lastPopulated--;
    }

    const firstNewRow = lastPopulated + 1;
    values.forEach((row, i) => {
      sheet.rows[firstNewRow + i] = [...row];
    });

    const startRowNumber = firstNewRow + 1;
    const endRowNumber = firstNewRow + values.length;
    return `'${parsed.title}'!A${startRowNumber}:Z${endRowNumber}`;
  }

  async deleteRow(sheetId: number, rowNumber: number): Promise<void> {
    this.calls.deleteRow++;
    this.checkFailure('deleteRow');
    const sheet = this.sheets.find((s) => s.sheetId === sheetId);
    if (!sheet) throw new Error(`No sheet with id ${sheetId}`);
    sheet.rows.splice(rowNumber - 1, 1);
  }

  async addSheet(title: string, columnCount: number): Promise<number> {
    this.calls.addSheet++;
    this.checkFailure('addSheet');
    const sheetId = this.nextSheetId++;
    this.sheets.push({
      sheetId,
      title,
      rows: [new Array(columnCount).fill('')],
    });
    return sheetId;
  }

  async formatHeaderRow(): Promise<void> {
    this.calls.formatHeaderRow++;
    this.checkFailure('formatHeaderRow');
  }
}

/* -------------------------------------------------------------------------- */
/* Convenience builders                                                        */
/* -------------------------------------------------------------------------- */

import {
  ACTIVITY_LOG_COLUMNS,
  MASTER_COLUMNS,
  SHEET_DEFINITIONS,
  SHEET_NAMES,
  TASK_COLUMNS,
} from '@/lib/sheets/schema';

/** A transport with every expected tab present and correctly headered. */
export function createHealthyTransport(): FakeSheetsTransport {
  const transport = new FakeSheetsTransport();
  for (const def of SHEET_DEFINITIONS) {
    transport.seedSheet(def.name, def.columns);
  }
  return transport;
}

export const COLUMN_COUNTS = {
  tasks: TASK_COLUMNS.length,
  master: MASTER_COLUMNS.length,
  activityLog: ACTIVITY_LOG_COLUMNS.length,
};

export { SHEET_NAMES };
