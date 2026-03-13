# User B Not Receiving Invoices/Quotations – Troubleshooting

## Data Model (customer_id vs receiver_id)

| Column | Meaning |
|--------|---------|
| `customer_id` | UUID from `customers` table – User A's contact/client. **Not** User B's UID. |
| `receiver_id` | User B's auth UID – the app user who receives the invoice. **Not** the same as customer_id. |

## How User B Receives Invoices/Quotations

User B sees items in their **Received** tab when:

1. **User B has signed up** – A row exists in `profiles` with their `id`
2. **Phone or email matches** – User B's `profiles.phone` or `profiles.email` matches the invoice/quotation `recipient_phone` or `recipient_email`
3. **Phone format** – System normalizes to last 10 digits (e.g. `+919876543210` → `9876543210`)

## Common Causes

| Cause | Fix |
|-------|-----|
| User B hasn't signed up | User B must create an account first |
| Profile phone/email empty | Profile may not be synced from auth; check `profiles` table |
| Phone format mismatch | Customer has `09876543210`, profile has `9876543210` – both normalize to same, but ensure customer data is correct |
| Different phone/email | Customer (User A's contact) must have same phone/email as User B's signup |

## Diagnostic Queries

Run the queries in `RECEIVER_DIAGNOSTIC_QUERIES.sql` in **Supabase → SQL Editor**.

### Quick Verification (replace placeholders)

**1. Get User B's profile:**
```sql
SELECT id, full_name, phone, email FROM profiles
WHERE email ILIKE 'userb@example.com';  -- or phone LIKE '%4321'
```

**2. Get a recent invoice's recipient:**
```sql
SELECT number, recipient_phone, recipient_email, receiver_id
FROM invoices ORDER BY created_at DESC LIMIT 5;
```

**3. Check if they match:**
- Invoice `recipient_phone` should end with same 10 digits as User B's `profiles.phone`
- Invoice `recipient_email` should match User B's `profiles.email` (case-insensitive)

### Expected Match Logic

- **Phone:** `recipient_phone` = last 10 digits of `profiles.phone` (or `recipient_phone LIKE '%XXXX'` where XXXX is last 4 digits)
- **Email:** `recipient_email ILIKE profiles.email`

## If User B Signed Up After Invoice Was Sent

Invoices/quotations are matched **at list time** by `recipient_phone` and `recipient_email`. If User B signs up later with matching phone/email, they should see past items on their next fetch. No backfill needed.

## Fix: receiver_id is NULL

If `receiver_id` is NULL on invoices, User B won't get notifications. This happens when `profiles.email` is empty (auth.users has the email but profiles may not).

**Fix:** Run the SQL in `RECEIVER_DIAGNOSTIC_QUERIES.sql` (query 0) to create `find_receiver_ids_by_email`. The backend then uses this to look up User B from `auth.users` when `profiles` has no match. Redeploy the backend after adding the function.

## RPC (Optional)

The system uses `find_receiver_ids_by_phone` RPC if it exists; otherwise falls back to `profiles` queries. The fallback works without the RPC. If you see "RPC fallback" in logs, the RPC is missing but the fallback should still find receivers.
