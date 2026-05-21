/**
 * Pinpoint skill — query the Pinpoint web API.
 *
 * Pinpoint's web API surface varies notably between versions, so this skill
 * exposes the two most stable endpoints plus a read-only GET passthrough
 * (`pinpoint_get`) for version-specific endpoints (server map, scatter, etc.).
 *
 * Tools: pinpoint_applications, pinpoint_server_time, pinpoint_get
 *
 * Enabled when `PINPOINT_URL` is set (e.g. http://localhost:8080).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('PINPOINT_URL', 'http://localhost:8080').replace(/\/$/, '');
  const fetchJSON = helpers.createFetcher('PINPOINT', 'pinpoint');

  // ── pinpoint_applications ─────────────────────────────────────────────────

  server.tool(
    'pinpoint_applications',
    'List monitored applications with their service type.',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/applications`);
        const apps = (Array.isArray(data) ? data : []).map((a: any) => ({
          applicationName: a.applicationName,
          serviceType: a.serviceType,
          code: a.code,
        }));
        return textResult({ count: apps.length, applications: apps });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── pinpoint_server_time ──────────────────────────────────────────────────

  server.tool(
    'pinpoint_server_time',
    'Get the current Pinpoint server time (useful for building time-range queries).',
    {},
    async () => {
      try {
        const data = await fetchJSON(`${baseUrl}/api/serverTime`);
        const ms = typeof data === 'number' ? data : data.currentServerTime;
        return textResult({
          currentServerTime: ms,
          iso: ms ? new Date(Number(ms)).toISOString() : null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── pinpoint_get ──────────────────────────────────────────────────────────

  server.tool(
    'pinpoint_get',
    'Read-only GET against any Pinpoint web API path — for version-specific endpoints (e.g. server map, scatter, agent list). Path must start with "/".',
    {
      path: z.string().describe('API path starting with "/" (e.g. "/api/getAgentList/getApplicationName")'),
      query: z.string().optional().describe('Raw query string without the leading "?" (e.g. "application=foo&from=...&to=...")'),
    },
    async ({ path, query }) => {
      try {
        if (!path.startsWith('/') || path.includes('..')) {
          return errorResult('path must start with "/" and must not contain ".."');
        }
        const url = `${baseUrl}${path}${query ? `?${query}` : ''}`;
        const data = await fetchJSON(url);
        return textResult(data);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'pinpoint',
  name: 'Pinpoint',
  description: 'Query the Pinpoint web API — applications, server time, and a read-only passthrough for version-specific endpoints',
  tools: 3,
  backends: ['Pinpoint'],
  isAvailable: () => !!process.env['PINPOINT_URL'],
  register: registerTools,
};
