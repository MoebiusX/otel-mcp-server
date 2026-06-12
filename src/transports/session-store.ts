/**
 * HTTP MCP session lifecycle management.
 *
 * The Streamable HTTP transport owns protocol details; this store owns the
 * process-level lifecycle concerns around it: lookup, last-activity tracking,
 * idle sweeping, and idempotent close cleanup.
 */

export interface ClosableTransport {
  sessionId?: string;
  onclose?: () => void;
  close(): void;
}

export interface ClosableServer {
  close(): unknown;
}

export interface SessionRecord<TTransport, TServer> {
  transport: TTransport;
  server: TServer;
  lastActivity: number;
}

export interface SessionStoreOptions {
  now?: () => number;
  onOpen?: () => void;
  onClose?: () => void;
}

export class SessionStore<
  TTransport extends ClosableTransport,
  TServer extends ClosableServer,
> {
  private readonly sessions = new Map<string, SessionRecord<TTransport, TServer>>();
  private readonly closing = new WeakSet<TTransport>();
  private readonly now: () => number;

  constructor(private readonly options: SessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /** Number of registered sessions currently tracked. */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Attach close cleanup to a new transport/server pair.
   *
   * This increments the open-session metric immediately, matching the previous
   * HTTP path where a newly-created transport was counted before initialize
   * completed.
   */
  bind(transport: TTransport, server: TServer): void {
    this.options.onOpen?.();
    transport.onclose = () => this.closeTransport(transport, server);
  }

  /** Register a transport once the SDK has assigned its MCP session id. */
  register(transport: TTransport, server: TServer): boolean {
    const sid = transport.sessionId;
    if (!sid) return false;
    this.sessions.set(sid, {
      transport,
      server,
      lastActivity: this.now(),
    });
    return true;
  }

  /** Lookup a session by id without mutating it. */
  get(sessionId: string): SessionRecord<TTransport, TServer> | undefined {
    return this.sessions.get(sessionId);
  }

  /** Lookup a session by id and mark it active. */
  touch(sessionId: string): SessionRecord<TTransport, TServer> | undefined {
    const session = this.sessions.get(sessionId);
    if (session) session.lastActivity = this.now();
    return session;
  }

  /** Close and remove all sessions idle for at least `idleMs`. */
  sweepIdle(idleMs: number): number {
    const cutoff = this.now() - idleMs;
    const stale: TTransport[] = [];
    for (const session of this.sessions.values()) {
      if (session.lastActivity < cutoff) stale.push(session.transport);
    }
    for (const transport of stale) {
      try {
        transport.close();
      } catch {
        /* already closing */
      }
    }
    return stale.length;
  }

  /**
   * Close cleanup for a transport. Safe to call multiple times for the same
   * transport; recursive close callbacks become no-ops.
   */
  closeTransport(transport: TTransport, fallbackServer?: TServer): void {
    if (this.closing.has(transport)) return;
    this.closing.add(transport);

    const sid = transport.sessionId;
    const registered = sid ? this.sessions.get(sid) : undefined;
    if (sid) this.sessions.delete(sid);
    this.options.onClose?.();

    const server = registered?.server ?? fallbackServer;
    if (server) {
      Promise.resolve(server.close()).catch(() => undefined);
    }
  }
}
