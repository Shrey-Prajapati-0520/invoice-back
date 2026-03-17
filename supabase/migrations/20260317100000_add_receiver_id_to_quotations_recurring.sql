-- Add receiver_id to quotations and recurring_invoices for consistent User B visibility.
-- Once set, User B always sees items until deleted (no dependency on profile phone/email).

-- Quotations: add receiver_id column (uuid, no FK to avoid auth schema dependency)
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS receiver_id uuid;

CREATE INDEX IF NOT EXISTS idx_quotations_receiver_id ON public.quotations(receiver_id);

COMMENT ON COLUMN public.quotations.receiver_id IS 'User B (receiver) auth UID – set when they view list; ensures permanent visibility';

-- Recurring invoices: add receiver_id column
ALTER TABLE public.recurring_invoices
  ADD COLUMN IF NOT EXISTS receiver_id uuid;

CREATE INDEX IF NOT EXISTS idx_recurring_invoices_receiver_id ON public.recurring_invoices(receiver_id);

COMMENT ON COLUMN public.recurring_invoices.receiver_id IS 'User B (receiver) auth UID – set when they view list; ensures permanent visibility';
