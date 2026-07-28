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
 * A parsed Athena cell value that has been converted based on the column type.
 */
export type AthenaTypedValue = string | number | boolean | Date | null;

/**
 * A parsed Athena row represented as an object with values converted based on
 * {@link ColumnInfo.Type}.
 *
 * When {@link ColumnCountMismatchBehavior} is `'extra'` and a row has more cells
 * than headers, surplus values are stored under {@link EXTRA_COLUMNS_KEY}.
 */
export type TypedParsedRow = Record<string, AthenaTypedValue> & {
  [EXTRA_COLUMNS_KEY]?: (string | null)[];
};

/**
 * Safely converts a string value to a finite number.
 *
 * Returns `null` when the value is `null`, empty/whitespace, or not a finite number.
 *
 * @param value - Raw Athena cell value.
 * @returns A finite number, or `null` when conversion is not possible.
 */
export const toNumber = (value: string | null): number | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

/**
 * Safely converts a string value to a boolean.
 *
 * Accepts (case-insensitive) `'true'` and `'false'`.
 * Returns `null` for `null`, empty/whitespace, or unrecognized values.
 *
 * @param value - Raw Athena cell value.
 * @returns `true` / `false`, or `null` when conversion is not possible.
 */
export const toBoolean = (value: string | null): boolean | null => {
  if (value == null) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return null;
};

/**
 * Safely converts a string value to a {@link Date}.
 *
 * Uses {@link Date.parse} and returns `null` when parsing fails.
 *
 * @param value - Raw Athena cell value.
 * @returns A {@link Date}, or `null` when conversion is not possible.
 */
export const toDate = (value: string | null): Date | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
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
 * Options for {@link AthenaQueryResultParser.rowToTypedObject}.
 */
export type RowToTypedObjectOptions = RowToObjectOptions & {
  /**
   * How to handle values that cannot be converted based on the column type.
   *
   * - `'keep'` (default): keep the original string value
   * - `'null'`: replace with `null`
   */
  unparseableValueBehavior?: 'keep' | 'null';
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
 * {@link AthenaQueryResultParser.parseResultSet},
 * {@link AthenaQueryResultParser.parseResultSetDetailed}, or
 * {@link AthenaQueryResultParser.parseResultSetIter}.
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
 * Why {@link AthenaQueryResultParser.parseResultSet},
 * {@link AthenaQueryResultParser.parseResultSetDetailed}, or
 * {@link AthenaQueryResultParser.parseResultSetIter} produced no rows without
 * processing row data.
 *
 * Distinct from a genuine empty `Rows` array (headers available, zero data rows).
 *
 * - `'result-set-undefined'`: the `ResultSet` argument was `undefined`
 * - `'headers-unavailable'`: no column metadata and headers were not initialized
 */
export type ParseResultSetUnavailableReason =
  | 'result-set-undefined'
  | 'headers-unavailable';

/**
 * Behavior when the `ResultSet` cannot be parsed because it is `undefined` or
 * headers cannot be determined.
 *
 * Does **not** apply when headers are available and `Rows` is simply empty.
 *
 * - `'silent'` (default): return `[]` (or yield nothing from
 *   {@link AthenaQueryResultParser.parseResultSetIter})
 * - `'throw'`: throw an Error describing the reason
 *
 * @see ParseResultSetOptions.unavailableResultBehavior
 */
export type UnavailableResultBehavior = 'silent' | 'throw';

/**
 * Behavior when the number of data rows exceeds {@link ParseResultSetOptions.maxRows}.
 *
 * - `'truncate'` (default): return/yield only the first `maxRows` rows
 * - `'throw'`: throw an Error before producing rows
 *
 * Ignored when `maxRows` is omitted.
 *
 * @see ParseResultSetOptions.maxRowsExceededBehavior
 */
export type MaxRowsExceededBehavior = 'truncate' | 'throw';

/**
 * Diagnostics for a {@link AthenaQueryResultParser.parseResultSetDetailed} call.
 *
 * Use `unavailableReason` to distinguish "could not parse" empty results from
 * a genuine empty `Rows` array, and `truncatedByMaxRows` to detect
 * {@link ParseResultSetOptions.maxRows} truncation.
 */
export type ParseResultSetDiagnostics = {
  /**
   * Present when parsing could not proceed. `null` when parsing completed
   * normally (including a genuine empty `Rows` array).
   */
  unavailableReason: ParseResultSetUnavailableReason | null;
  /**
   * Header-row skip decision for this parse, or `null` when parsing was unavailable.
   */
  headerRowDecision: HeaderRowDecision | null;
  /**
   * Headers used for this parse, or `null` when unavailable.
   */
  headers: string[] | null;
  /**
   * Number of raw rows in `ResultSet.Rows` before header skipping
   * (`0` when unavailable).
   */
  rawRowCount: number;
  /**
   * Number of rows returned after header skipping (and after applying
   * {@link ParseResultSetOptions.maxRows}, if set).
   */
  parsedRowCount: number;
  /**
   * `true` when {@link ParseResultSetOptions.maxRows} limited the number of
   * returned rows ({@link MaxRowsExceededBehavior} `'truncate'`).
   */
  truncatedByMaxRows: boolean;
};

/**
 * Result of {@link AthenaQueryResultParser.parseResultSetDetailed}.
 */
export type ParseResultSetDetailedResult = {
  /**
   * Parsed rows keyed by header name (empty when parsing was unavailable,
   * `Rows` contained no data rows after header skipping, or `maxRows` is `0`).
   */
  rows: ParsedRow[];
  /**
   * Details about unavailable input, header-row handling, row counts, and
   * whether {@link ParseResultSetOptions.maxRows} truncated the output.
   */
  diagnostics: ParseResultSetDiagnostics;
};

/**
 * Controls how an {@link AthenaQueryResultParser} instance reuses internal state
 * across parse calls.
 *
 * - `'paginate'` (default): retain headers and the header-row-dropped flag so
 *   consecutive pages of the **same** Athena query share state
 * - `'fresh-each-parse'`: call {@link AthenaQueryResultParser.reset} before every
 *   parse, so each call is independent (safer when reusing one instance across
 *   different queries without remembering to reset)
 *
 * For a single `ResultSet`, prefer the static `*Once` helpers
 * (for example {@link AthenaQueryResultParser.parseResultSetOnce}).
 */
export type ParserReusePolicy = 'paginate' | 'fresh-each-parse';

/**
 * Construction options for {@link AthenaQueryResultParser}.
 */
export type AthenaQueryResultParserOptions = {
  /**
   * How instance state is reused across parse calls.
   *
   * Default: `'paginate'`.
   *
   * @see ParserReusePolicy
   */
  reusePolicy?: ParserReusePolicy;
};

/**
 * Options for parsing an Athena {@link ResultSet}.
 *
 * Accepted by {@link AthenaQueryResultParser.parseResultSet},
 * {@link AthenaQueryResultParser.parseResultSetDetailed},
 * {@link AthenaQueryResultParser.parseResultSetIter},
 * {@link AthenaQueryResultParser.parseResultSetWith}, and the static `*Once`
 * helpers.
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
  /**
   * Behavior when the `ResultSet` is `undefined` or headers cannot be determined.
   *
   * Default: `'silent'` (legacy behavior: return `[]`).
   *
   * Does not apply when headers are available and `Rows` is simply empty.
   *
   * @see UnavailableResultBehavior
   */
  unavailableResultBehavior?: UnavailableResultBehavior;
  /**
   * Maximum number of parsed data rows to return or yield.
   *
   * Counts rows after header-row skipping. Omit for no limit.
   * When set, must be a non-negative integer.
   *
   * @see ParseResultSetOptions.maxRowsExceededBehavior
   */
  maxRows?: number;
  /**
   * Behavior when the number of data rows exceeds {@link ParseResultSetOptions.maxRows}.
   *
   * Default: `'truncate'`.
   *
   * Ignored when `maxRows` is omitted.
   *
   * @see MaxRowsExceededBehavior
   */
  maxRowsExceededBehavior?: MaxRowsExceededBehavior;
};

/**
 * Parses Athena query results into header-based row objects.
 *
 * **Stateful by default:** instance methods retain headers and whether a header
 * row was already dropped so consecutive `GetQueryResults` pages of the **same**
 * query can be parsed safely. Call {@link reset} (or create a new instance)
 * before parsing a different query. Misusing one instance across queries without
 * reset can skip or keep header rows incorrectly.
 *
 * Prefer the static `*Once` helpers for one-off parses, or construct with
 * `{ reusePolicy: 'fresh-each-parse' }` to isolate each parse automatically.
 *
 * Also handles metadata-driven headers, optional header-row skipping, duplicate
 * column-name resolution, configurable row/column-count mismatch behavior,
 * row limits for large result sets, streaming via
 * {@link AthenaQueryResultParser.parseResultSetIter}, and parse diagnostics via
 * {@link AthenaQueryResultParser.parseResultSetDetailed}.
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
   * Converts an Athena `Row` into a key-value object using the provided headers
   * and column metadata.
   *
   * Values are converted based on {@link ColumnInfo.Type}:
   *
   * - numeric-like types (e.g. `bigint`, `double`, `decimal(...)`) → `number`
   * - `boolean` → `boolean`
   * - date/time-like types (`date`, `timestamp`, `time`) → `Date`
   * - other/complex types → `string`
   *
   * Conversion is conservative: when a value cannot be parsed for its type, it
   * is kept as a `string` by default.
   *
   * @param row - A single Athena result row.
   * @param headers - Header names derived from metadata (or otherwise).
   * @param columnInfo - Column metadata in the same order as `headers`.
   * @param options - Row conversion options.
   * @returns A {@link TypedParsedRow} keyed by header name.
   * @throws Error When `columnCountMismatchBehavior` is `'throw'` and
   * `row.Data.length` does not equal `headers.length`.
   */
  static rowToTypedObject(
    row: Row,
    headers: string[],
    columnInfo: ColumnInfo[],
    options: RowToTypedObjectOptions = {},
  ): TypedParsedRow {
    const behavior = options.columnCountMismatchBehavior ?? 'silent';
    const expected = headers.length;
    const actual = AthenaQueryResultParser.getRowDataLength(row);

    AthenaQueryResultParser.handleColumnCountMismatch(
      expected,
      actual,
      behavior,
      options.rowIndex,
    );

    const unparseable = options.unparseableValueBehavior ?? 'keep';
    const obj: TypedParsedRow = {};

    for (const [index, header] of headers.entries()) {
      const raw = row.Data?.[index]?.VarCharValue ?? null;
      const type = columnInfo[index]?.Type;
      obj[header] = AthenaQueryResultParser.convertTypedValue(raw, type, unparseable);
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
   * Creates a parser for paginating pages of one Athena query.
   *
   * Call {@link reset} (or {@link create} again) before parsing another query.
   * For a single `ResultSet`, prefer {@link parseResultSetOnce}.
   *
   * @param options - Optional construction options (for example `reusePolicy`).
   * @returns A new {@link AthenaQueryResultParser} instance.
   */
  static create(
    options: AthenaQueryResultParserOptions = {},
  ): AthenaQueryResultParser {
    return new AthenaQueryResultParser(options);
  }

  /**
   * Stateless one-shot parse: returns rows without retaining parser state.
   *
   * Equivalent to `AthenaQueryResultParser.create().parseResultSet(...)` on a
   * throwaway instance. Prefer this over reusing an instance across queries
   * without {@link reset}.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param options - Same options as {@link parseResultSet}.
   * @returns Parsed rows keyed by header name.
   */
  static parseResultSetOnce(
    resultSet: ResultSet | undefined,
    options: ParseResultSetOptions = {},
  ): ParsedRow[] {
    return AthenaQueryResultParser.create().parseResultSet(resultSet, options);
  }

  /**
   * Stateless one-shot parse with diagnostics.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param options - Same options as {@link parseResultSetDetailed}.
   * @returns Parsed rows plus {@link ParseResultSetDiagnostics}.
   */
  static parseResultSetDetailedOnce(
    resultSet: ResultSet | undefined,
    options: ParseResultSetOptions = {},
  ): ParseResultSetDetailedResult {
    return AthenaQueryResultParser.create().parseResultSetDetailed(
      resultSet,
      options,
    );
  }

  /**
   * Stateless one-shot lazy parse.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param options - Same options as {@link parseResultSetIter}.
   * @yields Parsed rows keyed by header name.
   */
  static *parseResultSetIterOnce(
    resultSet: ResultSet | undefined,
    options: ParseResultSetOptions = {},
  ): Generator<ParsedRow, void, undefined> {
    yield* AthenaQueryResultParser.create().parseResultSetIter(resultSet, options);
  }

  /**
   * Stateless one-shot parse with a custom row mapper.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param rowParser - Function that transforms each {@link ParsedRow} into `T`, or `null` to skip.
   * @param options - Same options as {@link parseResultSetWith}.
   * @returns Mapped values with skipped rows removed.
   */
  static parseResultSetWithOnce<T>(
    resultSet: ResultSet | undefined,
    rowParser: RowParser<T>,
    options: ParseResultSetOptions = {},
  ): T[] {
    return AthenaQueryResultParser.create().parseResultSetWith(
      resultSet,
      rowParser,
      options,
    );
  }

  /**
   * Returns the number of cells in `row.Data`, or `0` when `Data` is absent.
   *
   * @param row - A single Athena result row.
   * @returns The length of `row.Data`.
   */
  private static getRowDataLength(row: Row): number {
    return row.Data?.length ?? 0;
  }

  /**
   * Converts a raw Athena cell string to a typed value based on column type.
   *
   * @param value - Raw `VarCharValue` (or `null` when missing).
   * @param type - Athena column type from metadata.
   * @param unparseable - Whether to keep the original string or return `null`
   * when conversion fails.
   * @returns A typed value, or the original string / `null` when unparseable.
   */
  private static convertTypedValue(
    value: string | null,
    type: string | undefined,
    unparseable: 'keep' | 'null',
  ): AthenaTypedValue {
    if (value == null) return null;

    const t = AthenaQueryResultParser.normalizeType(type);
    if (AthenaQueryResultParser.isNumericLikeType(t)) {
      const n = toNumber(value);
      if (n != null) return n;
      return unparseable === 'null' ? null : value;
    }

    if (AthenaQueryResultParser.isBooleanLikeType(t)) {
      const b = toBoolean(value);
      if (b != null) return b;
      return unparseable === 'null' ? null : value;
    }

    if (AthenaQueryResultParser.isDateTimeLikeType(t)) {
      const d = toDate(value);
      if (d != null) return d;
      return unparseable === 'null' ? null : value;
    }

    return value;
  }

  /**
   * Builds a human-readable message for a row/header column-count mismatch.
   *
   * @param expected - Expected column count (typically `headers.length`).
   * @param actual - Actual `row.Data` length.
   * @param rowIndex - Optional zero-based row index for context.
   * @returns A message suitable for throw/warn.
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
   * Builds a human-readable message for an unavailable parse result.
   *
   * @param reason - Why parsing could not proceed.
   * @returns A message describing the unavailable reason.
   */
  private static describeUnavailableResult(
    reason: ParseResultSetUnavailableReason,
  ): string {
    if (reason === 'result-set-undefined') {
      return 'ResultSet is undefined; cannot parse rows.';
    }

    return (
      'Headers are unavailable: ResultSet has no ColumnInfo metadata ' +
      'and headers have not been initialized.'
    );
  }

  /**
   * Builds a human-readable message when data rows exceed `maxRows`.
   *
   * @param actual - Number of data rows after header skipping.
   * @param maxRows - Configured row limit.
   * @returns A message suitable for throw.
   */
  private static describeMaxRowsExceeded(actual: number, maxRows: number): string {
    return `Parsed row count (${actual}) exceeds maxRows (${maxRows}).`;
  }

  /**
   * Validates {@link ParseResultSetOptions.maxRows} when provided.
   *
   * @param maxRows - Optional row limit from options.
   * @throws Error When `maxRows` is not a non-negative integer.
   */
  private static assertValidMaxRows(maxRows: number | undefined): void {
    if (maxRows == null) {
      return;
    }

    if (!Number.isInteger(maxRows) || maxRows < 0) {
      throw new Error('maxRows must be a non-negative integer when specified.');
    }
  }

  /**
   * Resolves how many data rows to emit given {@link ParseResultSetOptions.maxRows}.
   *
   * @param dataRowCount - Number of data rows after header skipping.
   * @param options - Parsing options.
   * @returns The emit limit and whether truncation occurred.
   * @throws Error When `maxRows` is invalid, or when the count exceeds `maxRows`
   * and `maxRowsExceededBehavior` is `'throw'`.
   */
  private static resolveRowLimit(
    dataRowCount: number,
    options: ParseResultSetOptions,
  ): { emitCount: number; truncatedByMaxRows: boolean } {
    const maxRows = options.maxRows;
    AthenaQueryResultParser.assertValidMaxRows(maxRows);

    if (maxRows == null) {
      return { emitCount: dataRowCount, truncatedByMaxRows: false };
    }

    if (dataRowCount > maxRows) {
      const behavior = options.maxRowsExceededBehavior ?? 'truncate';
      if (behavior === 'throw') {
        throw new Error(
          AthenaQueryResultParser.describeMaxRowsExceeded(dataRowCount, maxRows),
        );
      }

      return { emitCount: maxRows, truncatedByMaxRows: true };
    }

    return { emitCount: dataRowCount, truncatedByMaxRows: false };
  }

  /**
   * Applies {@link ColumnCountMismatchBehavior} when counts differ.
   *
   * No-op for `'silent'` and `'extra'` (callers handle `'extra'` mapping).
   *
   * @param expected - Expected column count.
   * @param actual - Actual `row.Data` length.
   * @param behavior - Mismatch handling strategy.
   * @param rowIndex - Optional zero-based row index for messages.
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
   * @returns Lowercased trimmed type string, or `''` when missing.
   */
  private static normalizeType(type: string | undefined): string {
    return (type ?? '').trim().toLowerCase();
  }

  /**
   * Returns whether the Athena type is treated as a "string-like" type.
   *
   * @param type - Raw Athena column type from metadata.
   * @returns `true` for string/varchar/char/varbinary-like types.
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
   * @returns `true` for integer/floating/decimal-like types.
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
   * @returns `true` when the type is `boolean`.
   */
  private static isBooleanLikeType(type: string | undefined): boolean {
    const t = AthenaQueryResultParser.normalizeType(type);
    return t === 'boolean';
  }

  /**
   * Returns whether the Athena type is treated as a date/time-like type.
   *
   * @param type - Raw Athena column type from metadata.
   * @returns `true` for date/timestamp/time-like types.
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
   * @returns `true` when `value` appears valid for `type`.
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
   * @returns Whether to skip the first row and the corresponding reason code.
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
  private readonly reusePolicy: ParserReusePolicy;

  /**
   * Creates a new parser instance with empty internal state.
   *
   * Default {@link ParserReusePolicy} is `'paginate'` (retain state across pages
   * of one query). Pass `{ reusePolicy: 'fresh-each-parse' }` to reset before
   * every parse when reusing the instance across queries.
   *
   * @param options - Construction options.
   */
  constructor(options: AthenaQueryResultParserOptions = {}) {
    this.reusePolicy = options.reusePolicy ?? 'paginate';
  }

  /**
   * Returns the configured {@link ParserReusePolicy}.
   */
  getReusePolicy(): ParserReusePolicy {
    return this.reusePolicy;
  }

  /**
   * Returns whether this instance currently holds parse state that would affect
   * a later call (headers, header-row-dropped flag, or last header decision).
   *
   * When `true` and you are starting a **different** Athena query, call
   * {@link reset} first (unless `reusePolicy` is `'fresh-each-parse'`).
   *
   * @returns `true` when mutable parse state is present.
   */
  hasActiveQueryState(): boolean {
    return (
      this.headers != null ||
      this.headerRowDropped ||
      this.lastHeaderRowDecision != null
    );
  }

  /**
   * Initializes headers from column metadata.
   *
   * This method is idempotent: headers are set only when not already initialized.
   * Also invoked indirectly by {@link parseResultSet},
   * {@link parseResultSetDetailed}, and {@link parseResultSetIter}.
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
   * @returns Header names, or `null` until {@link initHeaders},
   * {@link parseResultSet}, {@link parseResultSetDetailed}, or
   * {@link parseResultSetIter} has initialized them.
   */
  getHeaders(): string[] | null {
    return this.headers;
  }

  /**
   * Returns information about the most recent header-row decision.
   *
   * Useful when `skipHeaderRow` is `'auto'` and you need to know whether the
   * first row was skipped (and why). Updated by successful
   * {@link parseResultSet} / {@link parseResultSetDetailed} /
   * {@link parseResultSetIter} calls; unavailable early exits (undefined
   * `ResultSet` or missing headers) leave the previous value unchanged.
   *
   * @returns The last {@link HeaderRowDecision}, or `null` before any successful parse.
   */
  getLastHeaderRowDecision(): HeaderRowDecision | null {
    return this.lastHeaderRowDecision;
  }

  /**
   * Prepares headers, header-row decision, and data-row bounds for parsing.
   *
   * Shared by {@link parseResultSetDetailed} and {@link parseResultSetIter}.
   * Does not apply {@link ParseResultSetOptions.maxRows}; callers resolve the
   * emit limit separately.
   *
   * When {@link ParserReusePolicy} is `'fresh-each-parse'`, clears prior state
   * via {@link reset} before preparing.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param options - Parsing options.
   * @returns Either an unavailable reason or a ready parse context (headers,
   * raw rows, data-row start index/count, and header-row decision).
   * @throws Error When duplicate column names are detected and
   * `duplicateColumnNames` is `'throw'` (default).
   * @throws Error When `skipHeaderRow` is `true`, the first row does not look
   * like a header, and `forcedSkipHeaderRowMismatchBehavior` is `'throw'`.
   */
  private prepareParseResultSet(
    resultSet: ResultSet | undefined,
    options: ParseResultSetOptions,
  ):
    | { status: 'unavailable'; reason: ParseResultSetUnavailableReason }
    | {
      status: 'ready';
      headers: string[];
      rawRows: Row[];
      dataStartIndex: number;
      dataRowCount: number;
      decision: HeaderRowDecision;
    } {
    if (this.reusePolicy === 'fresh-each-parse') {
      this.reset();
    }

    if (!resultSet) {
      return { status: 'unavailable', reason: 'result-set-undefined' };
    }

    const meta = resultSet.ResultSetMetadata?.ColumnInfo ?? [];
    this.initHeaders(meta, { duplicateColumnNames: options.duplicateColumnNames });

    if (!this.headers) {
      return { status: 'unavailable', reason: 'headers-unavailable' };
    }

    const headers = this.headers;
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
            headers,
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
                headers,
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
    const dataStartIndex = decision.skipped ? 1 : 0;
    const dataRowCount = Math.max(0, rawRows.length - dataStartIndex);

    return {
      status: 'ready',
      headers,
      rawRows,
      dataStartIndex,
      dataRowCount,
      decision,
    };
  }

  /**
   * Parses rows from an Athena {@link ResultSet}.
   *
   * By default, this method auto-detects and skips the first row when it matches
   * the headers.
   *
   * When `resultSet` is `undefined` or headers cannot be determined, returns `[]`
   * unless {@link ParseResultSetOptions.unavailableResultBehavior} is `'throw'`.
   * Prefer {@link parseResultSetDetailed} when you need to distinguish those
   * cases from a genuine empty `Rows` array.
   *
   * For large result sets, prefer {@link parseResultSetIter} to avoid allocating
   * a full `ParsedRow[]`, and/or set {@link ParseResultSetOptions.maxRows}.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param options - Parsing options (header skipping, duplicate names, column-count mismatch, etc.).
   * @returns Parsed rows keyed by header name. Returns `[]` when `resultSet` is `undefined`
   * or has no column metadata (and headers were not previously initialized).
   * @throws Error When duplicate column names are detected and
   * `duplicateColumnNames` is `'throw'` (default).
   * @throws Error When `columnCountMismatchBehavior` is `'throw'` and any row's
   * `Data.length` does not match the header count.
   * @throws Error When `unavailableResultBehavior` is `'throw'` and the result
   * cannot be parsed.
   * @throws Error When `skipHeaderRow` is `true`, the first row does not look
   * like a header, and `forcedSkipHeaderRowMismatchBehavior` is `'throw'`.
   * @throws Error When `maxRows` is invalid, or data rows exceed `maxRows` with
   * `maxRowsExceededBehavior: 'throw'`.
   */
  parseResultSet(
    resultSet: ResultSet | undefined,
    options: ParseResultSetOptions = {},
  ): ParsedRow[] {
    return this.parseResultSetDetailed(resultSet, options).rows;
  }

  /**
   * Parses rows from an Athena {@link ResultSet} and returns diagnostics.
   *
   * Same parsing behavior as {@link parseResultSet}, but also exposes why an
   * empty result occurred via {@link ParseResultSetDiagnostics.unavailableReason}
   * (`'result-set-undefined'`, `'headers-unavailable'`, or `null` for a genuine
   * empty `Rows` array), and whether {@link ParseResultSetOptions.maxRows}
   * truncated the output.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param options - Same options as {@link parseResultSet}.
   * @returns A {@link ParseResultSetDetailedResult} with parsed rows and diagnostics.
   * @throws Error When duplicate column names are detected and
   * `duplicateColumnNames` is `'throw'` (default).
   * @throws Error When `columnCountMismatchBehavior` is `'throw'` and any row's
   * `Data.length` does not match the header count.
   * @throws Error When `unavailableResultBehavior` is `'throw'` and the result
   * cannot be parsed.
   * @throws Error When `skipHeaderRow` is `true`, the first row does not look
   * like a header, and `forcedSkipHeaderRowMismatchBehavior` is `'throw'`.
   * @throws Error When `maxRows` is invalid, or data rows exceed `maxRows` with
   * `maxRowsExceededBehavior: 'throw'`.
   */
  parseResultSetDetailed(
    resultSet: ResultSet | undefined,
    options: ParseResultSetOptions = {},
  ): ParseResultSetDetailedResult {
    const unavailableBehavior = options.unavailableResultBehavior ?? 'silent';

    const prepared = this.prepareParseResultSet(resultSet, options);
    if (prepared.status === 'unavailable') {
      if (unavailableBehavior === 'throw') {
        throw new Error(
          AthenaQueryResultParser.describeUnavailableResult(prepared.reason),
        );
      }

      return {
        rows: [],
        diagnostics: {
          unavailableReason: prepared.reason,
          headerRowDecision: null,
          headers: this.headers,
          rawRowCount: 0,
          parsedRowCount: 0,
          truncatedByMaxRows: false,
        },
      };
    }

    const { emitCount, truncatedByMaxRows } = AthenaQueryResultParser.resolveRowLimit(
      prepared.dataRowCount,
      options,
    );

    const columnCountMismatchBehavior =
      options.columnCountMismatchBehavior ?? 'silent';

    const rows: ParsedRow[] = [];
    for (let offset = 0; offset < emitCount; offset += 1) {
      const rawIndex = prepared.dataStartIndex + offset;
      rows.push(
        AthenaQueryResultParser.rowToObject(
          prepared.rawRows[rawIndex],
          prepared.headers,
          {
            columnCountMismatchBehavior,
            rowIndex: offset,
          },
        ),
      );
    }

    return {
      rows,
      diagnostics: {
        unavailableReason: null,
        headerRowDecision: prepared.decision,
        headers: prepared.headers,
        rawRowCount: prepared.rawRows.length,
        parsedRowCount: rows.length,
        truncatedByMaxRows,
      },
    };
  }

  /**
   * Lazily parses rows from an Athena {@link ResultSet}.
   *
   * Prefer this over {@link parseResultSet} for large pages when you can process
   * one row at a time, so a full `ParsedRow[]` is not allocated. The underlying
   * Athena `Rows` array is still held by the `ResultSet` itself.
   *
   * Supports the same options as {@link parseResultSet}, including
   * {@link ParseResultSetOptions.maxRows} and
   * {@link ParseResultSetOptions.maxRowsExceededBehavior}.
   *
   * When parsing is unavailable (`undefined` `ResultSet` or missing headers),
   * yields nothing unless `unavailableResultBehavior` is `'throw'`.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param options - Same options as {@link parseResultSet}.
   * @yields Parsed rows keyed by header name.
   * @returns Nothing (`void`) when iteration completes or parsing is unavailable.
   * @throws Error When duplicate column names are detected and
   * `duplicateColumnNames` is `'throw'` (default).
   * @throws Error When `columnCountMismatchBehavior` is `'throw'` and any row's
   * `Data.length` does not match the header count.
   * @throws Error When `unavailableResultBehavior` is `'throw'` and the result
   * cannot be parsed.
   * @throws Error When `skipHeaderRow` is `true`, the first row does not look
   * like a header, and `forcedSkipHeaderRowMismatchBehavior` is `'throw'`.
   * @throws Error When `maxRows` is invalid, or data rows exceed `maxRows` with
   * `maxRowsExceededBehavior: 'throw'`.
   */
  *parseResultSetIter(
    resultSet: ResultSet | undefined,
    options: ParseResultSetOptions = {},
  ): Generator<ParsedRow, void, undefined> {
    const unavailableBehavior = options.unavailableResultBehavior ?? 'silent';

    const prepared = this.prepareParseResultSet(resultSet, options);
    if (prepared.status === 'unavailable') {
      if (unavailableBehavior === 'throw') {
        throw new Error(
          AthenaQueryResultParser.describeUnavailableResult(prepared.reason),
        );
      }
      return;
    }

    const { emitCount } = AthenaQueryResultParser.resolveRowLimit(
      prepared.dataRowCount,
      options,
    );

    const columnCountMismatchBehavior =
      options.columnCountMismatchBehavior ?? 'silent';

    for (let offset = 0; offset < emitCount; offset += 1) {
      const rawIndex = prepared.dataStartIndex + offset;
      yield AthenaQueryResultParser.rowToObject(
        prepared.rawRows[rawIndex],
        prepared.headers,
        {
          columnCountMismatchBehavior,
          rowIndex: offset,
        },
      );
    }
  }

  /**
   * Parses a {@link ResultSet} and maps each parsed row through a custom parser.
   *
   * Any `null` results returned from `rowParser` are filtered out.
   *
   * Uses {@link parseResultSetIter} internally so a full intermediate
   * `ParsedRow[]` is not required.
   *
   * @param resultSet - Athena query result payload, or `undefined`.
   * @param rowParser - Function that transforms each {@link ParsedRow} into `T`, or `null` to skip.
   * @param options - Same options as {@link parseResultSet} (including
   * `columnCountMismatchBehavior`, `unavailableResultBehavior`, and `maxRows`).
   * @returns Mapped values with skipped rows removed.
   * @throws Error When underlying parsing throws (for example, duplicate column
   * names, column-count mismatch in `'throw'` mode, `unavailableResultBehavior:
   * 'throw'`, or `maxRowsExceededBehavior: 'throw'`).
   */
  parseResultSetWith<T>(
    resultSet: ResultSet | undefined,
    rowParser: RowParser<T>,
    options: ParseResultSetOptions = {},
  ): T[] {
    const results: T[] = [];

    for (const row of this.parseResultSetIter(resultSet, options)) {
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
   * **Required** before reusing a `'paginate'` instance for a **different**
   * Athena query. Not needed between pages of the same query (that is what
   * `'paginate'` is for). Prefer {@link parseResultSetOnce} for one-off parses,
   * or `{ reusePolicy: 'fresh-each-parse' }` to reset automatically.
   *
   * @see hasActiveQueryState
   * @see ParserReusePolicy
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
 * - {@link rowToTypedObject} — convert a single row to a {@link TypedParsedRow}
 * - {@link isHeaderRow} — detect header-like rows
 * - {@link parseResultSetOnce} — stateless one-shot parse
 * - {@link parseResultSetDetailedOnce} — stateless one-shot parse with diagnostics
 * - {@link parseResultSetIterOnce} — stateless one-shot lazy parse
 * - {@link parseResultSetWithOnce} — stateless one-shot parse with a row mapper
 */
export const {
  headersFromMeta,
  rowToObject,
  rowToTypedObject,
  isHeaderRow,
  parseResultSetOnce,
  parseResultSetDetailedOnce,
  parseResultSetIterOnce,
  parseResultSetWithOnce,
} = AthenaQueryResultParser;