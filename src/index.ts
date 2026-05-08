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
 * Strategy used when auto-detecting a header row.
 *
 * - `'exact'`: treat the first row as a header row when all cells exactly match the headers (legacy)
 * - `'safe'`: only skip when the first row matches headers AND at least one column's type makes it
 *   very unlikely to be a data row (helps avoid false positives)
 */
export type HeaderRowDetectionStrategy = 'exact' | 'safe';

/**
 * Describes whether and why a header row was skipped.
 *
 * When {@link ParseResultSetOptions.skipHeaderRow} is `'auto'`, this decision is
 * derived from {@link HeaderRowDetectionStrategy} and the incoming `ResultSet`.
 */
export type HeaderRowDecision =
  | {
    mode: 'forced';
    skipped: boolean;
    reason: 'skipHeaderRow:true';
  }
  | {
    mode: 'disabled';
    skipped: false;
    reason: 'skipHeaderRow:false';
  }
  | {
    mode: 'auto';
    skipped: boolean;
    strategy: HeaderRowDetectionStrategy;
    reason:
        | 'no-rows'
        | 'already-dropped'
        | 'not-header-row'
        | 'exact-match'
        | 'safe:type-evidence'
        | 'safe:no-type-evidence';
  };

type AutoHeaderRowDecision = Extract<HeaderRowDecision, { mode: 'auto' }>;
type AutoHeaderRowReason = AutoHeaderRowDecision['reason'];

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
  /**
   * Controls how header-row auto detection behaves.
   *
   * Default: `'exact'` (legacy behavior).
   *
   * Consider using `'safe'` to reduce false positives where the first data row
   * happens to equal the headers.
   */
  headerRowDetectionStrategy?: HeaderRowDetectionStrategy;
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

  /**
   * Returns a normalized Athena type string used for comparisons.
   */
  private static normalizeType(type: string | undefined): string {
    return (type ?? '').trim().toLowerCase();
  }

  /**
   * Returns whether the Athena type is treated as a "string-like" type.
   */
  private static isStringLikeType(type: string | undefined): boolean {
    const t = AthenaQueryResultParser.normalizeType(type);
    return (
      t === 'string' ||
      t.startsWith('varchar') ||
      t.startsWith('char') ||
      t.startsWith('varbinary')
    );
  }

  /**
   * Returns whether the Athena type is treated as a "numeric-like" type.
   */
  private static isNumericLikeType(type: string | undefined): boolean {
    const t = AthenaQueryResultParser.normalizeType(type);
    return (
      t === 'tinyint' ||
      t === 'smallint' ||
      t === 'int' ||
      t === 'integer' ||
      t === 'bigint' ||
      t === 'real' ||
      t === 'float' ||
      t === 'double' ||
      t.startsWith('decimal')
    );
  }

  /**
   * Returns whether the Athena type is treated as a boolean type.
   */
  private static isBooleanLikeType(type: string | undefined): boolean {
    const t = AthenaQueryResultParser.normalizeType(type);
    return t === 'boolean';
  }

  /**
   * Returns whether the Athena type is treated as a date/time-like type.
   */
  private static isDateTimeLikeType(type: string | undefined): boolean {
    const t = AthenaQueryResultParser.normalizeType(type);
    return (
      t === 'date' ||
      t === 'timestamp' ||
      t.startsWith('timestamp ') ||
      t === 'time' ||
      t.startsWith('time ')
    );
  }

  /**
   * Returns whether a string value looks parseable for the given Athena type.
   *
   * This is used only for the `'safe'` header-row detection strategy to decide
   * whether a header-looking row is unlikely to be valid data.
   */
  private static isParseableAsType(value: string, type: string | undefined): boolean {
    const t = AthenaQueryResultParser.normalizeType(type);
    if (AthenaQueryResultParser.isNumericLikeType(t)) {
      return Number.isFinite(Number(value));
    }
    if (AthenaQueryResultParser.isBooleanLikeType(t)) {
      return value === 'true' || value === 'false';
    }
    if (AthenaQueryResultParser.isDateTimeLikeType(t)) {
      // Athena typically returns ISO-like strings for date/time types.
      // We keep this intentionally strict to avoid classifying column names as data.
      return !Number.isNaN(Date.parse(value));
    }
    // For complex/string-like types, assume parseable.
    return true;
  }

  /**
   * Implements the header-row auto detection logic.
   *
   * - `'exact'`: skip when the first row exactly matches headers (legacy)
   * - `'safe'`: require type-based evidence that the row is not valid data
   */
  private static shouldAutoSkipHeaderRow(params: {
    firstRow: Row;
    headers: string[];
    columnInfo: ColumnInfo[];
    strategy: HeaderRowDetectionStrategy;
  }): { skip: boolean; reason: AutoHeaderRowReason } {
    const { firstRow, headers, columnInfo, strategy } = params;
    const isExact = AthenaQueryResultParser.isHeaderRow(firstRow, headers);
    if (!isExact) {
      return { skip: false, reason: 'not-header-row' };
    }

    if (strategy === 'exact') {
      return { skip: true, reason: 'exact-match' };
    }

    // strategy === 'safe'
    // Only skip when there is type-based evidence that this row is not a valid data row.
    // This reduces the chance of accidentally dropping a real data row that happens to
    // equal the headers.
    let hasNonStringColumn = false;
    let hasEvidence = false;

    for (const [index, header] of headers.entries()) {
      const type = columnInfo[index]?.Type;
      if (!AthenaQueryResultParser.isStringLikeType(type)) {
        hasNonStringColumn = true;
        if (!AthenaQueryResultParser.isParseableAsType(header, type)) {
          hasEvidence = true;
          break;
        }
      }
    }

    if (!hasNonStringColumn) {
      return { skip: false, reason: 'safe:no-type-evidence' };
    }

    return hasEvidence
      ? { skip: true, reason: 'safe:type-evidence' }
      : { skip: false, reason: 'safe:no-type-evidence' };
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
  private lastHeaderRowDecision: HeaderRowDecision | null = null;

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
   * Returns information about the most recent header-row decision.
   *
   * This is useful when `skipHeaderRow` is `'auto'` and you need to know whether
   * the first row was skipped (and why).
   */
  getLastHeaderRowDecision(): HeaderRowDecision | null {
    return this.lastHeaderRowDecision;
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
    const strategy = options.headerRowDetectionStrategy ?? 'exact';

    let decision: HeaderRowDecision;
    if (skipHeaderRow === true) {
      const skipped = rawRows.length > 0;
      decision = {
        mode: 'forced',
        skipped,
        reason: 'skipHeaderRow:true',
      };
      if (skipped) this.headerRowDropped = true;
    } else if (skipHeaderRow === false) {
      decision = {
        mode: 'disabled',
        skipped: false,
        reason: 'skipHeaderRow:false',
      };
    } else if (rawRows.length === 0) {
      decision = {
        mode: 'auto',
        skipped: false,
        strategy,
        reason: 'no-rows',
      };
    } else if (this.headerRowDropped) {
      decision = {
        mode: 'auto',
        skipped: false,
        strategy,
        reason: 'already-dropped',
      };
    } else {
      const auto = AthenaQueryResultParser.shouldAutoSkipHeaderRow({
        firstRow: rawRows[0],
        headers: this.headers,
        columnInfo: meta,
        strategy,
      });
      const skipped = auto.skip;
      decision = {
        mode: 'auto',
        skipped,
        strategy,
        reason: auto.reason,
      };
      if (skipped) this.headerRowDropped = true;
    }

    this.lastHeaderRowDecision = decision;
    const skipHeader = decision.skipped;
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
    this.lastHeaderRowDecision = null;
  }
}

/**
 * Re-export static methods for convenience.
 */
export const { headersFromMeta, rowToObject, isHeaderRow } = AthenaQueryResultParser;