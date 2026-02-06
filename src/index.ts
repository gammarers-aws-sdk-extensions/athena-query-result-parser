import type { Row, ColumnInfo, ResultSet } from '@aws-sdk/client-athena';

/**
 * Type for a parsed row (key = column name, value = string or null).
 */
export type ParsedRow = Record<string, string | null>;

/**
 * Type for a custom row parser that converts ParsedRow to T (or null to skip).
 */
export type RowParser<T> = (row: ParsedRow) => T | null;

/**
 * AthenaQueryResultParser
 * Parses Athena query result ResultSet into header-based row objects.
 */
export class AthenaQueryResultParser {

  /**
   * Build header array from ResultSetMetadata.
   * @param columnInfo - ColumnInfo array from Athena ResultSetMetadata
   * @returns Header string array
   */
  static headersFromMeta(columnInfo: ColumnInfo[]): string[] {
    return columnInfo.map((col, index) => col?.Name ?? `col_${index}`);
  }

  /**
   * Convert an Athena Row into a key-value object using headers.
   * @param row - Athena Row
   * @param headers - Header array
   * @returns Parsed row object
   */
  static rowToObject(row: Row, headers: string[]): ParsedRow {
    const obj: ParsedRow = {};
    for (const [index, header] of headers.entries()) {
      obj[header] = row.Data?.[index]?.VarCharValue ?? null;
    }
    return obj;
  }

  /**
   * Check if the row is the header row (all cells match headers).
   * @param row - Athena Row
   * @param headers - Header array
   * @returns true if the row is the header row
   */
  static isHeaderRow(row: Row, headers: string[]): boolean {
    if (!row?.Data?.length) return false;
    return headers.every(
      (header, index) => (row.Data?.[index]?.VarCharValue ?? null) === header,
    );
  }

  private headers: string[] | null = null;
  private headerRowDropped = false;

  constructor() {}

  /**
   * Initialize headers from column metadata (idempotent; only sets when not already set).
   * @param columnInfo - ColumnInfo array
   */
  initHeaders(columnInfo: ColumnInfo[]): void {
    if (!this.headers && columnInfo.length > 0) {
      this.headers = AthenaQueryResultParser.headersFromMeta(columnInfo);
    }
  }

  /**
   * Get the current headers (null until initHeaders/parseResultSet is called).
   */
  getHeaders(): string[] | null {
    return this.headers;
  }

  /**
   * Parse rows from a ResultSet (skips header row automatically, once per parser instance).
   * @param resultSet - Athena ResultSet
   * @returns Array of parsed row objects
   */
  parseResultSet(resultSet: ResultSet | undefined): ParsedRow[] {
    if (!resultSet) {
      return [];
    }

    // Initialize headers from metadata
    const meta = resultSet.ResultSetMetadata?.ColumnInfo ?? [];
    this.initHeaders(meta);

    if (!this.headers) {
      return [];
    }

    const rawRows = resultSet.Rows ?? [];
    const skipHeader =
      !this.headerRowDropped &&
      rawRows.length > 0 &&
      AthenaQueryResultParser.isHeaderRow(rawRows[0], this.headers);
    if (skipHeader) {
      this.headerRowDropped = true;
    }
    const rows = skipHeader ? rawRows.slice(1) : rawRows;

    return rows.map((row) =>
      AthenaQueryResultParser.rowToObject(row, this.headers!),
    );
  }

  /**
   * Parse ResultSet and transform each row with a custom parser (null results are filtered out).
   * @param resultSet - Athena ResultSet
   * @param rowParser - Custom row parser
   * @returns Array of parsed results (nulls filtered out)
   */
  parseResultSetWith<T>(
    resultSet: ResultSet | undefined,
    rowParser: RowParser<T>,
  ): T[] {
    const rows = this.parseResultSet(resultSet);
    const results: T[] = [];

    for (const row of rows) {
      const parsed = rowParser(row);
      if (parsed !== null) {
        results.push(parsed);
      }
    }

    return results;
  }

  /**
   * Reset parser state (headers and header-row-dropped flag). Use when reusing for a new query.
   */
  reset(): void {
    this.headers = null;
    this.headerRowDropped = false;
  }
}

// Re-export static methods for convenience
export const { headersFromMeta, rowToObject, isHeaderRow } = AthenaQueryResultParser;