# Secure Deployment Guide

## HTTPS Enforcement

- **Production:** The app enforces HTTPS via `HttpsRedirectMiddleware`. When `NODE_ENV=production` and `X-Forwarded-Proto` is `http`, requests are redirected to HTTPS.
- **Platform:** On Railway (and similar), TLS is terminated at the edge. Set `NODE_ENV=production` and ensure your platform sets `X-Forwarded-Proto: https`.
- **Security headers:** Helmet adds headers like `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` (when behind HTTPS).

## Secrets Storage

- All secrets live in environment variables (`.env` or platform Variables).
- Never commit `.env`. Use `.env.example` with placeholders only.
- See [SECRETS.md](./SECRETS.md) and [InvoiceBill/docs/SECRETS.md](../../InvoiceBill/docs/SECRETS.md).

## Database Access

- **No direct public DB access:** The backend uses Supabase’s JavaScript client (HTTPS API). No PostgreSQL port is exposed to the public.
- **Supabase Dashboard:** Use **Project Settings > API** for `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Do not enable “Direct database access” for public use.
- **Connection pooling:** When connecting via SQL (e.g. migrations), prefer Supabase’s pooler URL if available. The main app uses the Supabase JS client, which talks over HTTPS.

## Audit Logging

The app logs security-relevant events in a structured format for monitoring:

| Event Type         | When Logged                                  | Use For                      |
|--------------------|-----------------------------------------------|------------------------------|
| `auth_login`       | Login success/failure                         | Brute-force detection        |
| `auth_register`    | Registration success/failure                  | Abuse patterns               |
| `auth_forgot_password` | Forgot-password requests                  | Account enumeration checks   |
| `auth_reset_password`  | Password reset success/failure           | Token abuse                  |
| `auth_refresh`     | Token refresh success/failure                 | Token theft detection        |
| `api_error`        | 4xx/5xx responses                             | Error trends, attack patterns|
| `rate_limit`       | 429 Too Many Requests                         | Suspicious traffic           |

**Log format:** `[AUDIT] {"type":"auth_login","success":false,"email":"ab***@example.com","ip":"1.2.3.4","ts":"..."}`

- Emails are partially masked (e.g. `ab***@example.com`).
- Logs go to stdout; pipe to your log aggregator (Railway logs, Datadog, etc.) for alerting.

## Checklist Before Deploy

- [ ] `NODE_ENV=production` set
- [ ] All secrets in platform Variables (no `.env` in repo)
- [ ] Supabase `service_role` key used only on server
- [ ] HTTPS enabled at platform (Railway, etc.)
- [ ] Log aggregation configured to capture `[AUDIT]` lines
