# Repository Analysis and Grafana Skill Plan

Date: 2026-05-20

## Executive Summary

`otel-mcp-server` is a compact TypeScript MCP server for observability backends. It is currently organized around a small skill plugin contract, with eight registered skills and up to 42 tools when all optional backends are configured. The codebase is a good fit for Grafana because the architecture is intentionally extensible, tests are fast, and the existing optional-backend patterns for Elasticsearch and Alertmanager map well to Grafana.

Implemented direction: Grafana is an optional eighth skill gated by `GRAFANA_URL`, with 10 read-only tools covering health, data sources, data source queries, dashboards, folders, alert rules, active alerts, and contact points. The implementation intentionally avoids destructive dashboard, alert, contact point, silence, and notification policy mutations.

## Current State

### Project Shape

- Runtime: Node.js >= 20, ESM TypeScript, `moduleResolution: NodeNext`.
- Main dependency surface: `@modelcontextprotocol/sdk` and `zod`; the implementation intentionally avoids a heavy framework.
- Entrypoint: `src/index.ts`, with stdio as default transport and Streamable HTTP behind `--http <port>`.
- Server factory: `src/server.ts`, which registers available skills and the generated overview resource.
- Skill registry: `src/skills.ts`, currently registering traces, metrics, logs, Elasticsearch, Alertmanager, Grafana, ZK proofs, and system health.
- Config approach: skills read environment variables through `SkillHelpers.env()` instead of a central config object.
- Build/test: `npm run build`, `npm run lint`, and `npm test`.

### Existing Skills

| Skill ID | Backend | Tools | Availability |
| --- | --- | ---: | --- |
| `traces` | Jaeger | 5 | Always registered, defaults to `JAEGER_URL=http://localhost:16686` |
| `metrics` | Prometheus | 6 | Always registered, defaults to `PROMETHEUS_URL=http://localhost:9090` |
| `logs` | Loki | 4 | Always registered, defaults to `LOKI_URL=http://localhost:3100` |
| `elasticsearch` | Elasticsearch/OpenSearch | 5 | Optional, requires `ELASTICSEARCH_URL` |
| `alertmanager` | Alertmanager | 4 | Optional, requires `ALERTMANAGER_URL` |
| `grafana` | Grafana | 10 | Optional, requires `GRAFANA_URL` |
| `zk-proofs` | App API | 4 | Always registered, defaults to `APP_API_URL=http://localhost:5000` |
| `system` | App API and Jaeger | 4 | Always registered |

Default unconfigured tool count is 23. Fully configured tool count is 42.

### Skill Architecture

The skill contract is straightforward and well suited to Grafana:

- A skill exports `id`, `name`, `description`, `tools`, `backends`, `isAvailable()`, and `register()`.
- `register()` receives `McpServer` and `SkillHelpers`.
- Backend auth is standardized through env prefixes such as `PROMETHEUS_AUTH_TOKEN`, `_AUTH_BASIC`, and `_AUTH_HEADER`.
- Fetchers are instrumented per backend and reuse `MCP_TIMEOUT_MS`.
- Tool inputs use Zod schemas and return MCP text results using shared helpers.

The existing `elasticsearch` and `alertmanager` skills are the best implementation templates for Grafana because they are optional, URL-gated, and backend-specific.

### Transport and Auth

- Stdio mode has no client auth, which is normal for local MCP use.
- HTTP mode loads client API keys from `MCP_AUTH_KEYS`, `MCP_AUTH_KEYS_FILE`, `./auth-keys.json`, or `~/.otel-mcp/auth-keys.json`.
- HTTP `/health` and `/metrics` are always unauthenticated.
- Backend auth is per backend and supports bearer, basic, and raw authorization header.
- Loki adds tenant support through `X-Scope-OrgID` via fetcher extra headers.

For Grafana, this model should support:

- `GRAFANA_URL`
- `GRAFANA_AUTH_TOKEN`
- `GRAFANA_AUTH_BASIC`
- `GRAFANA_AUTH_HEADER`
- `GRAFANA_ORG_ID` mapped to `X-Grafana-Org-Id`

### Tests and Validation

Current validation on this machine after implementing the Grafana skill:

- `npm run lint`: passed.
- `npm test`: passed, 8 files and 106 tests.
- `npm run build`: passed.
- Built MCP smoke test against local Grafana passed: all 10 Grafana tools registered, `grafana_health` returned Grafana `11.2.0`, `grafana_datasources` returned `prometheus`, and `grafana_dashboards_search` returned `GT7`, `GT7 Live HUD v3`, and `GT7 Pit Wall v2`.
- Rich live smoke test passed: `grafana_dashboard_get` extracted 29 `GT7 Pit Wall v2` panels and panel PromQL targets, and `grafana_datasource_query` returned one Grafana data frame for query `up` with fields `Time` and `up`.
- `npm audit --audit-level=moderate`: failed with 8 vulnerabilities, 5 moderate and 3 high.

### Live Local Grafana Validation

The planned Grafana API surface was tested against local Grafana at `http://localhost:3000` using Basic auth. The instance is reachable and currently contains one Prometheus data source and GT7 dashboards.

Endpoint results:

| Endpoint | Result | Notes |
| --- | --- | --- |
| `GET /api/health` | OK | Returns `commit`, `database`, and `version` |
| `GET /api/datasources` | OK | Returns 1 data source |
| `GET /api/datasources/uid/prometheus` | OK | Returns Prometheus metadata, including `jsonData.timeInterval=1s` |
| `GET /api/datasources/uid/prometheus/health` | OK | Returns `status=OK`, message `Successfully queried the Prometheus API.` |
| `GET /api/search?limit=50` | OK | Returns 1 folder and 2 dashboards |
| `GET /api/folders` | OK | Returns 1 folder |
| `GET /api/dashboards/uid/:uid` | OK | Returns dashboard JSON, panels, targets, tags, and folder metadata |
| `POST /api/ds/query` | OK | Prometheus query `up` returned one data frame with `Time` and `up` fields |
| `GET /api/v1/provisioning/alert-rules` | OK | Returns an empty array on this instance |
| `GET /api/alertmanager/grafana/api/v2/alerts` | OK | Returns an empty array on this instance |
| `GET /api/alertmanager/grafana/config/api/v1/receivers` | OK | Returns `grafana-default-email`, with sensitive integration details omitted by Grafana |
| `GET /api/alertmanager/grafana/config/api/v1/policies` | 404 | Treat notification policy support as optional/version-dependent |

Observed local objects:

- Data source: `Prometheus`, `uid=prometheus`, `type=prometheus`, `access=proxy`, `url=http://localhost:9090`, `isDefault=true`, `readOnly=true`.
- Folder: `GT7`, `uid=efld38wd6g9vka`.
- Dashboards:
   - `GT7 Live HUD v3`, `uid=fflq4dxtvhptsf`, 14 panels, tags `gt7`, `racing`.
   - `GT7 Pit Wall v2`, `uid=bflun9xtje3ggd`, 29 panels, tags `gt7`, `racing`, `pit-wall`.
- Panel targets expose PromQL cleanly via `panel.targets[].expr`, for example `gt7_session_info`, `gt7_fuel_pct`, `gt7_data_age_seconds`, `gt7_tire_temp_c{wheel="fl"}`, and `gt7_gear`.

Implementation implications from the live test:

- `grafana_dashboard_get` should summarize `dashboard.panels[].targets[]` because the data is immediately useful for agents.
- `grafana_datasource_query` should definitely use `POST /api/ds/query`; the endpoint works locally and returns Grafana data frames that need summarization.
- `grafana_datasource_health` can use the UID health endpoint for Prometheus and should gracefully handle unsupported data source types.
- `grafana_alert_rules` and active alert inspection should handle valid empty arrays as a successful no-alerts state.
- Notification policy tooling should remain optional or delayed because policy endpoints vary by Grafana version/configuration.

The test suite uses real MCP client/server pairs connected through `InMemoryTransport` and mocked `fetch`, which is a strong fit for adding Grafana tests without needing a live Grafana instance.

## Findings and Risks

### High Priority

1. `instrumentFetcher()` dropped POST options at runtime. Fixed in this implementation.

   `helpers.createFetcher()` supports `FetchOptions`, and Elasticsearch calls `fetchJSON(..., { method: 'POST', body })`, but `instrumentFetcher()` returns a wrapper that only forwards `(url, overrideTimeout)`. That means a backend using an instrumented fetcher cannot actually send method/body options. Elasticsearch tests still pass because they only match the URL and do not assert request method or body. Grafana data source querying will need POST, so this should be fixed before or as part of Grafana work.

2. Client `allowedTools` is documented but not enforced.

   `ClientKey.allowedTools` exists and the example key file advertises it, but HTTP request handling only authenticates the key and never restricts the created server or tool calls based on the client key. This matters more as Grafana adds broader read access to dashboards, queries, and alerts.

3. `npm audit` reports high-severity transitive advisories.

   The vulnerable packages appear mostly transitive through development/test tooling and MCP SDK dependencies, but the report should be reviewed and remediated with `npm audit fix` or targeted dependency updates.

### Medium Priority

4. Self-metrics define tool-call metrics but tool calls are not instrumented.

   `mcp_tool_calls_total`, `mcp_tool_duration_seconds`, and `mcp_tool_errors_total` exist in the registry, but tools are not wrapped to record them. Backend metrics are collected, but MCP tool metrics may stay empty.

5. Server version metadata was inconsistent. Fixed in this implementation.

   `server.ts` exports `VERSION = '1.2.0'`, and `metrics.serverInfo` now reports version `1.2.0`.

6. README references `.env.example`, but no `.env.example` file is present.

   The configuration section points readers to a file that is not currently in the workspace.

### Lower Priority

7. Always-available skills may register tools against default localhost URLs even when backends do not exist.

   This is intentional for local-stack ergonomics, but optional integrations such as Grafana should follow the Elasticsearch/Alertmanager pattern and require explicit configuration.

8. Dashboard and query results can be large.

   Grafana tools need conservative defaults, pagination, limits, and summaries to keep MCP responses useful for agents.

## Grafana Skill Goals

The Grafana skill should let an agent interrogate Grafana as the observability control plane:

- Discover configured data sources and their health.
- Query a selected data source through Grafana's unified query API.
- Search and inspect dashboards and panels.
- List folders and dashboard organization.
- Inspect alerting status across Grafana-managed alert rules.
- Inspect contact points, notification policies, and silences where supported.
- Correlate dashboards and panels with the existing Prometheus/Loki/Jaeger skills by data source UID, labels, folder, and tags.

The first release should be read-only. Mutating tools such as creating dashboards, changing alert rules, or managing silences should be deferred until authorization and confirmation semantics are stronger.

## Proposed Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `GRAFANA_URL` | Yes | Base Grafana URL, for example `http://localhost:3000` |
| `GRAFANA_AUTH_TOKEN` | Usually | Service account bearer token |
| `GRAFANA_AUTH_BASIC` | Optional | `user:password`, useful for local dev only |
| `GRAFANA_AUTH_HEADER` | Optional | Raw `Authorization` value, overrides token/basic |
| `GRAFANA_ORG_ID` | Optional | Sets `X-Grafana-Org-Id` for multi-org Grafana |
| `GRAFANA_DEFAULT_FROM` | Optional | Default query range, for example `now-1h` |
| `GRAFANA_MAX_ITEMS` | Optional | Default maximum list/search response size |

Implementation should use `helpers.createFetcher('GRAFANA', 'grafana', { extraHeaders })`.

## Implemented Tool Set v1

### 1. `grafana_health`

Purpose: verify Grafana reachability and version.

Grafana API:

- `GET /api/health`

Output:

- database status
- Grafana version and commit when exposed
- current org context if available from request settings

### 2. `grafana_datasources`

Purpose: list data sources and summarize their type, UID, access mode, URL, default status, and read-only metadata.

Grafana API:

- `GET /api/datasources`

Inputs:

- `type?: string`
- `name?: string`
- `limit?: number`

Output should redact secrets and avoid returning secure JSON fields.

### 3. `grafana_datasource_health`

Purpose: check one data source by UID.

Grafana API:

- `GET /api/datasources/uid/:uid`
- `GET /api/datasources/uid/:uid/health` where supported

Inputs:

- `uid: string`

Output:

- datasource metadata
- health status/message if endpoint exists
- clear fallback if the data source type does not support health checks

### 4. `grafana_datasource_query`

Purpose: run a read-only query through Grafana's unified data source query API.

Grafana API:

- `POST /api/ds/query`

Inputs:

- `datasource_uid: string`
- `query: string`
- `query_type?: string`
- `from?: string`
- `to?: string`
- `max_data_points?: number`
- `interval_ms?: number`
- `format?: 'summary' | 'raw'`

Notes:

- Prometheus and Loki need different query model shapes, so v1 should support known common types explicitly: `prometheus`, `loki`, `elasticsearch`, and a raw advanced mode.
- Default to summarized output and require `format: 'raw'` for full frames.
- Enforce a bounded time range and max data points.

### 5. `grafana_dashboards_search`

Purpose: find dashboards by text, tag, folder, type, starred status, or UID.

Grafana API:

- `GET /api/search`

Inputs:

- `query?: string`
- `tag?: string[]`
- `folder_uid?: string`
- `type?: 'dash-db' | 'dash-folder'`
- `limit?: number`

Output:

- dashboard UID/title/folder/tags/URL summary

### 6. `grafana_dashboard_get`

Purpose: retrieve dashboard structure, panels, data source references, variables, and alert-related panel metadata.

Grafana API:

- `GET /api/dashboards/uid/:uid`

Inputs:

- `uid: string`
- `include_json?: boolean` default false

Output:

- dashboard metadata
- panels with id/title/type/datasource/query summaries
- variables and tags
- raw dashboard JSON only when requested

### 7. `grafana_alert_rules`

Purpose: list Grafana-managed alert rules and current provisioning state.

Grafana API options:

- `GET /api/v1/provisioning/alert-rules`
- `GET /api/alertmanager/grafana/api/v2/alerts` for active alert instances where available

Inputs:

- `folder_uid?: string`
- `state?: 'all' | 'normal' | 'pending' | 'alerting' | 'recovering' | 'nodata' | 'error'`
- `limit?: number`

Output:

- rule UID/title/folder/condition/data source refs/state annotations
- active instance summary if available

### 8. `grafana_folders`

Purpose: list Grafana folders with UID, title, URL, and basic metadata.

Grafana API:

- `GET /api/folders`

### 9. `grafana_alerts`

Purpose: list active Grafana Alertmanager alert instances with labels, annotations, timing, and routing status.

Grafana API:

- `GET /api/alertmanager/grafana/api/v2/alerts`

### 10. `grafana_contact_points`

Purpose: list contact points / receivers with safe integration status metadata.

Grafana API:

- `GET /api/alertmanager/grafana/config/api/v1/receivers`

### Optional Future Tools

- `grafana_notification_policies`: summarize routing tree where the Grafana version exposes a compatible endpoint.
- `grafana_annotations`: search annotations for deploy and incident context.
- `grafana_incident_context`: higher-level composition tool combining dashboard search, alerts, and recent annotations.

## Implementation Plan

### Phase 0: Prerequisite Fixes

1. Fix `instrumentFetcher()` to preserve the third `FetchOptions` parameter and update its TypeScript signature.
2. Add tests proving POST method/body forwarding works with an instrumented fetcher.
3. Update `mcp_server_info{version}` to `1.2.0` or derive it from a single shared version constant.
4. Decide whether to enforce `allowedTools` before Grafana lands. If not, document that it is currently metadata only.

### Phase 1: Grafana Read-Only Skill Skeleton

1. Add `src/tools/grafana.ts`.
2. Export `skill: Skill` with `id: 'grafana'`, `name: 'Grafana'`, `tools: 10`, `backends: ['Grafana']`, and `isAvailable: () => !!process.env['GRAFANA_URL']`.
3. Add the skill to `src/skills.ts` after Alertmanager or before system health.
4. Use `GRAFANA_ORG_ID` as `X-Grafana-Org-Id` via fetcher extra headers.
5. Use URL normalization to remove trailing slash from `GRAFANA_URL`.

### Phase 2: Discovery and Dashboards

1. Implement `grafana_health`.
2. Implement `grafana_datasources`.
3. Implement `grafana_datasource_health` with graceful handling for unsupported health endpoints.
4. Implement `grafana_dashboards_search`.
5. Implement `grafana_dashboard_get` with summarized panel/query extraction.

### Phase 3: Querying and Alerts

1. Implement `grafana_datasource_query` with safe defaults and type-aware query model generation.
2. Implement `grafana_alert_rules` using provisioning and alertmanager-compatible endpoints where available.
3. Add response shaping helpers to keep query and dashboard payloads bounded.
4. Redact sensitive fields such as secure JSON data, tokens, passwords, webhook URLs, and authorization headers.
5. Treat alert notification policies as optional because the tested local Grafana returned 404 for the policy endpoint while receivers were available.

### Phase 4: Tests

1. Add `tests/grafana.test.ts` or extend `tests/new-tools.test.ts`.
2. Test zero registration when `GRAFANA_URL` is unset.
3. Test registration of all Grafana tools when `GRAFANA_URL` is set.
4. Mock each Grafana API endpoint and assert normalized outputs.
5. Assert `GRAFANA_AUTH_TOKEN` and `GRAFANA_ORG_ID` produce expected headers.
6. Assert `grafana_datasource_query` sends POST body through the instrumented fetcher.
7. Add tool count tests: fully configured count should become 42 with the 10-tool Grafana skill.

### Phase 5: Docs and Release Notes

1. Update README feature counts from 7 skills/32 tools to 8 skills/42 tools when Grafana is configured.
2. Add Grafana env vars to configuration tables.
3. Add Docker run examples for `GRAFANA_URL` and `GRAFANA_AUTH_TOKEN`.
4. Update example MCP configs with optional Grafana env vars.
5. Add changelog entry for the new skill and prerequisite bug fixes.
6. Consider adding the missing `.env.example` referenced by README.

## Suggested Acceptance Criteria

- `npm run lint` passes.
- `npm test` passes with new Grafana tests.
- `npm audit --audit-level=moderate` is reviewed and either fixed or explicitly accepted.
- `createServer({ tools: ['grafana'] })` registers no tools without `GRAFANA_URL`.
- With `GRAFANA_URL`, `grafana` registers exactly 10 tools.
- `GET /health` reports Grafana availability and tool count correctly.
- `otel://overview` includes Grafana when active.
- Grafana query, dashboard, and alert tools redact sensitive fields and cap large responses.

## Implementation Status

The read-only Grafana v1 skill has been implemented with the live-validated endpoint set. Remaining follow-up work is optional: notification policy support, annotations, and higher-level incident context composition can be added once endpoint compatibility and response shapes are verified across target Grafana versions.