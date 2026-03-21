# Abuse Protection & Rate Limiting

This document describes the rate limiting and abuse protection measures in place.

## Global Default

- **100 requests per minute** per IP (all endpoints unless overridden)
- Applies to both authenticated and unauthenticated requests

## Auth Endpoints (Stricter)

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /auth/register` | 5 | 15 min |
| `POST /auth/login` | 5 | 15 min |
| `POST /auth/forgot-password` | 5 | 15 min |
| `POST /auth/reset-password` | 5 | 15 min |
| `POST /auth/refresh` | 30 | 1 min |

## Sensitive Endpoints

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /payments/create` | 10 | 1 min |
| `POST /reminders/send` | 5 | 1 min |
| Push token registration | 10 | 1 min |
| Notifications list | 60 | 1 min |

## Skipped (No Rate Limit)

- `GET /health/*` – monitoring and load balancers
- `GET /`, `GET /reset-password`, `GET /health` – app entry and reset page
- `GET /payments/go/:sid` – payment redirect (user flow)
- `POST /payments/callback` – SabPaisa gateway callback (external)

## Data Creation Limits

| Controller | Limit | Window |
|------------|-------|--------|
| Invoices | 60 | 1 min |
| Quotations | 60 | 1 min |
| Recurring invoices | 60 | 1 min |

## Response on Rate Limit (429)

When a client exceeds the limit, the server returns:

```json
{
  "statusCode": 429,
  "message": "Too many requests. Please try again later.",
  "error": "Too Many Requests"
}
```

The app does not crash; the `ThrottlerExceptionFilter` ensures a safe JSON response.

## Bot Prevention

- **IP-based limiting** – Throttler uses the request IP (or `X-Forwarded-For` when behind a proxy)
- **Auth brute-force protection** – 5 attempts per 15 min on login/register
- **Email/SMS spam protection** – 5 reminders per min, 5 forgot-password per 15 min
- **Payment init spam** – 10 payment creations per min per user
