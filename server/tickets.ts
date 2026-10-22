import { createHash, randomBytes } from 'node:crypto';

export interface UploadTicket {
  issueId: string;
  /** Who the stored files count as uploaded by (the form's owner). */
  actorId: string;
  submitterName: string;
  remaining: number;
  expiresAt: number;
}

/**
 * Short-lived, limited permission for a request-form visitor to attach files to the one item
 * their submission created. In memory, in one process: a restart simply ends the ticket and the
 * visitor is asked to send the request again.
 */
export class UploadTickets {
  private tickets = new Map<string, UploadTicket>();

  /** Returns the secret token. Only its hash is kept. */
  create(t: { issueId: string; actorId: string; submitterName: string; maxFiles: number }, ttlMs = 15 * 60_000, now = Date.now()): string {
    this.sweep(now);
    if (this.tickets.size > 5000) this.tickets.clear(); // crude bound against someone minting tickets
    const token = randomBytes(24).toString('base64url');
    this.tickets.set(this.key(token), { issueId: t.issueId, actorId: t.actorId, submitterName: t.submitterName, remaining: t.maxFiles, expiresAt: now + ttlMs });
    return token;
  }

  /** Spends one upload. Returns the ticket, or null when it is unknown, expired or used up. */
  use(token: string, now = Date.now()): UploadTicket | null {
    const k = this.key(token);
    const t = this.tickets.get(k);
    if (!t || t.expiresAt <= now || t.remaining <= 0) {
      this.tickets.delete(k);
      return null;
    }
    t.remaining -= 1;
    if (t.remaining === 0) this.tickets.delete(k);
    return { ...t };
  }

  private key = (token: string) => createHash('sha256').update(token).digest('hex');

  private sweep(now: number) {
    for (const [k, t] of this.tickets) if (t.expiresAt <= now) this.tickets.delete(k);
  }
}
