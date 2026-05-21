/**
 * ClickHouse skill — query logs/events stored in ClickHouse via its HTTP API.
 *
 * ClickHouse is an increasingly common observability backend (used by SigNoz,
 * OpenObserve, and custom OTLP pipelines). This adapter speaks the HTTP
 * interface using the GET query path, which ClickHouse forces to be
 * **read-only** — so the read-only invariant is enforced by the engine itself.
 *
 * Tools: clickhouse_query, clickhouse_databases, clickhouse_tables,
 *        clickhouse_table_schema, clickhouse_logs_search
 *
 * Enabled when `CLICKHOUSE_URL` is set (e.g. http://clickhouse:8123).
 * Auth: set CLICKHOUSE_AUTH_BASIC=user:password for HTTP Basic.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult, parseDuration } from '../helpers.js';

/** Reject anything that isn't a bare SQL identifier (defends string-built SQL). */
function safeIdent(value: string, label: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Invalid ${label} "${value}" — only letters, digits, and underscore allowed`);
  }
  return value;
}

/** Single-quote escape for SQL string literals. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const chUrl = helpers.env('CLICKHOUSE_URL', 'http://localhost:8123');
  const fetchJSON = helpers.createFetcher('CLICKHOUSE', 'clickhouse');

  /**
   * Run a read-only query over the HTTP GET interface. `default_format=JSON`
   * makes ClickHouse return `{ meta, data, rows, statistics }` for queries with
   * no explicit FORMAT clause, so we never have to mutate the SQL.
   */
  async function runQuery(sql: string, maxRows: number): Promise<any> {
    const qs = new URLSearchParams({
      query: sql,
      default_format: 'JSON',
      max_result_rows: String(maxRows),
      result_overflow_mode: 'break',
    });
    return fetchJSON(`${chUrl}/?${qs}`);
  }

  // ── clickhouse_query ────────────────────────────────────────────────────

  server.tool(
    'clickhouse_query',
    'Run a read-only SQL query (SELECT/SHOW/DESCRIBE) and return rows with column types. ClickHouse forces GET queries to be read-only, so writes are rejected by the engine.',
    {
      sql: z.string().describe('SQL query (e.g. "SELECT count() FROM otel_logs WHERE timestamp > now() - INTERVAL 1 HOUR")'),
      max_rows: z.number().default(1000).describe('Max result rows to return'),
    },
    async ({ sql, max_rows }) => {
      try {
        const data = await runQuery(sql, max_rows);
        return textResult({
          columns: (data.meta || []).map((m: any) => ({ name: m.name, type: m.type })),
          rows: data.rows ?? (data.data || []).length,
          data: data.data || [],
          statistics: data.statistics || null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── clickhouse_databases ──────────────────────────────────────────────────

  server.tool(
    'clickhouse_databases',
    'List databases.',
    {},
    async () => {
      try {
        const data = await runQuery('SHOW DATABASES', 1000);
        return textResult({ databases: (data.data || []).map((r: any) => r.name) });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── clickhouse_tables ──────────────────────────────────────────────────────

  server.tool(
    'clickhouse_tables',
    'List tables, optionally within a database, with engine and approximate row/byte counts.',
    {
      database: z.string().optional().describe('Database to list (defaults to all)'),
    },
    async ({ database }) => {
      try {
        const where = database ? `WHERE database = ${sqlString(database)}` : '';
        const sql = `SELECT database, name, engine, total_rows, total_bytes FROM system.tables ${where} ORDER BY database, name`;
        const data = await runQuery(sql, 5000);
        return textResult({ count: (data.data || []).length, tables: data.data || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── clickhouse_table_schema ───────────────────────────────────────────────

  server.tool(
    'clickhouse_table_schema',
    'Describe a table — column names, types, and codecs.',
    {
      database: z.string().describe('Database name'),
      table: z.string().describe('Table name'),
    },
    async ({ database, table }) => {
      try {
        const db = safeIdent(database, 'database');
        const tbl = safeIdent(table, 'table');
        const data = await runQuery(`DESCRIBE TABLE ${db}.${tbl}`, 2000);
        const columns = (data.data || []).map((c: any) => ({
          name: c.name,
          type: c.type,
          default: c.default_expression || null,
          codec: c.codec_expression || null,
        }));
        return textResult({ database: db, table: tbl, columns });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── clickhouse_logs_search ─────────────────────────────────────────────────

  server.tool(
    'clickhouse_logs_search',
    'Convenience log search over a ClickHouse table: filter by time window, optional message substring (ILIKE), and optional level, newest first. For non-standard schemas use clickhouse_query directly.',
    {
      table: z.string().describe('Table name'),
      database: z.string().default('default').describe('Database name'),
      time_column: z.string().default('timestamp').describe('Timestamp column to filter and sort by'),
      message_column: z.string().default('message').describe('Column holding the log message'),
      level_column: z.string().optional().describe('Column holding the severity/level, if any'),
      search: z.string().optional().describe('Substring to match in the message column (ILIKE)'),
      level: z.string().optional().describe('Exact level to match (requires level_column)'),
      since: z.string().default('1h').describe('Time window (e.g. "15m", "1h", "1d")'),
      limit: z.number().default(100).describe('Max log lines to return'),
    },
    async (p) => {
      try {
        const db = safeIdent(p.database, 'database');
        const tbl = safeIdent(p.table, 'table');
        const timeCol = safeIdent(p.time_column, 'time_column');
        const msgCol = safeIdent(p.message_column, 'message_column');
        const levelCol = p.level_column ? safeIdent(p.level_column, 'level_column') : null;

        const seconds = Math.round(parseDuration(p.since) / 1000);
        const selectCols = [timeCol, ...(levelCol ? [levelCol] : []), msgCol].join(', ');
        const conditions = [`${timeCol} >= now() - INTERVAL ${seconds} SECOND`];
        if (p.search) conditions.push(`${msgCol} ILIKE ${sqlString(`%${p.search}%`)}`);
        if (p.level && levelCol) conditions.push(`${levelCol} = ${sqlString(p.level)}`);

        const sql =
          `SELECT ${selectCols} FROM ${db}.${tbl} ` +
          `WHERE ${conditions.join(' AND ')} ` +
          `ORDER BY ${timeCol} DESC LIMIT ${Math.max(1, Math.floor(p.limit))}`;

        const data = await runQuery(sql, p.limit);
        return textResult({ count: (data.data || []).length, lines: data.data || [] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'clickhouse',
  name: 'ClickHouse Logs',
  description: 'Query logs and events stored in ClickHouse via its read-only HTTP query API',
  tools: 5,
  backends: ['ClickHouse'],
  isAvailable: () => !!process.env['CLICKHOUSE_URL'],
  register: registerTools,
};
