export const config = {
  get jwtSecret(): string {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 16) {
      if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set (16+ chars)');
      return 'dev-only-insecure-jwt-secret-change-me';
    }
    return s;
  },
  get publicBaseUrl(): string {
    return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  },
  get publicHost(): string {
    return new URL(this.publicBaseUrl).host;
  },
  get webOrigins(): string[] {
    return (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean);
  },
  /** http:// destinations are only accepted outside production (local QA). */
  get allowHttpRedirects(): boolean {
    return process.env.NODE_ENV !== 'production';
  },
  get callbackWorkerEnabled(): boolean {
    return process.env.CALLBACK_WORKER_ENABLED !== 'false';
  },
  /** Fieldwork monitor: checks live fieldwork every five minutes. */
  get monitorEnabled(): boolean {
    return process.env.MONITOR_ENABLED !== 'false';
  },
  /** Request header carrying the respondent's country from the CDN/edge, e.g. cf-ipcountry. Unset = geolocation cannot run. */
  get geoCountryHeader(): string | null {
    const h = process.env.GEO_COUNTRY_HEADER?.trim().toLowerCase();
    return h ? h : null;
  },
  /** Key that encrypts two-step sign-in secrets. Falls back to JWT_SECRET; set it separately so rotating JWT_SECRET does not break authenticator apps. */
  get mfaEncryptionKey(): string {
    const k = process.env.MFA_ENCRYPTION_KEY;
    return k && k.length >= 16 ? k : this.jwtSecret;
  },
  /** Scheduled redirect version activation (docs/REDIRECT_DESTINATIONS.md). */
  get redirectSchedulerEnabled(): boolean {
    return process.env.REDIRECT_SCHEDULER_ENABLED !== 'false';
  },
  /** Data retention (docs/PRIVACY.md): the hourly job that anonymises old respondent data. */
  get automationSchedulerEnabled(): boolean {
    return process.env.AUTOMATION_SCHEDULER_ENABLED !== 'false';
  },
  get limitAlertsEnabled(): boolean {
    return process.env.LIMIT_ALERTS_ENABLED !== 'false';
  },
  get privacySchedulerEnabled(): boolean {
    return process.env.PRIVACY_SCHEDULER_ENABLED !== 'false';
  },
  /** Scheduled report emails: the minute-by-minute scheduler. */
  get reportSchedulerEnabled(): boolean {
    return process.env.REPORT_SCHEDULER_ENABLED !== 'false';
  },
  /** Outgoing email from the server environment. Settings → Integrations overrides it per organisation. */
  get smtp() {
    return smtpFrom(process.env);
  },
  /** Zoho Books from the server environment (bound to ZOHO_BOOKS_TENANT). */
  get zohoBooks() {
    return zohoBooksFrom(process.env);
  },
  get zohoBooksMissing(): string[] {
    return zohoBooksMissingFrom(process.env);
  },
  get zohoBooksSchedulerEnabled(): boolean {
    return process.env.ZOHO_BOOKS_SCHEDULER_ENABLED !== 'false';
  },
  get ledgers() {
    return ledgersFrom(process.env);
  },
  /** Key that encrypts accounting sign-in tokens. Falls back to the two-step sign-in key. */
  get accountingEncryptionKey(): string {
    const k = process.env.ACCOUNTING_ENCRYPTION_KEY;
    return k && k.length >= 16 ? k : this.mfaEncryptionKey;
  },
  /** Key that encrypts secrets saved in Settings → Integrations. Falls back to the accounting key. */
  get integrationsEncryptionKey(): string {
    const k = process.env.INTEGRATIONS_ENCRYPTION_KEY;
    return k && k.length >= 16 ? k : this.accountingEncryptionKey;
  },
  get ai() {
    return aiFrom(process.env);
  },
  cookieName: 'projexa_token',
};

/** Settings keyed by their environment variable names: the server env, or an organisation's saved integration. */
export type EnvMap = Record<string, string | undefined>;

/**
 * Outgoing email (docs/INTEGRATIONS.md). Zoho Mail SMTP by default: smtp.zoho.com, or
 * smtp.zoho.in / smtp.zoho.eu for accounts in those data centres. Null when not set up.
 */
export function smtpFrom(env: EnvMap): { host: string; port: number; secure: boolean; user: string; pass: string; from: string } | null {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  if (!user || !pass) return null;
  const port = Number(env.SMTP_PORT || 465);
  return {
    host: env.SMTP_HOST?.trim() || 'smtp.zoho.com',
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user,
    pass,
    from: env.MAIL_FROM?.trim() || user,
  };
}

/**
 * Direct sync to Zoho Books (docs/ZOHO_BOOKS.md). A self-client refresh token for one Zoho Books
 * organisation, bound to one SampTrek organisation by its slug. Null when any part is missing.
 */
export function zohoBooksFrom(env: EnvMap): { clientId: string; clientSecret: string; refreshToken: string; organizationId: string; tenant: string; apiUrl: string; accountsUrl: string; dc: string } | null {
  const v = (k: string) => env[k]?.trim() || '';
  const dc = (v('ZOHO_BOOKS_DC') || 'com').replace(/^\./, '');
  const c = {
    clientId: v('ZOHO_BOOKS_CLIENT_ID'),
    clientSecret: v('ZOHO_BOOKS_CLIENT_SECRET'),
    refreshToken: v('ZOHO_BOOKS_REFRESH_TOKEN'),
    organizationId: v('ZOHO_BOOKS_ORGANIZATION_ID'),
    tenant: v('ZOHO_BOOKS_TENANT'),
    apiUrl: (v('ZOHO_BOOKS_API_URL') || `https://www.zohoapis.${dc}/books/v3`).replace(/\/$/, ''),
    accountsUrl: (v('ZOHO_BOOKS_ACCOUNTS_URL') || `https://accounts.zoho.${dc}`).replace(/\/$/, ''),
    dc,
  };
  return c.clientId && c.clientSecret && c.refreshToken && c.organizationId && c.tenant ? c : null;
}

/** Names of the Zoho Books settings that are not set, for the settings screen. */
export function zohoBooksMissingFrom(env: EnvMap): string[] {
  return ['ZOHO_BOOKS_CLIENT_ID', 'ZOHO_BOOKS_CLIENT_SECRET', 'ZOHO_BOOKS_REFRESH_TOKEN', 'ZOHO_BOOKS_ORGANIZATION_ID', 'ZOHO_BOOKS_TENANT'].filter((k) => !env[k]?.trim());
}

/**
 * Direct sync to Xero, QuickBooks Online and Tally Prime (docs/ACCOUNTING_SYNC.md). Xero and
 * QuickBooks use an OAuth app per SampTrek server; each organisation signs in to its own company.
 * The URL settings only change for testing.
 */
export function ledgersFrom(env: EnvMap) {
  const v = (k: string) => env[k]?.trim() || '';
  const qbSandbox = v('QUICKBOOKS_ENVIRONMENT') === 'sandbox';
  return {
    xero: v('XERO_CLIENT_ID') && v('XERO_CLIENT_SECRET')
      ? {
          clientId: v('XERO_CLIENT_ID'),
          clientSecret: v('XERO_CLIENT_SECRET'),
          authorizeUrl: v('XERO_AUTHORIZE_URL') || 'https://login.xero.com/identity/connect/authorize',
          tokenUrl: v('XERO_TOKEN_URL') || 'https://identity.xero.com/connect/token',
          revokeUrl: v('XERO_REVOKE_URL') || 'https://identity.xero.com/connect/revocation',
          apiUrl: (v('XERO_API_URL') || 'https://api.xero.com').replace(/\/$/, ''),
          scopes: v('XERO_SCOPES') || '',
        }
      : null,
    quickbooks: v('QUICKBOOKS_CLIENT_ID') && v('QUICKBOOKS_CLIENT_SECRET')
      ? {
          clientId: v('QUICKBOOKS_CLIENT_ID'),
          clientSecret: v('QUICKBOOKS_CLIENT_SECRET'),
          sandbox: qbSandbox,
          authorizeUrl: v('QUICKBOOKS_AUTHORIZE_URL') || 'https://appcenter.intuit.com/connect/oauth2',
          tokenUrl: v('QUICKBOOKS_TOKEN_URL') || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
          revokeUrl: v('QUICKBOOKS_REVOKE_URL') || 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
          apiUrl: (v('QUICKBOOKS_API_URL') || (qbSandbox ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com')).replace(/\/$/, ''),
          minorVersion: v('QUICKBOOKS_MINOR_VERSION') || '75',
        }
      : null,
    /** Tally Prime's XML server is not safe on the internet, so it is bound to one organisation. */
    tally: v('TALLY_URL') && v('TALLY_TENANT') ? { url: v('TALLY_URL').replace(/\/$/, ''), tenant: v('TALLY_TENANT') } : null,
    schedulerEnabled: env.LEDGER_SCHEDULER_ENABLED !== 'false',
  };
}
export type LedgerApps = ReturnType<typeof ledgersFrom>;

/**
 * AI copilot and voice (docs/AI_COPILOT.md). Google Gemini through an AI Studio key, kept on the
 * server. Model names move often, so each is a setting with a current default.
 */
export function aiFrom(env: EnvMap): { provider: 'gemini'; apiKey: string; apiUrl: string; model: string; fallbackModel: string | null; liveModel: string } | null {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  return {
    provider: 'gemini',
    apiKey: key,
    apiUrl: (env.GEMINI_API_URL?.trim() || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
    model: env.AI_MODEL?.trim() || 'gemini-3.8-flash',
    fallbackModel: env.AI_FALLBACK_MODEL === '' ? null : env.AI_FALLBACK_MODEL?.trim() || 'gemini-3.5-flash-lite',
    liveModel: env.AI_LIVE_MODEL?.trim() || 'gemini-3.8-live',
  };
}
export type AiConfig = NonNullable<ReturnType<typeof aiFrom>>;
export type SmtpConfig = NonNullable<ReturnType<typeof smtpFrom>>;
export type ZohoBooksConfig = NonNullable<ReturnType<typeof zohoBooksFrom>>;
