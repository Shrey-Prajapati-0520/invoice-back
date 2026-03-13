-- =============================================================================
-- User B Receiver Diagnostic Queries
-- Run these in Supabase SQL Editor to verify why User B is not receiving
-- invoices/quotations.
-- =============================================================================

-- 0. FIX: Create function to lookup receivers from auth.users (profiles.email can be empty)
-- Run this first if receiver_id is NULL for invoices!
CREATE OR REPLACE FUNCTION public.find_receiver_ids_by_email(
  email_input text,
  exclude_id uuid
)
RETURNS TABLE (id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id FROM auth.users u
  WHERE lower(trim(u.email)) = lower(trim(email_input))
    AND u.id != exclude_id
    AND trim(coalesce(email_input, '')) != '';
$$;

-- 1. CHECK: User B's profile – phone and email must match customer
-- Replace 'USER_B_EMAIL' with User B's actual email to look up
SELECT id, full_name, phone, email, created_at
FROM profiles
WHERE email ILIKE '%USER_B_EMAIL%'
   OR phone LIKE '%USER_B_PHONE_LAST_4%';  -- e.g. '%4321' for ...4321

-- 2. CHECK: Phone format – system uses last 10 digits only
-- Verify User B's profile phone has correct format (10 digits)
SELECT id, phone,
       regexp_replace(phone, '\D', '', 'g') AS digits_only,
       right(regexp_replace(phone, '\D', '', 'g'), 10) AS last_10
FROM profiles
WHERE id = 'USER_B_UUID';  -- Replace with User B's profile id

-- 3. CHECK: Recent invoices – what recipient_phone/email is stored?
SELECT id, number, user_id, receiver_id, recipient_phone, recipient_email, created_at
FROM invoices
ORDER BY created_at DESC
LIMIT 10;

-- 4. CHECK: Recent quotations – what recipient_phone/email is stored?
SELECT id, quo_number, user_id, recipient_phone, recipient_email, created_at
FROM quotations
ORDER BY created_at DESC
LIMIT 10;

-- 5. MATCH CHECK: Does any invoice have recipient matching User B's profile?
-- Replace USER_B_PHONE_10 with User B's 10-digit phone (e.g. '9876543210')
-- Replace USER_B_EMAIL with User B's email (lowercase)
SELECT i.id, i.number, i.recipient_phone, i.recipient_email, i.receiver_id,
       p.id AS profile_id, p.phone AS profile_phone, p.email AS profile_email
FROM invoices i
CROSS JOIN profiles p
WHERE p.id = 'USER_B_UUID'
  AND (
    i.recipient_phone = right(regexp_replace(coalesce(p.phone,''), '\D', '', 'g'), 10)
    OR i.recipient_phone LIKE '%' || right(regexp_replace(coalesce(p.phone,''), '\D', '', 'g'), 10)
    OR i.recipient_email ILIKE coalesce(p.email, '')
  )
  AND i.user_id != p.id
ORDER BY i.created_at DESC
LIMIT 5;

-- 6. MATCH CHECK: Same for quotations
SELECT q.id, q.quo_number, q.recipient_phone, q.recipient_email,
       p.id AS profile_id, p.phone AS profile_phone, p.email AS profile_email
FROM quotations q
CROSS JOIN profiles p
WHERE p.id = 'USER_B_UUID'
  AND (
    q.recipient_phone = right(regexp_replace(coalesce(p.phone,''), '\D', '', 'g'), 10)
    OR q.recipient_phone LIKE '%' || right(regexp_replace(coalesce(p.phone,''), '\D', '', 'g'), 10)
    OR q.recipient_email ILIKE coalesce(p.email, '')
  )
  AND q.user_id != p.id
ORDER BY q.created_at DESC
LIMIT 5;

-- 7. CHECK: Customer phone/email (what User A sent TO)
SELECT c.id, c.name, c.phone, c.email, c.user_id
FROM customers c
WHERE c.user_id = 'USER_A_UUID'  -- Replace with User A (sender) id
ORDER BY c.created_at DESC
LIMIT 10;

-- 8. OPTIONAL: Sync profiles.email from auth.users (one-time fix for existing users)
-- Run if profiles have null email but auth.users has it
-- UPDATE profiles p
-- SET email = (SELECT lower(trim(u.email)) FROM auth.users u WHERE u.id = p.id)
-- WHERE (p.email IS NULL OR p.email = '')
--   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id AND u.email IS NOT NULL);

-- 9. CHECK: RPC exists for receiver lookup (optional – fallback works without it)
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'find_receiver_ids_by_phone';
