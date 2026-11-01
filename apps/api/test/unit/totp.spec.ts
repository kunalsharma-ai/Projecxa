import { base32Decode, base32Encode, decryptSecret, encryptSecret, hashRecoveryCode, hotp, newRecoveryCodes, totp, verifyTotp } from '../../src/auth/totp';

// RFC 6238 appendix B test secret "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 4226 and RFC 6238 test vectors', () => {
    expect(hotp(RFC_SECRET, 0)).toBe('755224');
    expect(hotp(RFC_SECRET, 9)).toBe('520489');
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });

  it('round-trips base32', () => {
    const b = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 9]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
  });

  it('allows one step of clock drift and refuses steps already used', () => {
    const t = 1_700_000_000_000;
    const step = Math.floor(t / 30_000);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, t - 30_000), null, t)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, t + 30_000), null, t)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, t - 90_000), null, t)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, t), step, t)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', null, t)).toBeNull();
  });

  it('encrypts secrets so a different key cannot read them', () => {
    const box = encryptSecret('JBSWY3DPEHPK3PXP', 'key-one-0123456789');
    expect(decryptSecret(box, 'key-one-0123456789')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(box, 'key-two-0123456789')).toThrow();
  });

  it('makes distinct recovery codes and hashes them ignoring case and spacing', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(` ${codes[0].toUpperCase().replace(/-/g, '')} `));
  });
});
