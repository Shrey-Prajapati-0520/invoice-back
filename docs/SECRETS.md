# Secrets & Credentials

See the main [SECRETS.md](../../InvoiceBill/docs/SECRETS.md) in the frontend repo for full guidance.

**Never commit `.env`.** Use `.env.example` as a template with placeholders only. All real credentials must be set in `.env` (local) or in your hosting provider’s Variables (Railway, etc.).

## Database Access

- The backend uses Supabase via HTTPS API only. No direct PostgreSQL port is exposed to the public.
- Keep `SUPABASE_SERVICE_KEY` secret and server-only. Do not enable direct database connections for public access in Supabase settings.
