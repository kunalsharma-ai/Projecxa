import { Global, Injectable, Logger, Module } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { config } from '../common/config';

export interface Mail {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string; contentType: string }[];
}
export type MailTransport = (from: string, mail: Mail) => Promise<{ messageId?: string }>;

export class MailNotConfigured extends Error {
  constructor() {
    super('Email is not set up on the server. Add the Zoho Mail SMTP settings (SMTP_USER, SMTP_PASS, MAIL_FROM).');
  }
}

/**
 * Sends email through SMTP (Zoho Mail by default). Credentials only come from the server
 * environment, never from the database or the screen. `transport` can be swapped in tests.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private cached: nodemailer.Transporter | null = null;
  transport: MailTransport | null = null;

  status() {
    const s = config.smtp;
    return s ? { configured: true, host: s.host, port: s.port, from: s.from } : { configured: !!this.transport, host: null, port: null, from: null };
  }

  async send(mail: Mail) {
    const s = config.smtp;
    if (this.transport) return this.transport(s?.from ?? 'reports@projexa.test', mail);
    if (!s) throw new MailNotConfigured();
    this.cached ??= nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
    const r = await this.cached.sendMail({ from: s.from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, attachments: mail.attachments });
    this.log.log(`Sent "${mail.subject}" to ${mail.to.length} recipient(s)`);
    return { messageId: r.messageId };
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
