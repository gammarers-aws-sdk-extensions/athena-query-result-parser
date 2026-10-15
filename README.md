# Athena Query Result Parser

[![npm version](https://img.shields.io/npm/v/athena-query-result-parser?style=flat-square)](https://www.npmjs.com/package/athena-query-result-parser)
[![license](https://img.shields.io/npm/l/athena-query-result-parser?style=flat-square)](https://www.npmjs.com/package/athena-query-result-parser)
[![Node.js](https://img.shields.io/node/v/athena-query-result-parser?style=flat-square)](https://www.npmjs.com/package/athena-query-result-parser)
[![build](https://img.shields.io/github/actions/workflow/status/gammarers-aws-sdk-extensions/athena-query-result-parser/build.yml?label=build&style=flat-square)](https://github.com/gammarers-aws-sdk-extensions/athena-query-result-parser/actions/workflows/build.yml)

A TypeScript library that parses [Amazon Athena](https://aws.amazon.com/athena/) query result `ResultSet` objects (from `@aws-sdk/client-athena`) into header-based row objects. It supports metadata-driven headers, configurable header-row skipping, column-count mismatch handling, typed parser errors, diagnostics, streaming, row limits, and custom row transformers.

## Features

- **Header-based parsing**: Builds column names from `ResultSetMetadata.ColumnInfo` and maps each row to a key-value object.
- **Header row handling**: `skipHeaderRow` option lets callers choose `'auto' | true | false` (`'auto'` by default).
- **Robust header auto-detection**: `headerRowDetectionStrategy` (`'exact' | 'safe'`) reduces false positives when using `skipHeaderRow: 'auto'`.
- **Duplicate column name handling**: `duplicateColumnNames` (`'throw' | 'suffix' | 'allow'`).
- **Column-count mismatch handling**: `columnCountMismatchBehavior` (`'silent' | 'throw' | 'warn' | 'extra'`).
- **Typed parser errors**: `AthenaQueryResultParserError` hierarchy with stable `code` values and structured fields for programmatic handling.
- **Parse diagnostics**: `parseResultSetDetailed()` exposes why a result is empty (`unavailableReason`) and whether `maxRows` truncated output.
- **Streaming**: `parseResultSetIter()` yields rows lazily without allocating a full `ParsedRow[]`.
- **Row limits**: `maxRows` / `maxRowsExceededBehavior` cap or reject oversized pages.
- **Stateless one-shot APIs**: `parseResultSetOnce` and related `*Once` helpers for single `ResultSet` parses.
- **Stateful pagination**: Instance parsers retain headers / header-row-dropped state across pages of one query; use `reset()`, `reusePolicy: 'fresh-each-parse'`, or `*Once` to avoid cross-query misuse.
- **Custom row parsing**: `parseResultSetWith<T>()` transforms each row; rows that return `null` are filtered out.
- **Value conversion helpers**: `toNumber`, `toBoolean`, and `toDate` for `string | null` values.
- **Type-aware row conversion**: `rowToTypedObject` converts cells from `ColumnInfo` (`Type`, and `Precision` / `Scale` for decimals). `bigint` and `decimal` stay strings so large integers and trailing scale are preserved.
- **Static helpers**: `headersFromMeta`, `rowToObject`, `isHeaderRow`, and the `*Once` helpers are exported for use without managing instance lifecycle.

## Installation

### npm

```bash
npm install athena-query-result-parser
```

### yarn

```bash
yarn add athena-query-result-parser
```

### pnpm

```bash
pnpm add athena-query-result-parser
```

`@aws-sdk/client-athena` (v3) is a dependency. Import `Row`, `ColumnInfo`, and `ResultSet` from that package.

## Usage

### One-off parse (recommended)

Prefer the stateless `*Once` helpers when you have a single `ResultSet`:

```typescript
import { AthenaQueryResultParser, parseResultSetOnce } from 'athena-query-result-parser';
import type { ResultSet } from '@aws-sdk/client-athena';

const resultSet: ResultSet = getAthenaResultSet(); // from GetQueryResults, etc.

const rows = parseResultSetOnce(resultSet);
// rows: Array<Record<string, string | null>>
// e.g. [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }]

// Equivalent:
// AthenaQueryResultParser.parseResultSetOnce(resultSet);
```

### Paginate pages of one query

Use an instance when consecutive `GetQueryResults` pages share headers and should skip the header row only once:

```typescript
const parser = AthenaQueryResultParser.create();
parser.parseResultSet(page1);
parser.parseResultSet(page2); // keeps headers / headerRowDropped

if (parser.hasActiveQueryState()) {
  parser.reset(); // required before a different query
}
parser.parseResultSet(otherQueryPage1);
```

To reuse one instance across queries without calling `reset()` yourself:

```typescript
const parser = new AthenaQueryResultParser({ reusePolicy: 'fresh-each-parse' });
```

| Use case | Recommended API |
|----------|-----------------|
| One `ResultSet` | `parseResultSetOnce` (or other `*Once` helpers) |
| Multiple pages of one query | `create()` / `new AthenaQueryResultParser()`, then `reset()` before another query |
| Reuse one instance across queries without `reset` | `{ reusePolicy: 'fresh-each-parse' }` |

### Safer auto header skipping

If you use `skipHeaderRow: 'auto'` and want to reduce the chance of accidentally dropping a real data row that happens to equal the headers, use `headerRowDetectionStrategy: 'safe'`:

```typescript
const rows = parser.parseResultSet(resultSet, {
  skipHeaderRow: 'auto',
  headerRowDetectionStrategy: 'safe',
});

const decision = parser.getLastHeaderRowDecision();
// decision tells you whether the first row was skipped and why
```

### Diagnostics

```typescript
const { rows, diagnostics } = parser.parseResultSetDetailed(resultSet);
if (diagnostics.unavailableReason != null) {
  // 'result-set-undefined' | 'headers-unavailable'
}
// diagnostics.truncatedByMaxRows is true when maxRows truncated the output
```

### Streaming

Process rows one at a time without allocating a full `ParsedRow[]`:

```typescript
for (const row of parser.parseResultSetIter(resultSet, { maxRows: 1000 })) {
  // handle row
}
```

Note: the Athena `ResultSet.Rows` array is still held by the SDK payload; this API avoids a second full array of parsed objects.

### Strict column-count validation

By default, rows shorter than the header count are padded with `null`, and surplus cells are discarded. Use `'throw'` to fail fast instead of silently losing data:

```typescript
const rows = parser.parseResultSet(resultSet, {
  columnCountMismatchBehavior: 'throw',
});
```

### Error handling

When a `'throw'` option is triggered, the parser throws a typed subclass of `AthenaQueryResultParserError`. Each error exposes a stable `code` and structured fields for logging or branching:

```typescript
import {
  AthenaQueryResultParser,
  AthenaQueryResultParserError,
  AthenaQueryResultParserDuplicateColumnNameError,
  AthenaQueryResultParserColumnCountMismatchError,
} from 'athena-query-result-parser';

try {
  AthenaQueryResultParser.parseResultSetOnce(resultSet, {
    columnCountMismatchBehavior: 'throw',
  });
} catch (error) {
  if (error instanceof AthenaQueryResultParserDuplicateColumnNameError) {
    console.error(error.code, error.duplicates);
  } else if (error instanceof AthenaQueryResultParserColumnCountMismatchError) {
    console.error(error.code, error.expected, error.actual, error.rowIndex);
  } else if (error instanceof AthenaQueryResultParserError) {
    console.error(error.code, error.message);
  }
}
```

| Class | `code` | When thrown | Extra fields |
|-------|--------|-------------|--------------|
| `AthenaQueryResultParserDuplicateColumnNameError` | `duplicate-column-name` | `duplicateColumnNames: 'throw'` (default) | `duplicates` |
| `AthenaQueryResultParserColumnCountMismatchError` | `column-count-mismatch` | `columnCountMismatchBehavior: 'throw'` | `expected`, `actual`, `rowIndex?` |
| `AthenaQueryResultParserUnavailableResultError` | `unavailable-result` | `unavailableResultBehavior: 'throw'` | `reason` (`'result-set-undefined' \| 'headers-unavailable'`) |
| `AthenaQueryResultParserHeaderRowMismatchError` | `header-row-mismatch` | `skipHeaderRow: true` with a non-header first row and `forcedSkipHeaderRowMismatchBehavior: 'throw'` (default) | — |
| `AthenaQueryResultParserInvalidMaxRowsError` | `invalid-max-rows` | `maxRows` is not a non-negative integer | `maxRows` |
| `AthenaQueryResultParserMaxRowsExceededError` | `max-rows-exceeded` | `maxRowsExceededBehavior: 'throw'` | `actual`, `maxRows` |
| `AthenaQueryResultParserUnparseableValueError` | `unparseable-value` | `unparseableValueBehavior: 'throw'` | `columnName`, `columnType`, `value`, `rowIndex?` |

Check a subclass before `AthenaQueryResultParserError`. Every parser failure extends that base class and exposes `code`.

### Preserving surplus columns

When a row has more cells than headers, store the extra values under `__extra`:

```typescript
import { EXTRA_COLUMNS_KEY } from 'athena-query-result-parser';

const rows = parser.parseResultSet(resultSet, {
  columnCountMismatchBehavior: 'extra',
  skipHeaderRow: false,
});
// e.g. { id: '1', name: 'Alice', __extra: ['surplus1', 'surplus2'] }
// or access via rows[0][EXTRA_COLUMNS_KEY]
```

### Safe value conversion helpers

```typescript
import { toNumber, toBoolean, toDate } from 'athena-query-result-parser';

const n = toNumber(row.count);        // number | null
const b = toBoolean(row.is_active);   // boolean | null
const d = toDate(row.created_at);     // Date | null
```

### Type-aware row conversion (ColumnInfo.Type based)

```typescript
import { rowToTypedObject } from 'athena-query-result-parser';
import type { ColumnInfo, Row } from '@aws-sdk/client-athena';

const typed = rowToTypedObject(row, headers, columnInfo);
// integer / tinyint / smallint → number
// bigint → string (exact decimal text, including values above Number.MAX_SAFE_INTEGER)
// decimal → string (trailing scale kept; Precision and Scale come from ColumnInfo)
// double / float → number, boolean → boolean, timestamp → Date

const typedStrict = rowToTypedObject(row, headers, columnInfo, {
  unparseableValueBehavior: 'throw',
});
```

### Custom row parser

```typescript
import { AthenaQueryResultParser, type ParsedRow } from 'athena-query-result-parser';

type User = { id: string; name: string };

const rowParser = (row: ParsedRow): User | null => {
  if (row.name == null || row.name === '') return null;
  return { id: row.id ?? '', name: row.name };
};

const users = AthenaQueryResultParser.parseResultSetWithOnce(resultSet, rowParser);
// users: User[] (rows with empty name are omitted)
```

### Static helpers

```typescript
import {
  headersFromMeta,
  rowToObject,
  rowToTypedObject,
  isHeaderRow,
  parseResultSetOnce,
  parseResultSetDetailedOnce,
  parseResultSetIterOnce,
  parseResultSetWithOnce,
  EXTRA_COLUMNS_KEY,
  toNumber,
  toBoolean,
  toDate,
} from 'athena-query-result-parser';
import type { ColumnInfo, Row } from '@aws-sdk/client-athena';

const headers = headersFromMeta(columnInfo);           // string[]
const obj = rowToObject(row, headers);                 // ParsedRow
const objStrict = rowToObject(row, headers, {
  columnCountMismatchBehavior: 'throw',
});
const typed = rowToTypedObject(row, headers, columnInfo);
const isHeader = isHeaderRow(row, headers);            // boolean
```

## Options

### Construction

Passed to `new AthenaQueryResultParser({ ... })` or `AthenaQueryResultParser.create({ ... })`.

| Option | Default | Description |
|--------|---------|-------------|
| `reusePolicy` | `'paginate'` | `'paginate'` keeps headers and the header-row-dropped flag across pages of one query. `'fresh-each-parse'` calls `reset()` before every parse. |

### `ParseResultSetOptions`

Accepted by `parseResultSet`, `parseResultSetDetailed`, `parseResultSetIter`, `parseResultSetWith`, and the `*Once` helpers.

| Option | Default | Description |
|--------|---------|-------------|
| `skipHeaderRow` | `'auto'` | `'auto'` skips the first row only when it matches the headers, once per instance in `'paginate'` mode. `true` skips it only when it looks like a header, and throws `AthenaQueryResultParserHeaderRowMismatchError` when it does not. `false` never skips it. |
| `skipFirstRow` | `false` | Drops the first row unconditionally. |
| `forcedSkipHeaderRowMismatchBehavior` | `'throw'` | Used when `skipHeaderRow` is `true` and the first row is not a header. `'throw'` throws `AthenaQueryResultParserHeaderRowMismatchError`. `'keep'` keeps the row. `'skip'` drops it. |
| `duplicateColumnNames` | `'throw'` | `'throw'` throws `AthenaQueryResultParserDuplicateColumnNameError`. `'suffix'` renames duplicates (`col`, `col_2`, `col_3`, ...). `'allow'` keeps duplicates; later columns overwrite earlier ones in `rowToObject`. |
| `headerRowDetectionStrategy` | `'exact'` | Used when `skipHeaderRow` is `'auto'`. `'exact'` skips on an exact header match. `'safe'` also requires type evidence that the row is unlikely to be data. |
| `columnCountMismatchBehavior` | `'silent'` | `'silent'` pads missing cells with `null` and drops surplus cells. `'throw'` throws `AthenaQueryResultParserColumnCountMismatchError`. `'warn'` logs `console.warn` and uses the `'silent'` mapping. `'extra'` stores surplus cells under `__extra`. |
| `unavailableResultBehavior` | `'silent'` | When `ResultSet` is `undefined` or headers cannot be determined. `'silent'` returns `[]` or yields nothing. `'throw'` throws `AthenaQueryResultParserUnavailableResultError`. Does not apply when headers exist and `Rows` is empty. |
| `maxRows` | omitted | Non-negative integer cap on data rows after header skipping. Omit for no limit. Invalid values throw `AthenaQueryResultParserInvalidMaxRowsError`. |
| `maxRowsExceededBehavior` | `'truncate'` | `'truncate'` returns or yields the first `maxRows` rows. `'throw'` throws `AthenaQueryResultParserMaxRowsExceededError` before producing rows. Ignored when `maxRows` is omitted. |

### Row helpers

`columnCountMismatchBehavior` and `rowIndex` apply to `rowToObject` and `rowToTypedObject`. `unparseableValueBehavior` applies to `rowToTypedObject`.

| Option | Default | Description |
|--------|---------|-------------|
| `columnCountMismatchBehavior` | `'silent'` | Same values as on `ParseResultSetOptions`. |
| `rowIndex` | omitted | Zero-based row index included in throw and warn messages. |
| `unparseableValueBehavior` | `'keep'` | `'keep'` returns the original string. `'null'` returns `null`. `'throw'` throws `AthenaQueryResultParserUnparseableValueError`. |

`tinyint`, `smallint`, `int`, and `integer` become `number` when the cell is a base-10 integer inside that type's range. `bigint` stays a string when it fits in signed 64 bits. `decimal` stays a string, including trailing fractional zeros. Digit limits for `decimal` use `ColumnInfo.Precision` and `ColumnInfo.Scale`, or `decimal(p,s)` on `Type` when those fields are absent. `real`, `float`, and `double` become `number`.

## Requirements

- Node.js >= 20

## License

This project is licensed under the Apache-2.0 License.
