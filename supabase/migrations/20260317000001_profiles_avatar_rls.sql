-- =============================================================================
-- Fix: "new row violates row-level security policy" when updating profile image
--
-- Backend uses SUPABASE_SERVICE_KEY. Supabase Storage RLS can block even service
-- role in some cases. These policies explicitly allow service_role and postgres.
-- Run in Supabase SQL Editor if migrations aren't applied.
-- =============================================================================

-- 1. Profiles table: allow service role and postgres
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_allow_service_role'
  ) THEN
    CREATE POLICY profiles_allow_service_role ON profiles
      FOR ALL
      USING (
        current_user IN ('postgres', 'supabase_admin')
        OR (auth.jwt() ->> 'role') = 'service_role'
      )
      WITH CHECK (
        current_user IN ('postgres', 'supabase_admin')
        OR (auth.jwt() ->> 'role') = 'service_role'
      );
  END IF;
END $$;

-- 2. Storage: ensure avatars bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Storage objects: allow service role for avatars (INSERT/UPDATE/SELECT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'storage_avatars_service_role'
  ) THEN
    CREATE POLICY storage_avatars_service_role ON storage.objects
      FOR ALL
      USING (
        bucket_id = 'avatars'
        AND (
          current_user IN ('postgres', 'supabase_admin')
          OR (auth.jwt() ->> 'role') = 'service_role'
        )
      )
      WITH CHECK (
        bucket_id = 'avatars'
        AND (
          current_user IN ('postgres', 'supabase_admin')
          OR (auth.jwt() ->> 'role') = 'service_role'
        )
      );
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. Allow authenticated users to upload to own folder (fallback for client uploads)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'storage_avatars_authenticated'
  ) THEN
    CREATE POLICY storage_avatars_authenticated ON storage.objects
      FOR ALL
      TO authenticated
      USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 5. Public read for avatars
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'storage_avatars_public_read'
  ) THEN
    CREATE POLICY storage_avatars_public_read ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'avatars');
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
