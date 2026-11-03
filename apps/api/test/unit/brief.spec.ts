import { isCountry, normalizeBrief } from '../../src/ai/brief';

const clients = [
  { id: 'c1', name: 'Acme Insights', code: 'ACME' },
  { id: 'c2', name: 'Northwind Foods', code: 'NWF' },
  { id: 'c3', name: 'Northwind Drinks', code: 'NWD' },
];

describe('normalizeBrief', () => {
  it('turns a full answer into a Create project draft', () => {
    const r = normalizeBrief(
      {
        projectName: 'EV owners – charging habits',
        clientName: 'acme insights',
        category: 'consumer',
        studyType: 'TRACKER',
        summary: 'Understand home and public charging.',
        targetGroup: 'Adults who own an EV',
        devices: { desktop: true, mobile: true, tablet: false },
        fieldStart: '2026-11-10',
        fieldEnd: '2026-11-24',
        currency: 'eur',
        loiMinutes: 12.2,
        irPercent: 0.25,
        cpi: '€4.50',
        liveSurveyUrl: 'https://survey.acme.example/s/ev?id={session_token}',
        countries: [{ countryCode: 'de', targetCompletes: 400 }, { countryCode: 'UK', targetCompletes: '300', irPercent: 18 }, { countryCode: 'fr', language: 'fr', targetCompletes: 300 }],
        quotas: ['Gender 50/50', 'Age 18-34: 30%'],
        notes: ['Exclude market research employees'],
        evidence: [{ field: 'loiMinutes', quote: 'about 12 minutes' }, { field: '', quote: 'x' }],
      },
      { clients, fileName: 'EV brief.pdf' },
    );
    expect(r.info).toMatchObject({ name: 'EV owners – charging habits', clientId: 'c1', category: 'Consumer', type: 'TRACKER', fieldStartAt: '2026-11-10', fieldEndAt: '2026-11-24' });
    expect(r.info.description).toContain('Quotas from the brief:\n- Gender 50/50');
    expect(r.info.description).toContain('Set up from the brief "EV brief.pdf".');
    expect(r.devices).toEqual({ desktop: true, mobile: true, tablet: false });
    expect(r.shared).toMatchObject({ loiMinutes: 13, irPercent: 25, cpi: 4.5, targetGroup: 'Adults who own an EV', liveSurveyUrl: 'https://survey.acme.example/s/ev?id={session_token}' });
    expect(r.rows.map((x) => [x.countryCode, x.language, x.currency, x.targetCompletes, x.irPercent])).toEqual([
      ['DE', 'de', 'EUR', 400, ''],
      ['GB', 'en', 'EUR', 300, 18],
      ['FR', 'fr', 'EUR', 300, ''],
    ]);
    expect(r.brief.client).toEqual({ id: 'c1', name: 'Acme Insights' });
    expect(r.brief.missing).toEqual([]);
    expect(r.brief.evidence).toEqual([{ field: 'loiMinutes', quote: 'about 12 minutes' }]);
    expect(r.brief.filled).toEqual(expect.arrayContaining(['Project name', 'Client', 'Category', 'Fieldwork dates', 'Devices', 'LOI', 'Incidence', 'CPI', 'Markets', 'Completes']));
  });

  it('drops what it cannot use, with warnings, and lists the gaps', () => {
    const r = normalizeBrief(
      {
        projectName: 'Snack test',
        clientName: 'Northwind',
        category: 'Space tourism',
        fieldStart: '2026-12-20',
        fieldEnd: '2026-12-01',
        loiMinutes: 600,
        cpi: 'call us',
        liveSurveyUrl: 'http://insecure.example/s',
        devices: { desktop: false, mobile: false, tablet: false },
        countries: [{ countryCode: 'XX' }, { countryCode: 'EU' }, { countryCode: 'US', targetCompletes: 0 }, { countryCode: 'US' }],
        missing: ['Incidence rate'],
      },
      { clients, fileName: null },
    );
    expect(r.info).toMatchObject({ clientId: '', category: '', fieldStartAt: '', fieldEndAt: '' });
    expect(r.shared).toMatchObject({ loiMinutes: '', cpi: '', liveSurveyUrl: '' });
    expect(r.devices).toEqual({ desktop: true, mobile: true, tablet: true });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ countryCode: 'US', language: 'en', currency: 'USD', targetCompletes: '' });
    expect(r.brief.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('matches several clients'),
      expect.stringContaining('before the start'),
      'LOI 600 is outside 1–240, so it was left empty',
      expect.stringContaining('not a usable price'),
      expect.stringContaining('not an https link'),
      expect.stringContaining('excluded every device'),
      '"XX" is not a country code, so that market was skipped',
      'US completes 0 is outside 1–1000000, so it was left empty',
      'US (en) appeared twice; the first one was kept',
    ]));
    expect(r.brief.missing).toEqual(['Incidence rate', 'Client (no match for "Northwind")', 'Category', 'LOI', 'Completes per market']);
    expect(r.info.description).toBe('Set up from a pasted brief.');
  });

  it('knows real country codes', () => {
    expect(['US', 'GB', 'DE', 'JP', 'BR'].every(isCountry)).toBe(true);
    expect(['XX', 'EU', 'UK', 'usa', ''].some(isCountry)).toBe(false);
  });
});
