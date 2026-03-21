-- Ensure invoices has receiver_id (User B visibility). Add if missing.
-- Also create find_receiver_ids_by_phone RPC for reliable lookup at create time.

-- Invoices: add receiver_id column (same pattern as quotations/recurring_invoices)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS receiver_id uuid;

CREATE INDEX IF NOT EXISTS idx_invoices_receiver_id ON public.invoices(receiver_id);

COMMENT ON COLUMN public.invoices.receiver_id IS 'User B (receiver) auth UID – set at create or when they view list; ensures permanent visibility';

-- RPC: Find profile IDs by phone (last 10 digits match). Used when User A creates invoice.
-- Matches profiles where phone ends with the same 10 digits as phone_10.
-- Drop first to avoid "cannot remove parameter defaults from existing function" when redefining.
DROP FUNCTION IF EXISTS public.find_receiver_ids_by_phone(text, uuid);

CREATE OR REPLACE FUNCTION public.find_receiver_ids_by_phone(
  phone_10 text,
  exclude_id uuid
)
RETURNS TABLE (id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM profiles p
  WHERE right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(coalesce(phone_10, ''), '\D', '', 'g'), 10)
    AND length(regexp_replace(coalesce(phone_10, ''), '\D', '', 'g')) >= 10
    AND p.id != exclude_id;
$$;

COMMENT ON FUNCTION public.find_receiver_ids_by_phone IS 'Find receiver user IDs by phone (10 digits). Used when User A creates invoice to set receiver_id.';
