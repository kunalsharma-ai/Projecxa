import { Global, Injectable, Logger, Module } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SmtpConfig } from '../common/config';
import { IntegrationsService } from '../integrations/integrations.service';

export interface Mail {
  /** Whose email settings (Settings → Integrations) send it. */
  organizationId: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string | Buffer; contentType: string }[];
  /** White-label: sender display name (the address stays the server's MAIL_FROM) and reply-to. */
  fromName?: string | null;
  replyTo?: string | null;
}
export type MailTransport = (from: string, mail: Mail) => Promise<{ messageId?: string }>;

export class MailNotConfigured extends Error {
  constructor() {
    super('Email sending is not set up yet. An admin can add the Zoho Mail settings in Settings → Integrations.');
  }
}

/**
 * Sends email through SMTP (Zoho Mail by default) with the organisation's settings from
 * Settings → Integrations, or the server's SMTP_* env when it has none. `transport` can be swapped in tests.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private cached = new Map<string, nodemailer.Transporter>();
  transport: MailTransport | null = null;

  constructor(private readonly integrations: IntegrationsService) {}

  async status(org: string) {
    const s = await this.integrations.smtp(org);
    return s ? { configured: true, host: s.host, port: s.port, from: s.from } : { configured: !!this.transport, host: null, port: null, from: null };
  }

  private transporter(s: SmtpConfig) {
    const key = JSON.stringify([s.host, s.port, s.secure, s.user, s.pass]);
    let t = this.cached.get(key);
    if (!t) {
      if (this.cached.size > 50) this.cached.clear();
      t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
      this.cached.set(key, t);
    }
    return t;
  }

  /** "Name <address>" with the organisation's sender name, keeping the configured address. */
  static from(configured: string, name?: string | null) {
    if (!name) return configured;
    const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
    return `"${name.replace(/["\\\r\n<>]/g, '').slice(0, 60)}" <${address}>`;
  }

  async send(mail: Mail) {
    const s = await this.integrations.smtp(mail.organizationId);
    if (this.transport) return this.transport(MailService.from(s?.from ?? 'reports@projexa.test', mail.fromName), mail);
    if (!s) throw new MailNotConfigured();
    const r = await this.transporter(s).sendMail({ from: MailService.from(s.from, mail.fromName), replyTo: mail.replyTo ?? undefined, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, attachments: mail.attachments });
    this.log.log(`Sent "${mail.subject}" to ${mail.to.length} recipient(s)`);
    return { messageId: r.messageId };
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
