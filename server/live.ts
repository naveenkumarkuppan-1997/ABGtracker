import type { ServerResponse } from 'node:http';

const MAX_PER_USER = 5;
const KEEPALIVE_MS = 25_000;

/**
 * Tells open browsers that something changed in an organization, so they can refresh without being asked.
 * It carries no data at all (just "organization X changed"): the browser then asks for what it is allowed to see
 * the normal way, so nothing can leak through this channel. Who hears about which organization is decided by
 * membership at the moment of the change. One server process only: a second process would need a shared channel.
 */
export class LiveBus {
  private conns = new Map<string, Set<ServerResponse>>();
  private timers = new Map<ServerResponse, NodeJS.Timeout>();

  constructor(private isMember: (userId: string, orgId: string) => boolean) {}

  get count(): number {
    let n = 0;
    for (const s of this.conns.values()) n += s.size;
    return n;
  }

  /** Registers an open stream. The oldest stream of a person is closed when they have too many (many tabs). */
  add(userId: string, res: ServerResponse): void {
    const set = this.conns.get(userId) ?? new Set();
    while (set.size >= MAX_PER_USER) {
      const oldest = set.values().next().value as ServerResponse;
      this.drop(userId, oldest);
    }
    set.add(res);
    this.conns.set(userId, set);
    this.timers.set(res, setInterval(() => this.write(res, ': keepalive\n\n'), KEEPALIVE_MS).unref());
    res.on('close', () => this.drop(userId, res));
  }

  private write(res: ServerResponse, text: string): void {
    try {
      res.write(text);
    } catch {
      /* the close handler cleans up */
    }
  }

  private drop(userId: string, res: ServerResponse): void {
    clearInterval(this.timers.get(res));
    this.timers.delete(res);
    this.conns.get(userId)?.delete(res);
    if (!this.conns.get(userId)?.size) this.conns.delete(userId);
    try {
      res.end();
    } catch {
      /* already closed */
    }
  }

  /** Says "this organization changed" to everyone who belongs to it and is connected. */
  publish(orgIds: string[]): void {
    for (const orgId of new Set(orgIds)) {
      for (const [userId, set] of this.conns) {
        if (!this.isMember(userId, orgId)) continue;
        for (const res of set) this.write(res, `event: changed\ndata: ${JSON.stringify({ orgId })}\n\n`);
      }
    }
  }

  closeAll(): void {
    for (const [userId, set] of [...this.conns]) for (const res of [...set]) this.drop(userId, res);
  }
}
