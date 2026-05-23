import http from 'node:http';

const port = Number(process.env.PORT || 5000);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function metrics(res) {
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
  res.end([
    '# HELP live_test_requests_total Requests handled by the live-test APP_API fixture',
    '# TYPE live_test_requests_total counter',
    'live_test_requests_total 1',
    '# HELP live_test_health System health gauge for the live-test APP_API fixture',
    '# TYPE live_test_health gauge',
    'live_test_health 1',
    '',
  ].join('\n'));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    json(res, 200, { status: 'ok', fixture: 'app-api' });
    return;
  }

  if (url.pathname === '/metrics') {
    metrics(res);
    return;
  }

  if (url.pathname === '/api/monitor/health') {
    json(res, 200, {
      status: 'healthy',
      services: [
        {
          name: 'app-api-fixture',
          status: 'healthy',
          avgDuration: 12,
          spanCount: 0,
          activeAnomalies: 0,
          lastSeen: new Date().toISOString(),
        },
      ],
      lastPolled: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === '/api/monitor/anomalies') {
    json(res, 200, { active: [], recentCount: 0 });
    return;
  }

  if (url.pathname === '/api/monitor/amount-anomalies') {
    json(res, 200, { active: [], recentCount: 0 });
    return;
  }

  if (url.pathname === '/api/monitor/baselines/enriched') {
    json(res, 200, { baselines: [], generatedAt: new Date().toISOString() });
    return;
  }

  if (url.pathname === '/api/public/zk/stats') {
    json(res, 200, {
      totalProofs: 1,
      verificationSuccessRate: 1,
      averageProvingTimeMs: 0,
      circuits: [{ name: 'live-test', proofs: 1 }],
    });
    return;
  }

  if (url.pathname === '/api/public/zk/solvency') {
    json(res, 200, {
      proofId: 'live-test-solvency',
      valid: true,
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  const proofMatch = url.pathname.match(/^\/api\/public\/zk\/proof\/(.+)$/);
  if (proofMatch) {
    json(res, 200, {
      tradeId: decodeURIComponent(proofMatch[1]),
      proof: { pi_a: [], pi_b: [], pi_c: [] },
      publicSignals: [],
      verificationKey: {},
    });
    return;
  }

  const verifyMatch = url.pathname.match(/^\/api\/public\/zk\/verify\/(.+)$/);
  if (verifyMatch) {
    json(res, 200, { tradeId: decodeURIComponent(verifyMatch[1]), valid: true });
    return;
  }

  json(res, 404, { error: 'not_found', path: url.pathname });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`app-api fixture listening on ${port}`);
});