# Athena Query Result Parser

[![npm version](https://img.shields.io/npm/v/athena-query-result-parser.svg)](https://www.npmjs.com/package/athena-query-result-parser)
[![license](https://img.shields.io/npm/l/athena-query-result-parser.svg)](https://www.npmjs.com/package/athena-query-result-parser)

A small TypeScript library that parses [Amazon Athena](https://aws.amazon.com/athena/) query result `ResultSet` objects (from `@aws-sdk/client-athena`) into header-based row objects. It handles metadata-driven headers, skips the header row when present, and supports custom row transformers.

## Features

- **Header-based parsing**: Builds column names from `ResultSetMetadata.ColumnInfo` and maps each row to a key-value object.
- **Header row handling**: `skipHeaderRow` option lets callers choose `'auto' | true | false` (`'auto'` by default).
- **Robust header auto-detection**: `headerRowDetectionStrategy` option helps reduce false positives when using `skipHeaderRow: 'auto'`.
- **Duplicate column name handling**: `duplicateColumnNames` option lets callers choose how to handle duplicate `ColumnInfo.Name` values (`'throw' | 'suffix' | 'allow'`).
- **Static helpers**: `headersFromMeta`, `rowToObject`, and `isHeaderRow` are exported for use without a parser instance.
- **Custom row parsing**: `parseResultSetWith<T>()` lets you transform each row with a custom function; rows that return `null` are filtered out.
- **Reusable parser**: Call `reset()` to clear state when reusing the parser for a new query.

## Installation

```bash
npm install athena-query-result-parser
```

```bash
yarn add athena-query-result-parser
```

**Dependency**: `@aws-sdk/client-athena` (v3). The library uses its types (`Row`, `ColumnInfo`, `ResultSet`).

## Usage

### Basic parsing

```typescript
import { AthenaQueryResultParser } from 'athena-query-result-parser';
import type { ResultSet } from '@aws-sdk/client-athena';

const parser = new AthenaQueryResultParser();
const resultSet: ResultSet = getAthenaResultSet(); // from GetQueryResults, etc.

const rows = parser.parseResultSet(resultSet);
// rows: Array<Record<string, string | null>>
// e.g. [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }]
```

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

### Custom row parser

Use `parseResultSetWith` to convert each row to a custom type and drop rows that return `null`:

```typescript
import { AthenaQueryResultParser, type ParsedRow } from 'athena-query-result-parser';

type User = { id: string; name: string };

const parser = new AthenaQueryResultParser();
const rowParser = (row: ParsedRow): User | null => {
  if (row.name == null || row.name === '') return null;
  return { id: row.id ?? '', name: row.name };
};

const users = parser.parseResultSetWith(resultSet, rowParser);
// users: User[] (rows with empty name are omitted)
```

## Options

### `skipHeaderRow`

Control how the parser handles the first row in `Rows`.

- `'auto'` (default): Skip the first row only when it exactly matches the derived headers (once per parser instance).
- `true`: Skip the first row **only when it looks like a header row**. By default, this throws if the first row does not look like a header row (to prevent accidental data loss).
- `false`: Never skip the first row.

```typescript
parser.parseResultSet(resultSet); // default: { skipHeaderRow: 'auto' }
parser.parseResultSet(resultSet, { skipHeaderRow: true }); // throws on mismatch by default
parser.parseResultSet(resultSet, {
  skipHeaderRow: true,
  forcedSkipHeaderRowMismatchBehavior: 'keep',
});
parser.parseResultSet(resultSet, { skipHeaderRow: false });

parser.parseResultSetWith(resultSet, rowParser, { skipHeaderRow: false });
```

### `skipFirstRow`

Drop the first row unconditionally (explicit, potentially lossy).

Use this when you truly want to drop the first row regardless of its contents.

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
parser.parseResultSet(resultSet, {
  skipHeaderRow: true,
  forcedSkipHeaderRowMismatchBehavior: 'keep',
});
parser.parseResultSet(resultSet, {
  skipHeaderRow: true,
  forcedSkipHeaderRowMismatchBehavior: 'skip',
});
```

### `duplicateColumnNames`

Control what happens when Athena returns duplicate `ColumnInfo.Name` values.

- `'throw'` (default): Throw an error listing duplicate names. This prevents silent data loss caused by key overwrites.
- `'suffix'`: Make column names unique by suffixing duplicates like `col`, `col_2`, `col_3`, ...
- `'allow'`: Keep duplicate names as-is (later columns overwrite earlier ones in `rowToObject`).

```typescript
parser.parseResultSet(resultSet); // default: { duplicateColumnNames: 'throw' }
parser.parseResultSet(resultSet, { duplicateColumnNames: 'suffix' });
parser.parseResultSet(resultSet, { duplicateColumnNames: 'allow' });

parser.parseResultSetWith(resultSet, rowParser, { duplicateColumnNames: 'suffix' });
```

### `headerRowDetectionStrategy`

Controls how header-row auto detection behaves when `skipHeaderRow` is `'auto'`.

- `'exact'` (default): Skip the first row when it exactly matches the derived headers (legacy behavior).
- `'safe'`: Skip only when the first row matches headers **and** there is type-based evidence (from `ColumnInfo.Type`) that the row is unlikely to be valid data (reduces false positives).

```typescript
parser.parseResultSet(resultSet, { skipHeaderRow: 'auto', headerRowDetectionStrategy: 'exact' });
parser.parseResultSet(resultSet, { skipHeaderRow: 'auto', headerRowDetectionStrategy: 'safe' });
```

### Headers and reset

Headers are derived from `ResultSetMetadata.ColumnInfo` on the first `parseResultSet` (or you can set them with `initHeaders`). Use `reset()` when reusing the same parser for another query:

```typescript
parser.parseResultSet(resultSet1);
// ...
parser.reset();
parser.parseResultSet(resultSet2);
```

### Static helpers

You can use the static functions without creating a parser:

```typescript
import {
  headersFromMeta,
  rowToObject,
  isHeaderRow,
} from 'athena-query-result-parser';
import type { ColumnInfo, Row } from '@aws-sdk/client-athena';

const headers = headersFromMeta(columnInfo);           // string[]
const obj = rowToObject(row, headers);                 // ParsedRow
const isHeader = isHeaderRow(row, headers);            // boolean
```

## API

### Types

- **`ParsedRow`**: `Record<string, string | null>` — one parsed row (column name → value or `null`).
- **`RowParser<T>`**: `(row: ParsedRow) => T | null` — custom row transformer; return `null` to exclude the row.

### Class: `AthenaQueryResultParser`

| Method | Description |
|--------|-------------|
| `initHeaders(columnInfo)` | Set headers from `ColumnInfo` (no-op if already set). |
| `getHeaders()` | Current headers or `null` until initialized. |
| `getLastHeaderRowDecision()` | Last header-row decision (useful when `skipHeaderRow` is `'auto'`). |
| `parseResultSet(resultSet, options?)` | Parse rows from a `ResultSet`; returns `ParsedRow[]`. `options.skipHeaderRow` supports `'auto' | true | false`. |
| `parseResultSetWith<T>(resultSet, rowParser, options?)` | Parse and transform with `rowParser`; returns `T[]` (nulls filtered out). `options` is forwarded to `parseResultSet`. |
| `reset()` | Clear headers and internal state for reuse. |

### Static methods (also exported as standalone)

- **`headersFromMeta(columnInfo)`**: Build header array from `ColumnInfo`; missing names become `col_0`, `col_1`, …
- **`rowToObject(row, headers)`**: Convert one `Row` to a `ParsedRow` using the given headers.
- **`isHeaderRow(row, headers)`**: Return `true` if the row’s cells match the headers.

## Requirements

- Node.js >= 20
- TypeScript (for types)
- `@aws-sdk/client-athena` (v3)

## License

This project is licensed under the (Apache-2.0) License.
