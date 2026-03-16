-- Ensure profiles.avatar_url exists for profile photos
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Note: Create the 'avatars' bucket manually in Supabase Dashboard → Storage.
-- Name: avatars, Public: true
-- Or use: INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);
