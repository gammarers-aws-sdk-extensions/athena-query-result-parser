import type { Row, ColumnInfo, ResultSet } from '@aws-sdk/client-athena';
import {
  AthenaQueryResultParser,
  headersFromMeta,
  rowToObject,
  isHeaderRow,
  EXTRA_COLUMNS_KEY,
  rowToTypedObject,
  toNumber,
  toBoolean,
  toDate,
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
  describe('value conversion utilities', () => {
    it('toNumber should return null for null/empty/unparseable values', () => {
      expect(toNumber(null)).toBeNull();
      expect(toNumber('')).toBeNull();
      expect(toNumber('   ')).toBeNull();
      expect(toNumber('not-a-number')).toBeNull();
    });

    it('toNumber should parse finite numbers', () => {
      expect(toNumber('0')).toBe(0);
      expect(toNumber('  1.25 ')).toBe(1.25);
      expect(toNumber('-10')).toBe(-10);
    });

    it('toBoolean should return null for null/empty/unrecognized values', () => {
      expect(toBoolean(null)).toBeNull();
      expect(toBoolean('')).toBeNull();
      expect(toBoolean('   ')).toBeNull();
      expect(toBoolean('yes')).toBeNull();
      expect(toBoolean('1')).toBeNull();
    });

    it('toBoolean should parse true/false (case-insensitive)', () => {
      expect(toBoolean('true')).toBe(true);
      expect(toBoolean('TRUE')).toBe(true);
      expect(toBoolean(' false ')).toBe(false);
    });

    it('toDate should return null for null/empty/unparseable values', () => {
      expect(toDate(null)).toBeNull();
      expect(toDate('')).toBeNull();
      expect(toDate('   ')).toBeNull();
      expect(toDate('not-a-date')).toBeNull();
    });

    it('toDate should parse ISO-like timestamps', () => {
      const d = toDate('2026-01-01T00:00:00.000Z');
      expect(d).not.toBeNull();
      expect(d!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
  });

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

      it('should pad with null when row has fewer cells than headers (silent default)', () => {
        const row = makeRow(['a']);
        const headers = ['h1', 'h2', 'h3'];
        expect(rowToObject(row, headers)).toEqual({ h1: 'a', h2: null, h3: null });
      });

      it('should discard surplus cells when row has more cells than headers (silent default)', () => {
        const row = makeRow(['a', 'b', 'c', 'd']);
        const headers = ['h1', 'h2'];
        expect(rowToObject(row, headers)).toEqual({ h1: 'a', h2: 'b' });
      });

      it('should throw in strict mode when column counts differ', () => {
        const row = makeRow(['a']);
        const headers = ['h1', 'h2'];
        expect(() =>
          rowToObject(row, headers, { columnCountMismatchBehavior: 'throw' }),
        ).toThrow('Column count mismatch: expected 2 column(s) but row has 1');
      });

      it('should include row index in strict mode error when provided', () => {
        const row = makeRow(['a', 'b', 'c']);
        const headers = ['h1', 'h2'];
        expect(() =>
          rowToObject(row, headers, {
            columnCountMismatchBehavior: 'throw',
            rowIndex: 3,
          }),
        ).toThrow('Column count mismatch at row index 3: expected 2 column(s) but row has 3');
      });

      it('should warn in warn mode when column counts differ', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const row = makeRow(['a']);
        const headers = ['h1', 'h2'];
        expect(
          rowToObject(row, headers, { columnCountMismatchBehavior: 'warn' }),
        ).toEqual({ h1: 'a', h2: null });
        expect(warnSpy).toHaveBeenCalledWith(
          'Column count mismatch: expected 2 column(s) but row has 1',
        );
        warnSpy.mockRestore();
      });

      it('should store surplus cells under __extra in extra mode', () => {
        const row = makeRow(['a', 'b', 'c', 'd']);
        const headers = ['h1', 'h2'];
        expect(
          rowToObject(row, headers, { columnCountMismatchBehavior: 'extra' }),
        ).toEqual({ h1: 'a', h2: 'b', [EXTRA_COLUMNS_KEY]: ['c', 'd'] });
      });

      it('should not add __extra when row length matches headers in extra mode', () => {
        const row = makeRow(['a', 'b']);
        const headers = ['h1', 'h2'];
        expect(
          rowToObject(row, headers, { columnCountMismatchBehavior: 'extra' }),
        ).toEqual({ h1: 'a', h2: 'b' });
      });
    });

    describe('rowToTypedObject', () => {
      it('should convert values based on ColumnInfo.Type', () => {
        const row = makeRow(['1', 'true', '2026-01-01T00:00:00.000Z', 'Alice']);
        const headers = ['id', 'is_active', 'created_at', 'name'];
        const columnInfo = makeColumnInfoWithTypes([
          { name: 'id', type: 'bigint' },
          { name: 'is_active', type: 'boolean' },
          { name: 'created_at', type: 'timestamp' },
          { name: 'name', type: 'varchar' },
        ]);

        const obj = rowToTypedObject(row, headers, columnInfo);
        expect(obj.id).toBe(1);
        expect(obj.is_active).toBe(true);
        expect(obj.created_at).toBeInstanceOf(Date);
        expect((obj.created_at as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(obj.name).toBe('Alice');
      });

      it('should keep original string when unparseable (default)', () => {
        const row = makeRow(['not-a-number']);
        const headers = ['n'];
        const columnInfo = makeColumnInfoWithTypes([{ name: 'n', type: 'bigint' }]);
        expect(rowToTypedObject(row, headers, columnInfo)).toEqual({ n: 'not-a-number' });
      });

      it('should convert unparseable values to null when configured', () => {
        const row = makeRow(['not-a-number']);
        const headers = ['n'];
        const columnInfo = makeColumnInfoWithTypes([{ name: 'n', type: 'bigint' }]);
        expect(
          rowToTypedObject(row, headers, columnInfo, { unparseableValueBehavior: 'null' }),
        ).toEqual({ n: null });
      });

      it('should store surplus cells under __extra in extra mode', () => {
        const row = makeRow(['1', 'Alice', 'surplus1', 'surplus2']);
        const headers = ['id', 'name'];
        const columnInfo = makeColumnInfoWithTypes([
          { name: 'id', type: 'bigint' },
          { name: 'name', type: 'varchar' },
        ]);
        expect(
          rowToTypedObject(row, headers, columnInfo, { columnCountMismatchBehavior: 'extra' }),
        ).toEqual({ id: 1, name: 'Alice', [EXTRA_COLUMNS_KEY]: ['surplus1', 'surplus2'] });
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

    it('should record forced decision when skipHeaderRow is true but Rows is empty', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], []);
      const rows = parser.parseResultSet(resultSet, { skipHeaderRow: true });
      expect(rows).toEqual([]);
      expect(parser.getLastHeaderRowDecision()).toEqual({
        mode: 'forced',
        skipped: false,
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

    it('should isolate each parse when reusePolicy is fresh-each-parse', () => {
      const parser = new AthenaQueryResultParser({
        reusePolicy: 'fresh-each-parse',
      });
      const resultSet = makeResultSet(
        ['id'],
        [
          ['id'],
          ['1'],
        ],
      );
      expect(parser.parseResultSet(resultSet)).toEqual([{ id: '1' }]);
      // Without fresh-each-parse, the second call would keep the header-like row.
      expect(parser.parseResultSet(resultSet)).toEqual([{ id: '1' }]);
      expect(parser.getReusePolicy()).toBe('fresh-each-parse');
    });

    it('should expose active query state for reset guidance', () => {
      const parser = AthenaQueryResultParser.create();
      expect(parser.hasActiveQueryState()).toBe(false);
      parser.parseResultSet(makeResultSet(['id'], [['1']]), {
        skipHeaderRow: false,
      });
      expect(parser.hasActiveQueryState()).toBe(true);
      parser.reset();
      expect(parser.hasActiveQueryState()).toBe(false);
    });

    it('should parse independently via parseResultSetOnce', () => {
      const resultSet = makeResultSet(
        ['id'],
        [
          ['id'],
          ['1'],
        ],
      );
      expect(AthenaQueryResultParser.parseResultSetOnce(resultSet)).toEqual([
        { id: '1' },
      ]);
      expect(AthenaQueryResultParser.parseResultSetOnce(resultSet)).toEqual([
        { id: '1' },
      ]);
    });

    it('should support detailed/iter/with once helpers', () => {
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['id', 'name'],
          ['1', 'Alice'],
        ],
      );
      const detailed = AthenaQueryResultParser.parseResultSetDetailedOnce(resultSet);
      expect(detailed.rows).toEqual([{ id: '1', name: 'Alice' }]);
      expect(detailed.diagnostics.headerRowDecision?.skipped).toBe(true);

      expect([...AthenaQueryResultParser.parseResultSetIterOnce(resultSet)]).toEqual([
        { id: '1', name: 'Alice' },
      ]);

      const mapped = AthenaQueryResultParser.parseResultSetWithOnce(
        resultSet,
        (row) => row.id,
      );
      expect(mapped).toEqual(['1']);
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

    it('should not skip in safe strategy when complex column types are always parseable', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSetWithTypes(
        [
          { name: 'payload', type: 'array' },
          { name: 'name', type: 'varchar' },
        ],
        [
          ['payload', 'name'],
          ['[1]', 'Alice'],
        ],
      );
      const rows = parser.parseResultSet(resultSet, {
        skipHeaderRow: 'auto',
        headerRowDetectionStrategy: 'safe',
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ payload: 'payload', name: 'name' });
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

    it('should expose unavailableReason via parseResultSetDetailed for undefined ResultSet', () => {
      const parser = new AthenaQueryResultParser();
      const result = parser.parseResultSetDetailed(undefined);
      expect(result.rows).toEqual([]);
      expect(result.diagnostics).toEqual({
        unavailableReason: 'result-set-undefined',
        headerRowDecision: null,
        headers: null,
        rawRowCount: 0,
        parsedRowCount: 0,
        truncatedByMaxRows: false,
      });
    });

    it('should expose unavailableReason via parseResultSetDetailed when metadata is missing', () => {
      const parser = new AthenaQueryResultParser();
      const result = parser.parseResultSetDetailed({ Rows: [makeRow(['1'])] });
      expect(result.rows).toEqual([]);
      expect(result.diagnostics.unavailableReason).toBe('headers-unavailable');
      expect(result.diagnostics.headers).toBeNull();
      expect(result.diagnostics.parsedRowCount).toBe(0);
      expect(result.diagnostics.truncatedByMaxRows).toBe(false);
    });

    it('should report null unavailableReason for a genuine empty Rows array', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id', 'name'], []);
      const result = parser.parseResultSetDetailed(resultSet);
      expect(result.rows).toEqual([]);
      expect(result.diagnostics.unavailableReason).toBeNull();
      expect(result.diagnostics.headers).toEqual(['id', 'name']);
      expect(result.diagnostics.rawRowCount).toBe(0);
      expect(result.diagnostics.parsedRowCount).toBe(0);
      expect(result.diagnostics.truncatedByMaxRows).toBe(false);
      expect(result.diagnostics.headerRowDecision).toEqual({
        mode: 'auto',
        skipped: false,
        strategy: 'exact',
        reason: 'no-rows',
      });
    });

    it('should throw when unavailableResultBehavior is throw and ResultSet is undefined', () => {
      const parser = new AthenaQueryResultParser();
      expect(() =>
        parser.parseResultSet(undefined, { unavailableResultBehavior: 'throw' }),
      ).toThrow('ResultSet is undefined; cannot parse rows.');
    });

    it('should throw when unavailableResultBehavior is throw and headers are unavailable', () => {
      const parser = new AthenaQueryResultParser();
      expect(() =>
        parser.parseResultSet(
          { Rows: [] },
          { unavailableResultBehavior: 'throw' },
        ),
      ).toThrow(
        'Headers are unavailable: ResultSet has no ColumnInfo metadata and headers have not been initialized.',
      );
    });

    it('should not throw for genuine empty Rows when unavailableResultBehavior is throw', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], []);
      expect(
        parser.parseResultSet(resultSet, { unavailableResultBehavior: 'throw' }),
      ).toEqual([]);
    });

    it('should include header decision and counts in parseResultSetDetailed diagnostics', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['id', 'name'],
          ['1', 'Alice'],
        ],
      );
      const result = parser.parseResultSetDetailed(resultSet);
      expect(result.rows).toEqual([{ id: '1', name: 'Alice' }]);
      expect(result.diagnostics.unavailableReason).toBeNull();
      expect(result.diagnostics.rawRowCount).toBe(2);
      expect(result.diagnostics.parsedRowCount).toBe(1);
      expect(result.diagnostics.truncatedByMaxRows).toBe(false);
      expect(result.diagnostics.headerRowDecision?.skipped).toBe(true);
    });

    it('should truncate rows when maxRows is set', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id'],
        [['1'], ['2'], ['3'], ['4']],
      );
      const result = parser.parseResultSetDetailed(resultSet, {
        maxRows: 2,
        skipHeaderRow: false,
      });
      expect(result.rows).toEqual([{ id: '1' }, { id: '2' }]);
      expect(result.diagnostics.parsedRowCount).toBe(2);
      expect(result.diagnostics.truncatedByMaxRows).toBe(true);
    });

    it('should not truncate when row count is within maxRows', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id'],
        [['1'], ['2']],
      );
      const result = parser.parseResultSetDetailed(resultSet, {
        maxRows: 10,
        skipHeaderRow: false,
      });
      expect(result.rows).toEqual([{ id: '1' }, { id: '2' }]);
      expect(result.diagnostics.parsedRowCount).toBe(2);
      expect(result.diagnostics.truncatedByMaxRows).toBe(false);
    });

    it('should throw when maxRows is exceeded and maxRowsExceededBehavior is throw', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id'],
        [['1'], ['2'], ['3']],
      );
      expect(() =>
        parser.parseResultSet(resultSet, {
          maxRows: 2,
          maxRowsExceededBehavior: 'throw',
          skipHeaderRow: false,
        }),
      ).toThrow('Parsed row count (3) exceeds maxRows (2).');
    });

    it('should reject invalid maxRows values', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(['id'], [['1']]);
      expect(() =>
        parser.parseResultSet(resultSet, { maxRows: -1, skipHeaderRow: false }),
      ).toThrow('maxRows must be a non-negative integer when specified.');
      expect(() =>
        parser.parseResultSet(resultSet, { maxRows: 1.5, skipHeaderRow: false }),
      ).toThrow('maxRows must be a non-negative integer when specified.');
    });

    it('should yield rows lazily via parseResultSetIter', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [
          ['id', 'name'],
          ['1', 'Alice'],
          ['2', 'Bob'],
        ],
      );
      const rows = [...parser.parseResultSetIter(resultSet)];
      expect(rows).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]);
    });

    it('should honor maxRows in parseResultSetIter', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id'],
        [['1'], ['2'], ['3']],
      );
      const rows = [
        ...parser.parseResultSetIter(resultSet, {
          maxRows: 2,
          skipHeaderRow: false,
        }),
      ];
      expect(rows).toEqual([{ id: '1' }, { id: '2' }]);
    });

    it('should yield nothing from parseResultSetIter for undefined ResultSet', () => {
      const parser = new AthenaQueryResultParser();
      expect([...parser.parseResultSetIter(undefined)]).toEqual([]);
    });

    it('should throw from parseResultSetIter when unavailableResultBehavior is throw', () => {
      const parser = new AthenaQueryResultParser();
      expect(() => [
        ...parser.parseResultSetIter(undefined, {
          unavailableResultBehavior: 'throw',
        }),
      ]).toThrow('ResultSet is undefined; cannot parse rows.');
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

    it('should throw when parseResultSet encounters a short row in strict mode', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [['1', 'Alice'], ['2']],
      );
      expect(() =>
        parser.parseResultSet(resultSet, { columnCountMismatchBehavior: 'throw' }),
      ).toThrow('Column count mismatch at row index 1: expected 2 column(s) but row has 1');
    });

    it('should store surplus cells via parseResultSet in extra mode', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id', 'name'],
        [['1', 'Alice', 'extra1', 'extra2']],
      );
      const rows = parser.parseResultSet(resultSet, {
        columnCountMismatchBehavior: 'extra',
        skipHeaderRow: false,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        id: '1',
        name: 'Alice',
        [EXTRA_COLUMNS_KEY]: ['extra1', 'extra2'],
      });
    });

    it('should pass columnCountMismatchBehavior through parseResultSetWith', () => {
      const parser = new AthenaQueryResultParser();
      const resultSet = makeResultSet(
        ['id'],
        [['1', 'surplus']],
      );
      const results = parser.parseResultSetWith(
        resultSet,
        (row: ParsedRow) => row,
        { columnCountMismatchBehavior: 'extra', skipHeaderRow: false },
      );
      expect(results[0]).toEqual({ id: '1', [EXTRA_COLUMNS_KEY]: ['surplus'] });
    });
  });
});
