-- =============================================================================
-- Fix: "new row violates row-level security policy" when updating profile image
--
-- The backend uses SUPABASE_SERVICE_KEY. This migration adds fallback policies
-- for profiles table and storage.objects (avatars bucket) for service role.
-- =============================================================================

-- 1. Profiles table: allow service role to update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_allow_service_role'
  ) THEN
    CREATE POLICY profiles_allow_service_role ON profiles
      FOR ALL
      USING (current_user IN ('postgres', 'supabase_admin'))
      WITH CHECK (current_user IN ('postgres', 'supabase_admin'));
  END IF;
END $$;

-- 2. Storage: ensure avatars bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Storage objects: allow service role to insert/update in avatars bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'storage_avatars_allow_service_role'
  ) THEN
    CREATE POLICY storage_avatars_allow_service_role ON storage.objects
      FOR ALL
      USING (bucket_id = 'avatars' AND current_user IN ('postgres', 'supabase_admin'))
      WITH CHECK (bucket_id = 'avatars' AND current_user IN ('postgres', 'supabase_admin'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
