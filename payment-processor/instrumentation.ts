/**
 * OpenTelemetry Instrumentation for kx-matcher
 * 
 * CRITICAL: This file must be imported BEFORE any other modules
 * to ensure proper instrumentation of amqplib for context propagation.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
    serviceName: 'kx-matcher',
    traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces'
    }),
    instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();

console.log('[MATCHER] OpenTelemetry instrumentation initialized');

export { sdk };
