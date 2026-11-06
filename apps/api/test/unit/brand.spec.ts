import { emailHeader, emailLogoUrl, type Brand } from '../../src/branding/branding';
import { productLogoPath } from '../../src/pdf/pdf';
import { renderReportPdf } from '../../src/pdf/report-pdf';

const base: Brand = {
  appName: 'SampTrek', custom: false, tagline: null, brandColor: null, theme: null, hidePoweredBy: false, supportEmail: null, loginMessage: null,
  logoUrl: null, logoDarkUrl: null, iconUrl: null, webBase: 'https://app.example.com/', emailFromName: null, emailReplyTo: null,
};
const pdf = (over: { appName?: string; custom?: boolean }) =>
  renderReportPdf({ org: 'Acme', title: 'Weekly', reportLabel: 'Overall', from: null, to: null, filters: [], totals: null, rows: [], rowLabel: 'Client', generated: '2026-11-06', ...over });

describe('SampTrek brand', () => {
  it('emails show the SampTrek logo from the web app unless the organisation uses its own name', () => {
    expect(emailLogoUrl(base)).toBe('https://app.example.com/brand/samptrek-logo-light.png');
    expect(emailHeader(base)).toContain('alt="SampTrek by Sampledge"');
    expect(emailLogoUrl({ ...base, logoUrl: 'https://x/logo' })).toBe('https://x/logo');
    expect(emailLogoUrl({ ...base, custom: true })).toBeNull();
    expect(emailHeader({ ...base, appName: 'Acme Hub', custom: true })).not.toContain('SampTrek');
    expect(emailLogoUrl({ ...base, webBase: '' })).toBeNull();
  });

  it('report PDFs carry the SampTrek logo, and not for white-labelled organisations', async () => {
    expect(productLogoPath()).toMatch(/samptrek-logo-light\.png$/);
    const own = await pdf({});
    const white = await pdf({ appName: 'Acme Hub', custom: true });
    expect(own.includes(Buffer.from('/Subtype /Image'))).toBe(true);
    expect(white.includes(Buffer.from('/Subtype /Image'))).toBe(false);
  });
});
