/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascade failures by detecting when an external service is failing
 * and "opening" the circuit to fail fast without trying the operation.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Service is failing, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 *
 * @see https://martinfowler.com/bliki/CircuitBreaker.html
 */

import { createLogger } from './logger';
import { ExternalServiceError } from './errors';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
    /** Name of the service/resource this breaker protects */
    name: string;
    /** Number of failures before opening the circuit */
    failureThreshold: number;
    /** Number of successes needed to close from half-open */
    successThreshold: number;
    /** Time in milliseconds to wait before transitioning from OPEN to HALF_OPEN */
    timeout: number;
    /** Optional callback when state changes */
    onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export interface CircuitBreakerMetrics {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number | null;
    totalFailures: number;
    totalSuccesses: number;
}

const DEFAULT_OPTIONS: Partial<CircuitBreakerOptions> = {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000, // 30 seconds
};

export class CircuitBreaker {
    private state: CircuitState = 'CLOSED';
    private failures = 0;
    private successes = 0;
    private lastFailureTime: number | null = null;
    private totalFailures = 0;
    private totalSuccesses = 0;
    private readonly logger;
    private readonly options: Required<CircuitBreakerOptions>;

    constructor(options: CircuitBreakerOptions) {
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
        } as Required<CircuitBreakerOptions>;

        this.logger = createLogger(`circuit-breaker:${options.name}`);
        this.logger.info({
            failureThreshold: this.options.failureThreshold,
            successThreshold: this.options.successThreshold,
            timeout: this.options.timeout,
        }, 'Circuit breaker initialized');
    }

    /**
     * Execute a function with circuit breaker protection
     * @throws ExternalServiceError if circuit is open
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        // CRITICAL: Import context to preserve OpenTelemetry trace context
        // Without this, the async execution may lose the active span
        const { context } = await import('@opentelemetry/api');
        const activeContext = context.active();

        // Check if we should transition from OPEN to HALF_OPEN
        if (this.state === 'OPEN') {
            const timeSinceFailure = Date.now() - (this.lastFailureTime ?? 0);
            if (timeSinceFailure >= this.options.timeout) {
                this.transitionTo('HALF_OPEN');
            } else {
                this.logger.debug({
                    service: this.options.name,
                    remainingMs: this.options.timeout - timeSinceFailure,
                }, 'Circuit OPEN - failing fast');
                throw new ExternalServiceError(
                    this.options.name,
                    new Error(`Circuit breaker OPEN for ${this.options.name}`)
                );
            }
        }

        try {
            // Execute within the captured context to preserve trace propagation
            const result = await context.with(activeContext, () => fn());
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);
            throw error;
        }
    }

    /**
     * Record a successful operation
     */
    private onSuccess(): void {
        this.totalSuccesses++;
        this.failures = 0; // Reset failure count on success

        if (this.state === 'HALF_OPEN') {
            this.successes++;
            this.logger.debug({
                successes: this.successes,
                threshold: this.options.successThreshold,
            }, 'Success in HALF_OPEN state');

            if (this.successes >= this.options.successThreshold) {
                this.transitionTo('CLOSED');
                this.successes = 0;
            }
        }
    }

    /**
     * Record a failed operation
     */
    private onFailure(error: unknown): void {
        this.totalFailures++;
        this.failures++;
        this.lastFailureTime = Date.now();

        this.logger.warn({
            failures: this.failures,
            threshold: this.options.failureThreshold,
            error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Operation failed');

        if (this.state === 'HALF_OPEN') {
            // Single failure in HALF_OPEN immediately opens the circuit
            this.transitionTo('OPEN');
            this.successes = 0;
        } else if (this.failures >= this.options.failureThreshold) {
            this.transitionTo('OPEN');
        }
    }

    /**
     * Transition to a new state
     */
    private transitionTo(newState: CircuitState): void {
        const oldState = this.state;
        if (oldState === newState) return;

        this.state = newState;
        this.logger.info({
            from: oldState,
            to: newState,
            service: this.options.name,
        }, 'Circuit breaker state changed');

        this.options.onStateChange?.(oldState, newState);
    }

    /**
     * Get current state
     */
    getState(): CircuitState {
        return this.state;
    }

    /**
     * Get current metrics
     */
    getMetrics(): CircuitBreakerMetrics {
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailureTime: this.lastFailureTime,
            totalFailures: this.totalFailures,
            totalSuccesses: this.totalSuccesses,
        };
    }

    /**
     * Manually reset the circuit breaker to CLOSED state
     */
    reset(): void {
        this.transitionTo('CLOSED');
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
    }

    /**
     * Check if the circuit is allowing requests
     */
    isAllowing(): boolean {
        if (this.state === 'CLOSED' || this.state === 'HALF_OPEN') {
            return true;
        }
        // In OPEN state, check if timeout has passed
        const timeSinceFailure = Date.now() - (this.lastFailureTime ?? 0);
        return timeSinceFailure >= this.options.timeout;
    }
}

/**
 * Factory for creating pre-configured circuit breakers
 */
export function createCircuitBreaker(
    name: string,
    options?: Partial<Omit<CircuitBreakerOptions, 'name'>>
): CircuitBreaker {
    return new CircuitBreaker({
        name,
        failureThreshold: options?.failureThreshold ?? 3,
        successThreshold: options?.successThreshold ?? 2,
        timeout: options?.timeout ?? 30000,
        onStateChange: options?.onStateChange,
    });
}
