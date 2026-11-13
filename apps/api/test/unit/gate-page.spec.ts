import { Script } from 'node:vm';
import { renderGatePage } from '../../src/survey/gate-page';
import { DEFAULT_DESIGN } from '../../src/survey/page-design';
import type { GateView } from '../../src/survey/survey.service';

const view = (over: Partial<GateView> = {}): GateView => ({
  token: 'SMP_test_token_123456',
  human: null,
  captcha: null,
  collect: { languages: true, timezone: true, fingerprint: true, signals: true },
  gateQuestions: [],
  prescreen: [],
  consent: null,
  design: DEFAULT_DESIGN,
  base: 'https://api.example.com',
  ...over,
});

/** The page's own inline script (the one carrying the nonce). */
function inlineScript(html: string): string {
  const m = /<script nonce="n0">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('no inline script');
  return m[1]!;
}

describe('gate page script', () => {
  const variants: [string, Partial<GateView>][] = [
    ['no visible steps', {}],
    ['math check', { human: { style: 'math', kind: 'input', question: '2 + 3 = ?', attemptsLeft: 3 } }],
    ['captcha + consent', { captcha: { challenge: 'abc', bits: 12 }, consent: { title: 'Privacy', body: 'Text', privacyUrl: null, version: 1 } }],
  ];

  it.each(variants)('is valid JavaScript (%s)', (_name, over) => {
    // A syntax error here leaves respondents on an empty white card and they never reach the survey.
    expect(() => new Script(inlineScript(renderGatePage(view(over), 'n0')))).not.toThrow();
  });

  it('keeps regex escapes the browser needs', () => {
    const js = inlineScript(renderGatePage(view(), 'n0'));
    expect(js).toContain('/^\\$?cdc_|');
    expect(js).toContain("replace(/\\d+([._]\\d+)*/g,'#')");
  });

  it('shows the form once the script runs', () => {
    const el = () => ({ hidden: true, textContent: '{}', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, focus() {}, appendChild() {}, setAttribute() {} });
    const form = el();
    const cfg = { ...el(), textContent: JSON.stringify({ preview: true, captcha: null, collect: { languages: false, timezone: false, fingerprint: false, signals: false }, steps: ['human'], human: { kind: 'input' } }) };
    const document = { getElementById: (id: string) => (id === 'f' ? form : id === 'cfg' ? cfg : el()) };
    const ctx = { document, window: { scrollTo() {} }, navigator: {}, Intl, Promise, JSON, Array, Object, String, Number, Math, isFinite, Uint8Array, TextEncoder, location: { pathname: '/g/x' } };
    (ctx.window as Record<string, unknown>).document = document;
    new Script(inlineScript(renderGatePage(view(), 'n0'))).runInNewContext(ctx);
    expect(form.hidden).toBe(false);
  });
});
