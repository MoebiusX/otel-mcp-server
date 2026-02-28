# On-Call Quick Guide — Tracing & Anomaly Monitoring

A short, actionable runbook for on-call engineers to triage tracing and anomaly monitoring incidents quickly.

---

## Purpose
To give on-call staff fast, reproducible steps for diagnosing tracing, anomaly, and metrics issues (Jaeger, Prometheus, Ollama analysis), and to provide quick fixes and escalation paths.

---

## At-a-glance checklist (first 5 mins) ✅
1. Confirm the alert: check the Monitor UI → **Active Alerts** and note **traceId**, **service**, **span**, **SEV**.
2. Open Jaeger (http://localhost:16686) and search the traceId: verify span hierarchy and missing/long spans.
3. Check Prometheus metrics snapshot for that timestamp (CPU, memory, request-rate, P99 latency).
4. Run `Analyze` in the Monitor UI (or POST to `/api/monitor/analyze`) to get LLM insights.
5. If SEV1/SEV2: escalate to on-call backend team (Slack #ops / PagerDuty) and attach trace + top 3 evidence points.

---

## Severity levels & quick actions 🔥
- **SEV1 (Critical)**: immediate customer impact. Gather trace + metrics, call Analyze, escalate, and prepare mitigation (rollback/restart/scaling).
- **SEV2 (Major)**: high impact on performance. Triage within 30 minutes, consider scaling or temporary throttling.
- **SEV3 (Moderate)**: investigate within a workday; collect more samples for trend analysis.
- **SEV4 / SEV5 (Minor/Low)**: monitor and group; add to backlog if recurring.

---

## Useful commands (copy & run)
- Submit order (reproduce trace):

  curl -s -X POST http://localhost:8000/api/orders -H 'Content-Type: application/json' -d '{"pair":"BTC/USD","side":"BUY","quantity":0.01,"orderType":"MARKET","userId":"seed.user.primary@krystaline.io"}'

- Manual baseline recalculation:

  curl -s -X POST http://localhost:5000/api/monitor/recalculate -H 'Content-Type: application/json'

- Trigger model analysis for a trace:

  curl -s -X POST http://localhost:5000/api/monitor/analyze -H 'Content-Type: application/json' -d '{"traceId":"<TRACE_ID>"}'

- Check server metrics endpoint (should be served by backend, not Vite):

  curl -s http://localhost:5000/metrics | head -40

- Check Ollama models and status:

  curl -s http://localhost:11434/api/tags

- Restart services (safe steps):

  taskkill /F /IM node.exe 2>nul && cmd /c "npm run dev"
  docker-compose up -d

---

## Common problems & triage tips 🛠️

1. **Missing spans / wrong hierarchy**
   - Check the **message headers** in `rabbitmq-client.ts` logs for `traceparent` and `x-parent-traceparent`.
   - Confirm producers call `propagation.inject(...)` and consumers call `propagation.extract(...)`.
   - Look at client-side: ensure `trade-form.tsx` preserves context across `await` boundaries.

2. **Orphaned response spans**
   - Verify order-matcher is not injecting its own context into the response. It should forward the original parent context (see `payment-processor/index.ts`).

3. **No metrics / metrics not showing**
   - Ensure `/metrics` is reachable on port 5000 and isn't intercepted by Vite; check `server/vite.ts` excludes `/metrics`.
   - Confirm Prometheus scrape target is up and returning metrics.

4. **LLM gives inaccurate recommendations**
   - Inspect server logs for the **actual prompt** sent to Ollama (analysis-service logs show prompt preview).
   - Confirm metrics were included; if not, check metrics-correlator logs for query failures.

5. **Slow or stuck Ollama calls**
   - Check `curl -s --max-time 10 http://localhost:11434/api/generate` for ping.
   - If the model is still loading, allow it to finish; fallback to a smaller model (we use `llama3.2:1b` for speed).

6. **Port conflicts (Windows)**
   - Jaeger grpc port 14250 can conflict on Windows. If you hit issues, check reserved range (`netsh interface ipv4 show excludedportrange protocol=tcp`) and update `docker-compose.yml` to use a port outside reserved ranges.

---

## On-call runbook: Step-by-step for a SEV1 incident
1. Capture: open Monitor UI → click anomaly → copy **traceId** and severity.
2. Validate traces: open Jaeger → load traceId → screenshot the trace hierarchy.
3. Collect metrics: query Prometheus around the timestamp (P95/P99, CPU, memory, errors).
4. Analyze: POST to `/api/monitor/analyze` with traceId and save LLM output.
5. Determine mitigation: scale service, restart worker, or roll back release depending on root cause.
6. After action: confirm recovery in UI & Jaeger, add incident notes to ticket, and re-run `POST /api/monitor/recalculate` if needed.

---

## Where to look in the repo (cheat-sheet) 📂
- Tracing propagation & client spans: `client/src/lib/tracing.ts`, `client/src/components/trade-form.tsx`
- RabbitMQ publish/consume & header injection: `server/services/rabbitmq-client.ts`
- Order-matcher consumer: `payment-processor/index.ts`
- Monitor & alerting: `server/monitor/*` (includes `anomaly-detector.ts`, `history-store.ts`, `trace-profiler.ts`)
- AI analysis: `server/monitor/analysis-service.ts`
- Metrics: `server/metrics/prometheus.ts`
- Dev server wiring (Vite + metrics): `server/vite.ts`

---

## Escalation & contact
- Slack: `#ops` (post traceId + short summary)
- Pager duty / On-call rotation: follow company on-call policy (SEV1 immediate page)

---

## Notes & best practices
- Always capture the trace snapshot and metrics snapshot before restarting services.
- Keep prompt logging enabled only during validation; disable verbose logs after confirmation.
- Use `POST /api/monitor/recalculate` to validate thresholds after bulk changes or deployments.

---