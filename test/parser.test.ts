import type { Row, ColumnInfo, ResultSet } from '@aws-sdk/client-athena';
import {
  AthenaQueryResultParser,
  headersFromMeta,
  rowToObject,
  isHeaderRow,
  type ParsedRow,
} from '../src';

function makeColumnInfo(names: string[]): ColumnInfo[] {
  return names.map((Name) => ({ Name, Type: 'varchar' }));
}

function makeRow(values: (string | null)[]): Row {
  return {
    Data: values.map((v) => (v != null ? { VarCharValue: v } : {})),
  };
}

function makeResultSet(columnNames: string[], rows: (string | null)[][]): ResultSet {
  const columnInfo = makeColumnInfo(columnNames);
  return {
    ResultSetMetadata: { ColumnInfo: columnInfo },
    Rows: rows.map((r) => makeRow(r)),
  };
}

describe('AthenaQueryResultParser', () => {
  describe('static methods', () => {
    describe('headersFromMeta', () => {
      it('should return header array from ColumnInfo', () => {
        const columnInfo = makeColumnInfo(['a', 'b', 'c']);
        expect(headersFromMeta(columnInfo)).toEqual(['a', 'b', 'c']);
      });

      it('should fall back to col_0, col_1, ... when Name is missing', () => {
        const columnInfo = [{}, {}, {}] as ColumnInfo[];
        expect(headersFromMeta(columnInfo)).toEqual(['col_0', 'col_1', 'col_2']);
      });
    });

    describe('rowToObject', () => {
      it('should return key-value object from Row and headers', () => {
        const row = makeRow(['v1', 'v2', 'v3']);
        const headers = ['x', 'y', 'z'];
        expect(rowToObject(row, headers)).toEqual({ x: 'v1', y: 'v2', z: 'v3' });
      });

      it('should convert missing cells to null', () => {
        const row = makeRow(['a', null, 'c']);
        const headers = ['h1', 'h2', 'h3'];
        expect(rowToObject(row, headers)).toEqual({ h1: 'a', h2: null, h3: 'c' });
      });
    });

    describe('isHeaderRow', () => {
      it('should return true when row matches headers', () => {
        const headers = ['a', 'b', 'c'];
        const row = makeRow(['a', 'b', 'c']);
        expect(isHeaderRow(row, headers)).toBe(true);
      });

      it('should return false when row does not match headers', () => {
        const headers = ['a', 'b', 'c'];
        const row = makeRow(['x', 'y', 'z']);
        expect(isHeaderRow(row, headers)).toBe(false);
      });

      it('should return false for empty row', () => {
        const headers = ['a'];
        const row = makeRow([]);
        expect(isHeaderRow(row, headers)).toBe(false);
      });
    });
  });

  describe('instance', () => {
    it('should return null from getHeaders before initHeaders', () => {
      const parser = new AthenaQueryResultParser();
      expect(parser.getHeaders()).toBeNull();
    });

    it('should set headers via initHeaders and return them via getHeaders', () => {
      const parser = new AthenaQueryResultParser();
      const columnInfo = makeColumnInfo(['id', 'name']);
      parser.initHeaders(columnInfo);
      expect(parser.getHeaders()).toEqual(['id', 'name']);
    });

    it('should convert ResultSet to ParsedRow array with parseResultSet', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['id', 'name'], // header row (skipped)
          ['1', 'Alice'],
          ['2', 'Bob'],
        ],
      );
      const rows = parser.parseResultSet(resultSet);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: '1', name: 'Alice' });
      expect(rows[1]).toEqual({ id: '2', name: 'Bob' });
    });

    it('should force skip first row with skipHeaderRow: true', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['1', 'Alice'],
          ['2', 'Bob'],
        ],
      );
      const rows = parser.parseResultSet(resultSet, { skipHeaderRow: true });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ id: '2', name: 'Bob' });
    });

    it('should disable header skipping with skipHeaderRow: false', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['id', 'name'], // header-like row
          ['1', 'Alice'],
        ],
      );
      const rows = parser.parseResultSet(resultSet, { skipHeaderRow: false });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 'id', name: 'name' });
      expect(rows[1]).toEqual({ id: '1', name: 'Alice' });
    });

    it('should return empty array when parseResultSet is given undefined', () => {
      const parser = new AthenaQueryResultParser();
      expect(parser.parseResultSet(undefined)).toEqual([]);
    });

    it('should apply custom parser with parseResultSetWith and filter out nulls', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [['1', 'Alice'], ['2', 'Bob'], ['3', '']],
      );
      type Item = { id: string; name: string };
      const rowParser = (row: ParsedRow): Item | null => {
        if (!row.name) return null;
        return { id: row.id ?? '', name: row.name };
      };
      const results = parser.parseResultSetWith(resultSet, rowParser);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: '1', name: 'Alice' });
      expect(results[1]).toEqual({ id: '2', name: 'Bob' });
    });

    it('should pass skipHeaderRow option through parseResultSetWith', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['id', 'name'], // header-like row
          ['1', 'Alice'],
        ],
      );
      const results = parser.parseResultSetWith(
        resultSet,
        (row) => row,
        { skipHeaderRow: false },
      );
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 'id', name: 'name' });
      expect(results[1]).toEqual({ id: '1', name: 'Alice' });
    });

    it('should clear headers and state on reset', () => {
      const parser = new AthenaQueryResultParser();
      parser.initHeaders(makeColumnInfo(['a', 'b']));
      expect(parser.getHeaders()).toEqual(['a', 'b']);
      parser.reset();
      expect(parser.getHeaders()).toBeNull();
    });
  });
});
