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
  cookieName: 'projexa_token',
};
