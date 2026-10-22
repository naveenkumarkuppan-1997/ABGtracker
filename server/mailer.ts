import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Extra mail headers (for example List-Unsubscribe). Names and values are fixed by the server, never by users. */
  headers?: Record<string, string>;
}

export interface Mailer {
  /** 'smtp' = really delivered; 'console' = only logged (development / no SMTP configured). */
  kind: 'smtp' | 'console';
  send(msg: MailMessage): Promise<void>;
}

/** Development fallback: prints the message and keeps the latest few so tests can read them. */
export class ConsoleMailer implements Mailer {
  kind = 'console' as const;
  outbox: (MailMessage & { at: string })[] = [];

  /**
   * `verbose` prints the whole message (links included) for developers. In production it must be
   * off: reset and invitation links are credentials, and logs are widely readable.
   */
  constructor(private log: (line: string) => void = (l) => console.log(l), private verbose = true) {}

  async send(msg: MailMessage): Promise<void> {
    if (this.verbose) {
      this.outbox.unshift({ ...msg, at: new Date().toISOString() });
      this.outbox.length = Math.min(this.outbox.length, 50);
      this.log(`[mail not sent: no SMTP_URL] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    } else {
      this.log(`[mail not sent: SMTP_URL is not configured] subject="${msg.subject}"`);
    }
  }
}

/** Real delivery through any SMTP server (SMTP_URL, e.g. smtps://user:pass@smtp.example.com:465). */
export class SmtpMailer implements Mailer {
  kind = 'smtp' as const;
  private transport;

  constructor(url: string, private from: string) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(msg: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, headers: msg.headers });
  }
}

export const createMailer = (smtpUrl: string | undefined, from: string, opts: { log?: (line: string) => void; verbose: boolean }): Mailer =>
  smtpUrl ? new SmtpMailer(smtpUrl, from) : new ConsoleMailer(opts.log, opts.verbose);
