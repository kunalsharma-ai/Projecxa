# Team and passwords

## Team (admins)

**Team** (`/settings/team`, in the sidebar for admins) lists every staff member (admins, project managers, sales, viewers) with role, status, how they sign in (password, two-step, Google/Microsoft/Zoho) and their last sign-in. Client and vendor logins stay under **Portal access**.

- **Invite someone**: name, work email and role. PROJEXA emails an invitation (Zoho Mail SMTP, the same settings as scheduled reports) with a link to choose a password. The link works for 72 hours. Until then the person shows as **Invited** and cannot sign in with a password (their account has a random one nobody knows). If email is not set up on the server, the screen shows the link to copy and send another way. Someone invited can also simply use single sign-on if it is on for your domain.
- **Role**: change it from the list. It applies to their next click; no sign-out needed.
- **Resend invite / Send reset link**: a new link (the previous one stops working). Invited people get a new invitation; everyone else a password reset link.
- **Sign out everywhere** (log-out icon): ends every session on every browser and device, e.g. after a lost laptop.
- **Deactivate**: they are signed out at once and cannot sign in, by password or single sign-on. Their projects, history and audit trail stay. **Reactivate** from the Deactivated view.
- You cannot remove your own admin role or deactivate yourself; another admin has to. There is always at least one active admin.

Every change is in the audit log: `user.invite`, `user.reinvite`, `user.update`, `user.deactivate`, `user.reactivate`, `user.sign_out_everywhere`, `password.reset_sent`.

## Forgot password

**Forgot password?** on the sign-in page asks for the email (and the organization slug if the email is in several). If the account exists, PROJEXA emails a reset link.

- The page always gives the same answer, so it cannot be used to find out who has an account.
- The link works **once**, for **30 minutes**. Asking again makes the earlier link stop working. At most 3 reset emails per person per hour.
- Choosing the new password signs the person out of every other session. Two-step sign-in is not changed: they still enter their authenticator code.
- No reset email is sent to staff whose organization uses "single sign-on only" (they sign in with Google, Microsoft or Zoho). Admins and portal users can always reset.
- Only a SHA-256 hash of each link is stored. The link is removed from the address bar as soon as the page opens.

## Password rules

At least 10 characters, not only digits, and not containing the part of the email before the `@` (when it is 4 characters or more). The page shows the rules while typing.

## Change your own password

**Account security** (account menu, or the shield button in the portals) → **Password**: enter the current password and the new one. Every other browser and device is signed out; the current one stays signed in.

## Setup

Emails use the SMTP settings in `apps/api/.env` (see `docs/SCHEDULED_REPORTS.md`: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`). Links point at the first `WEB_ORIGIN`, so set it to the public address of the web app.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/team` | admin |
| POST | `/team` `{ email, name, role }` | admin |
| PATCH | `/team/:id` `{ name?, role?, active? }` | admin |
| POST | `/team/:id/link` | admin |
| POST | `/team/:id/sign-out` | admin |
| POST | `/auth/password/forgot` `{ email, organization? }` | anyone |
| GET | `/auth/password/token?token=` | anyone |
| POST | `/auth/password/set` `{ token, password }` | anyone with a link |
| POST | `/auth/password/change` `{ currentPassword, newPassword }` | signed in |

`POST /users` (create with a password) still works for scripts.
