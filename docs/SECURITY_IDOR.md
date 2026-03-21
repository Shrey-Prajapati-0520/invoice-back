# IDOR Prevention & Ownership Checks

This document summarizes how the backend prevents Insecure Direct Object Reference (IDOR) vulnerabilities.

## Principle

Every API request that accesses, modifies, or deletes a resource by ID **must** verify the logged-in user owns that resource (or is an authorized party, e.g. invoice recipient).

## Implementation Pattern

1. **AuthGuard** – All protected routes require a valid JWT. `req.user` is set with the Supabase user (`id`, `email`, etc.).

2. **Ownership filter** – All queries that fetch/update/delete by resource ID include:
   ```ts
   .eq('user_id', req.user.id)
   ```
   or equivalent (e.g. `receiver_id` for shared resources like invoices).

3. **Shared resources** – For invoices and quotations, both **sender** and **recipient** may access:
   - `user_id === req.user.id` → owner (sender)
   - `receiver_id === req.user.id` or phone/email match → recipient

4. **404 on no match** – When update/delete affects 0 rows (resource doesn't exist or belongs to another user), return `NotFoundException` so the client receives 404 rather than a misleading success.

## Endpoints Audited

| Resource | List | Get :id | Create | Update :id | Delete :id | Ownership |
|----------|------|---------|--------|------------|------------|-----------|
| Invoices | ✓ | ✓ owner/recipient | ✓ | ✓ | ✓ | user_id, receiver_id, recipient match |
| Quotations | ✓ | ✓ owner/recipient | ✓ | — | — | user_id, receiver_id |
| Customers | ✓ | ✓ | ✓ | ✓ | ✓ | user_id |
| Items | ✓ | ✓ | ✓ | ✓ | ✓ | user_id |
| Addresses | ✓ | — | ✓ | ✓ | ✓ | user_id |
| Bank accounts | ✓ | ✓ | ✓ | ✓ | ✓ | user_id |
| Terms | ✓ | — | ✓ | ✓ | ✓ | user_id |
| Profiles | — | me only | — | me only | — | id = user.id |
| Business profiles | ✓ | ✓ | ✓ upsert | ✓ | — | user_id |
| Notifications | ✓ | — | — | read/:id | read-all | user_id |
| Messages | ✓ | — | — | mark-read | — | user_id |
| Payments create | — | — | ✓ | — | — | invoice owner/receiver/recipient |
| Reminders | — | — | send | — | — | invoice user_id |
| Recurring invoices | ✓ | — | ✓ | — | — | user_id, customer ownership |
| Invoice settings | ✓ | ✓ | ✓ | — | — | user_id |
| Reminder settings | ✓ | — | ✓ | — | — | user_id |
| Verification status | ✓ | — | pan, gstin | — | — | user_id |
| Reports | ✓ analytics | — | — | — | — | user_id |
| Push tokens | — | — | register | — | — | user_id |

## Callbacks & Public Endpoints

- **Payments callback** – Receives encrypted response from SabPaisa. Invoice ID comes from our original `create` flow (verified at init). Only pending invoices are updated to paid.
- **Payments go/:sid** – Session ID is short-lived, created during authenticated `create`. No sensitive data exposed.
