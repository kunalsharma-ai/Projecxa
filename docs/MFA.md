# Two-step sign-in (MFA)

Milestone 13. After the password, PROJEXA asks for a 6-digit code from an authenticator app on
the person's phone. It uses the open TOTP standard (RFC 6238), so any free app works: Google
Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden and others. There are no SMS
or email costs and no third-party service.

## For each person

**Account security** is in the account menu (top right) for staff, and behind the shield
button in the client and vendor portals.

1. **Set up** shows a QR code and the same key as text, for apps that cannot scan.
2. Typing the first code from the app turns it on.
3. Ten **recovery codes** are shown once (download or copy). Each lets you sign in once without
   the phone. **New recovery codes** (needs a current app code) replaces them all.
4. **Turn off** needs the password and a code or recovery code. It is not offered when the
   organization requires two-step sign-in.

Sessions that were open before turning it on keep working until they expire (12 hours).

## Signing in

1. Email and password, as before. For someone with two-step sign-in, the API answers
   `{ mfaRequired: true, mfaToken }` instead of a session.
2. `POST /api/v1/auth/login/mfa` with `mfaToken` and either `code` (6 digits) or
   `recoveryCode`. Success starts the normal session.

- `mfaToken` lasts 5 minutes, is signed with its own key and cannot be used as a session.
- Codes are accepted for the current 30-second step and one step either side (phone clock
  drift). Each step is accepted once, with a guarded database update, so a code seen over a
  shoulder or replayed cannot be used again.
- Recovery codes are stored as SHA-256 hashes and removed when used (also a guarded update).
  Case, spaces and dashes do not matter. Using one is recorded in the audit trail; with 3 or
  fewer left, the person is taken to Account security after signing in.
- 10 wrong codes in a row lock the second step for 15 minutes. An admin reset also clears it.

## For admins

**Settings → Sign-in security**:

- **Require two-step sign-in for staff.** Admins, project managers, sales and viewers must turn
  it on. Until they do, every API call except the setup routes answers `403` with
  `code: "MFA_SETUP_REQUIRED"`, and the app sends them to Account security. Client and vendor
  portal users stay optional. The admin must have it on for their own account before turning
  the requirement on, so the organization cannot be locked out.
- The list shows who has it on, who must still set it up, locked accounts and low recovery
  codes.
- **Reset** clears someone's two-step sign-in (lost phone and codes). They sign in with only
  their password and, if it is required, set it up again straight away. Admins cannot reset
  their own; another admin has to. Every change is in the audit trail (`mfa.enable`,
  `mfa.disable`, `mfa.reset`, `mfa.require`, `mfa.recovery_code_used` …).

## Storage and keys

| Field (`User`) | |
|---|---|
| `mfaSecret` | The TOTP secret, encrypted with AES-256-GCM (`v1.<iv>.<tag>.<ciphertext>`) |
| `mfaPendingSecret` | Encrypted secret during setup, until the first code |
| `mfaEnabledAt` | When it was turned on |
| `mfaRecoveryCodes` | Hashes of unused recovery codes |
| `mfaLastStep` | Last accepted time step (replay protection) |
| `mfaFailures`, `mfaLockedUntil` | Lockout |

`Organization.mfaRequired` holds the rule.

The encryption key comes from `MFA_ENCRYPTION_KEY` (falls back to `JWT_SECRET`). Set it on its
own and keep it: changing it means everyone has to set up their app again (an admin reset per
person). Rotating `JWT_SECRET` then only signs everyone out.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/auth/mfa` | Signed in: status, codes left, whether required |
| POST | `/auth/mfa/setup` | Signed in: new pending secret, `otpauth://` URL, QR code (SVG) |
| POST | `/auth/mfa/enable` `{ code }` | Signed in: turns it on, returns recovery codes |
| POST | `/auth/mfa/recovery-codes` `{ code }` | Signed in: new recovery codes |
| POST | `/auth/mfa/disable` `{ password, code \| recoveryCode }` | Signed in, when not required |
| POST | `/auth/login/mfa` `{ mfaToken, code \| recoveryCode }` | Second sign-in step |
| GET, PUT | `/organization/security` `{ mfaRequired }` | Admin |
| POST | `/users/:id/mfa/reset` | Admin, not for themselves |

Public API keys (`docs/PUBLIC_API.md`) are separate and not affected.

## Code

`apps/api/src/auth/totp.ts` (TOTP, base32, encryption, recovery codes; checked against the RFC
test vectors in `test/unit/totp.spec.ts`), `mfa.service.ts`, `auth.controller.ts` (sign-in),
`auth.guard.ts` (requirement). Web: `app/login/page.tsx`, `components/account/`,
`components/settings/sign-in-security.tsx`. Tests: `test/e2e/mfa.e2e.spec.ts`.
