import { v4 as uuidv4 } from 'uuid';

export function generateTraceId(): string {
  return uuidv4().replace(/-/g, '');
}

export function generateSpanId(): string {
  return uuidv4().replace(/-/g, '').substring(0, 16);
}

export function createTraceHeaders(traceId?: string, spanId?: string) {
  const currentTraceId = traceId || generateTraceId();
  const currentSpanId = spanId || generateSpanId();
  
  return {
    'traceparent': `00-${currentTraceId}-${currentSpanId}-01`,
    'tracestate': `payment-demo=1`,
  };
}

export function extractTraceFromHeaders(headers: Record<string, string>) {
  const traceparent = headers['traceparent'];
  if (!traceparent) return null;
  
  const parts = traceparent.split('-');
  if (parts.length !== 4) return null;
  
  return {
    traceId: parts[1],
    spanId: parts[2],
  };
}
