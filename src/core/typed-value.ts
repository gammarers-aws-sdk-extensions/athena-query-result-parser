import type { ColumnInfo } from '@aws-sdk/client-athena';
import {
  AthenaQueryResultValueConverter,
  AthenaQueryResultValueConverterArgumentError,
  AthenaQueryResultValueConverterUnparseableValueError,
  type AthenaTypedValue,
  type DateValueKind,
  type ToDateOptions,
  type UnparseableValueBehavior,
} from 'athena-query-result-value-converter';
import { AthenaQueryResultParserUnparseableValueError } from './errors';

export type {
  AthenaTypedValue,
  DateValueKind,
  ToDateOptions,
  UnparseableValueBehavior,
};

export { AthenaQueryResultValueConverterArgumentError };

/**
 * `date` columns stay calendar text. A UTC-midnight `Date` shifts the day in zones behind UTC.
 */
export const DEFAULT_DATE_VALUE: DateValueKind = 'string';

/**
 * Safely converts a string value to a finite number.
 *
 * Returns `null` when the value is `null`, empty/whitespace, or not a finite number.
 *
 * @param value - Raw Athena cell value.
 * @returns A finite number, or `null` when conversion is not possible.
 */
export const toNumber = AthenaQueryResultValueConverter.toNumber;

/**
 * Safely converts a string value to a boolean.
 *
 * Accepts (case-insensitive) `'true'` and `'false'`.
 * Returns `null` for `null`, empty/whitespace, or unrecognized values.
 *
 * @param value - Raw Athena cell value.
 * @returns `true` / `false`, or `null` when conversion is not possible.
 */
export const toBoolean = AthenaQueryResultValueConverter.toBoolean;

/**
 * Converts an Athena timestamp or `YYYY-MM-DD` date to a {@link Date}.
 *
 * Accepts `YYYY-MM-DD HH:mm:ss[.SSS]` and the same form with a `UTC`, numeric-offset,
 * or IANA suffix. `YYYY-MM-DD` is UTC midnight. Other text, including ISO `T`/`Z` forms,
 * returns `null`.
 *
 * @param value - Raw text, or `null`.
 * @param options - Session time zone for a timestamp that has no suffix.
 * @returns A {@link Date}, or `null` when the text is not a representable Athena literal.
 * @throws {@link AthenaQueryResultValueConverterArgumentError} When `options.timeZone` is not an IANA time zone.
 */
export const toDate = AthenaQueryResultValueConverter.toDate;

/**
 * Returns whether the Athena type is treated as a string-like type.
 *
 * @param type - Raw Athena column type from metadata.
 * @returns `true` for string/varchar/char/varbinary-like types.
 */
export const isStringLikeType = AthenaQueryResultValueConverter.isStringLikeType;

/**
 * Returns whether a string value matches the Athena literal for the column type.
 *
 * Date and time checks use the same literals as {@link convertTypedValue}.
 *
 * @param value - Cell value from a row.
 * @param type - Athena column type for that cell.
 * @returns `true` when `value` is acceptable for `type`.
 */
export const isParseableAsType = AthenaQueryResultValueConverter.isParseableAsType;

/**
 * Options for {@link convertTypedValue}.
 */
export type ConvertTypedValueOptions = {
  /**
   * How to handle values that cannot be converted based on the column type.
   */
  readonly unparseableValueBehavior: UnparseableValueBehavior;
  /**
   * Zero-based row index included in throw messages when available.
   */
  readonly rowIndex?: number;
  /**
   * IANA time zone for a `timestamp` that has no zone suffix.
   *
   * Default: `'UTC'`. `timestamp with time zone` uses the suffix on the cell.
   */
  readonly timeZone?: string;
  /**
   * How to return a `date` column.
   *
   * Default for this parser: {@link DEFAULT_DATE_VALUE} (`'string'`).
   */
  readonly dateValue?: DateValueKind;
};

/**
 * Converts a raw Athena cell using column metadata.
 *
 * Numeric, boolean, and temporal literals are interpreted by
 * `athena-query-result-value-converter`. `bigint` and `decimal` stay strings.
 * `time` stays text. A `timestamp` whose precision does not fit in a {@link Date}
 * stays text, including its zone suffix. `date` follows `dateValue`.
 *
 * @param value - Raw `VarCharValue` (or `null` when missing).
 * @param columnName - Header name used when conversion fails.
 * @param column - Column metadata for this cell.
 * @param options - Unparseable-value behavior, row index, and temporal options.
 * @returns A typed value, or the original string / `null` when unparseable.
 * @throws {@link AthenaQueryResultParserUnparseableValueError} When `unparseableValueBehavior` is `'throw'`
 * and the cell does not match its column type.
 * @throws {@link AthenaQueryResultValueConverterArgumentError} When `timeZone` or `dateValue` is unusable.
 */
export const convertTypedValue = (
  value: string | null,
  columnName: string,
  column: ColumnInfo | undefined,
  options: ConvertTypedValueOptions,
): AthenaTypedValue => {
  // Keep the parser error type. The converter error has the same cell fields.
  try {
    return AthenaQueryResultValueConverter.convert(value, columnName, column, {
      unparseableValueBehavior: options.unparseableValueBehavior,
      rowIndex: options.rowIndex,
      timeZone: options.timeZone,
      dateValue: options.dateValue ?? DEFAULT_DATE_VALUE,
    });
  } catch (error) {
    if (!(error instanceof AthenaQueryResultValueConverterUnparseableValueError)) {
      throw error;
    }
    throw new AthenaQueryResultParserUnparseableValueError(
      error.columnName,
      error.columnType,
      error.value,
      error.rowIndex,
    );
  }
};
