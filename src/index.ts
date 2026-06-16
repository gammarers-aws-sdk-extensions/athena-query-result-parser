import type { Row, ColumnInfo, ResultSet } from '@aws-sdk/client-athena';

/**
 * Well-known key on {@link ParsedRow} that holds surplus cell values when
 * `columnCountMismatchBehavior` is `'extra'`.
 */
export const EXTRA_COLUMNS_KEY = '__extra' as const;

/**
 * A parsed Athena row represented as an object.
 *
 * The key is the column name and the value is a string (or null when missing).
 *
 * When {@link ColumnCountMismatchBehavior} is `'extra'` and a row has more cells
 * than headers, surplus values are stored under {@link EXTRA_COLUMNS_KEY}.
 */
export type ParsedRow = Record<string, string | null> & {
  [EXTRA_COLUMNS_KEY]?: (string | null)[];
};

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
 * - `true`: skips the first row only when it looks like a header row (see also
 *   {@link ParseResultSetOptions.forcedSkipHeaderRowMismatchBehavior})
 * - `false`: never skips the first row
 */
export type SkipHeaderRowOption = 'auto' | boolean;

/**
 * Controls what happens when `skipHeaderRow: true` is specified but the first
 * row does not look like a header row.
 *
 * - `'throw'` (default): throw to prevent accidental data loss
 * - `'keep'`: keep the first row
 * - `'skip'`: skip the first row anyway (potentially lossy)
 */
export type ForcedSkipHeaderRowMismatchBehavior = 'throw' | 'skip' | 'keep';

/**
 * Behavior when the column names returned by Athena contain duplicates.
 *
 * - `'throw'` (default): throw an Error listing duplicate names
 * - `'suffix'`: rename duplicates like `col`, `col_2`, `col_3`, ...
 * - `'allow'`: keep duplicates (later columns overwrite earlier ones in
 *   {@link AthenaQueryResultParser.rowToObject})
 */
export type DuplicateColumnNameBehavior = 'throw' | 'suffix' | 'allow';

/**
 * Behavior when `row.Data` length does not match the number of headers.
 *
 * - `'silent'` (default): pad missing cells with `null` and discard surplus cells
 * - `'throw'`: throw an Error (strict mode) to prevent silent data loss
 * - `'warn'`: emit `console.warn` but keep the `'silent'` value mapping
 * - `'extra'`: store surplus cells under {@link EXTRA_COLUMNS_KEY}; short rows are
 *   still padded with `null` (use `'throw'` or `'warn'` to detect them)
 */
export type ColumnCountMismatchBehavior = 'silent' | 'throw' | 'warn' | 'extra';

/**
 * Options for {@link AthenaQueryResultParser.rowToObject}.
 */
export type RowToObjectOptions = {
  /**
   * How to handle rows whose `Data` length differs from `headers.length`.
   *
   * Default: `'silent'`.
   *
   * @see ColumnCountMismatchBehavior
   */
  columnCountMismatchBehavior?: ColumnCountMismatchBehavior;
  /**
   * Zero-based row index included in throw/warn messages when available.
   */
  rowIndex?: number;
};

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
 * Inspect via {@link AthenaQueryResultParser.getLastHeaderRowDecision} after
 * {@link AthenaQueryResultParser.parseResultSet}.
 *
 * When {@link ParseResultSetOptions.skipHeaderRow} is `'auto'`, this decision is
 * derived from {@link HeaderRowDetectionStrategy} and the incoming `ResultSet`.
 */
export type HeaderRowDecision =
  | {
    mode: 'forced';
    skipped: boolean;
    reason:
      | 'skipFirstRow:true'
      | 'skipHeaderRow:true'
      | 'skipHeaderRow:true:not-header-row';
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
   * Whether to drop the first row unconditionally.
   *
   * Use this when you truly want to skip the first row regardless of its
   * contents (explicit, potentially lossy).
   */
  skipFirstRow?: boolean;
  /**
   * Whether to drop the header row.
   *
   * Default: `'auto'`.
   */
  skipHeaderRow?: SkipHeaderRowOption;
  /**
   * Controls what happens when `skipHeaderRow: true` is used but the first row
   * does not look like a header row.
   *
   * Default: `'throw'`.
   */
  forcedSkipHeaderRowMismatchBehavior?: ForcedSkipHeaderRowMismatchBehavior;
  /**
   * Behavior when {@link ColumnInfo.Name} contains duplicates.
   *
   * - `'throw'` (default): throw an Error listing duplicates
   * - `'suffix'`: rename duplicates like `col`, `col_2`, `col_3`, ...
   * - `'allow'`: keep duplicates (later columns overwrite earlier ones in
   *   {@link AthenaQueryResultParser.rowToObject})
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
  /**
   * Behavior when a row's `Data` array length does not match the header count.
   *
   * Default: `'silent'` (legacy behavior).
   *
   * @see ColumnCountMismatchBehavior
   */
  columnCountMismatchBehavior?: ColumnCountMismatchBehavior;
};

/**
 * Parses Athena query results into header-based row objects.
 *
 * Handles metadata-driven headers, optional header-row skipping, duplicate
 * column-name resolution, and configurable row/column-count mismatch behavior.
 */
export class AthenaQueryResultParser {

  /**
   * Builds a header array from Athena `ResultSetMetadata`.
   *
   * When a column name is missing, it falls back to `col_<index>`.
   *
   * @param columnInfo - Column metadata from the Athena `ResultSet`.
   * @param options - Parser options (for example, duplicate column-name handling).
   * @returns Resolved header names in column order.
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
   *
   * When `row.Data` is shorter than `headers`, missing cells become `null`.
   * When it is longer, surplus cells are discarded unless
   * `columnCountMismatchBehavior` is `'extra'` (stored under
   * {@link EXTRA_COLUMNS_KEY}).
   *
   * @param row - A single Athena result row.
   * @param headers - Header names derived from metadata (or otherwise).
   * @param options - Row conversion options (for example, column-count mismatch behavior).
   * @returns A {@link ParsedRow} keyed by header name.
   * @throws Error When `columnCountMismatchBehavior` is `'throw'` and
   * `row.Data.length` does not equal `headers.length`.
   */
  static rowToObject(
    row: Row,
    headers: string[],
    options: RowToObjectOptions = {},
  ): ParsedRow {
    const behavior = options.columnCountMismatchBehavior ?? 'silent';
    const expected = headers.length;
    const actual = AthenaQueryResultParser.getRowDataLength(row);

    AthenaQueryResultParser.handleColumnCountMismatch(
      expected,
      actual,
      behavior,
      options.rowIndex,
    );

    const obj: ParsedRow = {};
    for (const [index, header] of headers.entries()) {
      obj[header] = row.Data?.[index]?.VarCharValue ?? null;
    }

    if (behavior === 'extra' && actual > expected) {
      const extras: (string | null)[] = [];
      for (let index = expected; index < actual; index += 1) {
        extras.push(row.Data?.[index]?.VarCharValue ?? null);
      }
      obj[EXTRA_COLUMNS_KEY] = extras;
    }

    return obj;
  }

  /**
   * Returns whether the given row is a header row (all cells match headers).
   *
   * Compares only the first `headers.length` cells; surplus cells in `row.Data`
   * are ignored. Rows shorter than `headers` never match.
   *
   * @param row - A single Athena result row.
   * @param headers - Header names to compare against.
   * @returns `true` when every header cell equals the corresponding header name.
   */
  static isHeaderRow(row: Row, headers: string[]): boolean {
    if (!row?.Data?.length) return false;
    return headers.every(
      (header, index) => (row.Data?.[index]?.VarCharValue ?? null) === header,
    );
  }

  /**
   * Returns the number of cells in `row.Data`, or `0` when `Data` is absent.
   */
  private static getRowDataLength(row: Row): number {
    return row.Data?.length ?? 0;
  }

  /**
   * Builds a human-readable message for a row/header column-count mismatch.
   *
   * @param expected - Expected column count (typically `headers.length`).
   * @param actual - Actual `row.Data` length.
   * @param rowIndex - Optional zero-based row index for context.
   */
  private static describeColumnCountMismatch(
    expected: number,
    actual: number,
    rowIndex?: number,
  ): string {
    const rowPart = rowIndex != null ? ` at row index ${rowIndex}` : '';
    return `Column count mismatch${rowPart}: expected ${expected} column(s) but row has ${actual}`;
  }

  /**
   * Applies {@link ColumnCountMismatchBehavior} when counts differ.
   *
   * No-op for `'silent'` and `'extra'` (callers handle `'extra'` mapping).
   *
   * @throws Error When `behavior` is `'throw'`.
   */
  private static handleColumnCountMismatch(
    expected: number,
    actual: number,
    behavior: ColumnCountMismatchBehavior,
    rowIndex?: number,
  ): void {
    if (expected === actual || behavior === 'silent' || behavior === 'extra') {
      return;
    }

    const message = AthenaQueryResultParser.describeColumnCountMismatch(
      expected,
      actual,
      rowIndex,
    );

    if (behavior === 'throw') {
      throw new Error(message);
    }

    if (behavior === 'warn') {
      console.warn(message);
    }
  }

  /**
   * Returns a normalized Athena type string used for comparisons.
   *
   * @param type - Raw Athena column type from metadata.
   */
  private static normalizeType(type: string | undefined): string {
    return (type ?? '').trim().toLowerCase();
  }

  /**
   * Returns whether the Athena type is treated as a "string-like" type.
   *
   * @param type - Raw Athena column type from metadata.
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
   *
   * @param type - Raw Athena column type from metadata.
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
   *
   * @param type - Raw Athena column type from metadata.
   */
  private static isBooleanLikeType(type: string | undefined): boolean {
    const t = AthenaQueryResultParser.normalizeType(type);
    return t === 'boolean';
  }

  /**
   * Returns whether the Athena type is treated as a date/time-like type.
   *
   * @param type - Raw Athena column type from metadata.
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
   * Used only for the `'safe'` header-row detection strategy to decide whether
   * a header-looking row is unlikely to be valid data.
   *
   * @param value - Cell value from the first row.
   * @param type - Athena column type for that cell.
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
   * Implements header-row auto-detection for `skipHeaderRow: 'auto'`.
   *
   * - `'exact'`: skip when the first row exactly matches headers (legacy)
   * - `'safe'`: require type-based evidence that the row is not valid data
   *
   * @param params.firstRow - First row in the result set.
   * @param params.headers - Resolved header names.
   * @param params.columnInfo - Column metadata (used by `'safe'` strategy).
   * @param params.strategy - Detection strategy from options.
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

  /**
   * Resolves duplicate header names according to {@link DuplicateColumnNameBehavior}.
   *
   * @param headers - Raw header names (may contain duplicates).
   * @param behavior - Duplicate-name handling strategy.
   * @returns Resolved header names.
   * @throws Error When `behavior` is `'throw'` and duplicates exist.
   */
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

  /**
   * Creates a new parser instance with empty internal state.
   */
  constructor() {}

  /**
   * Initializes headers from column metadata.
   *
   * This method is idempotent: headers are set only when not already initialized.
   *
   * @param columnInfo - Column metadata from the Athena `ResultSet`.
   * @param options - Parser options (for example, duplicate column-name handling).
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
   * @returns Header names, or `null` until {@link initHeaders} or
   * {@link parseResultSet} has been called.
   */
  getHeaders(): string[] | null {
    return this.headers;
  }

  /**
   * Returns information about the most recent header-row decision.
   *
   * Useful when `skipHeaderRow` is `'auto'` and you need to know whether the
   * first row was skipped (and why).
   *
   * @returns The last {@link HeaderRowDecision}, or `null` before any parse.
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
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param options - Parsing options (header skipping, duplicate names, column-count mismatch, etc.).
   * @returns Parsed rows keyed by header name. Returns `[]` when `resultSet` is `undefined`
   * or has no column metadata.
   * @throws Error When duplicate column names are detected and
   * `duplicateColumnNames` is `'throw'` (default).
   * @throws Error When `columnCountMismatchBehavior` is `'throw'` and any row's
   * `Data.length` does not match the header count.
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
    const skipFirstRow = options.skipFirstRow ?? false;
    const skipHeaderRow = options.skipHeaderRow ?? 'auto';
    const strategy = options.headerRowDetectionStrategy ?? 'exact';
    const mismatchBehavior = options.forcedSkipHeaderRowMismatchBehavior ?? 'throw';

    let decision: HeaderRowDecision;
    if (skipFirstRow) {
      const skipped = rawRows.length > 0;
      decision = { mode: 'forced', skipped, reason: 'skipFirstRow:true' };
      if (skipped) this.headerRowDropped = true;
    } else {
      if (skipHeaderRow === true) {
        if (rawRows.length === 0) {
          decision = { mode: 'forced', skipped: false, reason: 'skipHeaderRow:true' };
        } else {
          const looksLikeHeader = AthenaQueryResultParser.isHeaderRow(
            rawRows[0],
            this.headers,
          );
          if (!looksLikeHeader) {
            if (mismatchBehavior === 'throw') {
              throw new Error(
                'skipHeaderRow:true was specified but the first row does not look like a header row. ' +
                'If you want to always drop the first row, use skipFirstRow:true. ' +
                'Or set forcedSkipHeaderRowMismatchBehavior to "skip" or "keep".',
              );
            }

            if (mismatchBehavior === 'keep') {
              decision = {
                mode: 'forced',
                skipped: false,
                reason: 'skipHeaderRow:true:not-header-row',
              };
            } else {
            // mismatchBehavior === 'skip'
              decision = {
                mode: 'forced',
                skipped: true,
                reason: 'skipHeaderRow:true:not-header-row',
              };
              this.headerRowDropped = true;
            }
          } else {
            decision = { mode: 'forced', skipped: true, reason: 'skipHeaderRow:true' };
            this.headerRowDropped = true;
          }
        }
      } else {
        if (skipHeaderRow === false) {
          decision = {
            mode: 'disabled',
            skipped: false,
            reason: 'skipHeaderRow:false',
          };
        } else {
          if (rawRows.length === 0) {
            decision = {
              mode: 'auto',
              skipped: false,
              strategy,
              reason: 'no-rows',
            };
          } else {
            if (this.headerRowDropped) {
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
          }
        }
      }
    }

    this.lastHeaderRowDecision = decision;
    const skipHeader = decision.skipped;
    const rows = skipHeader ? rawRows.slice(1) : rawRows;

    const columnCountMismatchBehavior =
      options.columnCountMismatchBehavior ?? 'silent';

    return rows.map((row, rowIndex) =>
      AthenaQueryResultParser.rowToObject(row, this.headers!, {
        columnCountMismatchBehavior,
        rowIndex,
      }),
    );
  }

  /**
   * Parses a {@link ResultSet} and maps each parsed row through a custom parser.
   *
   * Any `null` results returned from `rowParser` are filtered out.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param rowParser - Function that transforms each {@link ParsedRow} into `T`, or `null` to skip.
   * @param options - Same options as {@link parseResultSet} (including `columnCountMismatchBehavior`).
   * @returns Mapped values with skipped rows removed.
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
   * Resets the parser state (headers, header-row-dropped flag, and last decision).
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
 * Convenience re-exports of {@link AthenaQueryResultParser} static helpers.
 *
 * - {@link headersFromMeta} — build headers from column metadata
 * - {@link rowToObject} — convert a single row to a {@link ParsedRow}
 * - {@link isHeaderRow} — detect header-like rows
 */
export const { headersFromMeta, rowToObject, isHeaderRow } = AthenaQueryResultParser;