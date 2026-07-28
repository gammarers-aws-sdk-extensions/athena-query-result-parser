# Athena Query Result Parser

[![npm version](https://img.shields.io/npm/v/athena-query-result-parser.svg)](https://www.npmjs.com/package/athena-query-result-parser)
[![license](https://img.shields.io/npm/l/athena-query-result-parser.svg)](https://www.npmjs.com/package/athena-query-result-parser)

A TypeScript library that parses [Amazon Athena](https://aws.amazon.com/athena/) query result `ResultSet` objects (from `@aws-sdk/client-athena`) into header-based row objects. It supports metadata-driven headers, configurable header-row skipping, column-count mismatch handling, diagnostics, streaming, row limits, and custom row transformers.

## Features

- **Header-based parsing**: Builds column names from `ResultSetMetadata.ColumnInfo` and maps each row to a key-value object.
- **Header row handling**: `skipHeaderRow` option lets callers choose `'auto' | true | false` (`'auto'` by default).
- **Robust header auto-detection**: `headerRowDetectionStrategy` (`'exact' | 'safe'`) reduces false positives when using `skipHeaderRow: 'auto'`.
- **Duplicate column name handling**: `duplicateColumnNames` (`'throw' | 'suffix' | 'allow'`).
- **Column-count mismatch handling**: `columnCountMismatchBehavior` (`'silent' | 'throw' | 'warn' | 'extra'`).
- **Parse diagnostics**: `parseResultSetDetailed()` exposes why a result is empty (`unavailableReason`) and whether `maxRows` truncated output.
- **Streaming**: `parseResultSetIter()` yields rows lazily without allocating a full `ParsedRow[]`.
- **Row limits**: `maxRows` / `maxRowsExceededBehavior` cap or reject oversized pages.
- **Stateless one-shot APIs**: `parseResultSetOnce` and related `*Once` helpers for single `ResultSet` parses.
- **Stateful pagination**: Instance parsers retain headers / header-row-dropped state across pages of one query; use `reset()`, `reusePolicy: 'fresh-each-parse'`, or `*Once` to avoid cross-query misuse.
- **Custom row parsing**: `parseResultSetWith<T>()` transforms each row; rows that return `null` are filtered out.
- **Value conversion helpers**: `toNumber`, `toBoolean`, and `toDate` for `string | null` values.
- **Type-aware row conversion**: `rowToTypedObject` converts cells based on `ColumnInfo.Type`.
- **Static helpers**: `headersFromMeta`, `rowToObject`, `isHeaderRow`, and the `*Once` helpers are exported for use without managing instance lifecycle.

## Installation

```bash
npm install athena-query-result-parser
```

```bash
yarn add athena-query-result-parser
```

**Dependency**: `@aws-sdk/client-athena` (v3). The library uses its types (`Row`, `ColumnInfo`, `ResultSet`).

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
// typed: Record<string, string | number | boolean | Date | null>

const typedStrict = rowToTypedObject(row, headers, columnInfo, {
  unparseableValueBehavior: 'null',
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

### Construction: `reusePolicy`

Passed to `new AthenaQueryResultParser({ ... })` or `AthenaQueryResultParser.create({ ... })`.

- `'paginate'` (default): Retain headers and the header-row-dropped flag across calls (for pages of the **same** query).
- `'fresh-each-parse'`: Call `reset()` before every parse so each call is independent.

```typescript
new AthenaQueryResultParser({ reusePolicy: 'paginate' });
new AthenaQueryResultParser({ reusePolicy: 'fresh-each-parse' });
```

### `skipHeaderRow`

Control how the parser handles the first row in `Rows`.

- `'auto'` (default): Skip the first row only when it matches the derived headers (once per parser instance in `'paginate'` mode).
- `true`: Skip the first row **only when it looks like a header row**. By default, this throws if the first row does not look like a header row.
- `false`: Never skip the first row.

```typescript
parser.parseResultSet(resultSet); // default: { skipHeaderRow: 'auto' }
parser.parseResultSet(resultSet, { skipHeaderRow: true }); // throws on mismatch by default
parser.parseResultSet(resultSet, {
  skipHeaderRow: true,
  forcedSkipHeaderRowMismatchBehavior: 'keep',
});
parser.parseResultSet(resultSet, { skipHeaderRow: false });
```

### `skipFirstRow`

Drop the first row unconditionally (explicit, potentially lossy).

```typescript
parser.parseResultSet(resultSet, { skipFirstRow: true });
```

### `forcedSkipHeaderRowMismatchBehavior`

Controls what happens when `skipHeaderRow: true` is used but the first row does not look like a header row.

- `'throw'` (default): Throw an error to prevent accidental data loss.
- `'keep'`: Keep the first row.
- `'skip'`: Skip the first row anyway (potentially lossy).

```typescript
parser.parseResultSet(resultSet, {
  skipHeaderRow: true,
  forcedSkipHeaderRowMismatchBehavior: 'throw',
});
```

### `duplicateColumnNames`

- `'throw'` (default): Throw an error listing duplicate names.
- `'suffix'`: Make names unique (`col`, `col_2`, `col_3`, ...).
- `'allow'`: Keep duplicates (later columns overwrite earlier ones in `rowToObject`).

```typescript
parser.parseResultSet(resultSet, { duplicateColumnNames: 'suffix' });
```

### `columnCountMismatchBehavior`

- `'silent'` (default): Pad missing cells with `null` and discard surplus cells.
- `'throw'`: Throw an error (strict mode).
- `'warn'`: Emit `console.warn` but keep the `'silent'` value mapping.
- `'extra'`: Store surplus cells under `__extra` (`EXTRA_COLUMNS_KEY`).

```typescript
parser.parseResultSet(resultSet, { columnCountMismatchBehavior: 'throw' });
rowToObject(row, headers, { columnCountMismatchBehavior: 'throw', rowIndex: 0 });
```

### `headerRowDetectionStrategy`

Used when `skipHeaderRow` is `'auto'`.

- `'exact'` (default): Skip when the first row exactly matches the derived headers.
- `'safe'`: Skip only when the first row matches headers **and** there is type-based evidence that the row is unlikely to be valid data.

```typescript
parser.parseResultSet(resultSet, {
  skipHeaderRow: 'auto',
  headerRowDetectionStrategy: 'safe',
});
```

### `unavailableResultBehavior`

When the `ResultSet` is `undefined` or headers cannot be determined.

- `'silent'` (default): Return `[]` / yield nothing.
- `'throw'`: Throw an error describing the reason.

Does **not** apply when headers are available and `Rows` is simply empty.

```typescript
parser.parseResultSet(undefined, { unavailableResultBehavior: 'throw' });
```

### `maxRows` / `maxRowsExceededBehavior`

Cap how many data rows are returned (after header-row skipping).

- `maxRows`: non-negative integer limit. Omit for no limit.
- `maxRowsExceededBehavior`:
  - `'truncate'` (default): return/yield only the first `maxRows` rows
  - `'throw'`: throw before producing rows when the data row count exceeds `maxRows`

```typescript
parser.parseResultSet(resultSet, { maxRows: 1000 });
parser.parseResultSet(resultSet, {
  maxRows: 1000,
  maxRowsExceededBehavior: 'throw',
});
```

## API

### Types

- **`ParsedRow`**: `Record<string, string | null>` with an optional `__extra` field.
- **`TypedParsedRow`**: row values converted from `ColumnInfo.Type`.
- **`RowParser<T>`**: `(row: ParsedRow) => T | null` — return `null` to exclude the row.
- **`ColumnCountMismatchBehavior`**: `'silent' | 'throw' | 'warn' | 'extra'`.
- **`UnavailableResultBehavior`**: `'silent' | 'throw'`.
- **`MaxRowsExceededBehavior`**: `'truncate' | 'throw'`.
- **`ParseResultSetUnavailableReason`**: `'result-set-undefined' | 'headers-unavailable'`.
- **`ParseResultSetDiagnostics`**: includes `unavailableReason`, header decision, row counts, and `truncatedByMaxRows`.
- **`ParserReusePolicy`**: `'paginate' | 'fresh-each-parse'`.
- **`AthenaQueryResultParserOptions`**: construction options (`reusePolicy`).
- **`EXTRA_COLUMNS_KEY`**: `'__extra'`.
- **`toNumber` / `toBoolean` / `toDate`**: safe conversion helpers.

### Class: `AthenaQueryResultParser`

| Method | Description |
|--------|-------------|
| `create(options?)` | Create a parser (same as `new`; documents the pagination workflow). |
| `parseResultSetOnce(resultSet, options?)` | Stateless one-shot parse; returns `ParsedRow[]`. |
| `parseResultSetDetailedOnce(resultSet, options?)` | Stateless one-shot parse with diagnostics. |
| `parseResultSetIterOnce(resultSet, options?)` | Stateless one-shot lazy parse. |
| `parseResultSetWithOnce(resultSet, rowParser, options?)` | Stateless one-shot parse with a row mapper. |
| `getReusePolicy()` | Configured `ParserReusePolicy`. |
| `hasActiveQueryState()` | Whether headers / header-dropped / last decision are set (hint to `reset`). |
| `initHeaders(columnInfo)` | Set headers from `ColumnInfo` (no-op if already set). |
| `getHeaders()` | Current headers or `null` until initialized. |
| `getLastHeaderRowDecision()` | Last header-row decision. |
| `parseResultSet(resultSet, options?)` | Parse rows; returns `ParsedRow[]`. |
| `parseResultSetDetailed(resultSet, options?)` | Parse rows plus diagnostics. |
| `parseResultSetIter(resultSet, options?)` | Lazily yield parsed rows. |
| `parseResultSetWith<T>(resultSet, rowParser, options?)` | Parse and transform; `null` results are filtered out. |
| `reset()` | Clear state before a different query (`'paginate'` mode). |

### Static methods (also exported as standalone)

- **`headersFromMeta(columnInfo, options?)`**: Build header array from `ColumnInfo`.
- **`rowToObject(row, headers, options?)`**: Convert one `Row` to a `ParsedRow`.
- **`rowToTypedObject(row, headers, columnInfo, options?)`**: Convert one `Row` using `ColumnInfo.Type`.
- **`isHeaderRow(row, headers)`**: Whether the row's cells match the headers.
- **`parseResultSetOnce` / `parseResultSetDetailedOnce` / `parseResultSetIterOnce` / `parseResultSetWithOnce`**: Stateless one-shot helpers.

## Requirements

- Node.js >= 20
- TypeScript (for types)
- `@aws-sdk/client-athena` (v3)

## License

This project is licensed under the Apache-2.0 License.
