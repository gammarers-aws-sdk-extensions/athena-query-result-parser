# Athena Query Result Parser

A small TypeScript library that parses [Amazon Athena](https://aws.amazon.com/athena/) query result `ResultSet` objects (from `@aws-sdk/client-athena`) into header-based row objects. It handles metadata-driven headers, skips the header row when present, and supports custom row transformers.

## Features

- **Header-based parsing**: Builds column names from `ResultSetMetadata.ColumnInfo` and maps each row to a key-value object.
- **Header row handling**: Automatically detects and skips the first row when it matches the header (once per parser instance).
- **Static helpers**: `headersFromMeta`, `rowToObject`, and `isHeaderRow` are exported for use without a parser instance.
- **Custom row parsing**: `parseResultSetWith<T>()` lets you transform each row with a custom function; rows that return `null` are filtered out.
- **Reusable parser**: Call `reset()` to clear state when reusing the parser for a new query.

## Installation

```bash
npm install athena-query-result-parser
# or
yarn add athena-query-result-parser
```

**Peer dependency**: `@aws-sdk/client-athena` (v3). The library uses its types (`Row`, `ColumnInfo`, `ResultSet`).

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

The first row is skipped when it exactly matches the header (e.g. Athena sometimes returns a header row in `Rows`).

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
| `parseResultSet(resultSet)` | Parse rows from a `ResultSet`; returns `ParsedRow[]`. Skips header row once per instance. |
| `parseResultSetWith<T>(resultSet, rowParser)` | Parse and transform with `rowParser`; returns `T[]` (nulls filtered out). |
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

This project is licensed under the Apache-2.0 License.
