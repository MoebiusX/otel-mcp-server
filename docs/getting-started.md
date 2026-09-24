# Getting Started

Connect an AI agent to your observability stack in about five minutes.

By the end you will have Claude Desktop (or any MCP client) answering questions
like *"which scrape targets are down?"* and *"find me any request slower than a
second, then show me the logs around it"* against your own Prometheus, Jaeger,
and Loki.

**Prerequisites:** Node.js ≥ 20, and at least one observability backend you can
reach. Prometheus alone is enough to finish this guide.

---

## 1. Check it runs

No clone, no build:

```bash
npx -y @moebiusx/otel-mcp-server --tools traces,metrics,logs
```

You should see:

```
✓ otel-mcp-server v1.8.0 running on stdio
  Skills:  3/3 configured — 15 tools registered
    ✓ traces         — Distributed Traces (5 tools) [Jaeger]
    ✓ metrics        — Prometheus Metrics (6 tools) [Prometheus]
    ✓ logs           — Structured Logs (4 tools) [Loki]
```

Press Ctrl-C. The server speaks [MCP](https://modelcontextprotocol.io) over
stdin/stdout, so running it directly like this is only a smoke test — an MCP
client drives it in step 3.

> **Why `--tools`?** With no flag the server registers 29 tools, but 14 of them
> target an application API you almost certainly do not run (`zk-proofs`,
> `public-exchange`, and most of `system`). Starting with the three core
> OpenTelemetry skills keeps the agent's tool list relevant. Add more as you
> configure them — `--tools` accepts any of the [26 skills](../README.md#skills).

## 2. Point it at your stack

The server self-configures from environment variables. One URL per backend:

```bash
export PROMETHEUS_URL=http://localhost:9090
export JAEGER_URL=http://localhost:16686
export LOKI_URL=http://localhost:3100
```

Only set the ones you actually run — a skill whose URL is missing simply does
not register, and its tools never appear to the agent.

Backends behind auth take a token alongside the URL
(`PROMETHEUS_AUTH_TOKEN`, `_AUTH_BASIC`, or OAuth client-credentials — see
[Backend Authentication](../README.md#backend-authentication)).

**Confirm the server actually reached them.** Run it in HTTP mode for a moment
and ask `/health`:

```bash
npx -y @moebiusx/otel-mcp-server --http 3001
```

```bash
curl -s http://localhost:3001/health | jq '.backendVersions'
```

```json
[
  {
    "skillId": "metrics",
    "product": "Prometheus",
    "detectedVersion": "2.53.0",
    "source": "probe",
    "url": "http://localhost:9090"
  }
]
```

`"source": "probe"` with a `detectedVersion` means the server talked to your
backend. `"source": "default"` with `"detectedVersion": null` means it could
not — check the URL, and that it is reachable from wherever the server runs.

> HTTP mode with no `MCP_AUTH_KEYS` is **open to anyone who can reach the
> port**, and `/health` and `/metrics` are always unauthenticated. That is fine
> for this localhost check; set
> [client keys](../README.md#client-authentication-http-mode) before exposing
> it anywhere.

## 3. Connect your agent

**Claude Desktop** — edit `claude_desktop_config.json`
(`~/Library/Application Support/Claude/` on macOS,
`%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "otel": {
      "command": "npx",
      "args": ["-y", "@moebiusx/otel-mcp-server", "--tools", "traces,metrics,logs"],
      "env": {
        "PROMETHEUS_URL": "http://localhost:9090",
        "JAEGER_URL": "http://localhost:16686",
        "LOKI_URL": "http://localhost:3100"
      }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the 🔌 icon.

**VS Code / GitHub Copilot** — same shape in `.vscode/mcp.json`; see
[`examples/vscode-mcp.json`](../examples/vscode-mcp.json). Ready-made copies of
both files live in [`examples/`](../examples/).

## 4. Ask it something

Start with questions that need only Prometheus, then walk the drill-down:

| Ask | What the agent calls |
|---|---|
| "Which of my Prometheus scrape targets are down?" | `metrics_targets` |
| "What alerts are firing right now?" | `metrics_alerts` |
| "Show me p95 latency for the checkout service over the last hour" | `metrics_query_range` |
| "Which services are sending traces? Find me any request slower than 1s" | `traces_services`, `traces_search` |
| "Pull the logs around trace `<id>`" | `trace_get`, `logs_tail_context` |

That last sequence — **metrics → traces → logs** — is the drill-down the server
is built around, and it's what makes an agent genuinely faster than clicking
through three UIs. The server also exposes a `otel://overview` resource
describing this and other workflows, which agents read on their own.

## 5. When something doesn't work

| What you see | What it means |
|---|---|
| `Error: fetch failed` from a tool | The backend is unreachable. Check `/health` → `backendVersions` shows `"source": "probe"`, not `"default"`. From a container, `localhost` is the container — use `host.docker.internal` or a service name. |
| No tools in the client at all | The client couldn't start the server. Check the client's MCP log for the startup banner — the `Skills:` line tells you what registered. |
| Fewer tools than expected | A backend URL is missing. The `✗ … not configured` lines in the banner name the skills that didn't register. |
| `Unauthorized` over HTTP | `MCP_AUTH_KEYS` is set; pass `Authorization: Bearer <key>`. |
| `Not Acceptable: Client must accept both…` | A raw `curl` missing headers — see below. |

**Talking to the HTTP endpoint directly.** MCP 2026-07-28 is stateless, so a
tool listing is a single POST with no handshake and no session:

```bash
curl -s -X POST http://localhost:3001/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Swap `tools/list` for `server/discover` to get server info, supported protocol
revisions, and the skill inventory with backend names in one call — the
quickest "what does this server see?" check there is.

Add `-H 'Authorization: Bearer sk-…'` when `MCP_AUTH_KEYS` is set.

## Where next

- **Add more backends** — [Backend URLs](../README.md#backend-urls) covers all
  26 skills: Grafana, Elasticsearch, Alertmanager, ClickHouse, Kubernetes,
  Pyroscope, service mesh, and more.
- **Run it for a team** — [Client Authentication](../README.md#client-authentication-http-mode)
  for API keys, then [JIT Privileged Identity](../README.md#just-in-time-jit-privileged-identity)
  to replace standing credentials with short-lived scoped tokens.
- **Deploy it** — [Kubernetes Deployment](../README.md#kubernetes-deployment)
  and [High availability](../README.md#high-availability-multiple-replicas).
- **Protocol details** — [MCP 2026-07-28 support](../README.md#mcp-2026-07-28-support).
  Older and newer MCP clients are served on the same endpoint with nothing to
  configure, so you can ignore this until you need it.
