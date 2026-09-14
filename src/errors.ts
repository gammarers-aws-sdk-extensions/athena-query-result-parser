/**
 * Base error thrown by Athena query result parsing.
 *
 * Catch this type to handle every parser failure, or catch a subclass for a
 * specific case. {@link code} is a stable machine-readable identifier.
 */
export abstract class AthenaQueryResultParserError extends Error {
  /**
   * Stable error code for logging, metrics, and programmatic handling.
   */
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const describeColumnCountMismatch = (
  expected: number,
  actual: number,
  rowIndex?: number,
): string => {
  const rowPart = rowIndex != null ? ` at row index ${rowIndex}` : '';
  return `Column count mismatch${rowPart}: expected ${expected} column(s) but row has ${actual}`;
};

const describeUnavailableResult = (
  reason: 'result-set-undefined' | 'headers-unavailable',
): string => {
  if (reason === 'result-set-undefined') {
    return 'ResultSet is undefined; cannot parse rows.';
  }

  return (
    'Headers are unavailable: ResultSet has no ColumnInfo metadata ' +
    'and headers have not been initialized.'
  );
};

const describeMaxRowsExceeded = (actual: number, maxRows: number): string => {
  return `Parsed row count (${actual}) exceeds maxRows (${maxRows}).`;
};

const HEADER_ROW_MISMATCH_MESSAGE =
  'skipHeaderRow:true was specified but the first row does not look like a header row. ' +
  'If you want to always drop the first row, use skipFirstRow:true. ' +
  'Or set forcedSkipHeaderRowMismatchBehavior to "skip" or "keep".';

/**
 * Thrown when column metadata contains duplicate names and
 * `duplicateColumnNames` is `'throw'` (the default).
 */
export class AthenaQueryResultParserDuplicateColumnNameError extends AthenaQueryResultParserError {
  readonly code = 'duplicate-column-name' as const;

  /**
   * Column names that appear more than once (in first-seen order).
   */
  readonly duplicates: readonly string[];

  constructor(duplicates: readonly string[]) {
    super(`Duplicate column names detected: ${duplicates.join(', ')}`);
    this.duplicates = duplicates;
  }
}

/**
 * Thrown when a row's `Data` length does not match the header count and
 * `columnCountMismatchBehavior` is `'throw'`.
 */
export class AthenaQueryResultParserColumnCountMismatchError extends AthenaQueryResultParserError {
  readonly code = 'column-count-mismatch' as const;

  /**
   * Expected column count (typically `headers.length`).
   */
  readonly expected: number;

  /**
   * Actual `row.Data` length.
   */
  readonly actual: number;

  /**
   * Optional zero-based row index included in the message when provided.
   */
  readonly rowIndex: number | undefined;

  constructor(expected: number, actual: number, rowIndex?: number) {
    super(describeColumnCountMismatch(expected, actual, rowIndex));
    this.expected = expected;
    this.actual = actual;
    this.rowIndex = rowIndex;
  }
}

/**
 * Thrown when the `ResultSet` cannot be parsed because it is `undefined` or
 * headers cannot be determined, and `unavailableResultBehavior` is `'throw'`.
 */
export class AthenaQueryResultParserUnavailableResultError extends AthenaQueryResultParserError {
  readonly code = 'unavailable-result' as const;

  /**
   * Why parsing could not proceed.
   */
  readonly reason: 'result-set-undefined' | 'headers-unavailable';

  constructor(reason: 'result-set-undefined' | 'headers-unavailable') {
    super(describeUnavailableResult(reason));
    this.reason = reason;
  }
}

/**
 * Thrown when `skipHeaderRow` is `true`, the first row does not look like a
 * header, and `forcedSkipHeaderRowMismatchBehavior` is `'throw'` (the default).
 */
export class AthenaQueryResultParserHeaderRowMismatchError extends AthenaQueryResultParserError {
  readonly code = 'header-row-mismatch' as const;

  constructor() {
    super(HEADER_ROW_MISMATCH_MESSAGE);
  }
}

/**
 * Thrown when `maxRows` is provided but is not a
 * non-negative integer.
 */
export class AthenaQueryResultParserInvalidMaxRowsError extends AthenaQueryResultParserError {
  readonly code = 'invalid-max-rows' as const;

  /**
   * The invalid `maxRows` value that was supplied.
   */
  readonly maxRows: number;

  constructor(maxRows: number) {
    super('maxRows must be a non-negative integer when specified.');
    this.maxRows = maxRows;
  }
}

/**
 * Thrown when the number of data rows exceeds `maxRows` and
 * `maxRowsExceededBehavior` is `'throw'`.
 */
export class AthenaQueryResultParserMaxRowsExceededError extends AthenaQueryResultParserError {
  readonly code = 'max-rows-exceeded' as const;

  /**
   * Number of data rows after header skipping.
   */
  readonly actual: number;

  /**
   * Configured row limit.
   */
  readonly maxRows: number;

  constructor(actual: number, maxRows: number) {
    super(describeMaxRowsExceeded(actual, maxRows));
    this.actual = actual;
    this.maxRows = maxRows;
  }
}
