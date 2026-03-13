-- Fix: receiver_id is NULL because profiles.email can be empty while auth.users has the email.
-- This function looks up User B (receiver) by email in auth.users as fallback.
-- Run in Supabase SQL Editor if not using migrations.

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

COMMENT ON FUNCTION public.find_receiver_ids_by_email IS 'Find receiver user IDs by email from auth.users (fallback when profiles.email is empty)';
