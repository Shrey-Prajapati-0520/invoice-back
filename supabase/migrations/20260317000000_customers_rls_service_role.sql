-- =============================================================================
-- Fix: "new row violates row-level security policy for table customers"
--
-- IMPORTANT: The backend must use SUPABASE_SERVICE_KEY (not SUPABASE_ANON_KEY).
-- The service_role key bypasses RLS. If you see this error, check invoicebill-backend
-- .env has: SUPABASE_SERVICE_KEY=eyJ... (from Supabase Dashboard > API keys > service_role)
--
-- This migration adds a fallback policy for service role connections.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customers' AND policyname = 'customers_allow_service_role'
  ) THEN
    CREATE POLICY customers_allow_service_role ON customers
      FOR ALL
      USING (current_user IN ('postgres', 'supabase_admin'))
      WITH CHECK (current_user IN ('postgres', 'supabase_admin'));
  END IF;
END $$;
