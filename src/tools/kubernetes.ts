/**
 * Kubernetes skill — read-only access to the kube-apiserver, including any CRD.
 *
 * This is the high-leverage control-plane adapter: one generic CRD reader lets
 * an agent inspect the status of products that surface state as Custom
 * Resources — Inspektor Gadget, Cilium policies, Argo Rollouts, Flagger,
 * Kyverno/Gatekeeper, KEDA, Chaos Mesh, and more — without a bespoke skill each.
 *
 * Tools: k8s_health, k8s_api_resources, k8s_list, k8s_get, k8s_events
 *
 * Transport: Node's built-in `node:https` (not the shared fetcher), so it can
 * validate TLS against the cluster CA and present a ServiceAccount bearer token
 * without adding a dependency. Strictly read-only (GET only).
 *
 * Enabled when `KUBERNETES_URL` is set, or when running in-cluster (the
 * ServiceAccount token mount is present).
 *
 * Config:
 *   KUBERNETES_URL                      API server (default https://kubernetes.default.svc)
 *   KUBERNETES_TOKEN                    Bearer token (overrides the SA token file)
 *   KUBERNETES_TOKEN_FILE               Token file path (default SA mount)
 *   KUBERNETES_CA_FILE                  CA bundle path (default SA mount)
 *   KUBERNETES_INSECURE_SKIP_TLS_VERIFY Set "true" to skip TLS verification (dev only)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import type { Skill, SkillHelpers } from '../skill.js';
import { textResult, errorResult } from '../helpers.js';

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

/** Read the bearer token fresh each call (projected SA tokens rotate). */
function readToken(): string {
  const envTok = process.env['KUBERNETES_TOKEN'];
  if (envTok) return envTok;
  const tokFile = process.env['KUBERNETES_TOKEN_FILE'] || `${SA_DIR}/token`;
  try {
    return readFileSync(tokFile, 'utf-8').trim();
  } catch {
    return '';
  }
}

/** CA bundle is stable for the process lifetime — read once. */
let caCache: Buffer | undefined;
let caLoaded = false;
function readCA(): Buffer | undefined {
  if (caLoaded) return caCache;
  caLoaded = true;
  const caFile = process.env['KUBERNETES_CA_FILE'] || `${SA_DIR}/ca.crt`;
  try {
    if (existsSync(caFile)) caCache = readFileSync(caFile);
  } catch {
    /* fall through — no CA available */
  }
  return caCache;
}

/** GET against the kube-apiserver with SA auth and cluster-CA TLS validation. */
function k8sGet(
  baseUrl: string,
  path: string,
  timeoutMs: number,
  raw = false,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const isHttps = url.protocol === 'https:';
    const token = readToken();
    const insecure = process.env['KUBERNETES_INSECURE_SKIP_TLS_VERIFY'] === 'true';

    const opts: any = {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    if (isHttps) {
      const ca = readCA();
      if (ca && !insecure) opts.ca = ca;
      opts.rejectUnauthorized = !insecure;
    }

    const reqFn = isHttps ? httpsRequest : httpRequest;
    const req = reqFn(url, opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`HTTP ${status}: ${body.slice(0, 200)} — ${url.pathname}`));
          return;
        }
        if (raw) {
          resolve(body);
          return;
        }
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e: any) {
          reject(new Error(`Invalid JSON from ${url.pathname}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.end();
  });
}

/** Build a resource path. Empty/"core" group → /api/{version}; else /apis/{group}/{version}. */
function resourcePath(
  group: string,
  version: string,
  plural: string,
  namespace?: string,
  name?: string,
): string {
  const base = (!group || group === 'core') ? `/api/${version}` : `/apis/${group}/${version}`;
  const ns = namespace ? `/namespaces/${encodeURIComponent(namespace)}` : '';
  const nm = name ? `/${encodeURIComponent(name)}` : '';
  return `${base}${ns}/${plural}${nm}`;
}

/** Trim a Kubernetes object to the fields an agent cares about. */
function curateObject(obj: any, includeSpec: boolean): any {
  const md = obj.metadata || {};
  const status = obj.status || {};
  const conditions = Array.isArray(status.conditions)
    ? status.conditions.map((c: any) => ({
        type: c.type,
        status: c.status,
        reason: c.reason,
        message: c.message,
        lastTransitionTime: c.lastTransitionTime,
      }))
    : undefined;

  const out: any = {
    kind: obj.kind,
    name: md.name,
    namespace: md.namespace,
    creationTimestamp: md.creationTimestamp,
  };
  if (md.labels) out.labels = md.labels;
  if (status.phase) out.phase = status.phase;
  if (conditions) out.conditions = conditions;

  // Surface remaining status (the valuable part of most CRDs), minus the
  // conditions we already pulled out and minus noisy managed-field metadata.
  const { conditions: _omit, ...restStatus } = status;
  if (Object.keys(restStatus).length) out.status = restStatus;
  if (includeSpec && obj.spec) out.spec = obj.spec;
  return out;
}

function registerTools(server: McpServer, helpers: SkillHelpers): void {
  const baseUrl = helpers.env('KUBERNETES_URL', 'https://kubernetes.default.svc');
  const timeoutMs = helpers.timeoutMs;

  // ── k8s_health ────────────────────────────────────────────────────────────

  server.tool(
    'k8s_health',
    'Check kube-apiserver connectivity — returns server version and readiness.',
    {},
    async () => {
      try {
        const [version, readyz] = await Promise.all([
          k8sGet(baseUrl, '/version', timeoutMs).catch(() => null),
          k8sGet(baseUrl, '/readyz', timeoutMs, true).catch((e: any) => `error: ${e.message}`),
        ]);
        return textResult({
          apiServer: baseUrl,
          ready: typeof readyz === 'string' ? readyz.trim() : readyz,
          version: version
            ? { gitVersion: version.gitVersion, platform: version.platform }
            : null,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── k8s_api_resources ───────────────────────────────────────────────────

  server.tool(
    'k8s_api_resources',
    'Discover installed API groups, or list the resource kinds (CRDs) within one group. Use this to find out which products are installed (e.g. is chaos-mesh.org or kyverno.io present?) and the exact group/version/plural to query.',
    {
      group: z.string().optional()
        .describe('API group to introspect (e.g. "argoproj.io"). Omit to list all groups.'),
      version: z.string().optional()
        .describe('Group version; defaults to the group\'s preferred version.'),
    },
    async ({ group, version }) => {
      try {
        if (!group) {
          const data = await k8sGet(baseUrl, '/apis', timeoutMs);
          const groups = (data.groups || []).map((g: any) => ({
            name: g.name,
            preferredVersion: g.preferredVersion?.version,
            versions: (g.versions || []).map((v: any) => v.version),
          }));
          return textResult({ coreApi: '/api/v1', groupCount: groups.length, groups });
        }

        let ver = version;
        if (!ver) {
          const meta = await k8sGet(baseUrl, `/apis/${encodeURIComponent(group)}`, timeoutMs);
          ver = meta.preferredVersion?.version || meta.versions?.[0]?.version;
        }
        if (!ver) return errorResult(`No version found for group ${group}`);

        const data = await k8sGet(baseUrl, `/apis/${encodeURIComponent(group)}/${ver}`, timeoutMs);
        const resources = (data.resources || [])
          .filter((r: any) => !r.name.includes('/')) // drop subresources like status/scale
          .map((r: any) => ({
            name: r.name,
            kind: r.kind,
            namespaced: r.namespaced,
            verbs: r.verbs,
          }));
        return textResult({ group, version: ver, resources });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── k8s_list ──────────────────────────────────────────────────────────────

  server.tool(
    'k8s_list',
    'List objects of any resource or CRD, with curated status. Works for built-in resources (group="") and Custom Resources alike — e.g. group="argoproj.io" plural="rollouts", or group="chaos-mesh.org" plural="podchaos".',
    {
      group: z.string().default('')
        .describe('API group ("" for core resources like pods/services)'),
      version: z.string().default('v1').describe('API version (e.g. "v1", "v1alpha1")'),
      plural: z.string().describe('Resource plural name (e.g. "rollouts", "ciliumnetworkpolicies")'),
      namespace: z.string().optional().describe('Namespace to scope to (omit for all namespaces / cluster-scoped)'),
      label_selector: z.string().optional().describe('Label selector (e.g. "app=foo,tier=backend")'),
      limit: z.number().default(50).describe('Max objects to return'),
      include_spec: z.boolean().default(false).describe('Include each object\'s full spec (off by default to limit size)'),
    },
    async ({ group, version, plural, namespace, label_selector, limit, include_spec }) => {
      try {
        const path = resourcePath(group, version, plural, namespace);
        const qs = new URLSearchParams({ limit: String(limit) });
        if (label_selector) qs.set('labelSelector', label_selector);
        const data = await k8sGet(baseUrl, `${path}?${qs}`, timeoutMs);
        const items = (data.items || []).map((o: any) => curateObject(o, include_spec));
        return textResult({
          kind: data.kind,
          count: items.length,
          truncated: !!data.metadata?.continue,
          items,
        });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── k8s_get ───────────────────────────────────────────────────────────────

  server.tool(
    'k8s_get',
    'Get a single object (built-in or CRD) by name, with full status and optionally its spec.',
    {
      group: z.string().default('').describe('API group ("" for core resources)'),
      version: z.string().default('v1').describe('API version'),
      plural: z.string().describe('Resource plural name'),
      name: z.string().describe('Object name'),
      namespace: z.string().optional().describe('Namespace (omit for cluster-scoped resources)'),
      include_spec: z.boolean().default(true).describe('Include the object spec'),
    },
    async ({ group, version, plural, name, namespace, include_spec }) => {
      try {
        const path = resourcePath(group, version, plural, namespace, name);
        const obj = await k8sGet(baseUrl, path, timeoutMs);
        return textResult(curateObject(obj, include_spec));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );

  // ── k8s_events ────────────────────────────────────────────────────────────

  server.tool(
    'k8s_events',
    'List recent cluster events — useful for diagnosing what changed or what is failing. Filter by namespace and type.',
    {
      namespace: z.string().optional().describe('Namespace to scope to (omit for all namespaces)'),
      type: z.enum(['Normal', 'Warning', 'all']).default('all').describe('Event type filter'),
      limit: z.number().default(50).describe('Max events to return'),
    },
    async ({ namespace, type, limit }) => {
      try {
        const path = resourcePath('', 'v1', 'events', namespace);
        const qs = new URLSearchParams({ limit: String(limit) });
        const data = await k8sGet(baseUrl, `${path}?${qs}`, timeoutMs);
        const events = (data.items || [])
          .filter((e: any) => type === 'all' || e.type === type)
          .map((e: any) => ({
            type: e.type,
            reason: e.reason,
            message: e.message,
            object: `${e.involvedObject?.kind}/${e.involvedObject?.name}`,
            namespace: e.metadata?.namespace,
            count: e.count,
            lastTimestamp: e.lastTimestamp || e.eventTime || e.deprecatedLastTimestamp || null,
          }));
        return textResult({ count: events.length, events });
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  );
}

export const skill: Skill = {
  id: 'kubernetes',
  name: 'Kubernetes (CRD reader)',
  description: 'Read-only kube-apiserver access — health, API discovery, generic resource/CRD listing, and events',
  tools: 5,
  backends: ['Kubernetes'],
  isAvailable: () =>
    !!process.env['KUBERNETES_URL'] ||
    existsSync(`${SA_DIR}/token`),
  register: registerTools,
};
