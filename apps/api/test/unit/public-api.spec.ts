import { hmacSha256 } from '../../src/common/crypto';
import { RateLimiter } from '../../src/public-api/api-key.guard';
import { looksLikeApiKey, newApiKey } from '../../src/public-api/api-keys';
import { signWebhook } from '../../src/webhooks/webhooks.service';

describe('public API helpers', () => {
  it('makes keys that only keep a hash and a short prefix', () => {
    const a = newApiKey();
    const b = newApiKey();
    expect(a.key).not.toBe(b.key);
    expect(looksLikeApiKey(a.key)).toBe(true);
    expect(a.prefix).toHaveLength(12);
    expect(a.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(looksLikeApiKey('eyJhbGciOi.jwt.token')).toBe(false);
  });

  it('rate limits per key in fixed windows', () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.hit('k', 0).ok).toBe(true);
    expect(rl.hit('k', 10)).toMatchObject({ ok: true, remaining: 0 });
    expect(rl.hit('k', 20).ok).toBe(false);
    expect(rl.hit('other', 20).ok).toBe(true);
    expect(rl.hit('k', 1000)).toMatchObject({ ok: true, remaining: 1 });
  });

  it('signs timestamp and body like the alert webhook', () => {
    expect(signWebhook('s', '1700000000', '{"a":1}')).toBe(`sha256=${hmacSha256('s', '1700000000.{"a":1}')}`);
  });
});
