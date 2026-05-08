import type { Row, ColumnInfo, ResultSet } from '@aws-sdk/client-athena';

/**
 * A parsed Athena row represented as an object.
 *
 * The key is the column name and the value is a string (or null when missing).
 */
export type ParsedRow = Record<string, string | null>;

/**
 * A custom row parser that converts a {@link ParsedRow} to `T`.
 *
 * Returning `null` means "skip this row".
 */
export type RowParser<T> = (row: ParsedRow) => T | null;

/**
 * Controls whether the first row should be skipped as a header row.
 *
 * - `'auto'`: skips only when the first row's cells match the headers
 * - `true`: always skips the first row (when present)
 * - `false`: never skips the first row
 */
export type SkipHeaderRowOption = 'auto' | boolean;

/**
 * Behavior when the column names returned by Athena contain duplicates.
 */
export type DuplicateColumnNameBehavior = 'throw' | 'suffix' | 'allow';

/**
 * Options for parsing an Athena {@link ResultSet}.
 */
export type ParseResultSetOptions = {
  /**
   * Whether to drop the header row.
   *
   * Default: `'auto'`.
   */
  skipHeaderRow?: SkipHeaderRowOption;
  /**
   * Behavior when {@link ColumnInfo.Name} contains duplicates.
   *
   * - `'throw'` (default): throw an Error listing duplicates
   * - `'suffix'`: rename duplicates like `col`, `col_2`, `col_3`, ...
   * - `'allow'`: keep duplicates (later columns overwrite earlier ones in {@link rowToObject})
   */
  duplicateColumnNames?: DuplicateColumnNameBehavior;
};

/**
 * Parses Athena query results into header-based row objects.
 */
export class AthenaQueryResultParser {

  /**
   * Builds a header array from Athena `ResultSetMetadata`.
   *
   * When a column name is missing, it falls back to `col_<index>`.
   *
   * @throws Error When duplicate column names are detected and
   * `duplicateColumnNames` is `'throw'` (default).
   */
  static headersFromMeta(
    columnInfo: ColumnInfo[],
    options: { duplicateColumnNames?: DuplicateColumnNameBehavior } = {},
  ): string[] {
    const headers = columnInfo.map((col, index) => col?.Name ?? `col_${index}`);
    const behavior = options.duplicateColumnNames ?? 'throw';
    return AthenaQueryResultParser.resolveDuplicateHeaders(headers, behavior);
  }

  /**
   * Converts an Athena `Row` into a key-value object using the provided headers.
   *
   * If headers contain duplicates, later values overwrite earlier ones.
   */
  static rowToObject(row: Row, headers: string[]): ParsedRow {
    const obj: ParsedRow = {};
    for (const [index, header] of headers.entries()) {
      obj[header] = row.Data?.[index]?.VarCharValue ?? null;
    }
    return obj;
  }

  /**
   * Returns whether the given row is a header row (all cells match headers).
   */
  static isHeaderRow(row: Row, headers: string[]): boolean {
    if (!row?.Data?.length) return false;
    return headers.every(
      (header, index) => (row.Data?.[index]?.VarCharValue ?? null) === header,
    );
  }

  private static resolveDuplicateHeaders(
    headers: string[],
    behavior: DuplicateColumnNameBehavior,
  ): string[] {
    if (behavior === 'allow') {
      return headers;
    }

    const counts = new Map<string, number>();
    for (const header of headers) {
      counts.set(header, (counts.get(header) ?? 0) + 1);
    }
    const duplicates = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name);

    if (duplicates.length === 0) {
      return headers;
    }

    if (behavior === 'throw') {
      throw new Error(
        `Duplicate column names detected: ${duplicates.join(', ')}`,
      );
    }

    // behavior === 'suffix'
    const nextIndexByName = new Map<string, number>();
    const resolved: string[] = [];
    for (const header of headers) {
      const next = nextIndexByName.get(header) ?? 1;
      if (next === 1) {
        resolved.push(header);
        nextIndexByName.set(header, 2);
        continue;
      }

      let candidate = `${header}_${next}`;
      let candidateIndex = next;
      while (counts.has(candidate)) {
        candidateIndex += 1;
        candidate = `${header}_${candidateIndex}`;
      }
      resolved.push(candidate);
      nextIndexByName.set(header, candidateIndex + 1);
      counts.set(candidate, 1);
    }

    return resolved;
  }

  private headers: string[] | null = null;
  private headerRowDropped = false;
  private duplicateColumnNames: DuplicateColumnNameBehavior = 'throw';

  constructor() {}

  /**
   * Initializes headers from column metadata.
   *
   * This method is idempotent: headers are set only when not already initialized.
   *
   * @throws Error When duplicate column names are detected and
   * `duplicateColumnNames` is `'throw'` (default).
   */
  initHeaders(
    columnInfo: ColumnInfo[],
    options: { duplicateColumnNames?: DuplicateColumnNameBehavior } = {},
  ): void {
    if (!this.headers && columnInfo.length > 0) {
      const behavior = options.duplicateColumnNames ?? this.duplicateColumnNames;
      this.duplicateColumnNames = behavior;
      this.headers = AthenaQueryResultParser.headersFromMeta(columnInfo, {
        duplicateColumnNames: behavior,
      });
    }
  }

  /**
   * Returns the current headers.
   *
   * Returns `null` until {@link initHeaders} / {@link parseResultSet} has been called.
   */
  getHeaders(): string[] | null {
    return this.headers;
  }

  /**
   * Parses rows from an Athena {@link ResultSet}.
   *
   * By default, this method auto-detects and skips the first row when it matches
   * the headers.
   *
   * @throws Error When duplicate column names are detected and
   * `duplicateColumnNames` is `'throw'` (default).
   */
  parseResultSet(
    resultSet: ResultSet | undefined,
    options: ParseResultSetOptions = {},
  ): ParsedRow[] {
    if (!resultSet) {
      return [];
    }

    // Initialize headers from metadata
    const meta = resultSet.ResultSetMetadata?.ColumnInfo ?? [];
    this.initHeaders(meta, { duplicateColumnNames: options.duplicateColumnNames });

    if (!this.headers) {
      return [];
    }

    const rawRows = resultSet.Rows ?? [];
    const skipHeaderRow = options.skipHeaderRow ?? 'auto';
    const skipHeader =
      skipHeaderRow === true
        ? rawRows.length > 0
        : skipHeaderRow === false
          ? false
          : !this.headerRowDropped &&
            rawRows.length > 0 &&
            AthenaQueryResultParser.isHeaderRow(rawRows[0], this.headers);
    if (skipHeaderRow === 'auto' && skipHeader) {
      this.headerRowDropped = true;
    }
    const rows = skipHeader ? rawRows.slice(1) : rawRows;

    return rows.map((row) =>
      AthenaQueryResultParser.rowToObject(row, this.headers!),
    );
  }

  /**
   * Parses a {@link ResultSet} and maps each parsed row through a custom parser.
   *
   * Any `null` results returned from `rowParser` are filtered out.
   */
  parseResultSetWith<T>(
    resultSet: ResultSet | undefined,
    rowParser: RowParser<T>,
    options: ParseResultSetOptions = {},
  ): T[] {
    const rows = this.parseResultSet(resultSet, options);
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
   * Resets the parser state (headers and header-row-dropped flag).
   *
   * Call this when reusing a parser instance for a new query.
   */
  reset(): void {
    this.headers = null;
    this.headerRowDropped = false;
  }
}

/**
 * Re-export static methods for convenience.
 */
export const { headersFromMeta, rowToObject, isHeaderRow } = AthenaQueryResultParser;