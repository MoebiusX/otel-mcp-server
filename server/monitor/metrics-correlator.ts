/**
 * Metrics Correlator Service
 * 
 * Queries Prometheus to correlate metrics with detected anomalies.
 * Provides context for WHY an anomaly occurred.
 */

// @ts-ignore - node-fetch types not installed
import fetch from 'node-fetch';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import { getErrorMessage } from '../lib/errors';

const logger = createLogger('metrics-correlator');
const PROMETHEUS_URL = config.observability.prometheusUrl;

export interface CorrelatedMetrics {
    anomalyId: string;
    timestamp: Date;
    window: {
        start: Date;
        end: Date;
    };
    service: string;
    metrics: {
        cpuPercent: number | null;
        memoryMB: number | null;
        requestRate: number | null;      // requests per second
        errorRate: number | null;        // percentage
        p99LatencyMs: number | null;     // milliseconds
        activeConnections: number | null;
    };
    insights: string[];
    healthy: boolean;
}

interface PrometheusQueryResult {
    status: string;
    data: {
        resultType: string;
        result: Array<{
            metric: Record<string, string>;
            value?: [number, string];           // instant query
            values?: Array<[number, string]>;   // range query
        }>;
    };
}

class MetricsCorrelator {
    private prometheusUrl: string;

    constructor() {
        this.prometheusUrl = PROMETHEUS_URL;
    }

    /**
     * Correlate metrics with an anomaly
     * Fetches metrics from ±2 minutes around the anomaly timestamp
     */
    async correlate(
        anomalyId: string,
        service: string,
        timestamp: Date
    ): Promise<CorrelatedMetrics> {
        const windowMs = 2 * 60 * 1000; // ±2 minutes
        const start = new Date(timestamp.getTime() - windowMs);
        const end = new Date(timestamp.getTime() + windowMs);

        logger.info({ service, timestamp: timestamp.toISOString() }, 'Fetching metrics for anomaly correlation');

        // Query all metrics in parallel
        const [cpu, memory, requestRate, errorRate, p99Latency, activeConns] = await Promise.all([
            this.queryMetricAverage('rate(process_cpu_seconds_total[1m])', service, timestamp),
            this.queryMetricAverage('process_resident_memory_bytes', service, timestamp),
            this.queryMetricAverage('rate(http_requests_total[1m])', service, timestamp),
            this.queryErrorRate(service, timestamp),
            this.queryP99Latency(service, timestamp),
            this.queryMetricAverage('http_active_connections', service, timestamp),
        ]);

        // Convert CPU to percentage (rate gives seconds/second)
        const cpuPercent = cpu !== null ? cpu * 100 : null;

        // Convert memory to MB
        const memoryMB = memory !== null ? memory / (1024 * 1024) : null;

        // Generate insights based on metrics
        const insights = this.generateInsights(cpuPercent, memoryMB, requestRate, errorRate, activeConns);

        // Determine if the system was healthy
        const healthy = insights.length === 0;

        return {
            anomalyId,
            timestamp,
            window: { start, end },
            service,
            metrics: {
                cpuPercent,
                memoryMB,
                requestRate,
                errorRate,
                p99LatencyMs: p99Latency !== null ? p99Latency * 1000 : null,
                activeConnections: activeConns,
            },
            insights,
            healthy,
        };
    }

    /**
     * Query Prometheus for a metric average at a specific time
     */
    private async queryMetricAverage(
        metricQuery: string,
        service: string,
        timestamp: Date
    ): Promise<number | null> {
        try {
            // Use instant query at the anomaly timestamp
            const time = timestamp.getTime() / 1000;
            const query = encodeURIComponent(metricQuery);
            const url = `${this.prometheusUrl}/api/v1/query?query=${query}&time=${time}`;

            const response = await fetch(url);
            if (!response.ok) {
                logger.warn({ status: response.status, metricQuery }, 'Prometheus query failed');
                return null;
            }

            const data = await response.json() as PrometheusQueryResult;

            if (data.status !== 'success' || !data.data.result.length) {
                return null;
            }

            // Get the first result value
            const result = data.data.result[0];
            if (result.value) {
                return parseFloat(result.value[1]);
            }

            return null;
        } catch (error: unknown) {
            logger.warn({ metricQuery, err: error }, 'Error querying metric from Prometheus');
            return null;
        }
    }

    /**
     * Calculate error rate as percentage
     */
    private async queryErrorRate(service: string, timestamp: Date): Promise<number | null> {
        try {
            const time = timestamp.getTime() / 1000;

            // Query error rate as percentage
            const query = encodeURIComponent(
                `sum(rate(http_request_errors_total[5m])) / sum(rate(http_requests_total[5m])) * 100`
            );
            const url = `${this.prometheusUrl}/api/v1/query?query=${query}&time=${time}`;

            const response = await fetch(url);
            if (!response.ok) return null;

            const data = await response.json() as PrometheusQueryResult;

            if (data.status !== 'success' || !data.data.result.length) {
                return 0; // No errors = 0%
            }

            const result = data.data.result[0];
            if (result.value) {
                const rate = parseFloat(result.value[1]);
                return isNaN(rate) ? 0 : rate;
            }

            return 0;
        } catch (error: unknown) {
            logger.warn({ err: error }, 'Error querying error rate from Prometheus');
            return null;
        }
    }

    /**
     * Query P99 latency from histogram
     */
    private async queryP99Latency(service: string, timestamp: Date): Promise<number | null> {
        try {
            const time = timestamp.getTime() / 1000;

            // P99 from histogram
            const query = encodeURIComponent(
                `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`
            );
            const url = `${this.prometheusUrl}/api/v1/query?query=${query}&time=${time}`;

            const response = await fetch(url);
            if (!response.ok) return null;

            const data = await response.json() as PrometheusQueryResult;

            if (data.status !== 'success' || !data.data.result.length) {
                return null;
            }

            const result = data.data.result[0];
            if (result.value) {
                return parseFloat(result.value[1]);
            }

            return null;
        } catch (error: unknown) {
            logger.warn({ err: error }, 'Error querying P99 latency from Prometheus');
            return null;
        }
    }

    /**
     * Generate human-readable insights from metrics
     */
    private generateInsights(
        cpuPercent: number | null,
        memoryMB: number | null,
        requestRate: number | null,
        errorRate: number | null,
        activeConnections: number | null
    ): string[] {
        const insights: string[] = [];

        // CPU insights
        if (cpuPercent !== null) {
            if (cpuPercent >= 90) {
                insights.push('🔥 Critical CPU usage (≥90%) - likely CPU saturation');
            } else if (cpuPercent >= 80) {
                insights.push('⚠️ High CPU usage (≥80%) - approaching saturation');
            } else if (cpuPercent >= 70) {
                insights.push('📊 Elevated CPU usage (≥70%)');
            }
        }

        // Memory insights
        if (memoryMB !== null) {
            if (memoryMB >= 1024) {
                insights.push('🔥 High memory usage (≥1GB) - potential memory pressure');
            } else if (memoryMB >= 512) {
                insights.push('⚠️ Elevated memory usage (≥512MB)');
            }
        }

        // Error rate insights
        if (errorRate !== null) {
            if (errorRate >= 10) {
                insights.push(`🔥 Critical error rate (${errorRate.toFixed(1)}%) - service degradation`);
            } else if (errorRate >= 5) {
                insights.push(`⚠️ Elevated error rate (${errorRate.toFixed(1)}%)`);
            } else if (errorRate >= 1) {
                insights.push(`📊 Notable error rate (${errorRate.toFixed(1)}%)`);
            }
        }

        // Request rate insights (compare to expected baseline)
        if (requestRate !== null && requestRate >= 100) {
            insights.push(`📈 High request rate (${requestRate.toFixed(0)} req/s)`);
        }

        // Connection insights
        if (activeConnections !== null && activeConnections >= 100) {
            insights.push(`⚠️ High active connections (${activeConnections})`);
        }

        return insights;
    }

    /**
     * Get current metrics summary for all services
     */
    async getMetricsSummary(): Promise<Record<string, any>> {
        try {
            const now = new Date();

            const [totalRequests, totalErrors, avgLatency] = await Promise.all([
                this.queryMetricAverage('sum(rate(http_requests_total[5m]))', '', now),
                this.queryMetricAverage('sum(rate(http_request_errors_total[5m]))', '', now),
                this.queryMetricAverage('avg(rate(http_request_duration_seconds_sum[5m]) / rate(http_request_duration_seconds_count[5m]))', '', now),
            ]);

            return {
                timestamp: now,
                requestsPerSecond: totalRequests,
                errorsPerSecond: totalErrors,
                avgLatencyMs: avgLatency !== null ? avgLatency * 1000 : null,
                prometheusHealthy: true,
            };
        } catch (error: unknown) {
            logger.error({ err: error }, 'Error getting metrics summary from Prometheus');
            return {
                timestamp: new Date(),
                prometheusHealthy: false,
                error: getErrorMessage(error),
            };
        }
    }

    /**
     * Check if Prometheus is reachable
     */
    async checkHealth(): Promise<boolean> {
        try {
            const response = await fetch(`${this.prometheusUrl}/-/healthy`);
            return response.ok;
        } catch {
            return false;
        }
    }
}

// Export singleton instance
export const metricsCorrelator = new MetricsCorrelator();
