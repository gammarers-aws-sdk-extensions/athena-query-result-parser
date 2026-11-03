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
import {
  AthenaQueryResultParserArgumentError,
  AthenaQueryResultParserUnparseableValueError,
} from './errors';

export type {
  AthenaTypedValue,
  DateValueKind,
  ToDateOptions,
  UnparseableValueBehavior,
};

/**
 * `date` columns stay calendar text. A UTC-midnight `Date` shifts the day in zones behind UTC.
 */
export const DEFAULT_DATE_VALUE: DateValueKind = 'string';

const TYPE_REAL = 'real';
const TYPE_FLOAT = 'float';
const TYPE_DOUBLE = 'double';
const TIMESTAMP_TYPE_PREFIX = 'timestamp';

/**
 * Athena prints these with Java's `Double` formatting. `Number('infinity')` is `NaN`, so the
 * spelling stays case-sensitive.
 */
const NON_FINITE_NUMBER_PATTERN = /^(?:NaN|[+-]?Infinity)$/;

const APPROXIMATE_NUMERIC_TYPES: ReadonlySet<string> = new Set([
  TYPE_REAL,
  TYPE_FLOAT,
  TYPE_DOUBLE,
]);

/**
 * Returns a normalized Athena type string used for comparisons.
 *
 * @param type - Raw Athena column type from metadata.
 * @returns Lowercased trimmed type string, or `''` when missing.
 */
const normalizeType = (type: string | undefined): string => (type ?? '').trim().toLowerCase();

/**
 * Returns whether the normalized type is an approximate numeric type.
 *
 * @param type - Normalized Athena column type.
 * @returns `true` for `real`, `float`, and `double`.
 */
const isApproximateNumericType = (type: string): boolean => APPROXIMATE_NUMERIC_TYPES.has(type);

/**
 * Returns whether the normalized type is a timestamp, including precision and zone forms.
 *
 * @param type - Normalized Athena column type.
 * @returns `true` when the type starts with `timestamp`.
 */
const isTimestampType = (type: string): boolean => type.startsWith(TIMESTAMP_TYPE_PREFIX);

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
 * Maps a converter failure onto this package's error hierarchy.
 *
 * @param error - The error caught from the value converter.
 * @throws {@link AthenaQueryResultParserUnparseableValueError} When the converter rejected a cell.
 * @throws {@link AthenaQueryResultParserArgumentError} When the converter rejected an option.
 */
const rethrowConverterError = (error: unknown): never => {
  if (error instanceof AthenaQueryResultValueConverterUnparseableValueError) {
    throw new AthenaQueryResultParserUnparseableValueError(
      error.columnName,
      error.columnType,
      error.value,
      error.rowIndex,
    );
  }
  if (error instanceof AthenaQueryResultValueConverterArgumentError) {
    throw new AthenaQueryResultParserArgumentError(error.message);
  }
  throw error;
};

/**
 * Converts an Athena timestamp or `YYYY-MM-DD` date to a {@link Date}.
 *
 * Accepts `YYYY-MM-DD HH:mm:ss[.SSS]` and the same form with a `UTC`, numeric-offset,
 * or IANA suffix. `YYYY-MM-DD` is UTC midnight. Other text, including ISO `T`/`Z` forms,
 * returns `null`.
 *
 * @param value - Raw text, or `null`.
 * @param options - {@link ToDateOptions}. Session time zone for a timestamp that has no suffix.
 * @returns A {@link Date}, or `null` when the text is not a representable Athena literal.
 * @throws {@link AthenaQueryResultParserArgumentError} When `options.timeZone` is not an IANA time zone.
 */
export const toDate = (value: string | null, options?: ToDateOptions): Date | null => {
  try {
    return AthenaQueryResultValueConverter.toDate(value, options);
  } catch (error) {
    return rethrowConverterError(error);
  }
};

/**
 * Converts Athena's non-finite double text.
 *
 * The value converter rejects these as unparseable. `Number` can represent them.
 *
 * @param value - Raw cell text.
 * @param normalizedType - Lowercased Athena column type.
 * @returns `Infinity`, `-Infinity`, or `NaN`, or `null` when this is not that text.
 */
const toNonFiniteNumber = (value: string, normalizedType: string): number | null => {
  if (!isApproximateNumericType(normalizedType)) return null;

  const trimmed = value.trim();
  if (!NON_FINITE_NUMBER_PATTERN.test(trimmed)) return null;

  return Number(trimmed);
};

/**
 * Converts a timestamp the value converter rejected when {@link toDate} can read it.
 *
 * Example: `2026-01-01 00:00:00.000 UTC` on a zone-less `timestamp`. Precision above
 * milliseconds stays with the converter, which keeps that text instead of rejecting it.
 *
 * @param value - Raw cell text.
 * @param normalizedType - Lowercased Athena column type.
 * @param timeZone - Session time zone for a timestamp that has no suffix.
 * @returns A {@link Date}, or `null` when the text is not a representable timestamp.
 */
const toTimestampDate = (
  value: string,
  normalizedType: string,
  timeZone: string | undefined,
): Date | null => {
  if (!isTimestampType(normalizedType)) return null;

  return toDate(value, timeZone == null ? undefined : { timeZone });
};

/**
 * Applies the caller's unparseable behavior after this parser also cannot convert the cell.
 *
 * @param value - Original cell text.
 * @param behavior - Whether to keep the text, return `null`, or throw.
 * @param error - Converter rejection, remapped when `behavior` is `'throw'`.
 * @returns The original string or `null`.
 * @throws {@link AthenaQueryResultParserUnparseableValueError} When `behavior` is `'throw'`.
 */
const applyUnparseableValue = (
  value: string,
  behavior: UnparseableValueBehavior,
  error: unknown,
): AthenaTypedValue => {
  if (behavior === 'null') return null;
  if (behavior === 'throw') return rethrowConverterError(error);

  return value;
};

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
 * Non-finite doubles and timestamps {@link toDate} can read count as well.
 *
 * @param value - Cell value from a row.
 * @param type - Athena column type for that cell.
 * @returns `true` when `value` is acceptable for `type`.
 */
export const isParseableAsType = (value: string, type: string | undefined): boolean => {
  if (AthenaQueryResultValueConverter.isParseableAsType(value, type)) return true;

  const normalized = normalizeType(type);
  if (toNonFiniteNumber(value, normalized) != null) return true;

  return toTimestampDate(value, normalized, undefined) != null;
};

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
 * When the converter rejects a cell, this parser still converts values it can
 * represent: `Infinity`, `-Infinity`, and `NaN` on `real` / `float` / `double`,
 * and a timestamp {@link toDate} can read (for example a zone suffix on a
 * zone-less `timestamp`).
 *
 * @param value - Raw `VarCharValue` (or `null` when missing).
 * @param columnName - Header name used when conversion fails.
 * @param column - Column metadata for this cell.
 * @param options - Unparseable-value behavior, row index, and temporal options.
 * @returns A typed value, or the original string / `null` when unparseable.
 * @throws {@link AthenaQueryResultParserUnparseableValueError} When `unparseableValueBehavior` is `'throw'`
 * and the cell does not match its column type.
 * @throws {@link AthenaQueryResultParserArgumentError} When `timeZone` or `dateValue` is unusable.
 */
export const convertTypedValue = (
  value: string | null,
  columnName: string,
  column: ColumnInfo | undefined,
  options: ConvertTypedValueOptions,
): AthenaTypedValue => {
  // Ask the converter to throw so an intentional string (bigint, time, timestamp(6))
  // stays distinct from a cell it rejected.
  if (value == null) return null;

  const normalized = normalizeType(column?.Type);

  try {
    return AthenaQueryResultValueConverter.convert(value, columnName, column, {
      unparseableValueBehavior: 'throw',
      rowIndex: options.rowIndex,
      timeZone: options.timeZone,
      dateValue: options.dateValue ?? DEFAULT_DATE_VALUE,
    });
  } catch (error) {
    if (!(error instanceof AthenaQueryResultValueConverterUnparseableValueError)) {
      return rethrowConverterError(error);
    }

    // `NaN != null` is true. A falsy check would drop a real NaN result.
    const recoveredNumber = toNonFiniteNumber(value, normalized);
    if (recoveredNumber != null) return recoveredNumber;

    const recoveredDate = toTimestampDate(value, normalized, options.timeZone);
    if (recoveredDate != null) return recoveredDate;

    return applyUnparseableValue(value, options.unparseableValueBehavior, error);
  }
};
