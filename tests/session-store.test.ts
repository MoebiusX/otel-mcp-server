import { describe, it, expect } from 'vitest';
import { SessionStore } from '../src/transports/session-store.js';

class FakeTransport {
  onclose?: () => void;
  closeCalls = 0;

  constructor(public sessionId?: string) {}

  close(): void {
    this.closeCalls++;
    this.onclose?.();
  }
}

class FakeServer {
  closeCalls = 0;

  constructor(private readonly onClose?: () => void) {}

  close(): void {
    this.closeCalls++;
    this.onClose?.();
  }
}

describe('SessionStore', () => {
  it('registers and touches sessions by id', () => {
    let now = 1000;
    const store = new SessionStore<FakeTransport, FakeServer>({ now: () => now });
    const transport = new FakeTransport('sid-1');
    const server = new FakeServer();

    store.bind(transport, server);
    expect(store.register(transport, server)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.get('sid-1')?.lastActivity).toBe(1000);

    now = 2000;
    const touched = store.touch('sid-1');
    expect(touched?.lastActivity).toBe(2000);
  });

  it('does not register transports without a session id', () => {
    const store = new SessionStore<FakeTransport, FakeServer>();
    const transport = new FakeTransport();
    const server = new FakeServer();

    store.bind(transport, server);
    expect(store.register(transport, server)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('closes a transport/server pair only once even when close recurses', () => {
    let opened = 0;
    let closed = 0;
    const transport = new FakeTransport('sid-1');
    const server = new FakeServer(() => transport.close());
    const store = new SessionStore<FakeTransport, FakeServer>({
      onOpen: () => { opened++; },
      onClose: () => { closed++; },
    });

    store.bind(transport, server);
    store.register(transport, server);

    transport.close();
    transport.close();

    expect(opened).toBe(1);
    expect(closed).toBe(1);
    expect(server.closeCalls).toBe(1);
    expect(store.size).toBe(0);
  });

  it('sweeps idle sessions and keeps active sessions', () => {
    let now = 10_000;
    let closed = 0;
    const store = new SessionStore<FakeTransport, FakeServer>({
      now: () => now,
      onClose: () => { closed++; },
    });
    const stale = new FakeTransport('stale');
    const active = new FakeTransport('active');

    store.bind(stale, new FakeServer());
    store.register(stale, new FakeServer());
    now = 19_000;
    store.bind(active, new FakeServer());
    store.register(active, new FakeServer());
    now = 20_000;

    expect(store.sweepIdle(5_000)).toBe(1);
    expect(stale.closeCalls).toBe(1);
    expect(active.closeCalls).toBe(0);
    expect(closed).toBe(1);
    expect(store.get('stale')).toBeUndefined();
    expect(store.get('active')).toBeTruthy();
  });
});
