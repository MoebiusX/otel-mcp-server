# Grafana Skill Reference

This document consolidates the old Grafana implementation notes into the current operational reference. The canonical user-facing tool catalog remains in [README.md](../README.md), while the Docker-backed validation workflow is covered in [live-testing.md](live-testing.md).

## Current State

The Grafana skill is implemented as a read-only MCP skill gated by `GRAFANA_URL`. It is intended for verification and interrogation workflows across Grafana health, data sources, dashboards, folders, alert rules, active alerts, and contact points.

| Property | Value |
| --- | --- |
| Skill ID | `grafana` |
| Backend | Grafana HTTP API |
| Availability | Enabled when `GRAFANA_URL` is set |
| Tool count | 10 |
| Live fixture | `grafana/grafana:11.1.4` in `docker-compose.live.yml` |
| Live smoke tool | `grafana_health` |

The implementation lives in [src/tools/grafana.ts](../src/tools/grafana.ts). The standard live-test profile validates the skill with an isolated Grafana fixture, then stops and removes that fixture before moving to the next skill.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `GRAFANA_URL` | Yes | Base Grafana URL, for example `http://localhost:3000` or `http://grafana:3000` inside Docker. |
| `GRAFANA_AUTH_TOKEN` | Optional | Service account bearer token. |
| `GRAFANA_AUTH_BASIC` | Optional | `user:password`, useful for local development. |
| `GRAFANA_AUTH_HEADER` | Optional | Raw `Authorization` value; overrides token/basic auth. |
| `GRAFANA_ORG_ID` | Optional | Sets `X-Grafana-Org-Id` for multi-org Grafana. |
| `GRAFANA_DEFAULT_FROM` | Optional | Default query range start for data source queries. Defaults to `now-1h`. |
| `GRAFANA_MAX_ITEMS` | Optional | Default list/search limit. Defaults to `50`, capped at `500`. |

Backend authentication is handled through the shared backend auth helpers. HTTP MCP client authentication is separate and uses `MCP_AUTH_KEYS` or an auth keys file.

## Tool Surface

| Tool | Purpose | Notes |
| --- | --- | --- |
| `grafana_health` | Reads `/api/health`. | Returns version, commit, database status, and org context when configured. |
| `grafana_datasources` | Lists data sources. | Supports type/name filters and a bounded limit; redacts sensitive metadata. |
| `grafana_datasource_health` | Checks one data source by UID. | Includes metadata plus health output when the plugin supports health checks. |
| `grafana_datasource_query` | Runs a read-only query through `/api/ds/query`. | Supports summarized or raw output; bounds interval and max data points. |
| `grafana_dashboards_search` | Searches dashboards and folders. | Supports query text, tags, folder UID, type, starred filter, and limit. |
| `grafana_dashboard_get` | Retrieves a dashboard by UID. | Summarizes panels, variables, data source refs, panel targets, and optional sanitized JSON. |
| `grafana_folders` | Lists folders. | Returns UID, title, URL, ACL/edit metadata, and bounded count. |
| `grafana_alert_rules` | Lists Grafana-managed alert rules. | Supports folder UID and datasource UID filters. |
| `grafana_alerts` | Lists active Grafana Alertmanager alerts. | Supports label matchers and active/silenced/inhibited flags. |
| `grafana_contact_points` | Lists alert contact points/receivers. | Returns safe integration status metadata only. |

All tools are read-only. Dashboard mutation, alert mutation, silence management, and notification policy changes are intentionally out of scope for this skill.

## Live Validation

The standard Docker live-test matrix includes Grafana with this fixture mapping:

```json
"grafana": {
  "profiles": ["standard"],
  "fixtures": ["grafana"],
  "smoke": { "tool": "grafana_health", "args": {} },
  "metricsContains": "backend=\"grafana\""
}
```

Run only the Grafana live smoke test:

```bash
node scripts/live-test.mjs --skill grafana --no-build
```

The default live-test mode is isolated: start Grafana, wait for `/api/health`, run the MCP smoke test, remove the MCP container, then stop and remove Grafana. A passing line looks like:

```text
PASS grafana          tested=grafana/grafana_health sent={} response={"version":"11.1.4","commit":"...","database":"ok","orgId":null} duration=58ms tools=10/10
```

For full live-test usage and the HTML report viewer, see [live-testing.md](live-testing.md) and [live-test-report-viewer.html](live-test-report-viewer.html).

## Response Safety

The skill summarizes and redacts responses before returning them to the MCP client:

- URLs with embedded credentials are redacted.
- Keys that look like passwords, secrets, tokens, API keys, authorization headers, cookies, private values, or webhooks are redacted.
- Long strings are truncated.
- Dashboard and query responses are summarized by default to avoid oversized MCP responses.
- `grafana_datasource_query` requires `format: "raw"` before returning sanitized raw Grafana data frames.

## Maintenance Notes

- Keep the README tool table as the canonical public catalog.
- Keep this file focused on Grafana-specific behavior and validation details.
- Keep live-test fixture details in `tests/live-test-matrix.json` and `docker-compose.live.yml` rather than duplicating them here.
- If new Grafana tools are added, update this file, the README Grafana table, the live-test matrix smoke coverage when appropriate, and the report viewer only if the report schema changes.
