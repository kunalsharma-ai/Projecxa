/// <reference types="node" />
import { createHash, randomBytes } from 'crypto';
import { concat, floatToInt16, fromBase64, resampleInt16, toBase64, toBase64Url, utf8, wav } from '../src/lib/pcm';
import { makePkce, parseReturn, startUrl } from '../src/lib/sso';

jest.mock('expo-audio', () => ({}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-speech', () => ({}));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-device', () => ({}));

describe('base64', () => {
  it('matches Node for every length', () => {
    for (let n = 0; n < 40; n++) {
      const b = new Uint8Array(randomBytes(n));
      const ours = toBase64(b);
      expect(ours).toBe(Buffer.from(b).toString('base64'));
      expect(Array.from(fromBase64(ours))).toEqual(Array.from(b));
    }
  });
  it('makes base64url without padding', () => {
    expect(toBase64Url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(toBase64Url(new Uint8Array([1]))).toBe('AQ');
  });
});

describe('pcm', () => {
  it('downsamples 48 kHz to 16 kHz by averaging', () => {
    const out = resampleInt16(new Int16Array([3, 3, 3, 9, 9, 9]), 48000, 16000);
    expect(Array.from(out)).toEqual([3, 9]);
  });
  it('leaves matching rates alone and upsamples by interpolation', () => {
    const same = new Int16Array([1, 2]);
    expect(resampleInt16(same, 16000, 16000)).toBe(same);
    expect(Array.from(resampleInt16(new Int16Array([0, 100]), 8000, 16000))).toEqual([0, 50, 100, 100]);
  });
  it('clips floats to 16 bit', () => {
    expect(Array.from(floatToInt16(new Float32Array([0, 1, -1, 2])))).toEqual([0, 32767, -32768, 32767]);
  });
  it('writes a valid WAV header', () => {
    const w = wav(new Uint8Array(10), 24000);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...w.subarray(8, 12))).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(28, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(10);
    expect(w.length).toBe(54);
  });
  it('joins buffers and decodes UTF-8', () => {
    expect(Array.from(concat([new Uint8Array([1]), new Uint8Array([2, 3])]))).toEqual([1, 2, 3]);
    expect(utf8(new Uint8Array(Buffer.from('{"t":"héllo ✓ 🎙"}')))).toBe('{"t":"héllo ✓ 🎙"}');
  });
});

describe('mobile single sign-on', () => {
  it('makes an S256 PKCE pair the server can check', async () => {
    const p = await makePkce((n) => new Uint8Array(randomBytes(n)), async (s) => createHash('sha256').update(s).digest('base64'));
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toBe(createHash('sha256').update(p.verifier).digest('base64url'));
  });
  it('builds the start address', () => {
    expect(startUrl('https://x.io/api/v1', 'google', 'projexa://sso', 'abc', ' Acme ')).toBe('https://x.io/api/v1/auth/sso/google/start?client=mobile&redirect=projexa%3A%2F%2Fsso&challenge=abc&org=acme');
    expect(startUrl('https://x.io/api/v1', 'zoho', 'projexa://sso', 'abc')).not.toContain('org=');
  });
  it('reads the way back', () => {
    expect(parseReturn('projexa://sso?code=abc123')).toEqual({ code: 'abc123' });
    expect(parseReturn('exp://192.168.1.2:8081/--/sso?error=No%20account+here')).toEqual({ error: 'No account here' });
    expect(parseReturn('projexa://sso')).toHaveProperty('error');
  });
});

describe('push routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { appRoute } = require('../src/lib/push') as typeof import('../src/lib/push');
  it('maps web paths in a push to app screens', () => {
    expect(appRoute('/projects/p1?tab=monitor')).toBe('/project/p1');
    expect(appRoute('/projects/new')).toBe('/projects/new');
    expect(appRoute('/requests/t1')).toBe('/request/t1');
    expect(appRoute('/portal/vendor/requests/t1')).toBe('/portal/vendor');
    expect(appRoute('/tasks')).toBe('/tasks');
  });
});

describe('voice input', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toInputPcm } = require('../src/lib/voice') as typeof import('../src/lib/voice');
  it('turns 48 kHz stereo float into 16 kHz mono 16-bit', () => {
    const f = new Float32Array(48 * 2).fill(0.5);
    const out = toInputPcm({ data: f.buffer, sampleRate: 48000, channels: 2 }, 'float32');
    expect(out.length).toBe(16 * 2);
    expect(new Int16Array(out.buffer, out.byteOffset, out.length / 2)[0]).toBe(16383);
  });
});
