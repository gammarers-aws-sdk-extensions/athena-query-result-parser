import type { Row, ColumnInfo, ResultSet } from '@aws-sdk/client-athena';
import {
  AthenaQueryResultParser,
  headersFromMeta,
  rowToObject,
  isHeaderRow,
  type ParsedRow,
} from '../src';

const makeColumnInfo = (names: string[]): ColumnInfo[] =>
  names.map((Name) => ({ Name, Type: 'varchar' }));

const makeColumnInfoWithTypes = (
  cols: { name: string; type: string }[],
): ColumnInfo[] => cols.map(({ name, type }) => ({ Name: name, Type: type }));

const makeRow = (values: (string | null)[]): Row => ({
  Data: values.map((v) => (v != null ? { VarCharValue: v } : {})),
});

const makeResultSet = (columnNames: string[], rows: (string | null)[][]): ResultSet => {
  const columnInfo = makeColumnInfo(columnNames);
  return {
    ResultSetMetadata: { ColumnInfo: columnInfo },
    Rows: rows.map((r) => makeRow(r)),
  };
};

const makeResultSetWithTypes = (
  cols: { name: string; type: string }[],
  rows: (string | null)[][],
): ResultSet => {
  const columnInfo = makeColumnInfoWithTypes(cols);
  return {
    ResultSetMetadata: { ColumnInfo: columnInfo },
    Rows: rows.map((r) => makeRow(r)),
  };
};

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

      it('should throw by default when duplicate column names exist', () => {
        const columnInfo = makeColumnInfo(['a', 'a']);
        expect(() => headersFromMeta(columnInfo)).toThrow(
          'Duplicate column names detected',
        );
      });

      it('should suffix duplicate column names when configured', () => {
        const columnInfo = makeColumnInfo(['a', 'a', 'a']);
        expect(
          headersFromMeta(columnInfo, { duplicateColumnNames: 'suffix' }),
        ).toEqual(['a', 'a_2', 'a_3']);
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

    it('should record auto header-row decision', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['id', 'name'], // header row (skipped)
          ['1', 'Alice'],
        ],
      );
      parser.parseResultSet(resultSet);
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'auto',
        skipped: true,
        strategy: 'exact',
        reason: 'exact-match',
      });
    });

    it('should record disabled decision when skipHeaderRow is false', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], [['id']]);
      parser.parseResultSet(resultSet, { skipHeaderRow: false });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'disabled',
        skipped: false,
        reason: 'skipHeaderRow:false',
      });
    });

    it('should record forced decision when skipHeaderRow is true', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], [['id'], ['1']]);
      parser.parseResultSet(resultSet, { skipHeaderRow: true });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'forced',
        skipped: true,
        reason: 'skipHeaderRow:true',
      });
    });

    it('should throw by default when skipHeaderRow is true but first row is not a header row', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], [['1'], ['2']]);
      expect(() => parser.parseResultSet(resultSet, { skipHeaderRow: true })).toThrow(
        'skipHeaderRow:true was specified but the first row does not look like a header row',
      );
    });

    it('should keep the first row when skipHeaderRow is true and mismatch behavior is keep', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], [['1'], ['2']]);
      const rows = parser.parseResultSet(resultSet, {
        skipHeaderRow: true,
        forcedSkipHeaderRowMismatchBehavior: 'keep',
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: '1' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'forced',
        skipped: false,
        reason: 'skipHeaderRow:true:not-header-row',
      });
    });

    it('should skip the first row when skipHeaderRow is true and mismatch behavior is skip', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], [['1'], ['2']]);
      const rows = parser.parseResultSet(resultSet, {
        skipHeaderRow: true,
        forcedSkipHeaderRowMismatchBehavior: 'skip',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ id: '2' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'forced',
        skipped: true,
        reason: 'skipHeaderRow:true:not-header-row',
      });
    });

    it('should unconditionally skip the first row when skipFirstRow is true', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], [['1'], ['2']]);
      const rows = parser.parseResultSet(resultSet, { skipFirstRow: true });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ id: '2' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'forced',
        skipped: true,
        reason: 'skipFirstRow:true',
      });
    });

    it('should record no-rows decision when ResultSet has no rows', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet: ResultSet = {
        ResultSetMetadata: { ColumnInfo: makeColumnInfo(['id']) },
        Rows: [],
      };
      parser.parseResultSet(resultSet, { skipHeaderRow: 'auto' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'auto',
        skipped: false,
        strategy: 'exact',
        reason: 'no-rows',
      });
    });

    it('should record already-dropped decision when header was dropped previously', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id'],
        [
          ['id'], // header row (skipped)
          ['1'],
        ],
      );
      parser.parseResultSet(resultSet, { skipHeaderRow: 'auto' });
      // second call in the same parser instance: do not drop again
      parser.parseResultSet(resultSet, { skipHeaderRow: 'auto' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'auto',
        skipped: false,
        strategy: 'exact',
        reason: 'already-dropped',
      });
    });

    it('should avoid false-positive header skipping in safe strategy when all columns are varchar', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['id', 'name'], // could be a legitimate data row
          ['1', 'Alice'],
        ],
      );
      const rows = parser.parseResultSet(resultSet, {
        skipHeaderRow: 'auto',
        headerRowDetectionStrategy: 'safe',
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 'id', name: 'name' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'auto',
        skipped: false,
        strategy: 'safe',
        reason: 'safe:no-type-evidence',
      });
    });

    it('should skip header row in safe strategy when type evidence exists', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSetWithTypes(
        [
          { name: 'id', type: 'bigint' },
          { name: 'name', type: 'varchar' },
        ],
        [
          ['id', 'name'], // header row
          ['1', 'Alice'],
        ],
      );
      const rows = parser.parseResultSet(resultSet, {
        skipHeaderRow: 'auto',
        headerRowDetectionStrategy: 'safe',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ id: '1', name: 'Alice' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'auto',
        skipped: true,
        strategy: 'safe',
        reason: 'safe:type-evidence',
      });
    });

    it('should skip header row in safe strategy for boolean type evidence', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSetWithTypes(
        [
          { name: 'is_active', type: 'boolean' },
          { name: 'name', type: 'varchar' },
        ],
        [
          ['is_active', 'name'], // header row
          ['true', 'Alice'],
        ],
      );
      const rows = parser.parseResultSet(resultSet, {
        skipHeaderRow: 'auto',
        headerRowDetectionStrategy: 'safe',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ is_active: 'true', name: 'Alice' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'auto',
        skipped: true,
        strategy: 'safe',
        reason: 'safe:type-evidence',
      });
    });

    it('should skip header row in safe strategy for timestamp type evidence', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSetWithTypes(
        [
          { name: 'created_at', type: 'timestamp' },
          { name: 'name', type: 'varchar' },
        ],
        [
          ['created_at', 'name'], // header row
          ['2026-01-01 00:00:00.000', 'Alice'],
        ],
      );
      const rows = parser.parseResultSet(resultSet, {
        skipHeaderRow: 'auto',
        headerRowDetectionStrategy: 'safe',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ created_at: '2026-01-01 00:00:00.000', name: 'Alice' });
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'auto',
        skipped: true,
        strategy: 'safe',
        reason: 'safe:type-evidence',
      });
    });

    it('should throw when ResultSet has duplicate column names by default', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['a', 'a'], [['1', '2']]);
      expect(() => parser.parseResultSet(resultSet)).toThrow(
        'Duplicate column names detected',
      );
    });

    it('should suffix duplicate columns when configured via parseResultSet options', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['a', 'a'], [['1', '2']]);
      expect(
        parser.parseResultSet(resultSet, { duplicateColumnNames: 'suffix' })[0],
      ).toEqual({ a: '1', a_2: '2' });
    });

    it('should allow duplicate columns when configured and overwrite earlier values', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['a', 'a'], [['1', '2']]);
      expect(
        parser.parseResultSet(resultSet, { duplicateColumnNames: 'allow' })[0],
      ).toEqual({ a: '2' });
    });

    it('should avoid suffix collisions when column names already contain suffix-like names', () => {
      const columnInfo = makeColumnInfo(['a', 'a', 'a_2', 'a']);
      expect(headersFromMeta(columnInfo, { duplicateColumnNames: 'suffix' })).toEqual([
        'a',
        'a_3',
        'a_2',
        'a_4',
      ]);
    });

    it('should force skip first row with skipFirstRow: true', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['1', 'Alice'],
          ['2', 'Bob'],
        ],
      );
      const rows = parser.parseResultSet(resultSet, { skipFirstRow: true });
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
      expect(parser.getLastHeaderRowDecision()).toBeNull();
    });
  });
});
